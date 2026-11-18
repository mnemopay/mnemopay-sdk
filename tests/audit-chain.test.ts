import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditChain, verifyBundle, canonicalize, sha256Hex } from "../src/governance/audit-chain.js";

describe("AuditChain.emit", () => {
  it("assigns monotonic sequence ids starting at 0", () => {
    const chain = new AuditChain();
    const a = chain.emit("kind.a", { x: 1 });
    const b = chain.emit("kind.b", { x: 2 });
    expect(a.sequence).toBe(0);
    expect(b.sequence).toBe(1);
  });

  it("threads parent_id when supplied", () => {
    const chain = new AuditChain();
    const parent = chain.emit("kind.a", { x: 1 });
    const child = chain.emit("kind.b", { x: 2 }, parent.id);
    expect(child.parent_id).toBe(parent.id);
  });

  it("invokes signer when provided", () => {
    const chain = new AuditChain({ signer: (p) => "sig:" + p.length.toString() });
    const e = chain.emit("kind.a", { x: 1 });
    expect(e.signature).toMatch(/^sig:\d+$/);
  });
});

describe("rollMerkleRoot + verifyBundle", () => {
  it("empty chain → empty root → verifies as ok", () => {
    const bundle = new AuditChain().toBundle();
    expect(bundle.merkle_root).toBe("");
    expect(verifyBundle(bundle).ok).toBe(true);
  });

  it("non-empty chain produces 64-char hex root + verifyBundle ok", () => {
    const chain = new AuditChain();
    chain.emit("a", { v: 1 });
    chain.emit("b", { v: 2 });
    chain.emit("c", { v: 3 });
    const bundle = chain.toBundle();
    expect(bundle.merkle_root).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyBundle(bundle).ok).toBe(true);
  });

  it("detects tampering — verifyBundle returns root_mismatch", () => {
    const chain = new AuditChain();
    chain.emit("a", { v: 1 });
    chain.emit("b", { v: 2 });
    const bundle = chain.toBundle();
    const tampered = {
      ...bundle,
      events: bundle.events.map((e, i) => (i === 0 ? { ...e, payload: { v: 999 } } : e)),
    };
    const r = verifyBundle(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("root_mismatch");
  });

  it("verifyEventSignature hook catches per-event signature tampering", () => {
    const chain = new AuditChain({ signer: () => "good-sig" });
    chain.emit("a", { v: 1 });
    const bundle = chain.toBundle();
    const tampered = {
      ...bundle,
      events: bundle.events.map((e) => ({ ...e, signature: "bad-sig" })),
    };
    const root = sha256Hex(canonicalize(tampered.events[0]!));
    const r = verifyBundle(
      { ...tampered, merkle_root: root },
      { verifyEventSignature: (e) => e.signature === "good-sig" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_event_signature");
  });
});

describe("AuditChain — file-backed", () => {
  it("path-backed: every emit appends one JSONL line + bundle still verifies", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-chain-test-"));
    const path = join(dir, "nested", "llm.jsonl");
    try {
      const chain = new AuditChain({ path });
      const a = chain.emit("llm.call", { tokens: 100 });
      const b = chain.emit("llm.call", { tokens: 200 });
      const c = chain.emit("llm.call", { tokens: 50 });

      expect(existsSync(path)).toBe(true);
      const lines = readFileSync(path, "utf8").trim().split("\n");
      expect(lines.length).toBe(3);
      const parsed = lines.map((l) => JSON.parse(l));
      expect(parsed[0].id).toBe(a.id);
      expect(parsed[1].id).toBe(b.id);
      expect(parsed[2].id).toBe(c.id);
      expect(parsed[0].payload.tokens).toBe(100);

      // In-memory tail must remain intact — bundle verifies.
      const bundle = chain.toBundle();
      expect(bundle.events.length).toBe(3);
      expect(verifyBundle(bundle).ok).toBe(true);

      // rollAndExport writes the bundle snapshot.
      const out = join(dir, "bundle.json");
      const exported = chain.rollAndExport({ pathOut: out });
      expect(existsSync(out)).toBe(true);
      const onDisk = JSON.parse(readFileSync(out, "utf8"));
      expect(onDisk.events.length).toBe(3);
      expect(onDisk.merkle_root).toBe(exported.merkle_root);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strict: a failed append throws, and the event is not kept in memory nor its sequence consumed", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-chain-test-"));
    const path = join(dir, "log.jsonl");
    try {
      mkdirSync(path); // a directory where the log file should be → append fails
      const chain = new AuditChain({ path, strict: true });
      expect(() => chain.emit("a", { v: 1 })).toThrow();
      expect(chain.events().length).toBe(0);
      expect(chain.rollMerkleRoot()).toBe("");
      rmSync(path, { recursive: true });
      const ok = chain.emit("b", { v: 2 });
      expect(ok.sequence).toBe(0);
      expect(readFileSync(path, "utf8").trim().split("\n").length).toBe(1);
      expect(verifyBundle(chain.toBundle()).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CONTROL: without strict the same append failure is swallowed (original best-effort behaviour)", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-chain-test-"));
    const path = join(dir, "log.jsonl");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mkdirSync(path);
      const chain = new AuditChain({ path });
      expect(() => chain.emit("a", { v: 1 })).not.toThrow();
      expect(chain.events().length).toBe(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strict: a parent path that cannot be created throws from the constructor", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-chain-test-"));
    try {
      const blocker = join(dir, "file");
      writeFileSync(blocker, "x");
      expect(() => new AuditChain({ path: join(blocker, "sub", "log.jsonl"), strict: true })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("back-compat: no path → behaves identically to prior in-memory chain", () => {
    const chain = new AuditChain();
    chain.emit("a", { v: 1 });
    chain.emit("b", { v: 2 });
    const bundle = chain.toBundle();
    expect(bundle.events.length).toBe(2);
    expect(bundle.merkle_root).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyBundle(bundle).ok).toBe(true);
  });
});
