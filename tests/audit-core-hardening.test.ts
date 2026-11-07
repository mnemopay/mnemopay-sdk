/**
 * Regression tests for the 2026-11-06 audit (03-mnemopay-core):
 *   D2  agent id path traversal in persistence
 *   P1  NaN / negative / Infinity must fail CLOSED in policy + capability tokens
 *   S4  cross-process money-state last-writer-wins race
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MnemoPayLite } from "../src/index.js";
import { safeFileId } from "../src/safe-id.js";
import { compilePolicy, evaluateAction, type Policy } from "../src/governance/policy.js";
import { IdentityRegistry } from "../src/identity.js";

let root: string;
let dir: string;
const live: MnemoPayLite[] = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mnemopay-audit-"));
  dir = path.join(root, "persist");
});
afterEach(() => {
  while (live.length) live.pop()!.destroy();
  fs.rmSync(root, { recursive: true, force: true });
});

const FRAUD = {
  maxChargesPerMinute: 9999, maxChargesPerHour: 9999, maxChargesPerDay: 9999,
  maxDailyVolume: 9_999_999, blockThreshold: 2.0, settlementHoldMinutes: 0, disputeWindowMinutes: 0,
};

function spawn(id: string): MnemoPayLite {
  const a = new MnemoPayLite(id, 0.05, false, undefined, FRAUD);
  a.enablePersistence(dir);
  live.push(a);
  return a;
}

describe("D2: agent id cannot escape the persist dir", () => {
  it("safeFileId keeps ordinary ids unchanged (existing files keep their names)", () => {
    for (const id of ["agent-1", "tnt_pro_0123456789", "did:mp:abc", "user-123.v2", "a@b.c"]) {
      expect(safeFileId(id)).toBe(id);
    }
  });

  it("safeFileId neutralises traversal and separators, and keeps distinct ids distinct", () => {
    const bad = ["../escaped", "../../app/package", "a/b", "a\\b", "..", ".", "", ".hidden", "x/../y", "a\0b"];
    const out = bad.map(safeFileId);
    for (const o of out) {
      expect(o).toMatch(/^[A-Za-z0-9_@:.-]+$/);
      expect(o).not.toContain("..");
      expect(o).not.toContain("/");
      expect(o).not.toContain("\\");
    }
    expect(new Set(out).size).toBe(bad.length);
  });

  it("remember() with a traversal id writes ONLY inside the persist dir", async () => {
    const evil = spawn("../escaped-by-agentid");
    await evil.remember("payload");
    // nothing may appear in the parent of the persist dir (where the old code wrote)
    const outside = fs.readdirSync(root).filter((f) => f !== "persist");
    expect(outside).toEqual([]);
    const inside = fs.readdirSync(dir);
    expect(inside.length).toBeGreaterThan(0);
    for (const f of inside) expect(f).not.toContain("..");
  });

  it("an absolute-looking id cannot target another directory either", async () => {
    const target = path.join(root, "victim.json");
    const evil = spawn(path.join(root, "victim"));
    await evil.remember("payload");
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe("P1: malformed amounts fail closed", () => {
  const policy: Policy = {
    id: "p", version: 1,
    rules: [{ id: "cap", applies_to: ["payment"], hard_cap_usd: 25, approval_threshold_usd: 10 }],
  };
  const compiled = compilePolicy(policy);
  const pay = (usd: number | undefined) =>
    evaluateAction(compiled, { kind: "payment", target: "x", ...(usd === undefined ? {} : { estimated_usd: usd }) });

  it("NaN / negative / Infinity are denied", () => {
    for (const bad of [NaN, -1, -1e9, Infinity, -Infinity]) {
      const v = pay(bad);
      expect("allowed" in v && v.allowed).toBe(false);
      expect((v as any).reason).toBe("invalid_amount");
    }
  });

  it("a non-number estimate is denied", () => {
    const v = evaluateAction(compiled, { kind: "payment", target: "x", estimated_usd: "5" as unknown as number });
    expect("allowed" in v && v.allowed).toBe(false);
  });

  it("is denied even when no rule matches the action kind", () => {
    const v = evaluateAction(compiled, { kind: "tool_call", target: "x", estimated_usd: NaN });
    expect("allowed" in v && v.allowed).toBe(false);
  });

  it("legitimate amounts still behave as before", () => {
    expect((pay(5) as any).allowed).toBe(true);
    expect((pay(0) as any).allowed).toBe(true);
    expect((pay(undefined) as any).allowed).toBe(true);
    expect((pay(15) as any).needs_approval).toBe(true);
    expect((pay(30) as any).allowed).toBe(false);
  });

  it("validateToken rejects NaN / negative / Infinity amounts", () => {
    const r = new IdentityRegistry();
    r.createIdentity("a1", "o1", "o@e.com");
    const t = r.issueToken("a1", ["charge"], { maxAmount: 10, maxTotalSpend: 100 });
    for (const bad of [NaN, -100, Infinity, -Infinity]) {
      expect(r.validateToken(t.id, "charge", bad).valid).toBe(false);
    }
    expect(r.validateToken(t.id, "charge", 5).valid).toBe(true);
    expect(r.validateToken(t.id, "charge", 0).valid).toBe(true);
    expect(r.validateToken(t.id, "charge").valid).toBe(true);
  });

  it("MnemoPayLite.charge rejects NaN / negative / Infinity / non-number", async () => {
    const a = new MnemoPayLite("p1-charge", 0.05, false, undefined, FRAUD);
    for (const bad of [NaN, -5, 0, Infinity, -Infinity, "5" as unknown as number, 1e308]) {
      await expect(a.charge(bad, "x")).rejects.toThrow();
    }
  });
});

describe("S4: concurrent writers cannot silently overwrite money state", () => {
  it("a stale process adopts committed money state before it acts (charge ids do not collide)", async () => {
    const a = spawn("race-adopt");
    const b = spawn("race-adopt"); // loads the same (empty) file: a snapshot that is about to be stale

    const txA = await a.charge(10, "A's charge");
    await a.settle(txA.id);
    const walletAfterA = (await a.balance()).wallet;
    expect(walletAfterA).toBeGreaterThan(0);

    // B never saw A's work. Old code: B's charge reused id "1" and its save wrote
    // wallet=0 over A's settlement. New code: B refreshes first.
    const txB = await b.charge(10, "B's charge");
    expect(txB.id).not.toBe(txA.id);

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "race-adopt.json"), "utf-8"));
    expect(onDisk.wallet).toBeCloseTo(walletAfterA, 2); // A's settlement survived B's save
    expect(onDisk.settledCount).toBe(1);
    expect(onDisk.stateVersion).toBeGreaterThan(1);
  });

  it("an idle stale instance's autosave does not erase another process's money state", async () => {
    const idle = spawn("race-idle");
    const busy = spawn("race-idle");

    const tx = await busy.charge(10, "work");
    await busy.settle(tx.id);
    const wallet = (await busy.balance()).wallet;

    (idle as any)._saveToDisk(); // what the 30s autosave / exit hook does

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "race-idle.json"), "utf-8"));
    expect(onDisk.wallet).toBeCloseTo(wallet, 2);
    expect(onDisk.settledCount).toBe(1);
    // and the idle instance now agrees with disk
    expect((await idle.balance()).wallet).toBeCloseTo(wallet, 2);
  });

  it("a true lost update (two writers changed money after the same base) is detected, not silent", async () => {
    const a = spawn("race-conflict");
    const b = spawn("race-conflict");
    const events: any[] = [];
    b.on("persist:conflict", (e: any) => events.push(e));

    const txA = await a.charge(10, "A"); // A commits first
    await a.settle(txA.id);
    const walletA = (await a.balance()).wallet;

    // B mutates its OWN stale in-memory money state directly, bypassing the
    // start-of-operation refresh, to model an overlap inside one async op.
    (b as any)._wallet = 777;
    (b as any)._saveToDisk();

    expect(events.length).toBe(1);
    expect(events[0].diskVersion).toBeGreaterThan(events[0].localVersion);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "race-conflict.json"), "utf-8"));
    expect(onDisk.wallet).toBeCloseTo(walletA, 2); // first committer won; 777 did NOT overwrite it
    expect(onDisk.wallet).not.toBe(777);
  });

  it("memories from both writers still merge", async () => {
    const a = spawn("race-mem");
    const b = spawn("race-mem");
    await a.remember("from A");
    await b.remember("from B");
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "race-mem.json"), "utf-8"));
    expect(onDisk.memories.map((m: any) => m.content).sort()).toEqual(["from A", "from B"]);
  });

  it("charge counter survives a restart (no id reuse over a pending tx)", async () => {
    const a = spawn("race-restart");
    const t1 = await a.charge(10, "first");
    a.destroy();
    live.splice(live.indexOf(a), 1);
    const again = spawn("race-restart");
    const t2 = await again.charge(10, "second");
    expect(t2.id).not.toBe(t1.id);
    const pending = await again.history(10);
    expect(pending.filter((t: any) => t.status === "pending").length).toBe(2);
  });

  it("stale lock files do not block saving", async () => {
    const a = spawn("race-lock");
    const lock = path.join(dir, "race-lock.json.lock");
    fs.writeFileSync(lock, "999999");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    await a.remember("after stale lock");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "race-lock.json"), "utf-8")).memories.length).toBe(1);
    expect(fs.existsSync(lock)).toBe(false);
  });
});
