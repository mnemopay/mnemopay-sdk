/**
 * S3 follow-up: isBlockedWebhookHost only inspects the hostname text, so a
 * public-looking name that RESOLVES to a private address (127.0.0.1.nip.io, an
 * attacker DNS record, DNS rebinding) was delivered to the internal address.
 * Delivery now validates the addresses it is about to connect to.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { WebhookStore, guardedLookup, postGuarded } from "../src/storage/webhooks.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mnemopay-wh-dns-"));
  delete process.env.MNEMOPAY_WEBHOOK_ALLOW_LOCAL;
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

// A resolver stub: name -> addresses (no real DNS).
const stub = (map: Record<string, string[]>) =>
  ((host: string, _opts: any, cb: any) => {
    const addrs = map[host];
    if (!addrs) return cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
    cb(null, addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  }) as any;

describe("guardedLookup", () => {
  const run = (lk: any, host: string, all = true) =>
    new Promise<any>((resolve) => lk(host, { all }, (err: any, a: any, f: any) => resolve({ err, a, f })));

  it("refuses a public name that resolves to loopback / metadata / private space", async () => {
    const lk = guardedLookup(undefined, stub({
      "rebind.example": ["127.0.0.1"],
      "meta.example": ["169.254.169.254"],
      "mixed.example": ["93.184.216.34", "10.0.0.5"],
      "v6.example": ["::1"],
      "mapped.example": ["::ffff:127.0.0.1"],
    }));
    for (const h of ["rebind.example", "meta.example", "mixed.example", "v6.example", "mapped.example"]) {
      const r = await run(lk, h);
      expect(r.err?.message, h).toMatch(/blocked target/);
    }
  });

  it("passes a name that resolves only to public addresses (both lookup call shapes)", async () => {
    const lk = guardedLookup(undefined, stub({ "ok.example": ["93.184.216.34"] }));
    const all = await run(lk, "ok.example", true);
    expect(all.err).toBeNull();
    expect(all.a).toEqual([{ address: "93.184.216.34", family: 4 }]);
    const one = await run(lk, "ok.example", false);
    expect(one.a).toBe("93.184.216.34");
    expect(one.f).toBe(4);
  });
});

describe("pumpOnce uses the guarded transport when no fetch is injected", () => {
  it("does not deliver to a public name that resolves to loopback", async () => {
    let hits = 0;
    const srv = http.createServer((_req, res) => { hits++; res.end("ok"); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as any).port;
    try {
      const s = new WebhookStore({ dbPath: path.join(dir, "w.db") });
      s.register(`https://rebind.example:${port}/h`, ["*"], "tenant-a");
      s.fire("e", { a: 1 }, "tenant-a");
      await s.pumpOnce(10, undefined, { resolver: stub({ "rebind.example": ["127.0.0.1"] }) });
      const d = s.listDeliveries()[0];
      expect(d.status).not.toBe("delivered");
      expect(d.lastError).toMatch(/blocked target/);
      expect(hits).toBe(0);
      s.close();
    } finally { srv.close(); }
  });
});

describe("postGuarded", () => {
  it("posts body + headers, reports status, and does not follow redirects", async () => {
    let seen: any;
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/redir") { res.writeHead(302, { location: "http://127.0.0.1:1/x" }); res.end(); return; }
        seen = { body, sig: req.headers["x-test"] };
        res.writeHead(204); res.end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as any).port;
    try {
      // Permissive predicate so the loopback test server is reachable; the lookup path is still exercised.
      const lookup = guardedLookup(() => false, stub({ "good.example": ["127.0.0.1"] }));
      const ok = await postGuarded(`http://good.example:${port}/h`, { headers: { "x-test": "1" }, body: "{\"a\":1}", lookup });
      expect(ok.status).toBe(204);
      expect(seen).toEqual({ body: "{\"a\":1}", sig: "1" });
      const redir = await postGuarded(`http://good.example:${port}/redir`, { headers: {}, body: "{}", lookup });
      expect(redir.status).toBe(302);
    } finally { srv.close(); }
  });
});
