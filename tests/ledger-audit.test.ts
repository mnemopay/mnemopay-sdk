import { describe, it, expect } from "vitest";
import { Ledger } from "../src/ledger.js";

function busy(n: number): Ledger {
  const l = new Ledger();
  for (let i = 0; i < n; i++) {
    l.recordCharge("a1", 10, `tx-${i}`);
    l.recordSettlement("a1", `tx-${i}`, 10, 0.3, 9.7, "cp");
  }
  return l;
}

describe("Ledger audit guarantees", () => {
  it("compact(50) keeps recording entries afterwards (regression: it used to disable recording)", () => {
    const l = busy(20);
    l.compact(50);
    const before = l.visibleSize;
    l.recordCharge("a1", 5, "after-compact");
    expect(l.visibleSize).toBe(before + 2);
    expect(l.getEntriesForTransaction("after-compact")).toHaveLength(2);
    expect(l.verify().auditTrail).toBe("compacted");
  });

  it("hash chain stays valid across compaction and survives a serialize roundtrip", () => {
    const l = busy(20);
    const dropped = l.compact(50);
    expect(dropped.length).toBeGreaterThan(0);
    expect(l.verifyChain().valid).toBe(true);
    const restored = new Ledger(l.serialize());
    expect(restored.verifyChain().valid).toBe(true);
    expect(restored.verify().balanced).toBe(true);
  });

  it("detects tampering with a non-amount field (description, timestamp)", () => {
    const l = busy(3);
    const e = (l as any).entries;
    e[2].description = "edited after the fact";
    expect(l.verifyChain().valid).toBe(false);

    const l2 = busy(3);
    (l2 as any).entries[2].createdAt = "2001-01-01T00:00:00.000Z";
    expect(l2.verifyChain().valid).toBe(false);
  });

  it("detects a stripped prevEntryHash (used to be skipped as 'legacy')", () => {
    const l = busy(3);
    delete (l as any).entries[4].prevEntryHash;
    const r = l.verifyChain();
    expect(r.valid).toBe(false);
    expect(r.brokenLinks).toContain(4);
  });

  it("detects tail truncation after serialize via the declared head hash", () => {
    const l = busy(3);
    const ser = l.serialize();
    const summary = ser[ser.length - 1];
    const entries = ser.slice(0, -2); // drop the last entry, keep summary
    const restored = new Ledger([...entries, summary] as any);
    const r = restored.verifyChain();
    expect(r.headMatches).toBe(false);
    expect(r.valid).toBe(false);
  });

  it("detects an edited summary via reconcile() while entries are intact", () => {
    const l = busy(3);
    const ser = l.serialize() as any[];
    ser[ser.length - 1].accountBalances["agent:a1:USD"] += 1000;
    const restored = new Ledger(ser);
    const s = restored.verify();
    expect(s.reconciled).toBe(false);
  });

  it("a broken compaction base is caught", () => {
    const l = busy(20);
    l.compact(50);
    (l as any).entries[0].prevEntryHash = "00".repeat(32);
    expect(l.verifyChain().valid).toBe(false);
  });

  it("legacy (v1-hash) entries still verify", () => {
    const l = busy(2);
    const ser = l.serialize() as any[];
    // Rebuild a legacy chain: no hashVersion, links computed with the old formula.
    const { createHash } = require("crypto");
    const legacy = (e: any) =>
      createHash("sha256")
        .update([e.id, e.txRef, e.account, String(e.debit), String(e.credit), e.currency, String(e.seq), e.prevEntryHash ?? ""].join("|"))
        .digest("hex");
    const entries = ser.slice(0, -1).map((e) => {
      const c = { ...e };
      delete c.hashVersion;
      return c;
    });
    for (let i = 1; i < entries.length; i++) entries[i].prevEntryHash = legacy(entries[i - 1]);
    const restored = new Ledger(entries);
    expect(restored.verifyChain().valid).toBe(true);
  });

  it("high-throughput mode is explicit and reported as disabled", () => {
    const l = new Ledger();
    l.setHighThroughput(true);
    l.transfer("a", "b", 5, "USD", "x");
    expect(l.visibleSize).toBe(0);
    expect(l.verify().auditTrail).toBe("disabled");
    expect(l.getBalance("b")).toBe(5);
  });

  it("recordSettlement is atomic: a bad net leaves no partial legs", () => {
    const l = new Ledger();
    l.recordCharge("a1", 100, "t");
    const before = l.size;
    expect(() => l.recordSettlement("a1", "t", 100, 3, 0, "cp")).toThrow();
    expect(() => l.recordSettlement("a1", "t", 100, 3, 50, "cp")).toThrow(/must equal gross/);
    expect(l.size).toBe(before);
    expect(l.getBalance("platform:float")).toBe(0);
  });

  it("archiveSink receives the dropped entries", () => {
    const l = busy(20);
    let got = 0;
    l.archiveSink = (d) => { got += d.length; };
    const dropped = l.compact(50);
    expect(got).toBe(dropped.length);
  });
});
