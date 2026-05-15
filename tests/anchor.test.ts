import { describe, it, expect } from "vitest";
import { Wallet } from "../src/identity/wallet.js";
import {
  anchorMemory,
  verifyAnchor,
  rollAnchorRoot,
  InMemoryNonceStore,
} from "../src/recall/anchor.js";
import type { GridStampSpatialProof } from "../src/governance/spatial.js";

function fixedDate(): Date {
  return new Date("2026-05-14T12:00:00.000Z");
}

const FIXED_NONCE = "0123456789abcdef0123456789abcdef";

describe("anchorMemory", () => {
  it("produces a stable hash + signature for the same input (fixed nonce)", () => {
    const wallet = Wallet.create();
    const a1 = anchorMemory({
      memory_id: "m1",
      content: "the bot remembered the user prefers dark mode",
      wallet,
      sequence: 0,
      nonce: FIXED_NONCE,
      now: fixedDate(),
    });
    const a2 = anchorMemory({
      memory_id: "m1",
      content: "the bot remembered the user prefers dark mode",
      wallet,
      sequence: 0,
      nonce: FIXED_NONCE,
      now: fixedDate(),
    });
    expect(a1.content_sha256).toBe(a2.content_sha256);
    expect(a1.signature).toBe(a2.signature);
    expect(a1.did).toBe(wallet.did);
  });

  it("produces different nonces by default — replay defense", () => {
    const wallet = Wallet.create();
    const a = anchorMemory({ memory_id: "m1", content: "x", wallet, sequence: 0 });
    const b = anchorMemory({ memory_id: "m1", content: "x", wallet, sequence: 1 });
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.signature).not.toBe(b.signature);
  });

  it("emits expires_at = now + ttl_ms (default 30d)", () => {
    const wallet = Wallet.create();
    const t0 = fixedDate();
    const a = anchorMemory({ memory_id: "m1", content: "x", wallet, sequence: 0, now: t0 });
    const expires = new Date(a.expires_at).getTime();
    const expected = t0.getTime() + 30 * 24 * 60 * 60 * 1000;
    expect(expires).toBe(expected);
  });

  it("rejects negative or non-integer sequence", () => {
    const wallet = Wallet.create();
    expect(() =>
      anchorMemory({ memory_id: "m1", content: "x", wallet, sequence: -1 }),
    ).toThrow();
    expect(() =>
      anchorMemory({ memory_id: "m1", content: "x", wallet, sequence: 1.5 }),
    ).toThrow();
  });

  it("changes signature when memory_id changes (binding)", () => {
    const wallet = Wallet.create();
    const a = anchorMemory({ memory_id: "m1", content: "same", wallet, sequence: 0, nonce: FIXED_NONCE, now: fixedDate() });
    const b = anchorMemory({ memory_id: "m2", content: "same", wallet, sequence: 0, nonce: FIXED_NONCE, now: fixedDate() });
    expect(a.signature).not.toBe(b.signature);
  });
});

describe("verifyAnchor", () => {
  it("verifies a correctly-signed anchor against the original content", () => {
    const wallet = Wallet.create();
    const anchor = anchorMemory({ memory_id: "m1", content: "hello", wallet, sequence: 0 });
    const result = verifyAnchor({
      anchor,
      content: "hello",
      publicKey: wallet.publicKey,
      verify: (did, sig, payload, pk) => wallet.verify(did, sig, payload, pk),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when content changed (content_mismatch)", () => {
    const wallet = Wallet.create();
    const anchor = anchorMemory({ memory_id: "m1", content: "hello", wallet, sequence: 0 });
    const result = verifyAnchor({
      anchor,
      content: "tampered",
      publicKey: wallet.publicKey,
      verify: (did, sig, payload, pk) => wallet.verify(did, sig, payload, pk),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("content_mismatch");
  });

  it("rejects when signature is tampered (bad_signature)", () => {
    const wallet = Wallet.create();
    const anchor = anchorMemory({ memory_id: "m1", content: "hello", wallet, sequence: 0 });
    const tampered = { ...anchor, signature: "00".repeat(64) };
    const result = verifyAnchor({
      anchor: tampered,
      content: "hello",
      publicKey: wallet.publicKey,
      verify: (did, sig, payload, pk) => wallet.verify(did, sig, payload, pk),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });
});

describe("rollAnchorRoot", () => {
  it("returns empty string for empty input", () => {
    expect(rollAnchorRoot([])).toBe("");
  });

  it("returns a 64-char hex root for any non-empty batch", () => {
    const wallet = Wallet.create();
    const batch = [
      anchorMemory({ memory_id: "m1", content: "a", wallet, sequence: 0, now: fixedDate() }),
      anchorMemory({ memory_id: "m2", content: "b", wallet, sequence: 1, now: fixedDate() }),
      anchorMemory({ memory_id: "m3", content: "c", wallet, sequence: 2, now: fixedDate() }),
    ];
    const root = rollAnchorRoot(batch);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("replay defenses", () => {
  it("rejects an expired anchor", () => {
    const wallet = Wallet.create();
    const now = fixedDate();
    const anchor = anchorMemory({
      memory_id: "m1",
      content: "x",
      wallet,
      sequence: 0,
      ttl_ms: 1000,
      now,
    });
    const future = new Date(now.getTime() + 2000);
    const r = verifyAnchor({
      anchor,
      content: "x",
      publicKey: wallet.publicKey,
      verify: (did, sig, p, pk) => wallet.verify(did, sig, p, pk),
      now: future,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects a replayed nonce after first verification", () => {
    const wallet = Wallet.create();
    const store = new InMemoryNonceStore();
    const anchor = anchorMemory({ memory_id: "m1", content: "x", wallet, sequence: 0 });

    const r1 = verifyAnchor({
      anchor,
      content: "x",
      publicKey: wallet.publicKey,
      verify: (did, sig, p, pk) => wallet.verify(did, sig, p, pk),
      seen_nonces: store,
    });
    expect(r1.ok).toBe(true);

    const r2 = verifyAnchor({
      anchor,
      content: "x",
      publicKey: wallet.publicKey,
      verify: (did, sig, p, pk) => wallet.verify(did, sig, p, pk),
      seen_nonces: store,
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("nonce_replay");
  });

  it("does NOT record nonce when verification fails (no DoS via failed attempts)", () => {
    const wallet = Wallet.create();
    const store = new InMemoryNonceStore();
    const anchor = anchorMemory({ memory_id: "m1", content: "x", wallet, sequence: 0 });
    const tampered = { ...anchor, signature: "00".repeat(64) };

    const r1 = verifyAnchor({
      anchor: tampered,
      content: "x",
      publicKey: wallet.publicKey,
      verify: (did, sig, p, pk) => wallet.verify(did, sig, p, pk),
      seen_nonces: store,
    });
    expect(r1.ok).toBe(false);

    // A correct subsequent verify with the real anchor should still succeed.
    const r2 = verifyAnchor({
      anchor,
      content: "x",
      publicKey: wallet.publicKey,
      verify: (did, sig, p, pk) => wallet.verify(did, sig, p, pk),
      seen_nonces: store,
    });
    expect(r2.ok).toBe(true);
  });
});

describe("GridStamp spatial-proof envelope", () => {
  const proof: GridStampSpatialProof = {
    kind: "spatial_proof_v1",
    proofId: "proof_test_001",
    signature: "ab".repeat(32),
    timestamp: "2026-05-15T14:30:00.000Z",
    pose: { lat: 33.0151, lng: -96.6705, alt: 195, yaw: 1.2 },
    scores: { ssim: 0.94 },
    agentId: "agent_test",
  };

  it("includes the spatial proof in the signed payload (sig changes when proof changes)", () => {
    const wallet = Wallet.create();
    const base = anchorMemory({
      memory_id: "m1",
      content: "delivered to porch",
      wallet,
      sequence: 0,
      nonce: FIXED_NONCE,
      now: fixedDate(),
    });
    const withProof = anchorMemory({
      memory_id: "m1",
      content: "delivered to porch",
      wallet,
      sequence: 0,
      nonce: FIXED_NONCE,
      now: fixedDate(),
      gridstamp: proof,
    });
    // Same memory + nonce + time, but adding the gridstamp envelope must
    // change the signed payload (and therefore the signature). Otherwise an
    // attacker could swap the proof field without invalidating the anchor.
    expect(withProof.gridstamp).toEqual(proof);
    expect(base.signature).not.toBe(withProof.signature);
  });

  it("verifies a gridstamp-bearing anchor round-trip", () => {
    const wallet = Wallet.create();
    const anchor = anchorMemory({
      memory_id: "m1",
      content: "delivered to porch",
      wallet,
      sequence: 0,
      gridstamp: proof,
    });
    const r = verifyAnchor({
      anchor,
      content: "delivered to porch",
      publicKey: wallet.publicKey,
      verify: (did, sig, p, pk) => wallet.verify(did, sig, p, pk),
    });
    expect(r.ok).toBe(true);
  });

  it("rejects bad_signature if the gridstamp envelope is swapped after mint", () => {
    const wallet = Wallet.create();
    const anchor = anchorMemory({
      memory_id: "m1",
      content: "delivered to porch",
      wallet,
      sequence: 0,
      gridstamp: proof,
    });
    const swapped = {
      ...anchor,
      gridstamp: { ...proof, proofId: "proof_attacker_substituted" },
    };
    const r = verifyAnchor({
      anchor: swapped,
      content: "delivered to porch",
      publicKey: wallet.publicKey,
      verify: (did, sig, p, pk) => wallet.verify(did, sig, p, pk),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });
});
