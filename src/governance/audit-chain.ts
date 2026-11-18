/**
 * @mnemopay/sdk — shared event-stream + Merkle-root audit chain.
 *
 * Sister module to `audit.ts`'s `MerkleAudit` (which uses a chained-hash
 * design — each event commits to the previous chain hash). `AuditChain`
 * uses a per-event UUID + parent pointer + tree-Merkle root, which is the
 * shape downstream consumers (mnemopay-code, mnemopay-browser, and the
 * MCP gateway) need for Article 12 bundles where each event has a stable
 * id and event-level signatures.
 *
 * Both are valid audit primitives; this one is optimized for **bundle
 * export** (audit-12 bundles, signed PDFs, per-event signature surface),
 * while `MerkleAudit` is optimized for **streaming verification** (append
 * one, verify the chain).
 *
 * Pure module — only node:crypto.
 */

import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ChainEvent {
  /** UUIDv4. */
  id: string;
  /** Monotonic stream id — useful for log replay + ordering. */
  sequence: number;
  /** ISO-8601 wallclock of emission. */
  occurred_at: string;
  /** Event kind — caller-defined (e.g. `llm.call.start`). */
  kind: string;
  /** Payload — arbitrary JSON-able structure. */
  payload: Record<string, unknown>;
  /** Optional parent — caller-supplied for span correlation. */
  parent_id?: string;
  /** Optional signature over the canonical event bytes (hex/base64). */
  signature?: string;
}

export interface ChainSinkOptions {
  /** Optional signer — called with the canonical event payload before emit. */
  signer?: (payload: string) => string;
  /** Optional fixed sequence start — defaults to 0. */
  sequence_start?: number;
  /**
   * Optional file path. When provided, every `emit()` appends the event as a
   * single JSONL line to that path using `appendFileSync` (best-effort sync;
   * disk failures are logged via `console.warn` and never propagated). The
   * in-memory tail is preserved so `rollMerkleRoot()` / `toBundle()` behave
   * identically to the in-memory-only mode.
   *
   * Replaces the consumer-side `FileAuditChain` shim that several downstream
   * apps (bizsuite-site, mcp-gateway) were carrying as a 25-line subclass.
   */
  path?: string;
  /**
   * Fail closed on disk errors (only meaningful with `path`). When true, a
   * failed mkdir throws from the constructor and a failed append throws from
   * `emit()`; the event is then NOT added to the in-memory chain and its
   * sequence number is not consumed, so memory and disk never disagree.
   * Default false (best-effort, the original behaviour) for back-compat.
   */
  strict?: boolean;
}

export class AuditChain {
  private readonly _events: ChainEvent[] = [];
  private readonly opts: ChainSinkOptions;
  private nextSequence: number;
  /**
   * Per-event cached sha256(canonicalize(event)). Populated at `emit()` so
   * `rollMerkleRoot()` only has to walk the tree levels — the per-event
   * canonical + leaf-hash work happens once. Verifiers (verifyBundle)
   * recompute from scratch because they take an external bundle without
   * this cache.
   */
  private readonly _leafHashes: string[] = [];

  constructor(opts: ChainSinkOptions = {}) {
    this.opts = opts;
    this.nextSequence = opts.sequence_start ?? 0;
    if (opts.path) {
      // Best-effort: ensure the parent directory exists. A failure here
      // (read-only fs, bad path) is logged but does not throw — emit()
      // itself swallows disk failures by the same invariant.
      try {
        mkdirSync(dirname(opts.path), { recursive: true });
      } catch (err) {
        if (opts.strict) throw err;
        console.warn(
          "[mnemopay/governance/audit-chain] mkdir failed for",
          opts.path,
          (err as Error).message,
        );
      }
    }
  }

  emit(kind: string, payload: Record<string, unknown>, parent_id?: string): ChainEvent {
    const draft: ChainEvent = {
      id: randomUUID(),
      sequence: this.nextSequence++,
      occurred_at: new Date().toISOString(),
      kind,
      payload,
      ...(parent_id ? { parent_id } : {}),
    };
    if (this.opts.signer) {
      // Canonicalize once; reuse for both signer + leaf hash.
      const canonical = canonicalize(draft);
      draft.signature = this.opts.signer(canonical);
    }
    // The signature (if any) was added AFTER canonicalize, so the leaf hash
    // must re-canonicalize to include it. Match verifyBundle's behavior.
    const leaf = sha256Hex(canonicalize(draft));
    // Optional file-backed sink — append-only JSONL, written BEFORE the event
    // joins the in-memory chain. Best-effort unless `strict`.
    if (this.opts.path) {
      try {
        appendFileSync(this.opts.path, JSON.stringify(draft) + "\n");
      } catch (err) {
        if (this.opts.strict) {
          this.nextSequence--;
          throw err;
        }
        console.warn(
          "[mnemopay/governance/audit-chain] disk append failed:",
          (err as Error).message,
        );
      }
    }
    this._leafHashes.push(leaf);
    this._events.push(draft);
    return draft;
  }

  events(): readonly ChainEvent[] {
    return this._events;
  }

  /** Roll a tree-Merkle root over emitted events. Empty stream → "". */
  rollMerkleRoot(): string {
    if (this._events.length === 0) return "";
    // Leaf hashes were cached at emit() time. Walk the tree.
    let layer: string[] = this._leafHashes.slice();
    while (layer.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const a = layer[i]!;
        const b = layer[i + 1] ?? a;
        next.push(sha256Hex(a + b));
      }
      layer = next;
    }
    return layer[0] ?? "";
  }

  /** Materialize the canonical bundle object (consumed by Article 12 zip writer). */
  toBundle<TMeta extends Record<string, unknown> = Record<string, unknown>>(
    meta: TMeta = {} as TMeta,
  ): ChainBundle<TMeta> {
    return {
      version: 1,
      built_at: new Date().toISOString(),
      meta,
      events: this._events.slice(),
      merkle_root: this.rollMerkleRoot(),
    };
  }

  /**
   * Roll the full bundle and write it to `pathOut` as a single JSON document.
   * Useful for offline Article-12 export when the rolling JSONL is the live
   * stream and a snapshot bundle is what the regulator actually receives.
   *
   * Returns the bundle that was written.
   */
  rollAndExport<TMeta extends Record<string, unknown> = Record<string, unknown>>(
    args: { pathOut: string; meta?: TMeta },
  ): ChainBundle<TMeta> {
    const bundle = this.toBundle<TMeta>(args.meta ?? ({} as TMeta));
    try {
      mkdirSync(dirname(args.pathOut), { recursive: true });
    } catch {
      /* best-effort */
    }
    writeFileSync(args.pathOut, JSON.stringify(bundle, null, 2));
    return bundle;
  }
}

export interface ChainBundle<TMeta extends Record<string, unknown> = Record<string, unknown>> {
  version: 1;
  built_at: string;
  meta: TMeta;
  events: readonly ChainEvent[];
  merkle_root: string;
}

/** Stable JSON canonicalisation: sorted keys, no whitespace. */
export function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((item) => canonicalize(item)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  // Match JSON transport semantics: undefined object properties disappear,
  // while undefined array entries become null. Otherwise a bundle can verify
  // in memory but fail after JSON.stringify/parse.
  const keys = Object.keys(obj).filter((key) => obj[key] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Verify an external chain bundle.
 *   1. Recompute the Merkle root over the events.
 *   2. Optionally re-verify each per-event signature.
 */
export interface VerifyBundleOptions {
  verifyEventSignature?: (event: ChainEvent) => boolean;
}

export function verifyBundle(
  bundle: ChainBundle,
  options: VerifyBundleOptions = {},
): { ok: true } | { ok: false; reason: "root_mismatch" | "bad_event_signature"; index?: number } {
  if (bundle.events.length === 0) {
    return bundle.merkle_root === "" ? { ok: true } : { ok: false, reason: "root_mismatch" };
  }
  let layer = bundle.events.map((e) => sha256Hex(canonicalize(e)));
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!;
      const b = layer[i + 1] ?? a;
      next.push(sha256Hex(a + b));
    }
    layer = next;
  }
  if (layer[0] !== bundle.merkle_root) return { ok: false, reason: "root_mismatch" };

  if (options.verifyEventSignature) {
    for (let i = 0; i < bundle.events.length; i++) {
      const ev = bundle.events[i]!;
      if (ev.signature && !options.verifyEventSignature(ev)) {
        return { ok: false, reason: "bad_event_signature", index: i };
      }
    }
  }
  return { ok: true };
}
