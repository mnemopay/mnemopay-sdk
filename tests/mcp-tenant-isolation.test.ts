/**
 * Audit 03 (S1/S2/S3/D3): MCP server tenant isolation + human-approval separation.
 *
 * Before: approvals, identity/capability tokens, the audit chain, policy,
 * webhooks and the commerce engine were process-global. Any tenant could revoke
 * another's tokens, read the shared audit chain, receive another tenant's
 * charge events, and an agent could approve its own charge_request.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  executeTool,
  requireApprover,
  clientIpFromRequest,
  isValidTenantAgentId,
  approvalQueue,
  webhookStore,
  _resetApprovalQueueForTests,
  _resetWebhookStoreForTests,
  _resetTenantGovernanceForTests,
} from "../src/mcp/server.js";
import { MnemoPayLite } from "../src/index.js";
import { WebhookStore, isBlockedWebhookHost } from "../src/storage/webhooks.js";

const FRAUD = {
  maxChargesPerMinute: 9999, maxChargesPerHour: 9999, maxChargesPerDay: 9999,
  maxDailyVolume: 9_999_999, blockThreshold: 2.0, settlementHoldMinutes: 0, disputeWindowMinutes: 0,
};
const mk = (id: string) => new MnemoPayLite(id, 0.05, false, undefined, FRAUD);

let dir: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["MNEMOPAY_PERSIST_DIR", "MNEMOPAY_APPROVER_TOKEN", "MNEMOPAY_ALLOW_SELF_APPROVAL", "MNEMOPAY_AGENT_ID", "MNEMOPAY_WEBHOOK_ALLOW_LOCAL"];

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mnemopay-mcp-iso-"));
  process.env.MNEMOPAY_PERSIST_DIR = dir;
  delete process.env.MNEMOPAY_APPROVER_TOKEN;
  delete process.env.MNEMOPAY_ALLOW_SELF_APPROVAL;
  delete process.env.MNEMOPAY_WEBHOOK_ALLOW_LOCAL;
  process.env.MNEMOPAY_AGENT_ID = "boot-agent";
  _resetApprovalQueueForTests();
  _resetWebhookStoreForTests();
  _resetTenantGovernanceForTests();
});

afterEach(() => {
  _resetApprovalQueueForTests();
  _resetWebhookStoreForTests();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("S1: capability tokens / identity / audit chain / policy are per tenant", () => {
  it("tenant B cannot see, revoke, or kill tenant A's identity and tokens", async () => {
    const a = mk("tenant-a");
    const b = mk("tenant-b");
    await executeTool(a, "identity_create", { agentId: "worker", ownerId: "o", ownerEmail: "o@e.com" });
    const token = JSON.parse(await executeTool(a, "capability_issue", { agentId: "worker", permissions: ["charge"] }));

    // B has no such identity, and cannot list/revoke/kill it.
    await expect(executeTool(b, "identity_get", { agentId: "worker" })).rejects.toThrow(/Unknown agent/);
    expect(JSON.parse(await executeTool(b, "capability_list", { agentId: "worker" }))).toEqual([]);
    await expect(executeTool(b, "capability_revoke", { tokenId: token.id })).rejects.toThrow(/not found/i);
    const kill = JSON.parse(await executeTool(b, "identity_killswitch", { agentId: "worker", reason: "attack" }));
    expect(kill.revokedTokens).toBe(0);
    // B cannot even validate A's token
    expect(JSON.parse(await executeTool(b, "capability_validate", { tokenId: token.id, action: "charge" })).valid).toBe(false);

    // ...and A's token is untouched.
    expect(JSON.parse(await executeTool(a, "capability_validate", { tokenId: token.id, action: "charge" })).valid).toBe(true);
  });

  it("tenant B cannot read tenant A's audit chain or action ledger", async () => {
    const a = mk("tenant-a");
    const b = mk("tenant-b");
    await executeTool(a, "action_begin", { agentId: "tenant-a", intent: "SECRET-INTENT-OF-A" });
    await executeTool(a, "identity_create", { agentId: "w", ownerId: "o", ownerEmail: "o@e.com" });

    const bundleB = await executeTool(b, "audit_bundle_export", {});
    expect(bundleB).not.toContain("SECRET-INTENT-OF-A");
    expect(bundleB).not.toContain("identity.created");
    expect(JSON.parse(await executeTool(b, "action_list", {}))).toEqual([]);
    expect(await executeTool(a, "audit_bundle_export", {})).toContain("identity.created");
  });

  it("a policy set by tenant A does not apply to tenant B", async () => {
    const a = mk("tenant-a");
    const b = mk("tenant-b");
    await executeTool(a, "policy_set", { blockTargets: ["zz_custom_target"], hardCapUsd: 1 });
    const blockedForA = JSON.parse(await executeTool(a, "policy_evaluate", { kind: "tool_call", target: "zz_custom_target" }));
    expect(blockedForA.verdict.allowed).toBe(false);
    // Old code: one shared policy, so B was blocked by A's rule too.
    const forB = JSON.parse(await executeTool(b, "policy_evaluate", { kind: "tool_call", target: "zz_custom_target" }));
    expect(forB.verdict.allowed).toBe(true);
  });

  it("each tenant gets its own commerce engine, wallet and mandate", async () => {
    const a = mk("tenant-a");
    const b = mk("tenant-b");
    const ra = JSON.parse(await executeTool(a, "shop_set_mandate", { budget: 50, issuedBy: "owner-a" }));
    const rb = JSON.parse(await executeTool(b, "shop_set_mandate", { budget: 70, issuedBy: "owner-b" }));
    // Old code: B's call ran on A's engine, so B's remaining budget was A's.
    expect(ra.remainingBudget).toBe(50);
    expect(rb.remainingBudget).toBe(70);
  });
});

describe("S2: approval tools need a credential the agent does not hold", () => {
  async function request(agent: MnemoPayLite, amount = 5) {
    const r = JSON.parse(await executeTool(agent, "charge_request", { amount, reason: "needs a human" }));
    return r.requestId as string;
  }

  it("an agent cannot approve its own charge_request (disabled by default)", async () => {
    const a = mk("tenant-a");
    const id = await request(a);
    await expect(executeTool(a, "charge_approve", { requestId: id })).rejects.toThrow(/disabled|authorization/i);
    // still pending, no money moved
    expect(approvalQueue().charges.has(id)).toBe(true);
    expect((await a.history(10)).length).toBe(0);
  });

  it("with MNEMOPAY_APPROVER_TOKEN set, only the token holder can approve or reject", async () => {
    process.env.MNEMOPAY_APPROVER_TOKEN = "human-only-secret";
    const a = mk("tenant-a");
    const id = await request(a);
    await expect(executeTool(a, "charge_approve", { requestId: id })).rejects.toThrow(/Approver authorization/);
    await expect(executeTool(a, "charge_approve", { requestId: id, _approverToken: "guess" })).rejects.toThrow(/Approver authorization/);
    await expect(executeTool(a, "charge_reject", { requestId: id })).rejects.toThrow(/Approver authorization/);
    expect(approvalQueue().charges.has(id)).toBe(true);

    const ok = JSON.parse(await executeTool(a, "charge_approve", { requestId: id, _approverToken: "human-only-secret" }));
    expect(ok.status).toBe("charged");
    expect((await a.history(10)).length).toBe(1);
  });

  it("shop approval tools are gated the same way", async () => {
    process.env.MNEMOPAY_APPROVER_TOKEN = "human-only-secret";
    const a = mk("tenant-a");
    await expect(executeTool(a, "shop_approve", { orderId: "o1" })).rejects.toThrow(/Approver authorization/);
    await expect(executeTool(a, "shop_reject", { orderId: "o1" })).rejects.toThrow(/Approver authorization/);
  });

  it("an approver acting for tenant B cannot approve or reject tenant A's request", async () => {
    process.env.MNEMOPAY_APPROVER_TOKEN = "human-only-secret";
    const a = mk("tenant-a");
    const b = mk("tenant-b");
    const id = await request(a);
    await expect(executeTool(b, "charge_approve", { requestId: id, _approverToken: "human-only-secret" })).rejects.toThrow(/No pending charge request/);
    await expect(executeTool(b, "charge_reject", { requestId: id, _approverToken: "human-only-secret" })).rejects.toThrow(/No pending charge request/);
    expect(approvalQueue().charges.has(id)).toBe(true);
    expect((await b.history(10)).length).toBe(0);
  });

  it("pending lists are per tenant", async () => {
    const a = mk("tenant-a");
    const b = mk("tenant-b");
    const id = await request(a);
    expect(await executeTool(a, "shop_pending_approvals", {})).toContain(id);
    expect(await executeTool(b, "shop_pending_approvals", {})).toBe("No pending approvals.");
  });

  it("MNEMOPAY_ALLOW_SELF_APPROVAL=1 is the explicit opt-out", () => {
    process.env.MNEMOPAY_ALLOW_SELF_APPROVAL = "1";
    expect(() => requireApprover({})).not.toThrow();
  });

  it("charge_request rejects NaN / negative / Infinity amounts", async () => {
    const a = mk("tenant-a");
    for (const bad of [NaN, -5, 0, Infinity, "5" as any]) {
      await expect(executeTool(a, "charge_request", { amount: bad, reason: "x" })).rejects.toThrow(/positive finite/);
    }
  });

  it("tenant tagging survives a restart of the approval queue", async () => {
    const a = mk("tenant-a");
    const id = await request(a);
    _resetApprovalQueueForTests();
    expect(approvalQueue().charges.get(id)?.tenantId).toBe("tenant-a");
  });
});

describe("S3: webhooks are tenant scoped and the SSRF filter is complete", () => {
  it("a '*' hook registered by tenant A does not receive tenant B's events", async () => {
    const a = mk("tenant-a");
    const b = mk("tenant-b");
    await executeTool(a, "webhook_register", { url: "https://a.example.com/h", events: ["*"] });
    await executeTool(b, "webhook_register", { url: "https://b.example.com/h", events: ["charge.success"] });

    await executeTool(b, "charge", { amount: 5, reason: "b's purchase" });

    const deliveries = webhookStore().listDeliveries();
    const subs = webhookStore().list();
    const urlOf = (subId: string) => subs.find((s) => s.id === subId)?.url;
    const urls = deliveries.map((d) => urlOf(d.subscriptionId));
    expect(urls).toContain("https://b.example.com/h");
    expect(urls).not.toContain("https://a.example.com/h");
  });

  it("webhook_list shows only the caller's hooks", async () => {
    const a = mk("tenant-a");
    const b = mk("tenant-b");
    await executeTool(a, "webhook_register", { url: "https://a.example.com/h", events: ["*"] });
    expect(await executeTool(b, "webhook_list", {})).toBe("No webhooks registered.");
    expect(await executeTool(a, "webhook_list", {})).toContain("a.example.com");
  });

  it("legacy (pre-tenant) subscriptions belong to the default tenant only", () => {
    const s = new WebhookStore({ dbPath: path.join(dir, "legacy.db"), legacyTenantId: "boot-agent" });
    (s as any).db.prepare("INSERT INTO subscriptions (id, url, events, secret, created_at) VALUES ('wh_old','https://old.example.com','[\"*\"]','s',1)").run();
    expect(s.matching("charge.success", "boot-agent").length).toBe(1);
    expect(s.matching("charge.success", "tenant-b").length).toBe(0);
    s.close();
  });

  it("operator-global subscription (star tenant) receives every tenant's events", () => {
    const s = new WebhookStore({ dbPath: path.join(dir, "glob.db") });
    s.register("https://ops.example.com", ["*"], "*");
    expect(s.matching("charge.success", "tenant-a").length).toBe(1);
    expect(s.matching("charge.success", "tenant-b").length).toBe(1);
    s.close();
  });

  it("unregister respects ownership", () => {
    const s = new WebhookStore({ dbPath: path.join(dir, "own.db") });
    const sub = s.register("https://x.example.com", ["*"], "tenant-a");
    expect(s.unregister(sub.id, "tenant-b")).toBe(false);
    expect(s.unregister(sub.id, "tenant-a")).toBe(true);
    s.close();
  });

  it("blocks the private ranges the old prefix list missed", async () => {
    const blocked = [
      "172.16.0.1", "172.31.255.1", "100.64.0.1", "100.127.1.1", "[::ffff:7f00:1]", "[::ffff:127.0.0.1]",
      "[fc00::1]", "[fd12:3456::1]", "[fe80::1]", "2130706433", "0x7f000001", "0177.0.0.1", "192.0.0.1",
      "metadata.google.internal", "svc.internal", "box.local", "localhost", "[::1]", "0.0.0.0", "169.254.169.254", "10.1.2.3", "192.168.0.9",
    ];
    for (const h of blocked) expect(isBlockedWebhookHost(h), h).toBe(true);
    for (const h of ["example.com", "93.184.216.34", "hooks.stripe.com", "8.8.8.8", "172.32.0.1", "100.128.0.1"]) {
      expect(isBlockedWebhookHost(h), h).toBe(false);
    }
    const a = mk("tenant-a");
    for (const u of ["https://172.16.0.1/h", "https://100.64.0.1/h", "https://[::ffff:7f00:1]/h", "https://[fc00::1]/h", "https://2130706433/h", "https://user:pw@example.com/h"]) {
      const res = JSON.parse(await executeTool(a, "webhook_register", { url: u, events: ["*"] }));
      expect(res.error, u).toBeTruthy();
    }
  });

  it("deliveries never follow redirects", async () => {
    const s = new WebhookStore({ dbPath: path.join(dir, "redir.db") });
    s.register("https://x.example.com/h", ["*"], "tenant-a");
    s.fire("e", { a: 1 }, "tenant-a");
    let seenRedirect: unknown;
    await s.pumpOnce(10, (async (_u: any, init: any) => {
      seenRedirect = init.redirect;
      return { status: 302 } as any;
    }) as any);
    expect(seenRedirect).toBe("manual");
    expect(s.listDeliveries()[0].status).toBe("pending"); // 302 is a failure -> retry, not "delivered"
    s.close();
  });
});

describe("D3: rate-limit client key is not client-controlled", () => {
  const req = (xff: string | undefined, remote = "10.9.9.9", extra: Record<string, string> = {}) => ({
    headers: { ...(xff ? { "x-forwarded-for": xff } : {}), ...extra },
    socket: { remoteAddress: remote },
  });

  it("uses the rightmost (proxy-appended) XFF entry, so prepending cannot pick a bucket", () => {
    const real = clientIpFromRequest(req("203.0.113.7"), { trustedProxyHops: 1 });
    const spoof = clientIpFromRequest(req("6.6.6.6, 203.0.113.7"), { trustedProxyHops: 1 });
    expect(real).toBe("203.0.113.7");
    expect(spoof).toBe(real);
  });

  it("ignores X-Real-IP and fly-client-ip unless explicitly trusted", () => {
    expect(clientIpFromRequest(req(undefined, "10.9.9.9", { "x-real-ip": "1.1.1.1", "fly-client-ip": "2.2.2.2" }))).toBe("10.9.9.9");
    expect(clientIpFromRequest(req(undefined, "10.9.9.9", { "fly-client-ip": "2.2.2.2" }), { trustFlyClientIp: true })).toBe("2.2.2.2");
  });

  it("hops=0 ignores XFF; a too-short XFF falls back to the socket", () => {
    expect(clientIpFromRequest(req("1.2.3.4"), { trustedProxyHops: 0 })).toBe("10.9.9.9");
    expect(clientIpFromRequest(req("1.2.3.4"), { trustedProxyHops: 3 })).toBe("10.9.9.9");
  });
});

describe("misc hardening", () => {
  it("tenant ids that collide with non-wallet files are rejected", () => {
    expect(isValidTenantAgentId("tenant-keys")).toBe(false);
    expect(isValidTenantAgentId("Tenant-Keys")).toBe(false);
    expect(isValidTenantAgentId("tnt_pro_0123456789")).toBe(true);
    expect(isValidTenantAgentId("../x")).toBe(false);
  });
});
