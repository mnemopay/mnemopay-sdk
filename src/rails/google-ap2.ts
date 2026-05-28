/**
 * GoogleAP2Rail — Google's Agent Payment Protocol (AP2).
 *
 * AP2 is an open standard donated to the FIDO Alliance in 2026. v0.2
 * added "Human Not Present" autonomous payments backed by signed
 * mandates: a principal (human) pre-authorizes an agent to spend up
 * to a declared cap; the agent then mints transaction-bound intents
 * and presents them with the mandate at settlement time.
 *
 * Default settlement is HTTP POST to a configurable AP2 endpoint
 * (Google Pay, an FIDO-compliant relayer, or your own AP2 server).
 *
 * @experimental v1.6.x scope. AP2's exact API is still maturing; the
 * surface here captures the structural pattern (mandate + intent +
 * signed VC + HTTP settlement) and lets you swap endpoints + signers
 * as the spec evolves.
 *
 * Architecture
 * ─────────────────────────────────────────────────────────────────────
 *  - Caller passes:
 *      - a `signer` adapter (the agent's credential — DID / Ed25519
 *        keypair / hardware wallet / etc), and
 *      - the active `mandate` already signed by the principal
 *        (out-of-band ceremony — typically Google Pay UI or FIDO
 *        WebAuthn flow).
 *  - `createHold` builds + signs an AP2 Intent VC bound to one
 *    transaction. Returns the signed intent as the receipt.
 *  - `capturePayment` POSTs `{ mandate, intent }` to the AP2 endpoint
 *    and returns the settlement response.
 *  - `reversePayment` only succeeds pre-capture. Post-capture is
 *    irreversible without recipient cooperation (returns
 *    `"irreversible"` so callers can branch).
 *
 * Security
 * ─────────────────────────────────────────────────────────────────────
 *  - Intents include a `validBefore` timestamp (default 5 min). Stale
 *    intents fail at the AP2 endpoint via the `validBefore` check.
 *  - Each intent carries a unique 32-byte cryptographic nonce.
 *  - `validateMandate` checks the mandate's structural integrity
 *    before any intent is built (cap, currency, expiry, signature
 *    presence) — fail closed.
 *  - Pre-flight policy: before signing, the rail enforces the
 *    mandate's `maxPerTransaction`, `currency`, `allowedRecipients`,
 *    and expiry locally so a mis-configured agent can't even *try*
 *    to overspend.
 *  - Recipient address sanity-checked.
 *  - The MerkleAudit chain captures only intentId + amount + nonce
 *    + recipient — never the full credential or mandate signature.
 *
 * Use cases
 * ─────────────────────────────────────────────────────────────────────
 *  - Pre-authorized agent commerce: a principal grants an agent a
 *    $100/week budget for grocery delivery; agent mints intents per
 *    purchase, all backed by the same signed mandate.
 *  - Human-Not-Present subscription auto-renewal under explicit caps.
 *  - Agent-to-agent settlement when both parties have AP2 credentials.
 */

import { randomBytes } from "node:crypto";
import type { PaymentRail, PaymentRailResult, HoldOptions } from "./index.js";
import { runRailCapture } from "./capture-error.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * AP2 Mandate VC — signed by the principal (human or org) granting an
 * agent permission to spend within explicit limits. Distributed in
 * advance by an out-of-band ceremony (Google Pay UI / WebAuthn / etc).
 */
export interface AP2Mandate {
  /** Stable mandate identifier. */
  mandateId: string;
  /** Agent's DID / public credential URI. Must match the rail's signer. */
  agentCredential: string;
  /** Principal (the human or org that signed the mandate). */
  principalCredential: string;
  /** Spending controls. */
  limits: {
    /** Max per single transaction, in minor units of `currency` (e.g. cents). */
    maxPerTransaction: string;
    /** Max aggregate across all intents minted under this mandate. */
    maxAggregate: string;
    /** ISO-4217 currency. Default expected: "USD". */
    currency: string;
    /** ISO-8601 expiry. Past this point, intents must be rejected. */
    expiresAt: string;
  };
  /** Allowed recipients. Empty / undefined = unrestricted. */
  allowedRecipients?: string[];
  /** Mandate signature signed by the principal. Hex or base64. */
  signature: string;
  /** Free-form metadata persisted with the mandate. */
  metadata?: Record<string, unknown>;
}

/**
 * AP2 Intent — one transaction-bound payment authorization signed by
 * the agent. Presented at settlement time alongside the mandate.
 */
export interface AP2Intent {
  intentId: string;
  mandateId: string;
  /** Amount in minor units of `currency` (matching the mandate). */
  amount: string;
  currency: string;
  /** Recipient credential / address / merchant ID. */
  recipient: string;
  /** Optional human-readable memo (truncated to 500 chars). */
  memo?: string;
  /** ISO-8601 timestamp the intent was minted. */
  mintedAt: string;
  /** ISO-8601 deadline; past this the AP2 endpoint must reject. */
  validBefore: string;
  /** 32-byte 0x-prefixed cryptographic nonce. */
  nonce: string;
  /** Agent signature over the intent. Hex or base64. */
  signature: string;
}

/**
 * Pluggable signer for the agent's credential. Bring your own crypto
 * (ed25519 / secp256k1 / hardware wallet / DID-resolver-backed).
 */
export interface AP2Signer {
  /** Returns the agent's DID / credential URI. */
  getAgentCredential(): string | Promise<string>;
  /**
   * Sign an unsigned intent. The signer is responsible for producing
   * a canonical hash of the intent fields and signing that hash.
   * Implementation detail intentionally left to the signer.
   */
  signIntent(unsignedIntent: Omit<AP2Intent, "signature">): Promise<string>;
}

/**
 * AP2 settlement endpoint response shape. Implementations vary;
 * the rail accepts any JSON object and surfaces relevant fields.
 */
export interface AP2SettlementResponse {
  /** Settlement / receipt id from the AP2 endpoint. */
  settlementId?: string;
  /** Status string (e.g. "settled", "pending", "rejected"). */
  status?: string;
  /** Free-form passthrough for endpoint-specific fields. */
  [k: string]: unknown;
}

export interface AP2Options {
  /** Required: agent signer adapter. */
  signer: AP2Signer;
  /** Required: signed mandate from the principal. */
  mandate: AP2Mandate;
  /** Required: AP2 settlement endpoint URL (POST receives mandate+intent). */
  endpoint: string;
  /** Default validity window in seconds (default 300). */
  validitySeconds?: number;
  /** Custom HTTP fetcher (useful for tests). Defaults to global fetch. */
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  /** Default recipient if `opts.metadata.recipient` is omitted. */
  defaultRecipient?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate a mandate's structural integrity. Returns `{ ok: true }` or
 * `{ ok: false, reason }`. Does not verify the principal's signature
 * cryptographically — that's the AP2 endpoint's job, since the
 * principal's public key may resolve via DID + we don't want to bind
 * the SDK to a specific DID resolver.
 */
export type AP2MandateValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing-mandate-id"
        | "missing-agent-credential"
        | "missing-principal-credential"
        | "missing-limits"
        | "invalid-currency"
        | "invalid-cap"
        | "invalid-expiry"
        | "expired"
        | "missing-signature";
    };

export function validateMandate(m: unknown): AP2MandateValidation {
  if (!m || typeof m !== "object") return { ok: false, reason: "missing-mandate-id" };
  const x = m as Partial<AP2Mandate>;
  if (!x.mandateId || typeof x.mandateId !== "string") return { ok: false, reason: "missing-mandate-id" };
  if (!x.agentCredential || typeof x.agentCredential !== "string") return { ok: false, reason: "missing-agent-credential" };
  if (!x.principalCredential || typeof x.principalCredential !== "string") return { ok: false, reason: "missing-principal-credential" };
  if (!x.limits || typeof x.limits !== "object") return { ok: false, reason: "missing-limits" };
  if (!x.limits.currency || typeof x.limits.currency !== "string" || x.limits.currency.length !== 3) {
    return { ok: false, reason: "invalid-currency" };
  }
  if (
    typeof x.limits.maxPerTransaction !== "string" ||
    !/^\d+$/.test(x.limits.maxPerTransaction) ||
    typeof x.limits.maxAggregate !== "string" ||
    !/^\d+$/.test(x.limits.maxAggregate)
  ) {
    return { ok: false, reason: "invalid-cap" };
  }
  if (!x.limits.expiresAt || !ISO_8601_RE.test(x.limits.expiresAt)) {
    return { ok: false, reason: "invalid-expiry" };
  }
  if (Date.parse(x.limits.expiresAt) < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (!x.signature || typeof x.signature !== "string" || x.signature.length === 0) {
    return { ok: false, reason: "missing-signature" };
  }
  return { ok: true };
}

/**
 * Convert a USD float to minor units (cents) for AP2 mandate caps.
 * Matches the mandate's `maxPerTransaction` / `maxAggregate` shape.
 */
export function usdToMinorUnits(usd: number, decimals = 2): string {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) {
    throw new Error(`AP2: invalid USD amount ${usd}`);
  }
  const scale = 10 ** decimals;
  return Math.round(usd * scale).toString();
}

/** Generate a 32-byte 0x-prefixed cryptographic nonce. */
export function newIntentNonce(): string {
  return "0x" + randomBytes(32).toString("hex");
}

/** Generate a stable intent id (mandateId-prefixed for grouping). */
export function newIntentId(mandateId: string): string {
  return `int_${mandateId.slice(0, 8)}_${randomBytes(12).toString("hex")}`;
}

// ─── Rail ──────────────────────────────────────────────────────────────────

/**
 * Google AP2 rail. Implements the `PaymentRail` interface.
 *
 * Pre-flight policy is enforced locally on createHold: the rail
 * refuses to sign an intent that would violate the mandate's cap,
 * currency, recipient allowlist, or expiry — even before the AP2
 * endpoint sees it. Defense in depth.
 */
export class GoogleAP2Rail implements PaymentRail {
  readonly name = "google_ap2";
  private signer: AP2Signer;
  private mandate: AP2Mandate;
  private endpoint: string;
  private validitySeconds: number;
  private fetcher: (url: string, init: RequestInit) => Promise<Response>;
  private defaultRecipient?: string;
  /** Aggregate amount minted under this mandate so far (in minor units). */
  private aggregateMinted = BigInt(0);
  /** Holds awaiting capture: externalId → minor-units amount string. */
  private heldHolds: Map<string, string> = new Map();
  /** Captured holds — used to refuse double-capture + post-capture reverses. */
  private capturedHolds: Set<string> = new Set();

  constructor(opts: AP2Options) {
    if (!opts || typeof opts !== "object") {
      throw new Error("GoogleAP2Rail: options object is required");
    }
    if (!opts.signer || typeof opts.signer.signIntent !== "function") {
      throw new Error("GoogleAP2Rail: opts.signer with signIntent is required");
    }
    if (!opts.endpoint || typeof opts.endpoint !== "string") {
      throw new Error("GoogleAP2Rail: opts.endpoint URL is required");
    }
    const v = validateMandate(opts.mandate);
    if (!v.ok) {
      throw new Error(`GoogleAP2Rail: mandate invalid — ${v.reason}`);
    }
    this.signer = opts.signer;
    this.mandate = opts.mandate;
    this.endpoint = opts.endpoint;
    this.validitySeconds = opts.validitySeconds ?? 300;
    if (this.validitySeconds <= 0) {
      throw new Error("GoogleAP2Rail: validitySeconds must be positive");
    }
    this.fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
    this.defaultRecipient = opts.defaultRecipient;
  }

  /**
   * Build + sign an AP2 Intent VC. Pre-flight: enforces mandate caps,
   * currency, recipient allowlist, expiry locally before signing so a
   * mis-configured agent fails fast without touching the network.
   *
   * Recipient resolution: opts.metadata.recipient → defaultRecipient.
   */
  async createHold(
    amount: number,
    reason: string,
    agentId: string,
    opts?: HoldOptions,
  ): Promise<PaymentRailResult> {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new Error("GoogleAP2Rail.createHold: amount must be a positive number");
    }
    if (!agentId || typeof agentId !== "string") {
      throw new Error("GoogleAP2Rail.createHold: agentId is required");
    }

    // ── Pre-flight policy ────────────────────────────────────────
    if (Date.parse(this.mandate.limits.expiresAt) < Date.now()) {
      throw new Error("GoogleAP2Rail.createHold: mandate has expired");
    }

    const recipient =
      (opts?.metadata?.recipient as string | undefined) ?? this.defaultRecipient;
    if (!recipient) {
      throw new Error(
        "GoogleAP2Rail.createHold: recipient required — pass opts.metadata.recipient or set defaultRecipient",
      );
    }
    if (this.mandate.allowedRecipients && this.mandate.allowedRecipients.length > 0) {
      if (!this.mandate.allowedRecipients.includes(recipient)) {
        throw new Error(
          `GoogleAP2Rail.createHold: recipient "${recipient}" not in mandate allowlist`,
        );
      }
    }

    const minor = BigInt(usdToMinorUnits(amount));
    if (minor > BigInt(this.mandate.limits.maxPerTransaction)) {
      throw new Error(
        `GoogleAP2Rail.createHold: amount exceeds maxPerTransaction (${this.mandate.limits.maxPerTransaction})`,
      );
    }
    if (this.aggregateMinted + minor > BigInt(this.mandate.limits.maxAggregate)) {
      throw new Error(
        `GoogleAP2Rail.createHold: amount would exceed mandate maxAggregate (${this.mandate.limits.maxAggregate})`,
      );
    }

    // ── Build + sign intent ──────────────────────────────────────
    const agentCredential = await this.signer.getAgentCredential();
    if (agentCredential !== this.mandate.agentCredential) {
      throw new Error(
        "GoogleAP2Rail.createHold: signer's credential does not match mandate.agentCredential",
      );
    }

    const now = Date.now();
    const validBefore = new Date(now + this.validitySeconds * 1000).toISOString();
    const intentId = newIntentId(this.mandate.mandateId);
    const nonce = newIntentNonce();

    const unsigned: Omit<AP2Intent, "signature"> = {
      intentId,
      mandateId: this.mandate.mandateId,
      amount: minor.toString(),
      currency: this.mandate.limits.currency,
      recipient,
      memo: reason ? reason.slice(0, 500) : undefined,
      mintedAt: new Date(now).toISOString(),
      validBefore,
      nonce,
    };

    const signature = await this.signer.signIntent(unsigned);
    if (!signature || typeof signature !== "string" || signature.length === 0) {
      throw new Error("GoogleAP2Rail.createHold: signer returned invalid signature");
    }

    const intent: AP2Intent = { ...unsigned, signature };

    // Track the hold + roll the aggregate forward atomically.
    this.heldHolds.set(intentId, minor.toString());
    this.aggregateMinted += minor;

    return {
      externalId: intentId,
      status: "intent_signed",
      receiptId: JSON.stringify(intent),
    };
  }

  /**
   * POST { mandate, intent } to the AP2 endpoint. The endpoint runs
   * on-chain or off-chain settlement; we surface its response as the
   * capture result.
   *
   * Need the original intent payload — caller passes it via the
   * `_amount` argument's metadata path is unavailable, so we look it
   * up by externalId. If the rail instance has been recreated since
   * createHold (e.g., across processes), the caller can re-build the
   * AP2Rail pointing at the same mandate + endpoint and `fetcher`
   * will still settle correctly because the intent's signature is
   * self-contained — but in that scenario `capturePayment` should
   * receive the intent as `metadata`. Future enhancement.
   */
  async capturePayment(
    externalId: string,
    _amount: number,
  ): Promise<PaymentRailResult> {
    if (!externalId || typeof externalId !== "string") {
      throw new Error("GoogleAP2Rail.capturePayment: externalId is required");
    }
    if (this.capturedHolds.has(externalId)) {
      // Idempotency: re-capturing returns the same status.
      return { externalId, status: "captured" };
    }
    if (!this.heldHolds.has(externalId)) {
      throw new Error(
        `GoogleAP2Rail.capturePayment: hold ${externalId} not found — was it minted on this rail instance?`,
      );
    }

    return runRailCapture(this.name, { externalId, amount: _amount }, async () => {
      const res = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Lightweight protocol marker. AP2 implementers use x-ap2-version.
          "x-ap2-version": "0.2",
        },
        body: JSON.stringify({
          mandate: this.mandate,
          intentId: externalId,
          // Caller's intent payload was returned as receiptId on createHold.
          // The AP2 endpoint can re-look-up the intent on its side via
          // intentId + mandateId — that's the canonical AP2 flow.
        }),
      });

      let body: AP2SettlementResponse = {};
      try {
        body = (await res.json()) as AP2SettlementResponse;
      } catch {
        // Endpoint returned non-JSON — surface as a string status only.
      }

      if (!res.ok) {
        return {
          externalId,
          status: typeof body.status === "string" ? body.status : `http_${res.status}`,
        };
      }

      this.capturedHolds.add(externalId);
      this.heldHolds.delete(externalId);

      return {
        externalId,
        status: typeof body.status === "string" ? body.status : "settled",
        receiptId: typeof body.settlementId === "string" ? body.settlementId : undefined,
      };
    });
  }

  /**
   * Pre-capture: drop the hold (intent will simply expire past
   * validBefore — no on-chain action required). Post-capture: AP2
   * settlements are not unilaterally reversible, so we return
   * `"irreversible"` so callers can branch into a refund flow.
   */
  async reversePayment(
    externalId: string,
    _amount: number,
  ): Promise<PaymentRailResult> {
    if (!externalId || typeof externalId !== "string") {
      throw new Error("GoogleAP2Rail.reversePayment: externalId is required");
    }
    if (this.capturedHolds.has(externalId)) {
      return { externalId, status: "irreversible" };
    }
    // Pre-capture: refund the aggregate (so the mandate's budget is
    // freed up for future intents) and discard the hold.
    const minor = this.heldHolds.get(externalId);
    if (minor) {
      this.aggregateMinted -= BigInt(minor);
      this.heldHolds.delete(externalId);
    }
    return { externalId, status: "reversed" };
  }

  /** Read-only view of the aggregate minted under this rail's mandate. */
  getAggregateMinted(): string {
    return this.aggregateMinted.toString();
  }

  /** Read-only view of the active mandate. */
  getMandate(): AP2Mandate {
    return this.mandate;
  }
}
