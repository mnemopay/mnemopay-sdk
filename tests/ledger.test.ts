import { describe, it, expect, beforeEach } from "vitest";
import { Ledger } from "../src/ledger.js";

describe("Ledger — Double-Entry Bookkeeping", () => {
  let ledger: Ledger;

  beforeEach(() => {
    ledger = new Ledger();
  });

  // ── Core Transfer ──────────────────────────────────────────────────────

  describe("transfer()", () => {
    it("creates a debit+credit pair that balances to zero", () => {
      ledger.transfer("agent:alice", "escrow:alice", 100, "USD", "test charge");
      const summary = ledger.verify();
      expect(summary.balanced).toBe(true);
      expect(summary.imbalance).toBe(0);
      expect(summary.entryCount).toBe(2);
    });

    it("rejects zero or negative amounts", () => {
      expect(() => ledger.transfer("a", "b", 0, "USD", "bad")).toThrow("positive");
      expect(() => ledger.transfer("a", "b", -5, "USD", "bad")).toThrow("positive");
    });

    it("tracks balances correctly", () => {
      ledger.transfer("agent:alice", "escrow:alice", 50, "USD", "charge");
      expect(ledger.getBalance("agent:alice")).toBe(-50); // money left
      expect(ledger.getBalance("escrow:alice")).toBe(50);  // money arrived
    });

    it("assigns unique txRef per transfer", () => {
      const r1 = ledger.transfer("a", "b", 10, "USD", "t1");
      const r2 = ledger.transfer("a", "b", 20, "USD", "t2");
      expect(r1.txRef).not.toBe(r2.txRef);
    });

    it("assigns monotonically increasing sequence numbers", () => {
      ledger.transfer("a", "b", 10, "USD", "t1");
      ledger.transfer("c", "d", 20, "USD", "t2");
      const summary = ledger.verify();
      expect(summary.entryCount).toBe(4);
    });
  });

  // ── Payment Flows ──────────────────────────────────────────────────────

  describe("recordCharge()", () => {
    it("moves funds from agent to escrow", () => {
      ledger.recordCharge("agent-1", 75, "tx-001");
      expect(ledger.getBalance("agent:agent-1")).toBe(-75);
      expect(ledger.getBalance("escrow:agent-1")).toBe(75);
      expect(ledger.verify().balanced).toBe(true);
    });

    it("links entries to the transaction ID", () => {
      ledger.recordCharge("agent-1", 75, "tx-001");
      const entries = ledger.getEntriesForTransaction("tx-001");
      expect(entries).toHaveLength(2);
      expect(entries[0].relatedTxId).toBe("tx-001");
    });
  });

  describe("recordSettlement()", () => {
    it("releases escrow, takes fee, pays counterparty", () => {
      // Charge first
      ledger.recordCharge("agent-1", 100, "tx-001");

      // Settle: $100 gross, $3 fee (3%), $97 net to counterparty
      ledger.recordSettlement("agent-1", "tx-001", 100, 3, 97, "agent-2");

      expect(ledger.getBalance("escrow:agent-1")).toBe(0);     // escrow cleared
      expect(ledger.getBalance("platform:float")).toBe(0);      // float cleared (money distributed)
      expect(ledger.getBalance("platform:revenue")).toBe(3);    // fee collected
      expect(ledger.getBalance("counterparty:agent-2")).toBe(97); // counterparty paid
      expect(ledger.verify().balanced).toBe(true);
    });

    it("settles back to agent when no counterparty", () => {
      ledger.recordCharge("agent-1", 50, "tx-002");
      ledger.recordSettlement("agent-1", "tx-002", 50, 1.5, 48.5);

      expect(ledger.getBalance("agent:agent-1")).toBe(-50 + 48.5); // net: -1.5
      expect(ledger.getBalance("platform:revenue")).toBe(1.5);
      expect(ledger.verify().balanced).toBe(true);
    });

    it("handles zero fee", () => {
      ledger.recordCharge("agent-1", 25, "tx-003");
      ledger.recordSettlement("agent-1", "tx-003", 25, 0, 25, "agent-2");

      expect(ledger.getBalance("platform:revenue")).toBe(0);
      expect(ledger.getBalance("counterparty:agent-2")).toBe(25);
      expect(ledger.verify().balanced).toBe(true);
    });
  });

  describe("recordRefund()", () => {
    it("reverses a settlement", () => {
      ledger.recordCharge("agent-1", 100, "tx-001");
      ledger.recordSettlement("agent-1", "tx-001", 100, 3, 97, "agent-2");
      ledger.recordRefund("agent-1", "tx-001", 97, "agent-2");

      expect(ledger.getBalance("counterparty:agent-2")).toBe(0); // counterparty returned funds
      expect(ledger.getBalance("agent:agent-1")).toBe(-100 + 97); // agent gets net back
      expect(ledger.verify().balanced).toBe(true);
    });
  });

  describe("recordCancellation()", () => {
    it("releases escrow back to agent", () => {
      ledger.recordCharge("agent-1", 80, "tx-004");
      expect(ledger.getBalance("escrow:agent-1")).toBe(80);

      ledger.recordCancellation("agent-1", 80, "tx-004");
      expect(ledger.getBalance("escrow:agent-1")).toBe(0);
      expect(ledger.getBalance("agent:agent-1")).toBe(0); // fully restored
      expect(ledger.verify().balanced).toBe(true);
    });
  });

  describe("recordFunding()", () => {
    it("adds funds to agent wallet", () => {
      ledger.recordFunding("agent-1", 500, "stripe-deposit");
      expect(ledger.getBalance("agent:agent-1")).toBe(500);
      expect(ledger.verify().balanced).toBe(true);
    });
  });

  // ── Multi-Currency ─────────────────────────────────────────────────────

  describe("multi-currency", () => {
    it("tracks balances per currency independently", () => {
      ledger.transfer("agent:alice", "escrow:alice", 100, "USD", "usd charge");
      ledger.transfer("agent:alice", "escrow:alice", 0.005, "BTC", "btc charge");

      expect(ledger.getBalance("agent:alice", "USD")).toBe(-100);
      expect(ledger.getBalance("agent:alice", "BTC")).toBe(-0.005);
      expect(ledger.getBalance("escrow:alice", "USD")).toBe(100);
      expect(ledger.getBalance("escrow:alice", "BTC")).toBe(0.005);
    });
  });

  // ── Full Lifecycle ─────────────────────────────────────────────────────

  describe("full lifecycle", () => {
    it("handles charge → settle → refund and stays balanced", () => {
      // 1. Fund agent
      ledger.recordFunding("agent-1", 1000, "initial-deposit");

      // 2. Charge $200
      ledger.recordCharge("agent-1", 200, "tx-big");

      // 3. Settle with 3% fee
      ledger.recordSettlement("agent-1", "tx-big", 200, 6, 194, "merchant-1");

      // 4. Refund
      ledger.recordRefund("agent-1", "tx-big", 194, "merchant-1");

      const summary = ledger.verify();
      expect(summary.balanced).toBe(true);
      expect(ledger.getBalance("platform:revenue")).toBe(6); // fee kept
    });

    it("handles many transactions and stays balanced", () => {
      for (let i = 0; i < 100; i++) {
        const txId = `tx-${i}`;
        const amount = Math.round((Math.random() * 100 + 1) * 100) / 100;
        const fee = Math.round(amount * 0.019 * 100) / 100;
        const net = Math.round((amount - fee) * 100) / 100;

        ledger.recordCharge("agent-stress", amount, txId);
        ledger.recordSettlement("agent-stress", txId, amount, fee, net, `cp-${i}`);
      }

      const summary = ledger.verify();
      expect(summary.balanced).toBe(true);
      expect(summary.entryCount).toBe(800); // 100 charges (2 entries) + 100 settlements (3 entries each = 6) = 800
    });
  });

  // ── Queries ────────────────────────────────────────────────────────────

  describe("queries", () => {
    it("getAccountBalance returns detailed info", () => {
      ledger.recordFunding("agent-1", 500, "deposit");
      ledger.recordCharge("agent-1", 100, "tx-1");

      const bal = ledger.getAccountBalance("agent:agent-1");
      expect(bal.balance).toBe(400);
      expect(bal.totalCredits).toBe(500);
      expect(bal.totalDebits).toBe(100);
      expect(bal.entryCount).toBe(2);
      expect(bal.accountType).toBe("agent");
    });

    it("getAccountHistory returns entries in reverse order", () => {
      ledger.recordFunding("agent-1", 100, "deposit");
      ledger.recordCharge("agent-1", 50, "tx-1");

      const history = ledger.getAccountHistory("agent:agent-1", 10);
      expect(history).toHaveLength(2);
      expect(history[0].seq).toBeGreaterThan(history[1].seq);
    });

    it("getEntriesForTransaction returns all related entries", () => {
      ledger.recordCharge("agent-1", 100, "tx-1");
      ledger.recordSettlement("agent-1", "tx-1", 100, 3, 97, "agent-2");

      const entries = ledger.getEntriesForTransaction("tx-1");
      expect(entries.length).toBeGreaterThanOrEqual(6); // 2 charge + 6 settle
    });
  });

  // ── Serialization ──────────────────────────────────────────────────────

  describe("serialization", () => {
    it("serialize and restore preserves state", () => {
      ledger.recordFunding("agent-1", 500, "deposit");
      ledger.recordCharge("agent-1", 100, "tx-1");
      ledger.recordSettlement("agent-1", "tx-1", 100, 3, 97, "agent-2");

      const serialized = ledger.serialize();
      const restored = new Ledger(serialized);

      expect(restored.getBalance("agent:agent-1")).toBe(ledger.getBalance("agent:agent-1"));
      expect(restored.getBalance("platform:revenue")).toBe(3);
      expect(restored.verify().balanced).toBe(true);
      expect(restored.size).toBe(ledger.size);
    });
  });

  // ── Floating Point Safety ──────────────────────────────────────────────

  describe("floating point", () => {
    it("handles penny-level precision without drift", () => {
      // Classic floating point trap: 0.1 + 0.2 !== 0.3
      ledger.transfer("a", "b", 0.1, "USD", "t1");
      ledger.transfer("a", "b", 0.2, "USD", "t2");

      expect(ledger.getBalance("b")).toBe(0.3);
      expect(ledger.verify().balanced).toBe(true);
    });
  });
});
