/**
 * @mnemopay/sdk — on-chain anchoring seam for AuditChain bundles.
 *
 * `AuditChain.toBundle()` already produces a verifiable `merkle_root`, but that
 * root lives *inside* the bundle: whoever holds the file can recompute it, so it
 * proves internal consistency, not existence at a point in time. Anchoring the
 * root in an external append-only medium adds "this root existed at time T"
 * without the verifier having to trust the operator.
 *
 * This module is the **interface only**. MnemoPay deliberately ships no chain
 * code, no contract ABIs, no addresses and no gas handling:
 *
 *   - An anchoring provider implements {@link OnChainAnchorSink} in *their* own
 *     package and is injected here, exactly like `NeonAdapter` takes `pg` and
 *     `X402Rail` takes its signer. The SDK core keeps zero chain dependencies.
 *   - Which chain, which contract and who pays gas are entirely the sink's
 *     business. `chain` comes back as an opaque string from the sink rather than
 *     being enumerated here, so no provider or network is privileged by the SDK
 *     and a provider can be swapped without an SDK release.
 *   - Anchoring is **async by contract**: `anchor()` returns a handle and
 *     `status()` is polled. A synchronous on-chain reference at seal time would
 *     make sealing block on block inclusion.
 *
 * Division of responsibility: MnemoPay owns the structured log, the Merkle root
 * and custody of the records (EU AI Act Article 12). The sink owns anchoring and
 * tamper-evidence. No raw events ever leave the producer — only the root and the
 * bundle metadata the producer chooses to pass.
 */

import type { ChainBundle } from "./audit-chain.js";

/** What a producer hands the sink at seal time. Never raw events. */
export interface AnchorRequest {
  /**
   * Namespace for the producer, so one anchoring medium can serve many
   * independent producers without collision. Opaque to the SDK.
   */
  producerId: string;
  /** `ChainBundle.merkle_root`, passed through verbatim. */
  merkleRoot: string;
  /** Bundle metadata the producer chooses to expose. Never the events. */
  bundleMeta: Record<string, unknown>;
  /** ISO-8601 instant the bundle was sealed (`ChainBundle.built_at`). */
  sealedAt: string;
}

/** Handle returned immediately; resolve it with {@link OnChainAnchorSink.status}. */
export interface AnchorHandle {
  anchorId: string;
}

/**
 * A resolved, independently verifiable anchor.
 *
 * Every field is supplied by the sink. The SDK treats them as opaque strings and
 * never parses, validates or interprets them — it only stores them beside the
 * bundle so a verifier can check the anchor against the medium itself.
 */
export interface AnchorReference {
  /** Sink-defined medium identifier, e.g. a chain name. Opaque. */
  chain: string;
  /** Sink-defined transaction/receipt identifier. Opaque. */
  txHash: string;
  /** The committed form of the root as recorded by the sink. Opaque. */
  rootCommitment: string;
}

export type AnchorStatus =
  | { state: "pending" }
  | ({ state: "anchored" } & AnchorReference)
  | { state: "failed"; reason: string };

/**
 * Implemented by an anchoring provider, in the provider's own package.
 *
 * Implementations must not throw for an unknown `anchorId`; return
 * `{ state: "failed" }` instead, so a lost handle is a data condition rather
 * than a crash in the producer's seal path.
 */
export interface OnChainAnchorSink {
  anchor(input: AnchorRequest): Promise<AnchorHandle>;
  status(anchorId: string): Promise<AnchorStatus>;
}

/** Meta key under which {@link attachAnchorReference} stores the reference. */
export const ANCHOR_META_KEY = "anchor" as const;

/**
 * Hand a sealed bundle's root to a sink.
 *
 * Refuses an empty root: `rollMerkleRoot()` returns `""` for a stream with no
 * events, and anchoring `""` would produce an attestation that proves nothing
 * while looking authoritative.
 */
export async function anchorChainBundle(
  bundle: ChainBundle,
  sink: OnChainAnchorSink,
  opts: { producerId: string },
): Promise<AnchorHandle> {
  if (!opts?.producerId) {
    throw new Error("anchorChainBundle: producerId is required");
  }
  if (!bundle.merkle_root) {
    throw new Error(
      "anchorChainBundle: refusing to anchor an empty merkle_root (bundle has no events)",
    );
  }
  return sink.anchor({
    producerId: opts.producerId,
    merkleRoot: bundle.merkle_root,
    bundleMeta: bundle.meta,
    sealedAt: bundle.built_at,
  });
}

/**
 * Return a copy of `bundle` carrying `ref` under `meta.anchor`.
 *
 * Safe by construction: `merkle_root` is rolled over `events` only, so adding
 * metadata cannot invalidate the root and `verifyBundle()` still passes. The
 * bundle is copied rather than mutated, and an existing `meta.anchor` is a hard
 * error — silently replacing one anchor with another would strand the first
 * attestation with no record that it ever existed.
 */
export function attachAnchorReference<TMeta extends Record<string, unknown>>(
  bundle: ChainBundle<TMeta>,
  ref: AnchorReference,
): ChainBundle<TMeta & { anchor: AnchorReference }> {
  if (bundle.meta && ANCHOR_META_KEY in bundle.meta) {
    throw new Error(
      "attachAnchorReference: bundle.meta.anchor is already set — refusing to overwrite an existing anchor",
    );
  }
  return {
    ...bundle,
    meta: { ...(bundle.meta as TMeta), [ANCHOR_META_KEY]: ref } as TMeta & {
      anchor: AnchorReference;
    },
  };
}

export interface PollAnchorOptions {
  /** Maximum status checks before giving up. Default 10. */
  attempts?: number;
  /** Delay between checks, in ms. Default 1000. */
  delayMs?: number;
  /** Injected sleep, so tests need no real timers. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Poll until the anchor resolves.
 *
 * Returns the terminal status rather than throwing on `failed`: a failed anchor
 * is an expected outcome the producer should record, not an exception. Returns
 * the last `pending` status when `attempts` is exhausted, so a caller can tell
 * "still pending" apart from "failed".
 */
export async function pollAnchor(
  sink: OnChainAnchorSink,
  anchorId: string,
  opts: PollAnchorOptions = {},
): Promise<AnchorStatus> {
  const attempts = Math.max(1, opts.attempts ?? 10);
  const delayMs = Math.max(0, opts.delayMs ?? 1000);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let last: AnchorStatus = { state: "pending" };
  for (let i = 0; i < attempts; i++) {
    last = await sink.status(anchorId);
    if (last.state !== "pending") return last;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return last;
}

/**
 * Deterministic in-memory {@link OnChainAnchorSink} for tests and local dev.
 *
 * Performs no I/O of any kind. Reports a synthetic `chain` of `"mock"` so a mock
 * reference can never be mistaken for a real attestation.
 */
export class MockAnchorSink implements OnChainAnchorSink {
  /** Every request received, in order — assert against this in tests. */
  readonly requests: AnchorRequest[] = [];

  private readonly pendingTicks: number;
  private readonly failWith?: string;
  private seq = 0;
  private readonly polls = new Map<string, number>();
  private readonly roots = new Map<string, string>();

  constructor(opts: { pendingTicks?: number; failWith?: string } = {}) {
    this.pendingTicks = Math.max(0, opts.pendingTicks ?? 0);
    this.failWith = opts.failWith;
  }

  async anchor(input: AnchorRequest): Promise<AnchorHandle> {
    this.requests.push(input);
    const anchorId = `mock-anchor-${++this.seq}`;
    this.polls.set(anchorId, 0);
    this.roots.set(anchorId, input.merkleRoot);
    return { anchorId };
  }

  async status(anchorId: string): Promise<AnchorStatus> {
    const seen = this.polls.get(anchorId);
    // Unknown handle is a data condition, not a crash — see OnChainAnchorSink.
    if (seen === undefined) return { state: "failed", reason: `unknown anchorId: ${anchorId}` };
    if (this.failWith !== undefined) return { state: "failed", reason: this.failWith };
    this.polls.set(anchorId, seen + 1);
    if (seen < this.pendingTicks) return { state: "pending" };
    const root = this.roots.get(anchorId)!;
    return {
      state: "anchored",
      chain: "mock",
      txHash: `0xmock${anchorId}`,
      rootCommitment: root,
    };
  }
}
