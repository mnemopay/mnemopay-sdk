/**
 * S1 follow-up: with no MNEMOPAY_MCP_TOKEN (the multi-tenant, self-serve key
 * deployment), a request that simply OMITS its tenant key and sends
 * `X-MnemoPay-Agent: <victim>` was routed to the victim's wallet: the tenant key
 * pins the tenant, but nothing required presenting it. Selecting a tenant now
 * needs a pinning tenant key, the operator bearer token, or a valid portal key.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { authorizeTenantSelection, startServer } from "../src/mcp/server.js";

describe("authorizeTenantSelection (pure rules)", () => {
  const base = { bootId: "boot" };
  it("no id / boot id is always fine", () => {
    expect(authorizeTenantSelection({ ...base, requested: undefined, credentialed: false })).toBeUndefined();
    expect(authorizeTenantSelection({ ...base, requested: "boot", credentialed: false })).toBe("boot");
  });
  it("a pinned (tenant-key) identity wins over whatever the caller asks for", () => {
    expect(authorizeTenantSelection({ ...base, requested: "victim", pinned: "mine", credentialed: false })).toBe("mine");
  });
  it("anonymous callers cannot pick another tenant; credentialed callers can", () => {
    expect(() => authorizeTenantSelection({ ...base, requested: "victim", credentialed: false })).toThrow(/Tenant selection requires/);
    expect(authorizeTenantSelection({ ...base, requested: "victim", credentialed: true })).toBe("victim");
  });
  it("explicit opt-out keeps the old open behaviour", () => {
    expect(authorizeTenantSelection({ ...base, requested: "victim", credentialed: false, allowAnonymous: true })).toBe("victim");
  });
});

describe("REST: anonymous X-MnemoPay-Agent cannot reach another tenant's wallet", () => {
  let port = 0;
  let dir = "";
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["PORT", "MNEMOPAY_PERSIST_DIR", "MNEMOPAY_MCP_TOKEN", "MNEMOPAY_ALLOW_ANON_TENANT_SELECTION", "MNEMOPAY_AGENT_ID", "REQUIRE_PORTAL_AUTH"];

  beforeAll(async () => {
    for (const k of KEYS) saved[k] = process.env[k];
    port = await new Promise<number>((res) => { const s = net.createServer().listen(0, () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mnemopay-anon-"));
    process.env.PORT = String(port);
    process.env.MNEMOPAY_PERSIST_DIR = dir;
    process.env.MNEMOPAY_AGENT_ID = "boot-agent";
    delete process.env.MNEMOPAY_MCP_TOKEN;
    delete process.env.MNEMOPAY_ALLOW_ANON_TENANT_SELECTION;
    await startServer();
    await new Promise((r) => setTimeout(r, 300));
  }, 30_000);

  afterAll(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const call = (headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}/api/balance`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });

  it("no header -> boot agent still works", async () => {
    const r = await call();
    expect(r.status).toBe(200);
  });

  it("header selecting a tenant, with no credential, is refused", async () => {
    const r = await call({ "x-mnemopay-agent": "victim-tenant" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toMatch(/Tenant selection requires/);
  });
});
