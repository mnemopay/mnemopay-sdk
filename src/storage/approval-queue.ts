/**
 * Persistent HITL Approval Queue
 *
 * Backs the in-memory pendingApprovals / pendingChargeRequests Maps with a
 * SQLite-backed mirror so a pod restart doesn't silently drop pending
 * human-in-the-loop approvals.
 *
 * Two tables:
 *   pending_charges          — charge_request → charge_approve / charge_reject
 *   pending_shop_approvals   — shop autonomous purchase HITL
 *
 * Shop approvals carry an in-process `resolve()` callback (a Promise resolver
 * inside the CommerceEngine flow) that obviously cannot be serialized. On
 * rehydrate after restart, the callback is replaced with a no-op so the
 * operator can still see the orphaned approval in shop_pending_approvals and
 * clean it up via shop_reject. The buyer's original Promise died with the old
 * process — they will see a timeout / error. We do not pretend otherwise.
 *
 * Storage location:
 *   ${MNEMOPAY_PERSIST_DIR || ~/.mnemopay}/approvals.db
 *
 * Single-process writes only — matches the broader SQLiteStorage contract.
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// ── Types mirrored from mcp/server.ts ────────────────────────────────────────

export interface PersistedChargeRequest {
  id: string;
  amount: number;
  reason: string;
  context?: any;
  payOptions?: any;
  createdAt: number;
  /** Tenant (agent id) that raised the request; approvals are only visible/actionable by it. */
  tenantId?: string;
}

export interface PersistedShopApproval {
  orderId: string;
  order: any;
  createdAt: number;
  /** Tenant (agent id) that raised the approval. */
  tenantId?: string;
  /** No-op after rehydrate; live Promise resolver while the original request is in flight. */
  resolve: (approved: boolean) => void;
}

// ── Persistent queue ──────────────────────────────────────────────────────────

export class PersistentApprovalQueue {
  private db: any;
  private dbPath: string;
  /** In-memory mirror — hot path. Truth lives in SQLite. */
  readonly charges = new Map<string, PersistedChargeRequest>();
  readonly shopApprovals = new Map<string, PersistedShopApproval>();

  constructor(opts: { dbPath?: string } = {}) {
    this.dbPath = opts.dbPath || PersistentApprovalQueue.defaultDbPath();
    this._open();
    this._createTables();
    this._hydrate();
  }

  static defaultDbPath(): string {
    const dir = process.env.MNEMOPAY_PERSIST_DIR || path.join(os.homedir(), ".mnemopay");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore — _open will throw a clearer error if dir is unusable */
    }
    return path.join(dir, "approvals.db");
  }

  private _open(): void {
    try {
      const Database = require("better-sqlite3");
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
    } catch (err: any) {
      throw new Error(
        `PersistentApprovalQueue: failed to open ${this.dbPath} — ${err?.message || err}`
      );
    }
  }

  private _createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_charges (
        id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        reason TEXT NOT NULL,
        context TEXT,
        pay_options TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_charges_created
        ON pending_charges(created_at);

      CREATE TABLE IF NOT EXISTS pending_shop_approvals (
        order_id TEXT PRIMARY KEY,
        order_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_shop_created
        ON pending_shop_approvals(created_at);
    `);
    // Migration: tenant scoping (added after first release).
    for (const table of ["pending_charges", "pending_shop_approvals"]) {
      const cols: any[] = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!cols.some((c) => c.name === "tenant_id")) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT`);
      }
    }
  }

  private _hydrate(): void {
    const charges = this.db
      .prepare(`SELECT id, amount, reason, context, pay_options, created_at, tenant_id FROM pending_charges`)
      .all();
    for (const row of charges) {
      this.charges.set(row.id, {
        id: row.id,
        amount: row.amount,
        reason: row.reason,
        context: row.context ? this._safeParse(row.context) : undefined,
        payOptions: row.pay_options ? this._safeParse(row.pay_options) : undefined,
        createdAt: row.created_at,
        tenantId: row.tenant_id ?? undefined,
      });
    }
    const shops = this.db
      .prepare(`SELECT order_id, order_json, created_at, tenant_id FROM pending_shop_approvals`)
      .all();
    for (const row of shops) {
      this.shopApprovals.set(row.order_id, {
        orderId: row.order_id,
        order: this._safeParse(row.order_json) || {},
        createdAt: row.created_at,
        tenantId: row.tenant_id ?? undefined,
        // Rehydrated entries have no live Promise. Operator can still
        // shop_reject them; the no-op resolve is intentional.
        resolve: () => {},
      });
    }
  }

  private _safeParse(s: string): any {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  // ── Charge request API ─────────────────────────────────────────────────────

  addCharge(req: PersistedChargeRequest): void {
    this.charges.set(req.id, req);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO pending_charges (id, amount, reason, context, pay_options, created_at, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.id,
        req.amount,
        req.reason,
        req.context === undefined ? null : JSON.stringify(req.context),
        req.payOptions === undefined ? null : JSON.stringify(req.payOptions),
        req.createdAt,
        req.tenantId ?? null
      );
  }

  removeCharge(id: string): PersistedChargeRequest | undefined {
    const entry = this.charges.get(id);
    this.charges.delete(id);
    this.db.prepare(`DELETE FROM pending_charges WHERE id = ?`).run(id);
    return entry;
  }

  // ── Shop approval API ──────────────────────────────────────────────────────

  addShopApproval(approval: PersistedShopApproval): void {
    this.shopApprovals.set(approval.orderId, approval);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO pending_shop_approvals (order_id, order_json, created_at, tenant_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(approval.orderId, JSON.stringify(approval.order ?? {}), approval.createdAt, approval.tenantId ?? null);
  }

  removeShopApproval(orderId: string): PersistedShopApproval | undefined {
    const entry = this.shopApprovals.get(orderId);
    this.shopApprovals.delete(orderId);
    this.db.prepare(`DELETE FROM pending_shop_approvals WHERE order_id = ?`).run(orderId);
    return entry;
  }

  // ── Expiry sweep ───────────────────────────────────────────────────────────

  /**
   * Drop entries whose createdAt is older than `now - maxAgeMs`. Returns the
   * count of entries removed across both queues.
   * Shop approval resolve callbacks are invoked with `false` (rejected) so
   * any still-waiting in-process buyer Promise unblocks.
   */
  expireOlderThan(maxAgeMs: number, now: number = Date.now()): number {
    const cutoff = now - maxAgeMs;
    let removed = 0;

    for (const [id, entry] of this.charges) {
      if (entry.createdAt < cutoff) {
        this.charges.delete(id);
        removed++;
      }
    }
    this.db.prepare(`DELETE FROM pending_charges WHERE created_at < ?`).run(cutoff);

    for (const [orderId, entry] of this.shopApprovals) {
      if (entry.createdAt < cutoff) {
        try {
          entry.resolve(false);
        } catch {
          /* resolve may throw if already settled; ignore */
        }
        this.shopApprovals.delete(orderId);
        removed++;
      }
    }
    this.db.prepare(`DELETE FROM pending_shop_approvals WHERE created_at < ?`).run(cutoff);

    return removed;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

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
