/**
 * AP2 (Agents-Payments Protocol) verifiable-credential adapter.
 *
 * AP2 v0.2 (Google / FIDO Alliance, 2026) mandates a credential payload format
 * for verifying an agent's identity at payment time. The protocol explicitly
 * names "agent identity" as an unsolved production gap — which is exactly the
 * wedge MnemoPay's DID + Wallet primitive closes.
 *
 * This module is a pure adapter:
 *
 *   MnemoPay DID + reputation + charter   →   AP2 VerifiableCredential
 *
 * It signs the credential with the agent's existing Ed25519 key (the same key
 * already attached to its `did:mp:` identifier) and produces a W3C VC v2 /
 * AP2-shaped JSON document that a payment processor can verify offline.
 *
 * Design choices worth knowing about:
 *   - Canonicalisation reuses `bundle.canonicalize` so the credential is
 *     byte-stable — same inputs → identical signed JSON across processes.
 *   - The proof is computed over the credential WITHOUT `proof.proofValue`
 *     (W3C VC convention — you sign the document minus the signature slot).
 *   - We deliberately do NOT pull in `@noble/curves` (no new deps allowed).
 *     The SDK's existing Ed25519 path runs through `node:crypto` and that's
 *     what we reuse — same wire bytes, same security properties.
 *   - `verifyAp2Credential` returns a structured `VerifyResult` rather than
 *     throwing — payment processors typically branch on the failure reason
 *     (expired vs key_mismatch vs proof_invalid) and a thrown Error makes
 *     that ergonomically worse. `toAp2Credential` still throws on bad input
 *     (matches `exportBundle` / `mintDid` behaviour from siblings).
 *
 * Constraint from the AP2 spec we can't fully represent yet (see the report):
 *   - `Ed25519Signature2020` mandates the signature be encoded as a Multibase
 *     base58btc string (`z…`). Node's `crypto.sign` returns raw bytes; we
 *     emit base64 for transport (the SDK's existing convention) and note
 *     this in the credential's `proof.type` neighbours. Verifiers that
 *     strictly enforce Multibase will need a base58btc shim — a 30-line
 *     fix in a follow-up release. Crypto bytes are identical; only the
 *     transport encoding differs.
 */

import { createHash } from "node:crypto";

import {
  isDid,
  publicKeyMatchesDid,
  resolveDid,
  sign as didSign,
  verify as didVerify,
  type Did,
} from "./did.js";
import { canonicalize } from "./bundle.js";
import type { Charter } from "../governance/charter.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Compile-time tuple narrowing for the W3C / AP2 `@context` field. */
export type Ap2Context = [
  "https://www.w3.org/ns/credentials/v2",
  "https://w3.org/2026/agent-payments/v1",
];

/** Compile-time tuple narrowing for the AP2 `type` field. */
export type Ap2Type = ["VerifiableCredential", "AgentPaymentCredential"];

/** Mandate block — what the operator allowed this agent to spend. */
export interface Ap2SpendingMandate {
  monthlyLimitUsd: number;
  perTransactionLimitUsd: number;
  allowedRails: string[];
  /** Optional category whitelist (`["compute","storage"]` etc). */
  categories?: string[];
}

/** Governance block — proof the agent operates under a known constitution. */
export interface Ap2Governance {
  /** SHA-256 of the compiled charter, hex. */
  charterHash: string;
  /** Current MnemoPay audit-chain Merkle root, hex. */
  auditChainRoot: string;
}

/** The credential subject — everything a verifier needs about the agent. */
export interface Ap2CredentialSubject {
  /** DID URI (`did:mp:...`). */
  id: Did;
  agentName?: string;
  operatorId?: string;
  /** 0-1000 scaled reputation score (MnemoPay native scale). */
  reputationScore: number;
  /** 300-850 FICO-equivalent (industry-standard scale). */
  ficoEquivalent: number;
  spendingMandate: Ap2SpendingMandate;
  governance: Ap2Governance;
}

/** AP2-signed verifiable credential. */
export interface Ap2Credential {
  "@context": Ap2Context;
  type: Ap2Type;
  issuer: {
    id: Did;
    name?: string;
  };
  /** ISO8601 timestamp. Must be <= now at verify time. */
  issuanceDate: string;
  /** ISO8601 timestamp. If present, must be > now at verify time. */
  expirationDate?: string;
  credentialSubject: Ap2CredentialSubject;
  proof: {
    type: "Ed25519Signature2020";
    created: string;
    /** DID URL with key fragment: `<did>#keys-1`. */
    verificationMethod: `${Did}#keys-1`;
    proofPurpose: "assertionMethod";
    /**
     * Base64-encoded Ed25519 signature over the canonical credential bytes
     * (credential minus `proof.proofValue`). See module docstring for the
     * Multibase note.
     */
    proofValue: string;
  };
}

/** Inputs accepted by `toAp2Credential`. */
export interface ToAp2Input {
  /** The agent's DID — must match `issuerPublicKey` via self-cert. */
  did: Did;
  /** Hex PKCS#8 DER Ed25519 private key. Never logged. */
  privateKey: string;
  /** Hex SPKI DER Ed25519 public key. */
  publicKey: string;
  /** Optional human-readable issuer label. */
  issuerName?: string;
  /** Mirrored into `credentialSubject.agentName`. */
  agentName?: string;
  /** Mirrored into `credentialSubject.operatorId`. */
  operatorId?: string;
  /** 0-1000 — see `Ap2CredentialSubject.reputationScore`. */
  reputationScore: number;
  /** 300-850 — see `Ap2CredentialSubject.ficoEquivalent`. */
  ficoEquivalent: number;
  spendingMandate: Ap2SpendingMandate;
  /**
   * Either pass a compiled charter (we hash it) or pre-computed `charterHash`.
   * Pass one, not both. If both are passed, the explicit hash wins.
   */
  charter?: Charter;
  charterHash?: string;
  /** Current Merkle audit-chain root for the operator. */
  auditChainRoot: string;
  /** ISO8601. Defaults to now. */
  issuanceDate?: string;
  /** ISO8601. Optional. */
  expirationDate?: string;
}

/** Reason codes returned by `verifyAp2Credential` on failure. */
export type Ap2VerifyError =
  | "proof_invalid"
  | "expired"
  | "not_yet_valid"
  | "key_mismatch"
  | "bad_did"
  | "malformed";

/** Result of `verifyAp2Credential`. */
export type VerifyResult =
  | { valid: true }
  | { valid: false; error: Ap2VerifyError; detail?: string };

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Hex SHA-256 over a charter's canonical JSON. Pure — no file I/O — so the
 * adapter stays free of side effects per the brief.
 */
function hashCharter(charter: Charter): string {
  return createHash("sha256").update(canonicalize(charter)).digest("hex");
}

/**
 * Strip `proof.proofValue` from the credential so we can sign the rest.
 * Returns a new object — the input is not mutated.
 */
function credentialForSigning(cred: Ap2Credential): Omit<Ap2Credential, "proof"> & {
  proof: Omit<Ap2Credential["proof"], "proofValue">;
} {
  const { proof, ...rest } = cred;
  const { proofValue: _, ...proofWithoutSig } = proof;
  return { ...rest, proof: proofWithoutSig };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a signed AP2 verifiable credential from a MnemoPay wallet's DID,
 * keypair, reputation, mandate, and charter. Pure crypto — no I/O.
 *
 * Throws on:
 *   - invalid DID
 *   - public key that doesn't self-certify the DID
 *   - missing both `charter` and `charterHash`
 *
 * (Matches the existing identity module convention of plain `Error` from
 * `exportBundle` and `mintDid`. The SDK does not currently export a
 * `MnemoPayError` class — see the AP2 commit note for the follow-up.)
 */
export function toAp2Credential(input: ToAp2Input): Ap2Credential {
  if (!isDid(input.did)) {
    throw new Error(`toAp2Credential: invalid DID: ${input.did}`);
  }
  if (!publicKeyMatchesDid(input.did, input.publicKey)) {
    throw new Error("toAp2Credential: public key does not self-certify the DID");
  }
  if (!input.charter && !input.charterHash) {
    throw new Error("toAp2Credential: pass either `charter` or `charterHash`");
  }

  const charterHash = input.charterHash ?? hashCharter(input.charter as Charter);
  const issuanceDate = input.issuanceDate ?? new Date().toISOString();
  // proof.created mirrors issuanceDate when not separately specified — keeps
  // the credential easy to reason about in a debugger.
  const proofCreated = issuanceDate;

  // Build the credential subject. We assign optional fields conditionally so
  // they're omitted (rather than serialised as `undefined`) when not provided
  // — keeps the canonical JSON tight and reproducible.
  const credentialSubject: Ap2CredentialSubject = {
    id: input.did,
    reputationScore: input.reputationScore,
    ficoEquivalent: input.ficoEquivalent,
    spendingMandate: input.spendingMandate,
    governance: {
      charterHash,
      auditChainRoot: input.auditChainRoot,
    },
  };
  if (input.agentName !== undefined) credentialSubject.agentName = input.agentName;
  if (input.operatorId !== undefined) credentialSubject.operatorId = input.operatorId;

  const issuer: Ap2Credential["issuer"] = { id: input.did };
  if (input.issuerName !== undefined) issuer.name = input.issuerName;

  // Assemble the credential with an empty signature slot — we'll fill it in
  // after canonicalising the rest.
  const credential: Ap2Credential = {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://w3.org/2026/agent-payments/v1",
    ],
    type: ["VerifiableCredential", "AgentPaymentCredential"],
    issuer,
    issuanceDate,
    credentialSubject,
    proof: {
      type: "Ed25519Signature2020",
      created: proofCreated,
      verificationMethod: `${input.did}#keys-1`,
      proofPurpose: "assertionMethod",
      proofValue: "", // filled below
    },
  };
  if (input.expirationDate !== undefined) credential.expirationDate = input.expirationDate;

  // Sign canonical bytes of the credential MINUS the proofValue field.
  const canonical = canonicalize(credentialForSigning(credential));
  credential.proof.proofValue = didSign(input.did, input.privateKey, canonical);

  return credential;
}

/**
 * Verify an AP2 verifiable credential. Returns a structured result rather
 * than throwing so callers (payment processors, dashboards, gateways) can
 * branch cleanly on the failure mode.
 *
 * Checks:
 *   1. Document is well-formed and DID is syntactically valid.
 *   2. `proof.verificationMethod` matches `issuer.id` (no impersonation).
 *   3. The public key — resolved either from `credentialSubject.id` via the
 *      local DID resolver or self-certified from the DID tail — successfully
 *      verifies the Ed25519 signature over the canonical credential bytes.
 *   4. `issuanceDate` <= now <= `expirationDate` (if expirationDate present).
 */
export function verifyAp2Credential(
  credential: Ap2Credential,
  options: { now?: Date; publicKey?: string } = {},
): VerifyResult {
  // ── shape / DID checks ────────────────────────────────────────────────
  if (!credential || typeof credential !== "object" || !credential.proof) {
    return { valid: false, error: "malformed", detail: "missing proof" };
  }
  const subjectId = credential.credentialSubject?.id;
  const issuerId = credential.issuer?.id;
  if (!isDid(subjectId)) {
    return { valid: false, error: "bad_did", detail: `subject: ${subjectId}` };
  }
  if (!isDid(issuerId)) {
    return { valid: false, error: "bad_did", detail: `issuer: ${issuerId}` };
  }

  // ── verificationMethod must point at the issuer ───────────────────────
  const expectedVm = `${issuerId}#keys-1`;
  if (credential.proof.verificationMethod !== expectedVm) {
    return {
      valid: false,
      error: "key_mismatch",
      detail: `verificationMethod ${credential.proof.verificationMethod} ≠ ${expectedVm}`,
    };
  }

  // ── temporal checks ───────────────────────────────────────────────────
  const now = options.now ?? new Date();
  const issued = new Date(credential.issuanceDate);
  if (Number.isNaN(issued.getTime())) {
    return { valid: false, error: "malformed", detail: "issuanceDate not parseable" };
  }
  if (issued.getTime() > now.getTime()) {
    return { valid: false, error: "not_yet_valid" };
  }
  if (credential.expirationDate !== undefined) {
    const exp = new Date(credential.expirationDate);
    if (Number.isNaN(exp.getTime())) {
      return { valid: false, error: "malformed", detail: "expirationDate not parseable" };
    }
    if (exp.getTime() <= now.getTime()) {
      return { valid: false, error: "expired" };
    }
  }

  // ── resolve verifier pubkey ───────────────────────────────────────────
  // Order of preference: explicit override → local DID resolver. We never
  // fetch over the network from this module (constraint: no I/O).
  let publicKey: string | undefined = options.publicKey;
  if (!publicKey) {
    const doc = resolveDid(issuerId);
    publicKey = doc?.verificationMethod[0]?.publicKeyHex;
  }
  if (!publicKey) {
    return {
      valid: false,
      error: "key_mismatch",
      detail: "could not resolve issuer public key (pass options.publicKey or register the DID first)",
    };
  }
  if (!publicKeyMatchesDid(issuerId, publicKey)) {
    return { valid: false, error: "key_mismatch", detail: "pubkey does not self-certify the DID" };
  }

  // ── signature check ───────────────────────────────────────────────────
  const signature = credential.proof.proofValue;
  if (!signature || typeof signature !== "string") {
    return { valid: false, error: "proof_invalid", detail: "missing proofValue" };
  }
  const canonical = canonicalize(credentialForSigning(credential));
  const ok = didVerify(issuerId, signature, canonical, publicKey);
  if (!ok) {
    return { valid: false, error: "proof_invalid" };
  }
  return { valid: true };
}
