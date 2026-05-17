import { describe, it, expect, beforeEach } from "vitest";

import { mintDid, _resetResolver, type Did } from "./did.js";
import {
  toAp2Credential,
  verifyAp2Credential,
  type Ap2Credential,
  type ToAp2Input,
} from "./ap2.js";
import type { Charter } from "../governance/charter.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function sampleCharter(): Charter {
  return {
    name: "shopping-bot-v1",
    goal: "Buy office supplies under $200/mo within allowed categories",
    budget: { maxUsd: 200, approvalThresholdUsd: 50 },
    agents: [{ role: "developer", model: "claude-3-5-sonnet" }],
    outputs: ["receipts.json"],
  };
}

function sampleInput(
  did: Did,
  privateKey: string,
  publicKey: string,
  overrides: Partial<ToAp2Input> = {},
): ToAp2Input {
  return {
    did,
    privateKey,
    publicKey,
    issuerName: "Acme Operator Inc.",
    agentName: "shopping-bot",
    operatorId: "op_acme_001",
    reputationScore: 742,
    ficoEquivalent: 720,
    spendingMandate: {
      monthlyLimitUsd: 200,
      perTransactionLimitUsd: 50,
      allowedRails: ["stripe", "lightning"],
      categories: ["office-supplies", "compute"],
    },
    charter: sampleCharter(),
    auditChainRoot:
      "0000000000000000000000000000000000000000000000000000000000000001",
    issuanceDate: "2026-05-01T00:00:00.000Z",
    expirationDate: "2027-05-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("ap2 — happy path", () => {
  beforeEach(() => _resetResolver());

  it("builds a credential from a MnemoPay wallet that verifies", () => {
    const { did, publicKey, privateKey } = mintDid();
    const cred = toAp2Credential(sampleInput(did, privateKey, publicKey));

    expect(cred["@context"]).toEqual([
      "https://www.w3.org/ns/credentials/v2",
      "https://w3.org/2026/agent-payments/v1",
    ]);
    expect(cred.type).toEqual(["VerifiableCredential", "AgentPaymentCredential"]);
    expect(cred.issuer.id).toBe(did);
    expect(cred.issuer.name).toBe("Acme Operator Inc.");
    expect(cred.credentialSubject.id).toBe(did);
    expect(cred.credentialSubject.agentName).toBe("shopping-bot");
    expect(cred.credentialSubject.reputationScore).toBe(742);
    expect(cred.credentialSubject.ficoEquivalent).toBe(720);
    expect(cred.credentialSubject.governance.charterHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cred.proof.type).toBe("Ed25519Signature2020");
    expect(cred.proof.verificationMethod).toBe(`${did}#keys-1`);
    expect(cred.proof.proofPurpose).toBe("assertionMethod");
    expect(cred.proof.proofValue.length).toBeGreaterThan(0);

    const result = verifyAp2Credential(cred);
    expect(result.valid).toBe(true);
  });

  it("hashes the charter deterministically (same inputs → same hash)", () => {
    const { did, publicKey, privateKey } = mintDid();
    const a = toAp2Credential(sampleInput(did, privateKey, publicKey));
    const b = toAp2Credential(sampleInput(did, privateKey, publicKey));
    expect(a.credentialSubject.governance.charterHash).toBe(
      b.credentialSubject.governance.charterHash,
    );
  });

  it("accepts a pre-computed charterHash without `charter`", () => {
    const { did, publicKey, privateKey } = mintDid();
    const input = sampleInput(did, privateKey, publicKey);
    delete input.charter;
    input.charterHash = "abc123".padEnd(64, "0");
    const cred = toAp2Credential(input);
    expect(cred.credentialSubject.governance.charterHash).toBe("abc123".padEnd(64, "0"));
    expect(verifyAp2Credential(cred).valid).toBe(true);
  });

  it("omits optional fields when not provided (no `undefined` in JSON)", () => {
    const { did, publicKey, privateKey } = mintDid();
    const cred = toAp2Credential(
      sampleInput(did, privateKey, publicKey, {
        issuerName: undefined,
        agentName: undefined,
        operatorId: undefined,
        expirationDate: undefined,
      }),
    );
    const json = JSON.stringify(cred);
    expect(json).not.toContain('"name":');
    expect(json).not.toContain('"agentName":');
    expect(json).not.toContain('"operatorId":');
    expect(json).not.toContain('"expirationDate":');
    expect(verifyAp2Credential(cred).valid).toBe(true);
  });
});

describe("ap2 — verification failures", () => {
  beforeEach(() => _resetResolver());

  it("rejects with `proof_invalid` when the subject is tampered", () => {
    const { did, publicKey, privateKey } = mintDid();
    const cred = toAp2Credential(sampleInput(did, privateKey, publicKey));
    const tampered: Ap2Credential = {
      ...cred,
      credentialSubject: { ...cred.credentialSubject, reputationScore: 999 },
    };
    const result = verifyAp2Credential(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("proof_invalid");
    }
  });

  it("rejects with `proof_invalid` when the signature is tampered", () => {
    const { did, publicKey, privateKey } = mintDid();
    const cred = toAp2Credential(sampleInput(did, privateKey, publicKey));
    const tamperedSig = Buffer.from(cred.proof.proofValue, "base64");
    tamperedSig[0] = tamperedSig[0]! ^ 0xff;
    const tampered: Ap2Credential = {
      ...cred,
      proof: { ...cred.proof, proofValue: tamperedSig.toString("base64") },
    };
    const result = verifyAp2Credential(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("proof_invalid");
    }
  });

  it("rejects with `expired` when expirationDate is in the past", () => {
    const { did, publicKey, privateKey } = mintDid();
    const cred = toAp2Credential(
      sampleInput(did, privateKey, publicKey, {
        issuanceDate: "2026-01-01T00:00:00.000Z",
        expirationDate: "2026-02-01T00:00:00.000Z",
      }),
    );
    const result = verifyAp2Credential(cred, { now: new Date("2026-05-17T00:00:00.000Z") });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("expired");
    }
  });

  it("rejects with `not_yet_valid` when issuanceDate is in the future", () => {
    const { did, publicKey, privateKey } = mintDid();
    const cred = toAp2Credential(
      sampleInput(did, privateKey, publicKey, {
        issuanceDate: "2030-01-01T00:00:00.000Z",
        expirationDate: "2031-01-01T00:00:00.000Z",
      }),
    );
    const result = verifyAp2Credential(cred, { now: new Date("2026-05-17T00:00:00.000Z") });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("not_yet_valid");
    }
  });

  it("rejects with `key_mismatch` when verificationMethod doesn't match issuer", () => {
    const a = mintDid();
    const b = mintDid();
    const cred = toAp2Credential(sampleInput(a.did, a.privateKey, a.publicKey));
    const tampered: Ap2Credential = {
      ...cred,
      proof: { ...cred.proof, verificationMethod: `${b.did}#keys-1` },
    };
    const result = verifyAp2Credential(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("key_mismatch");
    }
  });

  it("rejects with `bad_did` when subject id isn't a valid DID", () => {
    const { did, publicKey, privateKey } = mintDid();
    const cred = toAp2Credential(sampleInput(did, privateKey, publicKey));
    const tampered: Ap2Credential = {
      ...cred,
      credentialSubject: {
        ...cred.credentialSubject,
        id: "did:web:example.com" as Did,
      },
    };
    const result = verifyAp2Credential(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("bad_did");
    }
  });
});

describe("ap2 — round-trip byte stability", () => {
  beforeEach(() => _resetResolver());

  it("produces identical signed JSON for identical inputs (deterministic)", () => {
    const { did, publicKey, privateKey } = mintDid();
    const input = sampleInput(did, privateKey, publicKey);
    const a = toAp2Credential(input);
    const b = toAp2Credential(input);
    // Ed25519 signing in node:crypto is deterministic per RFC 8032 — identical
    // canonical bytes + identical key MUST produce identical signatures. This
    // is the byte-stability guarantee AP2 verifiers depend on.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.proof.proofValue).toBe(b.proof.proofValue);
  });

  it("verify still succeeds after JSON-string transport", () => {
    const { did, publicKey, privateKey } = mintDid();
    const cred = toAp2Credential(sampleInput(did, privateKey, publicKey));
    const wire = JSON.stringify(cred);
    const parsed = JSON.parse(wire) as Ap2Credential;
    expect(verifyAp2Credential(parsed).valid).toBe(true);
  });
});

describe("ap2 — toAp2Credential input guards", () => {
  beforeEach(() => _resetResolver());

  it("throws on an invalid DID", () => {
    const { publicKey, privateKey } = mintDid();
    expect(() =>
      toAp2Credential(
        sampleInput("did:web:example.com" as Did, privateKey, publicKey),
      ),
    ).toThrow(/invalid DID/);
  });

  it("throws when public key does not self-certify the DID", () => {
    const a = mintDid();
    const b = mintDid();
    expect(() =>
      // a's DID + b's pubkey — would let a forger pass an unrelated key.
      toAp2Credential(sampleInput(a.did, a.privateKey, b.publicKey)),
    ).toThrow(/self-certify/);
  });

  it("throws when neither `charter` nor `charterHash` is provided", () => {
    const { did, publicKey, privateKey } = mintDid();
    const input = sampleInput(did, privateKey, publicKey);
    delete input.charter;
    delete input.charterHash;
    expect(() => toAp2Credential(input)).toThrow(/charter/);
  });
});
