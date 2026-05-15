/**
 * Example 07 — Recall + GridStamp anchor.
 *
 * Demonstrates the "memory with receipts" primitive shipped in v1.8.0:
 *
 *   1. Mint a per-agent identity Wallet (Ed25519 + DID).
 *   2. For each remembered piece of content, mint a MemoryAnchor — a
 *      DID-signed commitment to the content hash, with replay defenses
 *      (sequence, nonce, expires_at) baked in.
 *   3. Verify the anchor independently of the storage backend. The
 *      anchor module is pure — no I/O, no DB dependency — so verification
 *      works whether the memory lived in Postgres, Redis, R2, a file, or
 *      an LLM context window.
 *   4. Optionally attach a GridStampSpatialProof envelope (for embodied
 *      agents that need "this memory was taken AT this place" proofs).
 *   5. Roll a batch of anchors into a single Merkle root — useful for
 *      anchoring N memories with one on-chain checkpoint instead of N.
 *   6. Show how to reject replays via the bundled InMemoryNonceStore.
 *
 * The same pattern works for any consumer (mnemopay-gateway,
 * mnemopay-code, mnemopay-browser, or third-party agents). Just persist
 * the returned MemoryAnchor alongside the memory row.
 *
 * Run:
 *   npx tsx examples/07-recall-anchor.ts
 */

import { Wallet } from "../src/identity/wallet.js";
import {
  anchorMemory,
  verifyAnchor,
  rollAnchorRoot,
  InMemoryNonceStore,
  type MemoryAnchor,
} from "../src/recall/anchor.js";
import type { GridStampSpatialProof } from "../src/governance/spatial.js";

function log(label: string, value: unknown): void {
  console.log(`\n${label}`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

// ─── 1. Mint a per-agent wallet ─────────────────────────────────────────────
// The Wallet wraps an Ed25519 keypair + a portable DID (did:mp:...). Same
// wallet you'd export-bundle to carry reputation across platforms.
const agent = Wallet.create({ name: "memory-bot" });
log("Agent DID", agent.did);

// ─── 2. Mint anchors for two memories ───────────────────────────────────────
// In production, `sequence` is a monotonic per-wallet counter the consumer
// maintains (e.g. select max(sequence)+1 from memories where wallet=...).
const m1 = "user prefers dark mode and 4-space indent";
const m2 = "user is on call this Saturday — no Friday-night deploys";

const anchor1 = anchorMemory({
  memory_id: "mem_001",
  content: m1,
  wallet: agent,
  sequence: 0,
});
const anchor2 = anchorMemory({
  memory_id: "mem_002",
  content: m2,
  wallet: agent,
  sequence: 1,
});

log("Anchor #1", anchor1);

// ─── 3. Verify an anchor independently ──────────────────────────────────────
// Verification needs: the anchor, the original content, the agent's
// public key, and a verify() function that knows how to check Ed25519
// signatures. The anchor module stays free of identity-module imports by
// taking verify() as a parameter.
const result1 = verifyAnchor({
  anchor: anchor1,
  content: m1,
  publicKey: agent.publicKey,
  verify: (did, signature, payload, publicKey) =>
    agent.verify(did, signature, payload, publicKey),
});
log("verify(anchor1, original content)", result1);

// Tampered content fails fast — content_mismatch detected before the
// signature is even checked.
const result1Tampered = verifyAnchor({
  anchor: anchor1,
  content: m1 + " (injected by attacker)",
  publicKey: agent.publicKey,
  verify: (did, signature, payload, publicKey) =>
    agent.verify(did, signature, payload, publicKey),
});
log("verify(anchor1, tampered content)", result1Tampered);

// ─── 4. (Optional) Anchor with a GridStamp spatial proof ────────────────────
// For embodied agents — robots, drones, AGVs — a memory can carry a
// GridStampSpatialProof envelope binding the memory to a physical pose
// at capture time. The anchor signs OVER the proof, so any later tampering
// invalidates both signatures.
const spatialProof: GridStampSpatialProof = {
  kind: "spatial_proof_v1",
  proofId: "proof_demo_001",
  signature: "deadbeef".repeat(16), // HMAC from gridstamp, not validated here
  timestamp: new Date().toISOString(),
  pose: { lat: 33.0151, lng: -96.6705, alt: 195, yaw: 1.2 },
  scores: { ssim: 0.94 },
  agentId: "agent_demo",
};

const anchor3 = anchorMemory({
  memory_id: "mem_003",
  content: "delivered package to mailbox at front porch",
  wallet: agent,
  sequence: 2,
  gridstamp: spatialProof,
});
log("Anchor #3 (with spatial proof)", anchor3);

// ─── 5. Merkle-roll a batch ─────────────────────────────────────────────────
// If you want to anchor N memories with one external write (e.g. one
// on-chain checkpoint, one row in an audit table), compute a single root
// over the batch. The root commits to the full membership list.
const batch: MemoryAnchor[] = [anchor1, anchor2, anchor3];
const root = rollAnchorRoot(batch);
log("Merkle root over 3 anchors", root);

// ─── 6. Replay rejection via NonceStore ─────────────────────────────────────
// Anchors are single-use for verification when paired with a NonceStore.
// First verify succeeds; second is rejected with reason "nonce_replay".
// Production deployments swap InMemoryNonceStore for a Redis-backed adapter
// (same interface; SETNX + EXPIRE).
const nonceStore = new InMemoryNonceStore();

const rA = verifyAnchor({
  anchor: anchor1,
  content: m1,
  publicKey: agent.publicKey,
  verify: (did, signature, payload, publicKey) =>
    agent.verify(did, signature, payload, publicKey),
  seen_nonces: nonceStore,
});
log("First verify with nonce store", rA);

const rB = verifyAnchor({
  anchor: anchor1,
  content: m1,
  publicKey: agent.publicKey,
  verify: (did, signature, payload, publicKey) =>
    agent.verify(did, signature, payload, publicKey),
  seen_nonces: nonceStore,
});
log("Second verify (replay attempt)", rB);
