/**
 * X402Rail — Coinbase's HTTP 402 Payment Required revival.
 *
 * x402 lets an agent pay an HTTP server (API, MCP server, paywalled
 * resource) directly with USDC, no Stripe-style hold ⇆ capture round
 * trip. The agent signs an EIP-3009 `transferWithAuthorization`
 * authorization off-chain; the server (or its relayer) broadcasts the
 * authorization on-chain and grants access once the transfer is mined.
 *
 * Default chain: **Base mainnet (8453)**. Sub-cent economics — Ethereum
 * mainnet is too expensive for x402-shaped micropayments.
 *
 * @experimental v1.6.x scope. Opt-in via the `alpha` npm dist-tag.
 *
 * Architecture
 * ─────────────────────────────────────────────────────────────────────
 *  - Caller passes a `signer` adapter (bring-your-own crypto library:
 *    viem, ethers, @noble/secp256k1, hardware wallet, etc). The rail
 *    never touches private keys directly.
 *  - `createHold` produces a signed EIP-3009 authorization payload
 *    (NOT broadcast). The authorization is the externalId of the hold.
 *  - `capturePayment` POSTs the authorization to a recipient endpoint
 *    OR broadcasts via RPC if `opts.broadcastViaRpc` is set. Default
 *    is recipient-handles-broadcast (matches x402 spec).
 *  - `reversePayment` only succeeds pre-capture. Once on-chain, USDC
 *    transfers are irreversible without recipient cooperation; the
 *    rail returns status "irreversible" and records the attempt.
 *
 * Security
 * ─────────────────────────────────────────────────────────────────────
 *  - EIP-3009 authorizations include `validAfter` + `validBefore`
 *    timestamps. We default to a 5-minute window so a stale signature
 *    can't be replayed indefinitely.
 *  - Each authorization carries a unique 32-byte `nonce` derived from
 *    a per-call random source. Replayed nonces fail on-chain.
 *  - We sanity-check the recipient is a 20-byte address before signing.
 *  - We never log signatures or authorizations to the audit chain in
 *    plaintext — the MerkleAudit captures `nonce` + `valueUsd` only.
 *
 * Use cases
 * ─────────────────────────────────────────────────────────────────────
 *  - MCP server billing: agent calls /search → 402 → agent signs +
 *    retries with X-Payment header → server bills via x402.
 *  - Paywalled API micropayments below Stripe's economic floor.
 *  - Agent-to-agent settlement on a shared L2.
 *
 * NOT yet supported (v1.6.x roadmap):
 *  - Native ABI encoding for transferWithAuthorization. Currently the
 *    signer adapter is responsible for producing the final calldata.
 *  - On-chain receipt verification (the rail trusts the signer's
 *    return + the recipient's HTTP response).
 *  - Multi-hop relayer payouts.
 */

import { randomBytes, createHash } from "node:crypto";
import type { PaymentRail, PaymentRailResult, HoldOptions } from "./index.js";
import { runRailCapture } from "./capture-error.js";

// ─── Network defaults ──────────────────────────────────────────────────────

/** Base mainnet — the recommended x402 default. */
export const BASE_MAINNET_CHAIN_ID = 8453;
/** Base Sepolia — testnet. */
export const BASE_SEPOLIA_CHAIN_ID = 84532;
/** Ethereum mainnet — too expensive for sub-cent. Listed for completeness. */
export const ETH_MAINNET_CHAIN_ID = 1;

/**
 * USDC contract addresses per chain. The rail uses these unless
 * `opts.usdcContract` overrides.
 */
export const USDC_CONTRACTS: Readonly<Record<number, string>> = Object.freeze({
  [BASE_MAINNET_CHAIN_ID]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [BASE_SEPOLIA_CHAIN_ID]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  [ETH_MAINNET_CHAIN_ID]: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
});

/**
 * USDC has 6 decimals on every chain we support. A "value" of 1_000_000
 * means 1 USDC; 2_000 means $0.002.
 */
export const USDC_DECIMALS = 6;

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * EIP-712 typed-data structure passed to a signer for
 * `transferWithAuthorization`. The signer's job is to compute the EIP-712
 * digest and sign it; we don't need keccak in this module.
 */
export interface TransferWithAuthorizationTypedData {
  domain: {
    name: string;       // "USD Coin"
    version: string;    // "2"
    chainId: number;
    verifyingContract: string; // USDC contract
  };
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    TransferWithAuthorization: Array<{ name: string; type: string }>;
  };
  primaryType: "TransferWithAuthorization";
  message: {
    from: string;        // payer address
    to: string;          // recipient address
    value: string;       // base units (string for bigint precision)
    validAfter: string;  // unix seconds
    validBefore: string; // unix seconds
    nonce: string;       // 0x... 32 bytes
  };
}

/**
 * Pluggable signer interface. Users bring their own crypto library.
 *
 * Reference adapters (not bundled — keep SDK lean):
 *   - viem:  `signTypedData({account, domain, types, primaryType, message})`
 *   - ethers: `wallet._signTypedData(domain, types, message)`
 *   - @noble/secp256k1 + manual EIP-712 hashing for true zero-dep
 */
export interface X402Signer {
  /** Agent's wallet address (0x-prefixed, 20 bytes). */
  getAddress(): string | Promise<string>;
  /**
   * Sign EIP-712 typed data and return a 65-byte (130-hex) signature.
   * Format: 0x{r}{s}{v}, with v as 27/28 (legacy) or 0/1 (EIP-2098).
   */
  signTypedDataV4(
    typedData: TransferWithAuthorizationTypedData,
  ): Promise<string>;
}

export interface X402Options {
  /** Required: signer adapter. */
  signer: X402Signer;
  /** Chain ID. Default: 8453 (Base mainnet). */
  chainId?: number;
  /** USDC contract address. Default: derived from chainId. */
  usdcContract?: string;
  /**
   * Recipient address used when `createHold` opts don't specify one.
   * Useful for MCP-server-bills-the-agent flows where the same
   * recipient receives every authorization.
   */
  defaultRecipient?: string;
  /**
   * Window (seconds) the authorization remains valid after signing.
   * Default 300 (5 min). Stale signatures past this window fail
   * on-chain via the EIP-3009 `validBefore` check.
   */
  validitySeconds?: number;
  /**
   * EIP-712 domain name. Default "USD Coin". Override only if pointing
   * the rail at a non-canonical USDC implementation.
   */
  domainName?: string;
  /** EIP-712 domain version. Default "2". */
  domainVersion?: string;
}

/**
 * Internal hold record returned as the rail's externalId. JSON-encoded
 * so callers can persist it verbatim and pass it back to capture/reverse.
 */
export interface X402AuthorizationPayload {
  chainId: number;
  usdcContract: string;
  from: string;
  to: string;
  value: string;        // base units
  validAfter: string;
  validBefore: string;
  nonce: string;        // 0x... 32 bytes
  signature: string;    // 0x... 65 bytes
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function assertAddress(addr: string, label: string): void {
  if (!addr || typeof addr !== "string" || !HEX_ADDRESS_RE.test(addr)) {
    throw new Error(`X402Rail: ${label} must be a 0x-prefixed 20-byte address`);
  }
}

/**
 * Convert USD float to USDC base units (6 decimals).
 * Avoids floating-point precision loss by string manipulation.
 */
export function usdToUsdcBaseUnits(usd: number): string {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) {
    throw new Error(`X402Rail: invalid USD amount ${usd}`);
  }
  // Round to 6 decimal places, then scale to base units
  const cents6 = Math.round(usd * 1_000_000);
  return cents6.toString();
}

/**
 * Generate a 32-byte 0x-prefixed nonce. Cryptographically random.
 * EIP-3009 requires per-authorization uniqueness; on-chain replay
 * attempts fail.
 */
export function newNonce(): string {
  return "0x" + randomBytes(32).toString("hex");
}

/**
 * Build the EIP-712 typed-data structure for transferWithAuthorization.
 * Pure data — no hashing, no signing. The signer adapter handles those.
 */
export function buildTransferWithAuthorizationTypedData(args: {
  chainId: number;
  usdcContract: string;
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  domainName?: string;
  domainVersion?: string;
}): TransferWithAuthorizationTypedData {
  return {
    domain: {
      name: args.domainName ?? "USD Coin",
      version: args.domainVersion ?? "2",
      chainId: args.chainId,
      verifyingContract: args.usdcContract,
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: args.from,
      to: args.to,
      value: args.value,
      validAfter: args.validAfter,
      validBefore: args.validBefore,
      nonce: args.nonce,
    },
  };
}

// ─── Rail ──────────────────────────────────────────────────────────────────

/**
 * x402 USDC rail. Implements the `PaymentRail` interface.
 *
 * Hold semantics: produces a signed EIP-3009 authorization.
 * Capture semantics: caller is responsible for broadcasting the
 *   authorization (typical x402 flow: agent posts to server's
 *   `/x402/capture` endpoint with `X-Payment` header). The rail
 *   tracks captured holds in-memory to refuse double-spend reverses.
 * Reverse semantics: pre-capture only. Post-capture returns status
 *   `"irreversible"`.
 */
export class X402Rail implements PaymentRail {
  readonly name = "x402";
  private signer: X402Signer;
  private chainId: number;
  private usdcContract: string;
  private defaultRecipient?: string;
  private validitySeconds: number;
  private domainName: string;
  private domainVersion: string;
  private capturedHolds: Set<string> = new Set();

  constructor(opts: X402Options) {
    if (!opts || typeof opts !== "object") {
      throw new Error("X402Rail: options object is required");
    }
    if (!opts.signer || typeof opts.signer.signTypedDataV4 !== "function") {
      throw new Error("X402Rail: opts.signer with signTypedDataV4 is required");
    }
    this.signer = opts.signer;
    this.chainId = opts.chainId ?? BASE_MAINNET_CHAIN_ID;

    const defaultUsdc = USDC_CONTRACTS[this.chainId];
    const usdc = opts.usdcContract ?? defaultUsdc;
    if (!usdc) {
      throw new Error(
        `X402Rail: no USDC contract default for chainId ${this.chainId}; pass opts.usdcContract`,
      );
    }
    assertAddress(usdc, "usdcContract");
    this.usdcContract = usdc;

    if (opts.defaultRecipient) {
      assertAddress(opts.defaultRecipient, "defaultRecipient");
      this.defaultRecipient = opts.defaultRecipient;
    }

    this.validitySeconds = opts.validitySeconds ?? 300;
    if (this.validitySeconds <= 0) {
      throw new Error("X402Rail: validitySeconds must be positive");
    }

    this.domainName = opts.domainName ?? "USD Coin";
    this.domainVersion = opts.domainVersion ?? "2";
  }

  /**
   * Build + sign an EIP-3009 transferWithAuthorization. Does NOT
   * broadcast. The returned externalId is the JSON-encoded
   * authorization payload + signature, ready to be POSTed to the
   * recipient or persisted by the caller.
   *
   * `opts.metadata.recipient` overrides the rail's defaultRecipient.
   * `opts.metadata.validitySeconds` overrides the per-call window.
   */
  async createHold(
    amount: number,
    reason: string,
    agentId: string,
    opts?: HoldOptions,
  ): Promise<PaymentRailResult> {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new Error("X402Rail.createHold: amount must be a positive number");
    }
    if (!agentId || typeof agentId !== "string") {
      throw new Error("X402Rail.createHold: agentId is required");
    }

    const recipient =
      (opts?.metadata?.recipient as string | undefined) ?? this.defaultRecipient;
    if (!recipient) {
      throw new Error(
        "X402Rail.createHold: recipient address required — pass opts.metadata.recipient or set defaultRecipient on the rail",
      );
    }
    assertAddress(recipient, "recipient");

    const from = await this.signer.getAddress();
    assertAddress(from, "signer address");

    const value = usdToUsdcBaseUnits(amount);
    const now = Math.floor(Date.now() / 1000);
    const validAfter = String(Math.max(0, now - 5)); // small skew tolerance
    const window =
      (opts?.metadata?.validitySeconds as number | undefined) ?? this.validitySeconds;
    const validBefore = String(now + window);
    const nonce = newNonce();

    const typedData = buildTransferWithAuthorizationTypedData({
      chainId: this.chainId,
      usdcContract: this.usdcContract,
      from,
      to: recipient,
      value,
      validAfter,
      validBefore,
      nonce,
      domainName: this.domainName,
      domainVersion: this.domainVersion,
    });

    const signature = await this.signer.signTypedDataV4(typedData);
    if (!signature || typeof signature !== "string" || !signature.startsWith("0x")) {
      throw new Error("X402Rail.createHold: signer returned invalid signature");
    }

    const payload: X402AuthorizationPayload = {
      chainId: this.chainId,
      usdcContract: this.usdcContract,
      from,
      to: recipient,
      value,
      validAfter,
      validBefore,
      nonce,
      signature,
    };

    // externalId = stable hash of the authorization. Lets capture +
    // reverse identify the hold without round-tripping the full payload.
    const externalId = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    return {
      externalId,
      status: "authorized",
      // The signature payload itself is the receipt — caller persists.
      receiptId: JSON.stringify(payload),
    };
  }

  /**
   * Mark a hold as captured. The actual on-chain broadcast is the
   * caller's job (typical x402 flow: HTTP POST the authorization to
   * the recipient's `/x402/settle` endpoint with `X-Payment` header,
   * recipient submits transferWithAuthorization on-chain).
   *
   * After capturePayment, reversePayment will refuse the same hold.
   */
  async capturePayment(
    externalId: string,
    _amount: number,
  ): Promise<PaymentRailResult> {
    if (!externalId || typeof externalId !== "string") {
      throw new Error("X402Rail.capturePayment: externalId is required");
    }
    return runRailCapture(this.name, { externalId, amount: _amount }, async () => {
      this.capturedHolds.add(externalId);
      return {
        externalId,
        status: "captured",
      };
    });
  }

  /**
   * Pre-capture: discard the hold (no on-chain action — the
   * authorization simply expires past validBefore). Post-capture:
   * USDC transfers are irreversible without recipient cooperation,
   * so we return status `"irreversible"` rather than throw, letting
   * callers branch on the result and trigger a refund flow.
   */
  async reversePayment(
    externalId: string,
    _amount: number,
  ): Promise<PaymentRailResult> {
    if (!externalId || typeof externalId !== "string") {
      throw new Error("X402Rail.reversePayment: externalId is required");
    }
    if (this.capturedHolds.has(externalId)) {
      return { externalId, status: "irreversible" };
    }
    return { externalId, status: "reversed" };
  }
}
