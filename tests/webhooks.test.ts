/**
 * WebhookStore tests — persistent subscriptions + HMAC-signed delivery + retry/DLQ.
 *
 * The bug we're closing: `webhook_register` returned success but no POST ever
 * fired. The store now persists subs to SQLite, fire() enqueues a delivery
 * per matching sub, and pumpOnce() drains the queue with HMAC signatures
 * and exponential-backoff retry up to 6 attempts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  WebhookStore,
  signPayload,
  verifySignature,
} from "../src/storage/webhooks.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mnemopay-webhooks-"));
}

function makeStore(dir: string): WebhookStore {
  return new WebhookStore({ dbPath: path.join(dir, "webhooks.db") });
}

describe("WebhookStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("register issues an opaque signing secret and persists across rebuilds", () => {
    const s1 = makeStore(dir);
    const sub = s1.register("https://example.com/hook", ["charge.success", "settle"]);
    expect(sub.secret).toMatch(/^whsec_/);
    expect(sub.id).toMatch(/^wh_/);
    expect(sub.events).toEqual(["charge.success", "settle"]);
    s1.close();

    const s2 = makeStore(dir);
    const list = s2.list();
    expect(list).toHaveLength(1);
    expect(list[0].secret).toBe(sub.secret);
    s2.close();
  });

  it("matching() filters by event and respects the wildcard '*'", () => {
    const s = makeStore(dir);
    s.register("https://a.example.com/hook", ["charge.success"]);
    s.register("https://b.example.com/hook", ["settle"]);
    s.register("https://c.example.com/hook", ["*"]);
    expect(s.matching("charge.success").map((x) => x.url)).toEqual(
      expect.arrayContaining(["https://a.example.com/hook", "https://c.example.com/hook"])
    );
    expect(s.matching("settle").map((x) => x.url)).toEqual(
      expect.arrayContaining(["https://b.example.com/hook", "https://c.example.com/hook"])
    );
    expect(s.matching("refund").map((x) => x.url)).toEqual([
      "https://c.example.com/hook",
    ]);
    s.close();
  });

  it("fire() enqueues one delivery per matching subscription", () => {
    const s = makeStore(dir);
    s.register("https://a.example.com/hook", ["charge.success"]);
    s.register("https://b.example.com/hook", ["*"]);
    s.register("https://c.example.com/hook", ["settle"]); // not matching

    const n = s.fire("charge.success", { txId: "tx_1", amount: 9.99 });
    expect(n).toBe(2);
    const counts = s.countByStatus();
    expect(counts.pending).toBe(2);
    expect(counts.delivered).toBe(0);
    expect(counts.dead).toBe(0);
    s.close();
  });

  it("pumpOnce delivers to a 2xx endpoint and includes an HMAC header verifiable with the secret", async () => {
    const s = makeStore(dir);
    const sub = s.register("https://example.com/hook", ["charge.success"]);
    s.fire("charge.success", { txId: "tx_42", amount: 12.0 });

    let receivedHeader: string | null = null;
    let receivedBody: string | null = null;
    const fakeFetch: any = async (_url: string, init: any) => {
      receivedHeader = init.headers["x-mnemopay-signature"];
      receivedBody = init.body;
      return { status: 200 };
    };
    await s.pumpOnce(10, fakeFetch);

    expect(receivedHeader).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
    expect(verifySignature(sub.secret, receivedBody!, receivedHeader!)).toBe(true);
    // Tampered body must fail verification
    expect(verifySignature(sub.secret, receivedBody! + "x", receivedHeader!)).toBe(false);

    const counts = s.countByStatus();
    expect(counts.delivered).toBe(1);
    expect(counts.pending).toBe(0);
    s.close();
  });

  it("non-2xx responses schedule a retry with exponential backoff (not delivered, not dead)", async () => {
    const s = makeStore(dir);
    s.register("https://example.com/hook", ["settle"]);
    s.fire("settle", { txId: "tx_50" });

    const fakeFetch: any = async () => ({ status: 503 });
    await s.pumpOnce(10, fakeFetch);

    const counts = s.countByStatus();
    expect(counts.pending).toBe(1);
    expect(counts.delivered).toBe(0);
    expect(counts.dead).toBe(0);
    s.close();
  });

  it("after MAX_ATTEMPTS failures the delivery is marked 'dead' (DLQ)", async () => {
    const s = makeStore(dir);
    s.register("https://example.com/hook", ["refund"]);
    s.fire("refund", { txId: "tx_dead" });

    const fakeFetch: any = async () => ({ status: 500 });
    // Force-pump 6 times; we manually advance next_attempt_at by writing
    // directly through SQL since this test should not actually sleep.
    for (let i = 0; i < 6; i++) {
      await s.pumpOnce(10, fakeFetch);
      // bring the next_attempt_at back to now so we can re-pump in the loop
      const db = (s as any).db;
      db.prepare(`UPDATE deliveries SET next_attempt_at = ? WHERE status = 'pending'`).run(
        Date.now()
      );
    }
    const counts = s.countByStatus();
    expect(counts.dead).toBe(1);
    expect(counts.pending).toBe(0);
    expect(counts.delivered).toBe(0);
    s.close();
  });

  it("unregister removes the sub and matching() drops it", () => {
    const s = makeStore(dir);
    const sub = s.register("https://example.com/hook", ["charge.success"]);
    expect(s.list()).toHaveLength(1);
    expect(s.unregister(sub.id)).toBe(true);
    expect(s.list()).toHaveLength(0);
    expect(s.matching("charge.success")).toHaveLength(0);
    s.close();
  });
});

// The webhook pump starts a 2s setInterval on first store open. Even with a
// stubbed fetch the first failure test settles ~5s due to module-init cost +
// the unref'd interval interleaving. Give the describe headroom.
describe("failure-event webhooks fire through executeTool", { timeout: 15000 }, () => {
  // These tests prove that when a rail call inside the MCP tool handler
  // throws, the store receives a *.failed delivery (and the error still
  // propagates to the caller). Closes the gap left by 2026-05-12 when
  // success-side events shipped but failure events were deferred.

  let dir: string;
  let prevEnv: string | undefined;
  let prevFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    dir = makeTempDir();
    prevEnv = process.env.MNEMOPAY_PERSIST_DIR;
    process.env.MNEMOPAY_PERSIST_DIR = dir;
    // The MCP server starts a 2s setInterval webhook pump on first store
    // open. If a pump tick hits a real HTTP URL (example.com etc) it can
    // stall the test for the full DELIVERY_TIMEOUT_MS (10s). Stub fetch
    // with an instant 2xx so any pump tick during the test resolves fast.
    prevFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = async () =>
      new Response("", { status: 200 });
  });

  afterEach(async () => {
    const { _resetWebhookStoreForTests } = await import("../src/mcp/server.js");
    _resetWebhookStoreForTests();
    if (prevEnv === undefined) delete process.env.MNEMOPAY_PERSIST_DIR;
    else process.env.MNEMOPAY_PERSIST_DIR = prevEnv;
    if (prevFetch !== undefined) (globalThis as any).fetch = prevFetch;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function makeFailingAgent(method: "charge" | "settle" | "refund", err: Error) {
    return {
      agentId: "agent_test_fail",
      paymentRail: { name: "stripe" },
      [method]: async () => {
        throw err;
      },
    } as any;
  }

  it("charge.failed fires when agent.charge() throws and rethrows the error", async () => {
    const mod = await import("../src/mcp/server.js");
    const ws = mod.webhookStore();
    ws.register("https://example.com/charge-failed-hook", ["charge.failed"], "agent_test_fail");
    const agent = makeFailingAgent("charge", new Error("card_declined"));
    (agent as any).charge = async () => {
      throw Object.assign(new Error("card_declined"), { code: "RAIL_DECLINE" });
    };
    await expect(
      mod.executeTool(agent, "charge", { amount: 19.99, reason: "test" })
    ).rejects.toThrow("card_declined");

    const counts = ws.countByStatus();
    expect(counts.pending).toBeGreaterThanOrEqual(1);
    const pending = ws.listDeliveries({ status: "pending" });
    const failedDelivery = pending.find((d) => d.event === "charge.failed");
    expect(failedDelivery).toBeTruthy();
    const payload = JSON.parse(failedDelivery.payload);
    expect(payload.error).toContain("card_declined");
    expect(payload.errorCode).toBe("RAIL_DECLINE");
    expect(payload.amount).toBe(19.99);
    expect(payload.reason).toBe("test");
    expect(payload.rail).toBe("stripe");
    expect(payload.agentId).toBe("agent_test_fail");
  });

  it("settle.failed fires when agent.settle() throws and rethrows", async () => {
    const mod = await import("../src/mcp/server.js");
    const ws = mod.webhookStore();
    ws.register("https://example.com/settle-failed-hook", ["settle.failed"], "agent_test_fail");
    const agent = makeFailingAgent("settle", new Error("tx_not_found"));
    await expect(
      mod.executeTool(agent, "settle", { txId: "tx_missing" })
    ).rejects.toThrow("tx_not_found");

    const pending = ws.listDeliveries({ status: "pending" });
    const failedDelivery = pending.find((d) => d.event === "settle.failed");
    expect(failedDelivery).toBeTruthy();
    const payload = JSON.parse(failedDelivery.payload);
    expect(payload.txId).toBe("tx_missing");
    expect(payload.error).toContain("tx_not_found");
  });

  it("refund.failed fires when agent.refund() throws and rethrows", async () => {
    const mod = await import("../src/mcp/server.js");
    const ws = mod.webhookStore();
    ws.register("https://example.com/refund-failed-hook", ["refund.failed"], "agent_test_fail");
    const agent = makeFailingAgent("refund", new Error("already_refunded"));
    await expect(
      mod.executeTool(agent, "refund", { txId: "tx_abc" })
    ).rejects.toThrow("already_refunded");

    const pending = ws.listDeliveries({ status: "pending" });
    const failedDelivery = pending.find((d) => d.event === "refund.failed");
    expect(failedDelivery).toBeTruthy();
    const payload = JSON.parse(failedDelivery.payload);
    expect(payload.txId).toBe("tx_abc");
    expect(payload.error).toContain("already_refunded");
  });

  it("transfer.failed fires on Paystack rail failure (createTransferRecipient throws)", async () => {
    const mod = await import("../src/mcp/server.js");
    const ws = mod.webhookStore();
    ws.register("https://example.com/transfer-failed-hook", ["transfer.failed"], "agent_payout_fail");
    const agent = {
      agentId: "agent_payout_fail",
      paymentRail: {
        name: "paystack",
        createTransferRecipient: async () => {
          throw new Error("invalid_account_number");
        },
        initiateTransfer: async () => {
          throw new Error("should_not_reach");
        },
      },
    } as any;
    await expect(
      mod.executeTool(agent, "payout_create", {
        amount: 100,
        reason: "payout",
        accountName: "test",
        accountNumber: "0000000000",
        bankCode: "044",
      })
    ).rejects.toThrow("invalid_account_number");

    const pending = ws.listDeliveries({ status: "pending" });
    const failedDelivery = pending.find((d) => d.event === "transfer.failed");
    expect(failedDelivery).toBeTruthy();
    const payload = JSON.parse(failedDelivery.payload);
    expect(payload.stage).toBe("create_recipient");
    expect(payload.error).toContain("invalid_account_number");
    expect(payload.rail).toBe("paystack");
  });

  it("transfer.failed reports stage=initiate_transfer when initiateTransfer is what throws", async () => {
    const mod = await import("../src/mcp/server.js");
    const ws = mod.webhookStore();
    ws.register("https://example.com/transfer-failed-hook-2", ["transfer.failed"], "agent_payout_fail_2");
    const agent = {
      agentId: "agent_payout_fail_2",
      paymentRail: {
        name: "paystack",
        createTransferRecipient: async () => ({ recipientCode: "RCP_abc", name: "test" }),
        initiateTransfer: async () => {
          throw new Error("insufficient_balance");
        },
      },
    } as any;
    await expect(
      mod.executeTool(agent, "payout_create", {
        amount: 100,
        reason: "payout",
        accountName: "test",
        accountNumber: "0000000000",
        bankCode: "044",
      })
    ).rejects.toThrow("insufficient_balance");

    const pending = ws.listDeliveries({ status: "pending" });
    const failedDelivery = pending.find((d) => d.event === "transfer.failed");
    expect(failedDelivery).toBeTruthy();
    const payload = JSON.parse(failedDelivery.payload);
    expect(payload.stage).toBe("initiate_transfer");
    expect(payload.recipientCode).toBe("RCP_abc");
  });
});

describe("signPayload / verifySignature", () => {
  it("round-trip is correct", () => {
    const body = JSON.stringify({ hello: "world" });
    const t = Math.floor(Date.now() / 1000);
    const header = signPayload("whsec_test_secret", body, t);
    expect(verifySignature("whsec_test_secret", body, header)).toBe(true);
  });

  it("wrong secret fails", () => {
    const body = "{}";
    const t = Math.floor(Date.now() / 1000);
    const header = signPayload("right", body, t);
    expect(verifySignature("wrong", body, header)).toBe(false);
  });

  it("stale timestamp fails (default tolerance is 5 minutes)", () => {
    const body = "{}";
    const stale = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min ago
    const header = signPayload("whsec_test", body, stale);
    expect(verifySignature("whsec_test", body, header)).toBe(false);
  });
});
