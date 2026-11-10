/**
 * Persistent Webhook Subscriptions + Outbound Delivery
 *
 * The MCP server used to call `webhook_register` and store a Map in process
 * memory — registrations evaporated on restart, and there was no delivery
 * loop at all. That was a hard blocker for payments buyers, who look for
 * webhooks before anything else.
 *
 * This module adds:
 *   - SQLite-backed subscription store (with per-subscription HMAC secret)
 *   - A `webhook_deliveries` queue of (subscriptionId, event, payload, attempts)
 *   - `fire(event, payload)` enqueues a delivery for every matching subscription
 *   - `pumpOnce()` drains a batch: HTTPS POST with HMAC-SHA256 signature,
 *     exponential backoff, max-retry then DLQ (status='dead')
 *
 * Delivery is best-effort and intentionally synchronous-on-fire: we don't
 * block the caller, but we also don't spin up a background process. The
 * MCP server calls `pumpOnce()` on a setInterval after the queue is first
 * touched. Operators can also call it manually via the SDK for a flush.
 *
 * Storage location:
 *   ${MNEMOPAY_PERSIST_DIR || ~/.mnemopay}/webhooks.db
 *
 * Signature format:
 *   X-MnemoPay-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256(t + "." + body)>
 *   (the Stripe pattern — replay-resistant when receiver checks t freshness)
 */

import * as crypto from "crypto";
import * as dns from "dns";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";

const MAX_ATTEMPTS = 6; // ~ 1s + 2s + 4s + 8s + 16s + 32s ≈ 1 minute total
const DELIVERY_TIMEOUT_MS = 10_000;

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  secret: string;
  createdAt: number;
  /** Owning tenant (agent id). Undefined only on legacy rows written before tenant scoping. */
  tenantId?: string;
}

/**
 * SSRF guard for webhook targets. Returns true when `hostname` is a loopback,
 * private, link-local, CGNAT, multicast or otherwise non-public literal address
 * (IPv4, IPv6, IPv4-mapped IPv6, decimal/hex/octal tricks) or an internal name.
 * It cannot see through DNS: a public name that RESOLVES to a private address
 * is not caught here. Delivery therefore connects through `guardedLookup`/
 * `postGuarded` below, which validate the resolved addresses at connect time,
 * and never follows redirects.
 */
export function isBlockedWebhookHost(hostname: string): boolean {
  let h = String(hostname || "").trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  h = h.replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
      h.endsWith(".localdomain") || h === "metadata.google.internal") return true;

  // IPv6 literals
  if (h.includes(":")) {
    const mapped = /^(?:0{0,4}:){0,5}(?:ffff:)(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return isBlockedWebhookHost(mapped[1]);
    if (/^(?:0{0,4}:){0,5}ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h)) return true; // hex-form mapped v4
    if (h === "::" || h === "::1") return true;
    const first = h.split(":")[0];
    const n = first === "" ? 0 : parseInt(first, 16);
    if (Number.isNaN(n)) return true;
    if ((n & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((n & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((n & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (n === 0) return true;                 // ::/8 incl. v4-compatible
    return false;
  }

  // Pure numeric / hex / octal single-token hosts (e.g. 2130706433, 0x7f000001, 017700000001)
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/.test(h)) return true;

  const parts = h.split(".");
  if (parts.length === 4 && parts.every((p) => /^(0x[0-9a-f]+|\d+)$/.test(p))) {
    if (parts.some((p) => p.startsWith("0x") || (p.length > 1 && p.startsWith("0")))) return true; // hex/octal octets
    const [a, b] = parts.map((p) => parseInt(p, 10));
    if (parts.some((p) => parseInt(p, 10) > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast + reserved
  }
  return false;
}

/** Node `lookup` signature (what `http(s).request({ lookup })` calls). */
export type LookupFn = (hostname: string, options: any, cb: (err: any, address?: any, family?: number) => void) => void;

/**
 * A `lookup` that refuses to hand back private/internal addresses. Validation
 * happens on the very addresses the socket will connect to, so there is no
 * check-then-use gap for DNS rebinding. If ANY resolved address is blocked the
 * whole lookup fails (an attacker cannot mix a public and a private record).
 * IP-literal hosts never reach `lookup`; those are covered by isBlockedWebhookHost.
 */
export function guardedLookup(
  isBlocked: (address: string) => boolean = isBlockedWebhookHost,
  base: LookupFn = dns.lookup as unknown as LookupFn,
): LookupFn {
  return (hostname, options, cb) => {
    if (typeof options === "function") { cb = options; options = {}; }
    const wantAll = !!options?.all;
    base(hostname, { ...options, all: true }, (err: any, addrs: any) => {
      if (err) return cb(err);
      const list: Array<{ address: string; family: number }> = Array.isArray(addrs) ? addrs : [];
      if (list.length === 0 || list.some((a) => isBlocked(a.address))) {
        return cb(new Error(`blocked target: ${hostname} resolves to a private/internal address`));
      }
      if (wantAll) cb(null, list as any);
      else cb(null, list[0].address, list[0].family);
    });
  };
}

/**
 * POST `body` using `lookup` for name resolution. No redirect following (a 3xx is
 * returned to the caller as a plain status).
 */
export function postGuarded(
  url: string,
  init: { headers: Record<string, string>; body: string; signal?: AbortSignal; lookup?: LookupFn },
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: "POST",
        headers: { ...init.headers, "content-length": String(Buffer.byteLength(init.body)) },
        lookup: (init.lookup || guardedLookup()) as any,
        signal: init.signal,
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode || 0 });
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  event: string;
  payload: string; // JSON-encoded
  attempts: number;
  nextAttemptAt: number;
  status: "pending" | "delivered" | "dead";
  lastError?: string;
  lastStatusCode?: number;
  createdAt: number;
  deliveredAt?: number;
}

// ── HMAC sign / verify (exported so receivers can use the same helper) ────

export function signPayload(secret: string, body: string, timestamp: number): string {
  const signedString = `${timestamp}.${body}`;
  const hmac = crypto.createHmac("sha256", secret).update(signedString).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

export function verifySignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds: number = 300
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k.trim(), rest.join("=").trim()];
    })
  );
  const t = parseInt(parts.t, 10);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  // constant-time compare
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Store ──────────────────────────────────────────────────────────────────

export class WebhookStore {
  private db: any;
  private dbPath: string;
  /**
   * Tenant that owns subscriptions written before tenant scoping existed
   * (tenant_id IS NULL). Without this they would have to be delivered to every
   * tenant (a leak) or to nobody (a silent break).
   */
  private legacyTenantId?: string;

  constructor(opts: { dbPath?: string; legacyTenantId?: string } = {}) {
    this.dbPath = opts.dbPath || WebhookStore.defaultDbPath();
    this.legacyTenantId = opts.legacyTenantId;
    this._open();
    this._createTables();
  }

  static defaultDbPath(): string {
    const dir = process.env.MNEMOPAY_PERSIST_DIR || path.join(os.homedir(), ".mnemopay");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
    return path.join(dir, "webhooks.db");
  }

  private _open(): void {
    try {
      const Database = require("better-sqlite3");
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
    } catch (err: any) {
      throw new Error(`WebhookStore: failed to open ${this.dbPath} — ${err?.message || err}`);
    }
  }

  private _createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT NOT NULL,
        secret TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        last_status_code INTEGER,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_deliveries_subscription ON deliveries(subscription_id);
    `);
    // Migration: tenant scoping (added after first release).
    const cols: any[] = this.db.prepare(`PRAGMA table_info(subscriptions)`).all();
    if (!cols.some((c) => c.name === "tenant_id")) {
      this.db.exec(`ALTER TABLE subscriptions ADD COLUMN tenant_id TEXT`);
    }
  }

  // ── Subscription API ─────────────────────────────────────────────────────

  register(url: string, events: string[], tenantId?: string): WebhookSubscription {
    const id = `wh_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
    const sub: WebhookSubscription = {
      id,
      url,
      events: Array.isArray(events) ? events : [],
      secret,
      createdAt: Date.now(),
      tenantId,
    };
    this.db
      .prepare(
        `INSERT INTO subscriptions (id, url, events, secret, created_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(sub.id, sub.url, JSON.stringify(sub.events), sub.secret, sub.createdAt, tenantId ?? null);
    return sub;
  }

  private _owns(row: any, tenantId: string): boolean {
    // "*" = operator-global subscription (receives every tenant's events). MCP
    // tools never create one: "*" is not a valid tenant agent id.
    if (row.tenant_id === "*") return true;
    const owner = row.tenant_id ?? this.legacyTenantId;
    return owner === tenantId;
  }

  /**
   * List subscriptions. With `tenantId`, only that tenant's (plus legacy rows if
   * it is the legacy owner); without it, all of them (single-tenant SDK use).
   */
  list(tenantId?: string): WebhookSubscription[] {
    return this.db
      .prepare(`SELECT id, url, events, secret, created_at, tenant_id FROM subscriptions`)
      .all()
      .filter((row: any) => tenantId === undefined || this._owns(row, tenantId))
      .map((row: any) => ({
        id: row.id,
        url: row.url,
        events: JSON.parse(row.events),
        secret: row.secret,
        createdAt: row.created_at,
        tenantId: row.tenant_id ?? undefined,
      }));
  }

  /** Remove a subscription; with `tenantId`, only if that tenant owns it. */
  unregister(id: string, tenantId?: string): boolean {
    if (tenantId !== undefined) {
      const row = this.db.prepare(`SELECT tenant_id FROM subscriptions WHERE id = ?`).get(id);
      if (!row || !this._owns(row, tenantId)) return false;
    }
    const r = this.db.prepare(`DELETE FROM subscriptions WHERE id = ?`).run(id);
    return r.changes > 0;
  }

  matching(event: string, tenantId?: string): WebhookSubscription[] {
    return this.list(tenantId).filter((s) => s.events.includes(event) || s.events.includes("*"));
  }

  // ── Delivery enqueue ─────────────────────────────────────────────────────

  /**
   * Enqueue `event` for matching subscriptions. Pass `tenantId` to deliver ONLY
   * to that tenant's subscriptions (the MCP server always does); omitting it
   * fans out to every subscription, which is only right for single-tenant use.
   */
  fire(event: string, payload: any, tenantId?: string): number {
    const subs = this.matching(event, tenantId);
    if (subs.length === 0) return 0;
    const body = JSON.stringify({ event, timestamp: Date.now(), ...payload });
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT INTO deliveries (id, subscription_id, event, payload, attempts, next_attempt_at, status, created_at)
       VALUES (?, ?, ?, ?, 0, ?, 'pending', ?)`
    );
    const tx = this.db.transaction((rows: any[]) => {
      for (const r of rows) insert.run(...r);
    });
    const rows = subs.map((s) => [
      `whd_${now}_${crypto.randomBytes(6).toString("hex")}`,
      s.id,
      event,
      body,
      now,
      now,
    ]);
    tx(rows);
    return subs.length;
  }

  // ── Delivery worker ──────────────────────────────────────────────────────

  /**
   * Drains up to `batchSize` ready deliveries.
   * Returns the count actually attempted (not necessarily succeeded).
   *
   * For each delivery: POST to subscription.url with the HMAC header.
   * On 2xx → mark delivered. On non-2xx or network error → schedule next
   * attempt with exponential backoff, or mark 'dead' after MAX_ATTEMPTS.
   */
  async pumpOnce(batchSize: number = 25, fetchImpl?: typeof fetch, opts: { resolver?: LookupFn } = {}): Promise<number> {
    const ready = this.db
      .prepare(
        `SELECT d.*, s.url AS sub_url, s.secret AS sub_secret
         FROM deliveries d JOIN subscriptions s ON s.id = d.subscription_id
         WHERE d.status = 'pending' AND d.next_attempt_at <= ?
         ORDER BY d.next_attempt_at ASC
         LIMIT ?`
      )
      .all(Date.now(), batchSize);
    if (ready.length === 0) return 0;
    const allowLocal = process.env.MNEMOPAY_WEBHOOK_ALLOW_LOCAL === "1";
    // Production path (no injected fetch, local not allowed): connect through the
    // guarded lookup so a name that resolves to a private address is refused.
    const guarded = !fetchImpl && !allowLocal;
    const doFetch = fetchImpl || (globalThis as any).fetch;
    if (!guarded && typeof doFetch !== "function") {
      throw new Error("WebhookStore.pumpOnce: global fetch not available; pass fetchImpl");
    }
    for (const row of ready) {
      const attempts = row.attempts + 1;
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signPayload(row.sub_secret, row.payload, timestamp);
      try {
        // Re-check the target at delivery time (rows may predate the register-time
        // filter). Skipped when a fetch is injected (tests) or local is allowed.
        if (!fetchImpl && !allowLocal) {
          let host = "";
          try { host = new URL(row.sub_url).hostname; } catch { /* handled below */ }
          if (!host || isBlockedWebhookHost(host)) {
            this._scheduleRetry(row.id, MAX_ATTEMPTS, "blocked target (private/internal address)", null);
            continue;
          }
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
        const headers = {
          "content-type": "application/json",
          "x-mnemopay-signature": signature,
          "x-mnemopay-event": row.event,
          "x-mnemopay-delivery": row.id,
        };
        let res: { status: number };
        try {
          res = guarded
            ? await postGuarded(row.sub_url, { headers, body: row.payload, signal: controller.signal, lookup: guardedLookup(undefined, opts.resolver) })
            : await doFetch(row.sub_url, {
                method: "POST",
                headers,
                body: row.payload,
                signal: controller.signal,
                // Never follow redirects: a 302 to an internal address would bypass the host filter.
                redirect: "manual",
              });
        } finally {
          clearTimeout(timeoutId);
        }
        if (res.status >= 200 && res.status < 300) {
          this.db
            .prepare(
              `UPDATE deliveries SET status='delivered', attempts=?, last_status_code=?, delivered_at=? WHERE id=?`
            )
            .run(attempts, res.status, Date.now(), row.id);
        } else {
          this._scheduleRetry(row.id, attempts, `HTTP ${res.status}`, res.status);
        }
      } catch (err: any) {
        this._scheduleRetry(row.id, attempts, String(err?.message || err).slice(0, 200), null);
      }
    }
    return ready.length;
  }

  private _scheduleRetry(
    deliveryId: string,
    attempts: number,
    error: string,
    statusCode: number | null
  ): void {
    if (attempts >= MAX_ATTEMPTS) {
      this.db
        .prepare(
          `UPDATE deliveries SET status='dead', attempts=?, last_error=?, last_status_code=? WHERE id=?`
        )
        .run(attempts, error, statusCode, deliveryId);
      return;
    }
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s — base 2^attempts seconds
    const nextDelayMs = Math.pow(2, attempts) * 1000;
    this.db
      .prepare(
        `UPDATE deliveries SET attempts=?, next_attempt_at=?, last_error=?, last_status_code=? WHERE id=?`
      )
      .run(attempts, Date.now() + nextDelayMs, error, statusCode, deliveryId);
  }

  // ── Inspection ───────────────────────────────────────────────────────────

  getDelivery(id: string): WebhookDelivery | undefined {
    const row = this.db.prepare(`SELECT * FROM deliveries WHERE id = ?`).get(id);
    if (!row) return undefined;
    return {
      id: row.id,
      subscriptionId: row.subscription_id,
      event: row.event,
      payload: row.payload,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      status: row.status,
      lastError: row.last_error || undefined,
      lastStatusCode: row.last_status_code || undefined,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at || undefined,
    };
  }

  /**
   * Inspect enqueued deliveries (test/ops helper).
   * Returns rows in insertion order.
   */
  listDeliveries(opts: { status?: "pending" | "delivered" | "dead"; event?: string; limit?: number } = {}): WebhookDelivery[] {
    const clauses: string[] = [];
    const params: any[] = [];
    if (opts.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    if (opts.event) {
      clauses.push("event = ?");
      params.push(opts.event);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = opts.limit ?? 100;
    const rows: any[] = this.db
      .prepare(`SELECT * FROM deliveries ${where} ORDER BY created_at ASC LIMIT ?`)
      .all(...params, limit);
    return rows.map((r) => ({
      id: r.id,
      subscriptionId: r.subscription_id,
      event: r.event,
      payload: r.payload,
      attempts: r.attempts,
      nextAttemptAt: r.next_attempt_at,
      status: r.status,
      lastError: r.last_error ?? undefined,
      lastStatusCode: r.last_status_code ?? undefined,
      createdAt: r.created_at,
      deliveredAt: r.delivered_at ?? undefined,
    }));
  }

  countByStatus(): { pending: number; delivered: number; dead: number } {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM deliveries GROUP BY status`)
      .all();
    const out = { pending: 0, delivered: 0, dead: 0 } as Record<string, number>;
    for (const r of rows) out[r.status] = r.n;
    return out as any;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  close(): void {
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* best-effort */
    }
    try {
      this.db.close();
    } catch {
      /* best-effort */
    }
  }
}
