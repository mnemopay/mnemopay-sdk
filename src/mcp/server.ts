#!/usr/bin/env node
/**
 * MnemoPay Unified MCP Server
 *
 * Exposes MnemoPay SDK methods as MCP tools. Any MCP-compatible client
 * (Claude Desktop, Cursor, Windsurf, OpenClaw, Hermes) gets agent memory
 * + wallet capabilities instantly.
 *
 * Usage:
 *   npx @mnemopay/mcp-server                         # stdio, essentials (default)
 *   npx @mnemopay/mcp-server --tools=all             # all 95 tools
 *   npx @mnemopay/mcp-server --tools=memory,wallet   # memory + wallet only
 *   npx @mnemopay/mcp-server --http --port 3200      # HTTP/SSE mode
 *
 * Tool groups (pass via --tools=... or MNEMOPAY_TOOLS env var):
 *   essentials  memory + wallet + tx          (default — minimal context)
 *   memory      remember/recall/forget/reinforce/consolidate
 *   wallet      balance/profile/history/logs
 *   tx          charge/settle/refund/dispute/receipt_get
 *   commerce    shop_* + checkout executor
 *   hitl        approval queue (shop + charge requests)
 *   payments    payment_method_* + payout_*
 *   webhooks    webhook_register/list
 *   fico        agent_fico_score/behavioral/anomaly/fraud/reputation
 *   security    memory_integrity_check/history_export
 *   governance  charter/policy/risk/action-ledger/audit-bundle tools
 *   identity    KYA identity + scoped capability tokens + kill switch
 *   skills      governed declarative skill policy preview/execution plan
 *   spatial     GridStamp evidence validation/attachment/audit export
 *   agent_os    durable browser/code/computer/skill/brain jobs + operations
 *   organization_admin  members/invitations/policies/agents/limits
 *   operator    processes/approvals/activity/emergency controls
 *   agent       essentials + commerce + hitl + payments + webhooks
 *   all         every tool (95)
 *
 * Environment:
 *   MNEMOPAY_TOOLS      — Comma-separated group list (alternative to --tools)
 *   MNEMOPAY_AGENT_ID   — Agent identifier (default: "mcp-agent")
 *   MNEMOPAY_MODE       — "quick" or "production" (default: "quick")
 *   MNEMO_URL           — Mnemosyne API URL (production mode)
 *   AGENTPAY_URL        — AgentPay API URL (production mode)
 *   MNEMO_API_KEY       — Mnemosyne API key (production mode)
 *   AGENTPAY_API_KEY    — AgentPay API key (production mode)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MnemoPay, MnemoPayLite, RateLimiter, constantTimeEqual, AgentCreditScore, MerkleTree, BehavioralEngine, EWMADetector, IdentityRegistry } from "../index.js";
import type { Permission } from "../identity.js";

// Single source of truth for the version the server reports (was hard-coded and stale).
const PKG_VERSION: string = (require("../../package.json") as { version: string }).version;
import { StripeRail, LightningRail, MockRail } from "../rails/index.js";
import { PaystackRail } from "../rails/paystack.js";
import type { PaymentRail } from "../rails/index.js";
import type { RequestContext, FraudConfig } from "../fraud.js";
import { PersistentApprovalQueue } from "../storage/approval-queue.js";
import { WebhookStore, isBlockedWebhookHost } from "../storage/webhooks.js";
import { SQLiteAdapter } from "../recall/persistence/sqlite.js";
import { localEmbed } from "../recall/engine.js";
import {
  ActionLedger,
  attachSpatialEvidence,
  buildRiskPolicy,
  classifyRisk,
  compilePolicy,
  evaluateAction,
  InMemoryRateCounter,
  lintPolicy,
  MerkleAudit,
  fingerprintSpatialEvidence,
  validateCharter,
  verifySpatialEvidence,
  verifyBundle,
} from "../governance/index.js";
import type { ChainBundle, CompiledPolicy, Policy, PolicyAction, SpatialEvidence } from "../governance/index.js";
import { policyForSkill, runSkill } from "../skills/index.js";
import type { MnemoSkill, SkillActRequest, SkillPermissions } from "../skills/index.js";
import * as fs from "fs";

// ─── Security: MCP-level rate limiter ────────────────────────────────────────
// Separate from per-agent fraud rate limits — this guards the MCP server itself.

const MCP_RATE_LIMIT = {
  maxCallsPerMinute: 60,
  maxCallsPerHour: 500,
};

class McpRateLimiter {
  private timestamps: number[] = [];
  check(): void {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < 3_600_000);
    const lastMinute = this.timestamps.filter(t => now - t < 60_000).length;
    if (lastMinute >= MCP_RATE_LIMIT.maxCallsPerMinute) {
      throw new Error("MCP rate limit exceeded: too many calls per minute");
    }
    if (this.timestamps.length >= MCP_RATE_LIMIT.maxCallsPerHour) {
      throw new Error("MCP rate limit exceeded: too many calls per hour");
    }
    this.timestamps.push(now);
  }
}

const mcpLimiter = new McpRateLimiter();

type Agent = MnemoPayLite | MnemoPay;

// ─── Agent initialization ───────────────────────────────────────────────────

/**
 * Resolve the per-process agent config (rail + fraud/metering knobs +
 * persistence dir) ONCE so the boot agent and every per-tenant agent share the
 * exact same posture. Building a fresh PaymentRail per tenant would be wasteful
 * and (for Stripe) re-instantiate a client per tenant, so the rail instance is
 * shared — it's stateless w.r.t. agent id (the agentId is passed per charge via
 * createHold(amount, reason, agentId)). Only the wallet/ledger/memory (keyed by
 * agentId inside MnemoPayLite) differ per tenant.
 */
interface ResolvedAgentConfig {
  mode: "quick" | "production";
  paymentRail?: PaymentRail;
  fraud?: Partial<FraudConfig>;
  recall?: "score" | "vector" | "hybrid";
  debug: boolean;
  openaiApiKey?: string;
  /** Explicit persist dir to enablePersistence() on, or undefined to rely on auto-detect. */
  persistDir?: string;
  /** True when MNEMOPAY_PERSIST_DIR was explicitly set (auto-detect already covers it). */
  persistDirIsEnv: boolean;
}

let _resolvedConfig: ResolvedAgentConfig | null = null;

function resolveAgentConfig(): ResolvedAgentConfig {
  if (_resolvedConfig) return _resolvedConfig;
  const mode = (process.env.MNEMOPAY_MODE || "quick") === "production" ? "production" : "quick";

  if (mode === "production") {
    _resolvedConfig = { mode, debug: process.env.DEBUG === "true", persistDirIsEnv: false };
    return _resolvedConfig;
  }

  // ── Payment rail selection ────────────────────────────────────────────────
  // Set MNEMOPAY_PAYMENT_RAIL to "stripe", "paystack", or "lightning".
  // Defaults to MockRail when no rail/keys are configured (backwards compatible).
  const railName = (process.env.MNEMOPAY_PAYMENT_RAIL || "mock").toLowerCase();
  let paymentRail: PaymentRail;

  switch (railName) {
    case "stripe": {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("STRIPE_SECRET_KEY required when MNEMOPAY_PAYMENT_RAIL=stripe");
      const currency = process.env.STRIPE_CURRENCY || "usd";
      paymentRail = new StripeRail(key, currency);
      break;
    }
    case "paystack": {
      const key = process.env.PAYSTACK_SECRET_KEY;
      if (!key) throw new Error("PAYSTACK_SECRET_KEY required when MNEMOPAY_PAYMENT_RAIL=paystack");
      const currency = (process.env.PAYSTACK_CURRENCY || "NGN") as any;
      paymentRail = new PaystackRail(key, { currency });
      break;
    }
    case "lightning": {
      const url = process.env.LIGHTNING_LND_URL;
      const macaroon = process.env.LIGHTNING_MACAROON;
      if (!url || !macaroon) throw new Error("LIGHTNING_LND_URL and LIGHTNING_MACAROON required when MNEMOPAY_PAYMENT_RAIL=lightning");
      const btcPrice = Number(process.env.LIGHTNING_BTC_PRICE) || 60000;
      paymentRail = new LightningRail(url, macaroon, btcPrice);
      break;
    }
    default:
      paymentRail = new MockRail();
  }

  const recall = (process.env.MNEMOPAY_RECALL as "score" | "vector" | "hybrid") || undefined;

  // ── Fraud / metering config from env ──────────────────────────────────────
  // The stock FraudGuard defaults (30-min settlement hold, 0.75 block threshold,
  // 5 charges/min) are tuned for adversarial third-party marketplace escrow and
  // BREAK first-party metering (immediate per-LLM-call settle, rapid identical
  // micro-charges). A metering deploy sets MNEMOPAY_METERING=1 to relax all of
  // them; individual knobs can still be overridden via env. Receipt shape is
  // unchanged — only the risk gate differs.
  const metering =
    process.env.MNEMOPAY_METERING === "1" || process.env.MNEMOPAY_METERING === "true";
  const numEnv = (name: string): number | undefined => {
    const v = process.env[name];
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const fraudConfig: Partial<FraudConfig> = {};
  if (metering) {
    fraudConfig.settlementHoldMinutes = 0;
    fraudConfig.blockThreshold = 1.01; // never hard-block first-party metering
    fraudConfig.maxChargesPerMinute = 10_000;
    fraudConfig.maxChargesPerHour = 100_000;
    fraudConfig.maxChargesPerDay = 1_000_000;
    fraudConfig.maxDailyVolume = 1_000_000;
  }
  // Per-knob env overrides (apply on top of, or instead of, the metering preset).
  const holdMin = numEnv("MNEMOPAY_SETTLEMENT_HOLD_MINUTES");
  if (holdMin !== undefined) fraudConfig.settlementHoldMinutes = holdMin;
  const blockThr = numEnv("MNEMOPAY_BLOCK_THRESHOLD");
  if (blockThr !== undefined) fraudConfig.blockThreshold = blockThr;
  const maxPerMin = numEnv("MNEMOPAY_MAX_CHARGES_PER_MINUTE");
  if (maxPerMin !== undefined) fraudConfig.maxChargesPerMinute = maxPerMin;

  // Enable file persistence — always on by default.
  // Priority: MNEMOPAY_PERSIST_DIR env > Fly.io /data > ~/.mnemopay/data
  const persistDir =
    process.env.MNEMOPAY_PERSIST_DIR ||
    (process.env.FLY_APP_NAME ? "/data" : undefined) ||
    require("path").join(require("os").homedir(), ".mnemopay", "data");

  _resolvedConfig = {
    mode,
    paymentRail,
    fraud: Object.keys(fraudConfig).length > 0 ? fraudConfig : undefined,
    recall,
    debug: process.env.DEBUG === "true",
    openaiApiKey: process.env.OPENAI_API_KEY,
    persistDir,
    persistDirIsEnv: Boolean(process.env.MNEMOPAY_PERSIST_DIR),
  };
  return _resolvedConfig;
}

/**
 * Build a single agent for a given agent id using the shared resolved config.
 * The boot agent and every per-tenant agent come through here so they're
 * identical except for their agent id (which keys the wallet/ledger/memory and
 * the on-disk `${agentId}.json` persistence file).
 */
function buildAgentFor(agentId: string): Agent {
  const cfg = resolveAgentConfig();

  if (cfg.mode === "production") {
    return MnemoPay.create({
      agentId,
      mnemoUrl: process.env.MNEMO_URL || "http://localhost:8100",
      agentpayUrl: process.env.AGENTPAY_URL || "http://localhost:3100",
      mnemoApiKey: process.env.MNEMO_API_KEY,
      agentpayApiKey: process.env.AGENTPAY_API_KEY,
      debug: cfg.debug,
    });
  }

  const agent = MnemoPay.quick(agentId, {
    debug: cfg.debug,
    recall: cfg.recall,
    openaiApiKey: cfg.openaiApiKey,
    paymentRail: cfg.paymentRail,
    fraud: cfg.fraud,
  });

  // Each tenant persists to its own `${agentId}.json` under the shared dir.
  // When MNEMOPAY_PERSIST_DIR is set, MnemoPayLite already auto-enables it in
  // its constructor — so we only call enablePersistence for the fallback dirs.
  if (!cfg.persistDirIsEnv && cfg.persistDir) {
    (agent as MnemoPayLite).enablePersistence(cfg.persistDir);
  }

  return agent;
}

function createAgent(): Agent {
  return buildAgentFor(process.env.MNEMOPAY_AGENT_ID || "mcp-agent");
}

// ─── Per-tenant agent registry (multi-tenant wallet routing) ─────────────────
//
// One shared substrate, but each charge/settle/ledger entry is scoped to the
// CALLING tenant's own agent id (sent via the `X-MnemoPay-Agent` header on the
// REST/HTTP path, or the `_agentId` param on a direct MCP call). We lazily
// build one MnemoPayLite per tenant id — each is its own wallet + double-entry
// ledger + memory bank + `${agentId}.json` persistence file, so tenant A's
// money and memories are physically isolated from tenant B's. No per-request
// identity → the boot agent is used (existing single-tenant callers unchanged).
//
// Agent ids are validated to a safe charset to keep them filesystem-safe (they
// become a persistence filename) and prevent traversal.

const TENANT_AGENT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Ids that would collide with non-wallet files living in the same data dir
 * (`<dir>/tenant-keys.json` is the API-key store).
 */
const RESERVED_TENANT_IDS = new Set(["tenant-keys", "approvals", "webhooks"]);

export function isValidTenantAgentId(id: string): boolean {
  return TENANT_AGENT_ID_RE.test(id) && !id.includes("..") && !RESERVED_TENANT_IDS.has(id.toLowerCase());
}

// ─── Tenant helpers (isolation of approvals / governance / webhooks / commerce) ──
//
// The wallet-level AgentRegistry above isolates money and memory per tenant.
// Everything below used to be one process-global singleton shared by every
// tenant (audit S1). Each piece is now keyed by the acting agent's id.

function defaultTenantId(): string {
  return process.env.MNEMOPAY_AGENT_ID || "mcp-agent";
}

/** The tenant (agent id) a tool call is acting for. */
function tenantIdOf(agent: Agent): string {
  return String((agent as any)?.agentId || defaultTenantId());
}

/**
 * Does `entryTenant` (stored on a queue row / subscription) belong to `acting`?
 * Rows written before tenant scoping have no owner and belong to the default
 * (boot) tenant only.
 */
function tenantOwns(entryTenant: string | null | undefined, acting: string): boolean {
  return (entryTenant ?? defaultTenantId()) === acting;
}

// ─── Human-approval separation (audit S2) ────────────────────────────────────
//
// charge_approve / charge_reject / shop_approve / shop_reject were ordinary
// tools, so the very agent that raised a request could approve it, which makes
// "human in the loop" decorative. They now need a credential the agent does not
// hold:
//   MNEMOPAY_APPROVER_TOKEN set  -> caller must present it (arg `_approverToken`,
//                                   or `X-MnemoPay-Approver-Token` on the REST API).
//   unset                        -> the approval tools are DISABLED (fail closed),
//                                   unless MNEMOPAY_ALLOW_SELF_APPROVAL=1 is set to
//                                   knowingly keep the old single-user behaviour.
// Give the token to the human-facing client only, never to the agent runtime.
export function requireApprover(args: Record<string, any>): void {
  const token = process.env.MNEMOPAY_APPROVER_TOKEN;
  if (token) {
    const provided = typeof args?._approverToken === "string" ? args._approverToken : "";
    if (!constantTimeEqual(provided, token)) {
      throw new Error("Approver authorization required: a valid approver token is needed for approval tools");
    }
    return;
  }
  if (process.env.MNEMOPAY_ALLOW_SELF_APPROVAL === "1") return;
  throw new Error(
    "Approval tools are disabled: set MNEMOPAY_APPROVER_TOKEN (and give it only to the human approver) " +
    "or MNEMOPAY_ALLOW_SELF_APPROVAL=1 to let the calling agent approve its own requests",
  );
}

export class AgentRegistry {
  private readonly cache = new Map<string, Agent>();
  /** Cap the number of distinct tenant agents held in-process (DoS guard). */
  static readonly MAX_TENANTS = 10_000;

  constructor(private readonly bootAgent: Agent) {}

  /** The process boot agent (fallback when no per-request identity is given). */
  get boot(): Agent {
    return this.bootAgent;
  }

  /**
   * Resolve the agent for a request. `requestedAgentId` is the value from the
   * `X-MnemoPay-Agent` header / `_agentId` param. Empty/undefined → boot agent.
   * A request id equal to the boot agent's id also returns the boot agent (so
   * the boot wallet is never duplicated).
   */
  resolve(requestedAgentId?: string | null): Agent {
    const id = (requestedAgentId ?? "").trim();
    if (!id) return this.bootAgent;
    if (id === (this.bootAgent as any).agentId) return this.bootAgent;
    if (!isValidTenantAgentId(id)) {
      throw new Error("Invalid X-MnemoPay-Agent id");
    }
    let agent = this.cache.get(id);
    if (!agent) {
      if (this.cache.size >= AgentRegistry.MAX_TENANTS) {
        throw new Error("Too many tenant agents in-process");
      }
      agent = buildAgentFor(id);
      this.cache.set(id, agent);
    }
    return agent;
  }

  tenantIds(): string[] {
    return [...this.cache.keys()];
  }
}

// ─── Client IP for rate limiting (audit D3) ──────────────────────────────────
/**
 * Identify the client WITHOUT trusting client-supplied headers. The leftmost
 * X-Forwarded-For entry (and X-Real-IP) are whatever the client wrote, so
 * keying rate limits on them let anyone choose a fresh bucket per request.
 * Each trusted proxy appends the address it saw, so the believable entry is
 * counted from the RIGHT: with N trusted hops it is XFF[len - N].
 *   MNEMOPAY_TRUSTED_PROXY_HOPS   proxies in front of us that append to XFF
 *                                 (default 1; 0 = ignore XFF, use the socket).
 *   MNEMOPAY_TRUST_FLY_CLIENT_IP=1 honour `fly-client-ip` (only safe when Fly's
 *                                 edge is the sole way in; spoofable elsewhere).
 */
export function clientIpFromRequest(req: any, opts: { trustedProxyHops?: number; trustFlyClientIp?: boolean } = {}): string {
  const rawHops = opts.trustedProxyHops ?? process.env.MNEMOPAY_TRUSTED_PROXY_HOPS;
  const parsed = rawHops === undefined || rawHops === "" ? 1 : Number.parseInt(String(rawHops), 10);
  const hops = Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
  const trustFly = opts.trustFlyClientIp ?? process.env.MNEMOPAY_TRUST_FLY_CLIENT_IP === "1";
  const headers = req?.headers || {};
  if (trustFly) {
    const fly = String(headers["fly-client-ip"] || "").trim();
    if (fly) return fly;
  }
  if (hops > 0) {
    const raw = headers["x-forwarded-for"];
    const parts = String(Array.isArray(raw) ? raw.join(",") : raw || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= hops) return parts[parts.length - hops];
  }
  return req?.socket?.remoteAddress || "unknown";
}

// ─── Tenant API-key store (self-serve provisioning) ──────────────────────────
//
// The multi-tenant AgentRegistry above already scopes wallet/ledger/memory by
// agent id (the `X-MnemoPay-Agent` header). What it does NOT do is decide WHO is
// allowed to act as a given tenant — that gate lived entirely in the BizSuite
// portal (`/portal/verify-key`). For self-serve sign-up that is the broken link:
// the site emails a customer an `mp_…` key the substrate never minted and cannot
// validate, so the very first charge 403s.
//
// TenantKeyStore closes that loop WITHOUT inventing a parallel tenancy system:
// it is a thin authn layer that maps an opaque API key → an existing tenant
// agent id. The wallet itself is still the AgentRegistry's per-agent
// MnemoPayLite. A key is provisioned by the guarded `/tenant/provision` route
// and persisted as a salted SHA-256 hash (never the raw key) to
// `${persistDir}/tenant-keys.json`, alongside the per-tenant `${agentId}.json`
// wallet files. On every `/api/*` request the key is looked up here; a hit
// authenticates the caller AND resolves the acting agent id, so the emitted key
// authenticates subsequent /api/charge calls for exactly that tenant's wallet.
//
// Backward-compatible: when no tenant key matches, auth falls through to the
// existing portal check / Bearer MNEMOPAY_MCP_TOKEN path unchanged.

interface TenantKeyRecord {
  /** SHA-256(salt + apiKey), hex. The raw key is never stored. */
  keyHash: string;
  agentId: string;
  plan?: string;
  email?: string;
  createdAt: string;
  /** Set when a key is revoked; lookups then miss. */
  revokedAt?: string;
}

interface TenantKeyStoreFile {
  version: 1;
  /** Per-store random salt so a leaked file can't be rainbow-tabled offline. */
  salt: string;
  records: TenantKeyRecord[];
}

export class TenantKeyStore {
  private file: TenantKeyStoreFile;
  private readonly path: string | null;

  /** @param dir directory to persist `tenant-keys.json` into, or null for in-memory only (tests). */
  constructor(dir: string | null) {
    this.path = dir ? require("path").join(dir, "tenant-keys.json") : null;
    this.file = this.load();
  }

  private load(): TenantKeyStoreFile {
    if (this.path && fs.existsSync(this.path)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.path, "utf8")) as TenantKeyStoreFile;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.records) && typeof parsed.salt === "string") {
          return parsed;
        }
        console.error("[mnemopay-mcp] tenant-keys.json malformed — starting a fresh store");
      } catch (err: any) {
        console.error(`[mnemopay-mcp] failed to read tenant-keys.json (${err?.message || err}); starting fresh`);
      }
    }
    return { version: 1, salt: require("crypto").randomBytes(16).toString("hex"), records: [] };
  }

  private persist(): void {
    if (!this.path) return;
    try {
      fs.mkdirSync(require("path").dirname(this.path), { recursive: true });
      // Write-then-rename for crash-safety; keys file is small so this is cheap.
      const tmp = `${this.path}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.file, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.path);
    } catch (err: any) {
      console.error(`[mnemopay-mcp] failed to persist tenant-keys.json: ${err?.message || err}`);
    }
  }

  private hash(apiKey: string): string {
    return require("crypto").createHash("sha256").update(this.file.salt + apiKey).digest("hex");
  }

  /** Number of active (non-revoked) keys — for diagnostics/tests. */
  size(): number {
    return this.file.records.filter(r => !r.revokedAt).length;
  }

  /**
   * Look up the tenant a key authenticates as. Constant-time over all stored
   * hashes so a present/absent key can't be timed apart. Returns null on miss
   * or if the matched key is revoked.
   */
  lookup(apiKey: string): TenantKeyRecord | null {
    if (!apiKey) return null;
    const h = this.hash(apiKey);
    let match: TenantKeyRecord | null = null;
    for (const rec of this.file.records) {
      // constantTimeEqual short-circuits on length mismatch but both are 64-hex.
      if (constantTimeEqual(rec.keyHash, h) && !rec.revokedAt) match = rec;
    }
    return match;
  }

  /** First active record for an agent id, or null. */
  private activeForAgent(agentId: string): TenantKeyRecord | null {
    return this.file.records.find(r => r.agentId === agentId && !r.revokedAt) || null;
  }

  /**
   * Mint (or idempotently return) a working API key for a tenant.
   *
   * Idempotency: provisioning is driven by a Stripe webhook that can fire more
   * than once for the same checkout. The caller derives a STABLE agentId from
   * (email, plan); if that agent already has an active key we return the SAME
   * key rather than minting a second one — so webhook retries never email a
   * second, divergent key or orphan a wallet. The raw key is only knowable at
   * first mint, so on the idempotent path `apiKey` is returned as null and the
   * caller relies on its own persisted copy (e.g. Stripe session metadata).
   *
   * @param mode "test" | "live" — chooses the key prefix (mp_test_ / mp_live_).
   */
  mint(opts: { agentId: string; plan?: string; email?: string; mode: "test" | "live" }): {
    agentId: string;
    apiKey: string | null;
    created: boolean;
  } {
    const { agentId, plan, email, mode } = opts;
    if (!isValidTenantAgentId(agentId)) {
      throw new Error("Invalid tenant agentId");
    }
    const existing = this.activeForAgent(agentId);
    if (existing) {
      return { agentId, apiKey: null, created: false };
    }
    const prefix = mode === "live" ? "mp_live_" : "mp_test_";
    const apiKey = prefix + require("crypto").randomBytes(32).toString("hex");
    this.file.records.push({
      keyHash: this.hash(apiKey),
      agentId,
      plan,
      email,
      createdAt: new Date().toISOString(),
    });
    this.persist();
    return { agentId, apiKey, created: true };
  }

  /** Revoke every active key for an agent id. Returns count revoked. */
  revokeAgent(agentId: string): number {
    let n = 0;
    const now = new Date().toISOString();
    for (const rec of this.file.records) {
      if (rec.agentId === agentId && !rec.revokedAt) {
        rec.revokedAt = now;
        n++;
      }
    }
    if (n) this.persist();
    return n;
  }
}

/**
 * Pull the per-request acting agent id out of MCP tool-call args. On the direct
 * MCP path the calling tenant supplies an optional `_agentId` arg; on the
 * REST/HTTP path it arrives as the `X-MnemoPay-Agent` header (resolved before
 * this is reached). Returns undefined when no id was supplied so the boot agent
 * is used — keeping single-tenant callers byte-for-byte unchanged.
 */
export function agentIdFromArgs(args: Record<string, any> | undefined): string | undefined {
  const id = args && typeof args._agentId === "string" ? args._agentId.trim() : "";
  return id || undefined;
}

/**
 * Which tenant may this caller act as? (audit S1 follow-up)
 *
 * A tenant API key PINS the tenant. But the `X-MnemoPay-Agent` header / `_agentId`
 * arg also selects a tenant, and with no MNEMOPAY_MCP_TOKEN a caller could skip
 * the key entirely and name any tenant. Choosing a tenant other than the boot
 * agent therefore needs a credential: a pinning tenant key (`pinned`), or a
 * `credentialed` caller (operator bearer token verified, or a valid portal key).
 * `allowAnonymous` (MNEMOPAY_ALLOW_ANON_TENANT_SELECTION=1) restores the old open behaviour.
 * Returns the id to hand to AgentRegistry.resolve().
 */
export function authorizeTenantSelection(opts: {
  requested?: string | null;
  bootId: string;
  pinned?: string;
  credentialed: boolean;
  allowAnonymous?: boolean;
}): string | undefined {
  if (opts.pinned) return opts.pinned;
  const requested = (opts.requested ?? "").trim();
  if (!requested) return undefined;
  if (requested === opts.bootId || opts.credentialed || opts.allowAnonymous) return requested;
  throw new Error("Tenant selection requires a tenant API key or the operator token");
}

const anonTenantSelectionAllowed = (): boolean => process.env.MNEMOPAY_ALLOW_ANON_TENANT_SELECTION === "1";
// True only in HTTP mode with no MNEMOPAY_MCP_TOKEN: there the MCP transport has no
// caller identity at all, so `_agentId` must not reach other tenants. (stdio is a
// local trusted process; with a token set the bearer already authenticates the caller.)
let _httpAnonymous = false;

// ─── Brain bridge (read-only) ────────────────────────────────────────────────
// When MNEMOPAY_BRAIN_PATH points at a SQLite file, recall queries ALSO scan
// that corpus under the fixed agentId "brain" and merge hits into the
// response with `source: "brain"`. This is the operator-mode hook that lets a
// shared knowledge base bleed into per-agent recall without giving the agent
// write access. Disabled by default; opens lazily on first hit.

const BRAIN_AGENT_ID = "brain";
let brainAdapter: SQLiteAdapter | null = null;
let brainAdapterTried = false;

function getBrainAdapter(): SQLiteAdapter | null {
  if (brainAdapterTried) return brainAdapter;
  brainAdapterTried = true;
  const brainPath = process.env.MNEMOPAY_BRAIN_PATH;
  if (!brainPath) return null;
  try {
    if (!fs.existsSync(brainPath)) {
      console.error(
        `[mnemopay-mcp] MNEMOPAY_BRAIN_PATH=${brainPath} does not exist; brain bridge disabled.`,
      );
      return null;
    }
    brainAdapter = new SQLiteAdapter({ dbPath: brainPath, readOnly: true });
    console.error(`[mnemopay-mcp] Brain bridge enabled (read-only): ${brainPath}`);
    return brainAdapter;
  } catch (err: any) {
    console.error(
      `[mnemopay-mcp] Failed to open brain bridge at ${brainPath}: ${err?.message || err}`,
    );
    return null;
  }
}

// ─── Tool group registry ────────────────────────────────────────────────────
// Users select tool groups via --tools=<csv> or MNEMOPAY_TOOLS env var to
// control MCP context weight. Default = "essentials" (~1K tokens instead of ~3.8K).

const TOOL_GROUPS: Record<string, string[]> = {
  memory: ["remember", "recall", "forget", "reinforce", "consolidate"],
  wallet: ["balance", "profile", "history", "logs"],
  tx: ["charge", "settle", "refund", "dispute", "receipt_get"],
  commerce: [
    "shop_set_mandate", "shop_search", "shop_buy",
    "shop_confirm_delivery", "shop_orders", "shop_checkout",
  ],
  hitl: [
    "shop_pending_approvals", "shop_approve", "shop_reject",
    "charge_request", "charge_approve", "charge_reject",
  ],
  payments: [
    "payment_method_add", "payment_method_list", "payment_method_remove",
    "payout_create", "payout_status",
  ],
  webhooks: ["webhook_register", "webhook_list"],
  fico: [
    "agent_fico_score", "behavioral_analysis",
    "anomaly_check", "fraud_stats", "reputation",
  ],
  security: ["memory_integrity_check", "history_export"],
  governance: [
    "charter_validate",
    "policy_lint", "policy_set", "policy_evaluate", "risk_classify",
    "action_begin", "action_update", "action_end", "action_list",
    "audit_bundle_export", "audit_bundle_verify",
  ],
  identity: [
    "identity_create", "identity_get",
    "capability_issue", "capability_validate", "capability_list", "capability_revoke",
    "identity_killswitch",
  ],
  skills: ["skill_policy_preview", "skill_run_plan"],
  spatial: ["spatial_evidence_verify", "spatial_evidence_attach", "spatial_audit_export"],
  agent_os: [
    "agent_os_job_create", "agent_os_jobs", "agent_os_job_retry", "agent_os_job_cancel",
    "agent_os_alerts", "agent_os_usage", "agent_os_audit_export",
  ],
  organization_admin: [
    "organization_get", "organization_members", "organization_member_add", "organization_member_update",
    "organization_member_remove", "organization_invitations", "organization_invite", "organization_invite_revoke",
    "organization_policies", "organization_policy_create", "organization_policy_update", "organization_policy_delete",
    "organization_agents", "organization_agent_create", "organization_agent_update", "organization_agent_delete",
    "organization_limits_update",
  ],
  operator: [
    "operator_processes", "operator_process_get", "operator_process_pause", "operator_process_resume",
    "operator_process_estop", "operator_approvals", "operator_approval_decide", "operator_activity",
  ],
};

const GROUP_ALIASES: Record<string, string[]> = {
  essentials: ["memory", "wallet", "tx"],
  agent: ["memory", "wallet", "tx", "commerce", "hitl", "payments", "webhooks", "governance", "identity", "skills", "spatial", "agent_os"],
  all: Object.keys(TOOL_GROUPS),
};

function resolveToolFilter(spec: string | undefined): Set<string> {
  const raw = (spec ?? "essentials").trim().toLowerCase();
  if (!raw) return new Set(TOOL_GROUPS.memory.concat(TOOL_GROUPS.wallet, TOOL_GROUPS.tx));
  const requested = raw.split(",").map(s => s.trim()).filter(Boolean);
  const allowed = new Set<string>();
  for (const token of requested) {
    if (GROUP_ALIASES[token]) {
      for (const g of GROUP_ALIASES[token]) TOOL_GROUPS[g].forEach(t => allowed.add(t));
    } else if (TOOL_GROUPS[token]) {
      TOOL_GROUPS[token].forEach(t => allowed.add(t));
    } else {
      console.error(`[mnemopay-mcp] Unknown tool group: "${token}" (ignored). Valid: ${[...Object.keys(GROUP_ALIASES), ...Object.keys(TOOL_GROUPS)].join(", ")}`);
    }
  }
  if (allowed.size === 0) {
    GROUP_ALIASES.essentials.forEach(g => TOOL_GROUPS[g].forEach(t => allowed.add(t)));
  }
  return allowed;
}

function getToolFilterSpec(argv: string[]): string | undefined {
  const flagEq = argv.find(a => a.startsWith("--tools="));
  if (flagEq) return flagEq.slice("--tools=".length);
  const flagIdx = argv.indexOf("--tools");
  if (flagIdx !== -1 && argv[flagIdx + 1]) return argv[flagIdx + 1];
  return process.env.MNEMOPAY_TOOLS;
}

// ─── Guide resources ────────────────────────────────────────────────────────
// Tutorial prose that used to live in tool descriptions. Agents read these
// on demand via resources/read when they need the full context. This keeps
// tools/list lean (invocation signatures only).

const GUIDES: Record<string, { name: string; description: string; body: string }> = {
  "guide/tx": {
    name: "Guide: Transactions",
    description: "charge / settle / refund mechanics, reputation effects, dispute window",
    body: [
      "# Transactions",
      "",
      "**charge(amount, reason)** — opens an escrow held pending settlement.",
      "- Max charge = $500 × agent reputation. Call only AFTER delivering value.",
      "- Returns a txId for later settle/refund/dispute.",
      "",
      "**settle(txId, counterpartyId?)** — finalizes the escrow:",
      "- Moves funds to the agent wallet.",
      "- Boosts reputation +0.01.",
      "- Reinforces recently-accessed memories +0.05 (the learning feedback loop).",
      "- If `requireCounterparty` is enabled for this agent, a *different* agent ID must confirm.",
      "",
      "**refund(txId)** — reverses a transaction:",
      "- If already settled, withdraws funds and docks reputation -0.05.",
      "- Recovery cost: ~5 successful settlements to earn back a refund.",
      "",
      "**dispute(txId, reason)** — opens a dispute inside the 24h window. Freezes the tx until resolved.",
    ].join("\n"),
  },
  "guide/commerce": {
    name: "Guide: Commerce",
    description: "Shopping mandates, escrow-backed purchase, delivery confirmation",
    body: [
      "# Commerce",
      "",
      "The commerce flow is mandate-gated — the agent cannot buy anything without a mandate",
      "issued by the user. The mandate protects the user's money.",
      "",
      "## 1. shop_set_mandate",
      "Required first call. Defines:",
      "- `budget` (USD, total cap)",
      "- `maxPerItem` (defaults to budget)",
      "- `categories` / `blockedCategories`",
      "- `allowedMerchants` (merchant domain allow-list)",
      "- `approvalThreshold` — purchases above this require HITL approval",
      "- `issuedBy` — user name or ID who authorized the mandate (audit trail)",
      "",
      "## 2. shop_search(query, filters)",
      "Searches within the active mandate. Considers agent memory for past preferences.",
      "",
      "## 3. shop_buy(productId)",
      "Escrows funds — money is NOT released until `shop_confirm_delivery`. If the",
      "purchase fails at the provider level, escrow is automatically refunded.",
      "",
      "## 4. shop_confirm_delivery(orderId)",
      "Releases escrow to the merchant. Call only when the user confirms physical receipt.",
      "",
      "Use `shop_orders` to view status and remaining budget at any time.",
    ].join("\n"),
  },
  "guide/hitl": {
    name: "Guide: Human-in-the-loop",
    description: "Approval queues for purchases and charge requests",
    body: [
      "# Human-in-the-loop (HITL)",
      "",
      "Two approval queues run in parallel:",
      "",
      "## Shop approvals",
      "Triggered when a purchase exceeds `approvalThreshold` in the shopping mandate.",
      "- `shop_pending_approvals` — list items awaiting review",
      "- `shop_approve(orderId)` — escrow funds + execute",
      "- `shop_reject(orderId)` — cancel, no funds move",
      "- Items expire after 10 minutes.",
      "",
      "## Charge request approvals",
      "Unlike `charge()` (which runs immediately), `charge_request()` queues the",
      "payment for the user to review.",
      "- `charge_request(amount, reason)` — returns a requestId",
      "- `charge_approve(requestId)` — executes the real charge",
      "- `charge_reject(requestId)` — drops it, no money moves",
    ].join("\n"),
  },
  "guide/fico": {
    name: "Guide: Agent FICO & behavioral finance",
    description: "Credit score model, behavioral analysis, anomaly detection",
    body: [
      "# Agent FICO (300-850)",
      "",
      "Computed from five factors:",
      "1. Payment history (35%) — settlement rate, on-time rate",
      "2. Credit utilization (30%) — outstanding escrows vs budget cap",
      "3. Account age (15%) — time since agent creation",
      "4. Behavior diversity (10%) — variety of merchants/categories",
      "5. Fraud record (10%) — flags, disputes lost, warnings",
      "",
      "Returns: `score`, `rating` (Exceptional/Very Good/Good/Fair/Poor), `feeRate`,",
      "`trustLevel`, and `hitlRequired` (forces approval queues below threshold).",
      "",
      "# behavioral_analysis(amount, ...)",
      "",
      "Applies prospect theory (Kahneman & Tversky 1992) and mental accounting",
      "(Thaler & Benartzi 2004). Returns:",
      "- Prospect theory value function output",
      "- Cooling-off recommendation (delay in hours) based on monthlyIncome ratio",
      "- Loss framing vs an active savings goal if provided",
      "",
      "# anomaly_check(amount)",
      "",
      "EWMA streaming detector (Roberts 1959, Lucas & Saccucci 1990). Returns",
      "`normal` / `warning` / `critical`. Call inline before executing large charges.",
    ].join("\n"),
  },
  "guide/webhooks": {
    name: "Guide: Webhooks",
    description: "Event types and payload format for webhook_register",
    body: [
      "# Webhooks",
      "",
      "`webhook_register(url, events)` subscribes a callback URL to lifecycle events.",
      "Subscriptions are persisted to SQLite; the delivery loop drains pending",
      "deliveries every ~2s with exponential backoff (1s, 2s, 4s, 8s, 16s, 32s)",
      "up to 6 attempts before the delivery is marked `dead`.",
      "",
      "Event types:",
      "- `charge.success` — charge accepted into escrow",
      "- `charge.failed`  — charge rejected (reputation cap, fraud, mandate breach)",
      "- `settle`         — escrow released, funds moved",
      "- `refund`         — transaction reversed",
      "- `transfer.success` — Paystack payout completed",
      "- `transfer.failed`  — Paystack payout failed",
      "- `*` — subscribe to all events",
      "",
      "Payloads are JSON with `event`, `timestamp` (ms), and event-specific fields.",
      "",
      "Signature: each POST carries `X-MnemoPay-Signature: t=<unix-seconds>,v1=<hex>`",
      "where `v1 = HMAC-SHA256(secret, t + '.' + body)`. Reject requests where",
      "`now - t > 300s` to defend against replay. The signing secret is returned",
      "ONCE from `webhook_register` — store it before the call returns.",
    ].join("\n"),
  },
  "guide/checkout": {
    name: "Guide: Browser checkout executor",
    description: "Buyer profile env vars and merchant support for shop_checkout",
    body: [
      "# shop_checkout",
      "",
      "Browser-automates a real purchase on a merchant website: navigates to the",
      "product URL, adds to cart, fills shipping/payment, submits.",
      "",
      "## Supported merchants",
      "- **Shopify** — native detection, optimized selectors",
      "- **Other** — falls back to a generic checkout heuristic",
      "",
      "## Required env (buyer profile)",
      "Set these before calling `shop_checkout`:",
      "- `MNEMOPAY_BUYER_EMAIL`",
      "- `MNEMOPAY_BUYER_NAME`",
      "- `MNEMOPAY_BUYER_ADDRESS1`, `MNEMOPAY_BUYER_CITY`, `MNEMOPAY_BUYER_STATE`, `MNEMOPAY_BUYER_ZIP`, `MNEMOPAY_BUYER_COUNTRY`",
      "- `MNEMOPAY_BUYER_CARD_NUMBER`, `MNEMOPAY_BUYER_CARD_EXP`, `MNEMOPAY_BUYER_CARD_CVC`",
      "",
      "## Options",
      "- `headless` (default true) — set false to watch the run",
      "- `screenshotDir` — save debug screenshots at each checkout step",
    ].join("\n"),
  },
};

// ─── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "remember",
    description:
      "Store a memory persisted across sessions. Importance auto-scored if omitted.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "What to remember", maxLength: 100000 },
        importance: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Importance score (0-1). Auto-scored if omitted.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for categorization",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "recall",
    description:
      "Recall top memories. Semantic search if query provided, else importance-ranked.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Semantic search query (optional). When provided, returns memories most similar to this query.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 50,
          default: 5,
          description: "Number of memories to recall (default: 5)",
        },
      },
    },
  },
  {
    name: "forget",
    description: "Permanently delete a memory by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Memory ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "reinforce",
    description: "Boost a memory's importance after it yielded a good outcome.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Memory ID to reinforce" },
        boost: {
          type: "number",
          minimum: 0.01,
          maximum: 0.5,
          default: 0.1,
          description: "Importance boost (default: 0.1)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "consolidate",
    description: "Prune stale memories below the decay threshold.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "charge",
    description:
      "Create an escrow charge for delivered work. Max = $500 × reputation. See mnemopay://guide/tx.",
    inputSchema: {
      type: "object" as const,
      properties: {
        amount: {
          type: "number",
          minimum: 0.01,
          maximum: 500,
          description: "Amount in USD",
        },
        reason: {
          type: "string",
          minLength: 5,
          description: "Clear description of value delivered",
        },
      },
      required: ["amount", "reason"],
    },
  },
  {
    name: "settle",
    description:
      "Finalize a pending escrow. Releases funds, +0.01 reputation. See mnemopay://guide/tx.",
    inputSchema: {
      type: "object" as const,
      properties: {
        txId: { type: "string", description: "Transaction ID from charge" },
        counterpartyId: { type: "string", description: "Counter-party agent ID (required when requireCounterparty is enabled)" },
      },
      required: ["txId"],
    },
  },
  {
    name: "refund",
    description: "Refund a transaction. Docks reputation -0.05 if already settled.",
    inputSchema: {
      type: "object" as const,
      properties: {
        txId: { type: "string", description: "Transaction ID to refund" },
      },
      required: ["txId"],
    },
  },
  {
    name: "balance",
    description: "Check wallet balance and reputation score.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "profile",
    description: "Agent stats: reputation, wallet, memory count, tx count.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "logs",
    description: "Audit trail of memory and payment actions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", default: 20, description: "Number of entries" },
      },
    },
  },
  {
    name: "history",
    description: "Transaction history, most recent first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", default: 10, description: "Number of transactions" },
      },
    },
  },
  {
    name: "reputation",
    description: "Reputation report: score, tier, settlement rate, memory stats.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "dispute",
    description: "Dispute a settled tx within 24h window. Freezes it pending resolution.",
    inputSchema: {
      type: "object" as const,
      properties: {
        txId: { type: "string", description: "Transaction ID to dispute" },
        reason: { type: "string", minLength: 10, description: "Detailed reason for the dispute" },
      },
      required: ["txId", "reason"],
    },
  },
  {
    name: "fraud_stats",
    description: "Fraud stats: tracked/flagged/blocked agents, open disputes, fees.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  // ── Commerce tools ───────────────────────────────────────────────────
  {
    name: "shop_set_mandate",
    description:
      "Set shopping mandate (budget + restrictions). Required before shop_search/buy. See mnemopay://guide/commerce.",
    inputSchema: {
      type: "object" as const,
      properties: {
        budget: { type: "number", minimum: 0.01, description: "Total budget in USD" },
        maxPerItem: { type: "number", description: "Max spend per item (defaults to budget)" },
        categories: { type: "array", items: { type: "string" }, description: "Allowed categories (empty = any)" },
        blockedCategories: { type: "array", items: { type: "string" }, description: "Blocked categories" },
        allowedMerchants: { type: "array", items: { type: "string" }, description: "Allowed merchant domains" },
        approvalThreshold: { type: "number", description: "Purchases above this amount require user confirmation" },
        issuedBy: { type: "string", description: "Who authorized this mandate (user name or ID)" },
      },
      required: ["budget", "issuedBy"],
    },
  },
  {
    name: "shop_search",
    description: "Search products within the active mandate (budget/category/merchant filtered).",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "What to search for (e.g. 'USB-C cable under $15')" },
        maxPrice: { type: "number", description: "Maximum price filter" },
        category: { type: "string", description: "Category filter" },
        sortBy: { type: "string", enum: ["price_asc", "price_desc", "rating", "relevance"], description: "Sort order" },
        limit: { type: "number", minimum: 1, maximum: 20, description: "Max results (default: 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "shop_buy",
    description: "Purchase a product. Funds held in escrow until shop_confirm_delivery.",
    inputSchema: {
      type: "object" as const,
      properties: {
        productId: { type: "string", description: "Product ID from search results" },
        deliveryInstructions: { type: "string", description: "Shipping address or delivery notes" },
      },
      required: ["productId"],
    },
  },
  {
    name: "shop_confirm_delivery",
    description: "Confirm delivery and release escrow to the merchant.",
    inputSchema: {
      type: "object" as const,
      properties: {
        orderId: { type: "string", description: "Order ID to confirm delivery for" },
      },
      required: ["orderId"],
    },
  },
  {
    name: "shop_orders",
    description: "List orders with status, remaining budget, and purchase history.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", description: "Filter by status: purchased, delivered, cancelled" },
      },
    },
  },
  // ── Approval / HITL tools ──────────────────────────────────────────────────
  {
    name: "shop_pending_approvals",
    description: "List purchases/charges pending approval. Expire in 10 min.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "shop_approve",
    description: "Approve a pending purchase. Escrows funds and executes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        orderId: { type: "string", description: "Order ID from shop_pending_approvals" },
      },
      required: ["orderId"],
    },
  },
  {
    name: "shop_reject",
    description: "Reject a pending purchase. Order cancelled, no funds move.",
    inputSchema: {
      type: "object" as const,
      properties: {
        orderId: { type: "string", description: "Order ID to reject" },
      },
      required: ["orderId"],
    },
  },
  {
    name: "charge_request",
    description: "Queue a charge for user approval. Finalize via charge_approve/reject.",
    inputSchema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "Amount in USD" },
        reason: { type: "string", description: "Why the charge is needed" },
      },
      required: ["amount", "reason"],
    },
  },
  {
    name: "charge_approve",
    description: "Approve a pending charge request and execute it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        requestId: { type: "string", description: "Request ID from charge_request" },
      },
      required: ["requestId"],
    },
  },
  {
    name: "charge_reject",
    description: "Reject a pending charge request.",
    inputSchema: {
      type: "object" as const,
      properties: {
        requestId: { type: "string", description: "Request ID to reject" },
      },
      required: ["requestId"],
    },
  },
  // ── Payment method management ─────────────────────────────────────────────
  {
    name: "payment_method_add",
    description: "Create Stripe customer + SetupIntent. Returns client_secret. Stripe rail only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        email: { type: "string", description: "Customer email" },
        name: { type: "string", description: "Customer name (optional)" },
      },
      required: ["email"],
    },
  },
  {
    name: "payment_method_list",
    description: "List saved payment methods for a Stripe customer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        customerId: { type: "string", description: "Stripe customer ID (cus_...)" },
      },
      required: ["customerId"],
    },
  },
  {
    name: "payment_method_remove",
    description: "Detach a payment method from a Stripe customer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        paymentMethodId: { type: "string", description: "Payment method ID (pm_...)" },
      },
      required: ["paymentMethodId"],
    },
  },
  // ── Payouts (Paystack) ─────────────────────────────────────────────────────
  {
    name: "payout_create",
    description: "Initiate a Paystack bank payout (creates recipient + transfer). Paystack rail only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        accountName: { type: "string", description: "Recipient's name" },
        accountNumber: { type: "string", description: "Bank account number" },
        bankCode: { type: "string", description: "Bank code (e.g., '058' for GTBank)" },
        amount: { type: "number", description: "Amount in NGN" },
        reason: { type: "string", description: "Reason for the transfer" },
      },
      required: ["accountName", "accountNumber", "bankCode", "amount", "reason"],
    },
  },
  {
    name: "payout_status",
    description: "Check Paystack payout status by transfer code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transferCode: { type: "string", description: "Transfer code from payout_create (e.g., TRF_...)" },
      },
      required: ["transferCode"],
    },
  },
  // ── Webhooks ──────────────────────────────────────────────────────────────
  {
    name: "webhook_register",
    description: "Register a webhook URL for payment events. See mnemopay://guide/webhooks for event types.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "Callback URL to receive events" },
        events: {
          type: "array",
          items: { type: "string" },
          description: "Event types to subscribe to: charge.success, charge.failed, settle, refund, transfer.success, transfer.failed",
        },
      },
      required: ["url", "events"],
    },
  },
  {
    name: "webhook_list",
    description: "List registered webhook subscriptions.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  // ── Receipts & Export ─────────────────────────────────────────────────────
  {
    name: "receipt_get",
    description: "Get a formatted receipt for a transaction.",
    inputSchema: {
      type: "object" as const,
      properties: {
        txId: { type: "string", description: "Transaction ID" },
      },
      required: ["txId"],
    },
  },
  {
    name: "history_export",
    description: "Export full tx history as JSON or CSV.",
    inputSchema: {
      type: "object" as const,
      properties: {
        format: { type: "string", enum: ["json", "csv"], description: "Export format (default: json)" },
        limit: { type: "number", description: "Max transactions (default: all)" },
      },
    },
  },
  // ── Agent FICO ─────────────────────────────────────────────────────────────
  {
    name: "agent_fico_score",
    description:
      "Compute Agent FICO score (300-850). Returns score, tier, fee rate. See mnemopay://guide/fico.",
    inputSchema: {
      type: "object" as const,
      properties: {
        budgetCap: {
          type: "number",
          minimum: 1,
          description: "Agent's budget cap for utilization calculation (default: 10000)",
        },
        fraudFlags: { type: "number", minimum: 0, description: "Number of fraud flags (default: 0)" },
        disputeCount: { type: "number", minimum: 0, description: "Total disputes filed (default: 0)" },
        disputesLost: { type: "number", minimum: 0, description: "Disputes lost (default: 0)" },
        warnings: { type: "number", minimum: 0, description: "Fraud warnings (default: 0)" },
      },
    },
  },
  // ── Behavioral Finance ─────────────────────────────────────────────────────
  {
    name: "behavioral_analysis",
    description:
      "Analyze a spending amount (prospect theory, cooling-off, loss framing). See mnemopay://guide/fico.",
    inputSchema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "The spending amount to analyze" },
        monthlyIncome: {
          type: "number",
          minimum: 1,
          description: "Agent's monthly income/budget for cooling-off calculation",
        },
        goalName: { type: "string", description: "Savings goal name for loss framing" },
        goalTarget: { type: "number", description: "Savings goal target amount" },
        goalCurrent: { type: "number", description: "Current savings toward goal" },
        goalMonthlySavings: { type: "number", description: "Monthly savings rate" },
      },
      required: ["amount"],
    },
  },
  // ── Memory Integrity ───────────────────────────────────────────────────────
  {
    name: "memory_integrity_check",
    description:
      "SHA-256 Merkle integrity check over memories. Returns root hash, leaf count, tamper status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        snapshotHash: {
          type: "string",
          description: "Previous snapshot hash to compare against (optional — omit for first check)",
        },
      },
    },
  },
  // ── Checkout Executor ──────────────────────────────────────────────────────
  {
    name: "shop_checkout",
    description:
      "Browser-automated checkout on a merchant URL. See mnemopay://guide/checkout for env setup.",
    inputSchema: {
      type: "object" as const,
      properties: {
        productUrl: { type: "string", description: "Full URL of the product to purchase" },
        headless: { type: "boolean", description: "Run browser in headless mode (default: true)" },
        screenshotDir: { type: "string", description: "Directory to save debug screenshots" },
      },
      required: ["productUrl"],
    },
  },
  // ── Anomaly Detection ──────────────────────────────────────────────────────
  {
    name: "anomaly_check",
    description: "EWMA streaming anomaly check on a tx amount. Returns normal/warning/critical.",
    inputSchema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "Transaction amount to check" },
      },
      required: ["amount"],
    },
  },
  // Governance and action-evidence tools
  {
    name: "charter_validate",
    description: "Validate an agent mission charter before execution.",
    inputSchema: {
      type: "object" as const,
      properties: {
        charter: { type: "object", description: "Charter object containing goal, budget, agents, and outputs" },
      },
      required: ["charter"],
    },
  },
  {
    name: "policy_lint",
    description: "Lint a governance policy for invalid, contradictory, or ineffective rules.",
    inputSchema: {
      type: "object" as const,
      properties: { policy: { type: "object", description: "MnemoPay governance policy" } },
      required: ["policy"],
    },
  },
  {
    name: "policy_set",
    description: "Set the active MCP governance policy. Uses MnemoGuard defaults when policy is omitted.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policy: { type: "object", description: "Custom MnemoPay policy" },
        approvalThresholdUsd: { type: "number", minimum: 0, description: "Default-policy approval threshold" },
        hardCapUsd: { type: "number", minimum: 0, description: "Default-policy hard cap" },
        blockTargets: { type: "array", items: { type: "string" }, description: "Targets blocked by the default policy" },
      },
    },
  },
  {
    name: "policy_evaluate",
    description: "Evaluate a proposed tool, model, HTTP, file, or payment action against the active policy.",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["tool_call", "llm_call", "http_request", "file_write", "payment"] },
        target: { type: "string" },
        estimatedUsd: { type: "number", minimum: 0 },
        argsText: { type: "string" },
        locale: { type: "string" },
      },
      required: ["kind", "target"],
    },
  },
  {
    name: "risk_classify",
    description: "Classify a proposed action as low, medium, high, or critical risk.",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["tool_call", "llm_call", "http_request", "file_write", "payment"] },
        target: { type: "string" },
        estimatedUsd: { type: "number", minimum: 0 },
        argsText: { type: "string" },
        locale: { type: "string" },
      },
      required: ["kind", "target"],
    },
  },
  {
    name: "action_begin",
    description: "Begin a typed action-ledger record before an agent acts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "string" },
        intent: { type: "string" },
        plan: { type: "string" },
        risk: { type: "string", enum: ["low", "medium", "high", "critical"] },
      },
      required: ["intent"],
    },
  },
  {
    name: "action_update",
    description: "Append tools, memories, files, sites, cost, plan, or rollback notes to an action.",
    inputSchema: {
      type: "object" as const,
      properties: {
        actionId: { type: "string" },
        toolsUsed: { type: "array", items: { type: "string" } },
        memoriesUsed: { type: "array", items: { type: "string" } },
        filesAccessed: { type: "array", items: { type: "string" } },
        sitesVisited: { type: "array", items: { type: "string" } },
        costUsd: { type: "number", minimum: 0 },
        plan: { type: "string" },
        rollback: { type: "string" },
        executing: { type: "boolean" },
      },
      required: ["actionId"],
    },
  },
  {
    name: "action_end",
    description: "Complete, fail, block, or roll back an action-ledger record.",
    inputSchema: {
      type: "object" as const,
      properties: {
        actionId: { type: "string" },
        status: { type: "string", enum: ["completed", "failed", "blocked", "rolled_back"] },
        result: { type: "string" },
        error: { type: "string" },
      },
      required: ["actionId", "status"],
    },
  },
  {
    name: "action_list",
    description: "List typed agent actions and their lifecycle evidence.",
    inputSchema: {
      type: "object" as const,
      properties: { agentId: { type: "string" } },
    },
  },
  {
    name: "audit_bundle_export",
    description: "Export the action ledger as a Merkle-rooted audit bundle.",
    inputSchema: {
      type: "object" as const,
      properties: { meta: { type: "object", description: "Optional bundle metadata" } },
    },
  },
  {
    name: "audit_bundle_verify",
    description: "Verify the Merkle root of an exported action-ledger audit bundle.",
    inputSchema: {
      type: "object" as const,
      properties: { bundle: { type: "object", description: "Bundle returned by audit_bundle_export" } },
      required: ["bundle"],
    },
  },
  // Identity and capability controls
  {
    name: "identity_create",
    description: "Create a KYA agent identity. Private key material is never returned.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "string" },
        ownerId: { type: "string" },
        ownerEmail: { type: "string" },
        displayName: { type: "string" },
        capabilities: { type: "array", items: { type: "string" } },
        ownerType: { type: "string", enum: ["individual", "organization"] },
        ownerCountry: { type: "string" },
      },
      required: ["agentId", "ownerId", "ownerEmail"],
    },
  },
  {
    name: "identity_get",
    description: "Get public KYA identity information and active capability-token count.",
    inputSchema: {
      type: "object" as const,
      properties: { agentId: { type: "string" } },
      required: ["agentId"],
    },
  },
  {
    name: "capability_issue",
    description: "Issue a scoped, expiring capability token to an existing agent identity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agentId: { type: "string" },
        permissions: { type: "array", items: { type: "string", enum: ["charge", "settle", "refund", "remember", "recall", "transfer", "subscribe", "credit", "sign", "admin"] } },
        maxAmount: { type: "number", minimum: 0 },
        maxTotalSpend: { type: "number", minimum: 0 },
        allowedCounterparties: { type: "array", items: { type: "string" } },
        allowedCategories: { type: "array", items: { type: "string" } },
        expiresInMinutes: { type: "number", minimum: 1 },
        issuedBy: { type: "string" },
      },
      required: ["agentId", "permissions"],
    },
  },
  {
    name: "capability_validate",
    description: "Validate a capability token for an action, amount, and optional counterparty.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tokenId: { type: "string" },
        action: { type: "string", enum: ["charge", "settle", "refund", "remember", "recall", "transfer", "subscribe", "credit", "sign", "admin"] },
        amount: { type: "number", minimum: 0 },
        counterpartyId: { type: "string" },
      },
      required: ["tokenId", "action"],
    },
  },
  {
    name: "capability_list",
    description: "List active capability tokens for an agent.",
    inputSchema: {
      type: "object" as const,
      properties: { agentId: { type: "string" } },
      required: ["agentId"],
    },
  },
  {
    name: "capability_revoke",
    description: "Immediately revoke one capability token.",
    inputSchema: {
      type: "object" as const,
      properties: { tokenId: { type: "string" } },
      required: ["tokenId"],
    },
  },
  {
    name: "identity_killswitch",
    description: "Emergency stop: immediately revoke every active capability token for one agent.",
    inputSchema: {
      type: "object" as const,
      properties: { agentId: { type: "string" }, reason: { type: "string" } },
      required: ["agentId", "reason"],
    },
  },
  // Governed declarative skills
  {
    name: "skill_policy_preview",
    description: "Compile and preview the policy derived from a governed skill's declared permissions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skillId: { type: "string" },
        permissions: { type: "object" },
      },
      required: ["skillId", "permissions"],
    },
  },
  {
    name: "skill_run_plan",
    description: "Run a declarative sequence of proposed actions through MnemoSkills governance without executing external side effects.",
    inputSchema: {
      type: "object" as const,
      properties: {
        skillId: { type: "string" },
        name: { type: "string" },
        purpose: { type: "string" },
        version: { type: "string" },
        owner: { type: "string" },
        permissions: { type: "object" },
        actions: { type: "array", items: { type: "object" } },
        agentId: { type: "string" },
      },
      required: ["skillId", "purpose", "permissions", "actions"],
    },
  },
  {
    name: "spatial_evidence_verify",
    description: "Validate a GridStamp spatial-proof or SPZ evidence envelope before attachment.",
    inputSchema: {
      type: "object" as const,
      properties: { evidence: { type: "object" } },
      required: ["evidence"],
    },
  },
  {
    name: "spatial_evidence_attach",
    description: "Fail-closed attachment of GridStamp evidence to MnemoPay's spatial audit chain.",
    inputSchema: {
      type: "object" as const,
      properties: { evidence: { type: "object" } },
      required: ["evidence"],
    },
  },
  {
    name: "spatial_audit_export",
    description: "Export and verify the current spatial evidence audit chain.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  // Durable Agent OS jobs and operator controls
  {
    name: "agent_os_job_create",
    description: "Submit an isolated browser, code, computer, skill, or brain job to the configured MnemoPay Agent OS gateway.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["brain.recall", "brain.remember", "browser.run", "code.run", "computer.run", "skill.run"] },
        agentId: { type: "string" },
        payload: { type: "object" },
        maxAttempts: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["type", "agentId", "payload"],
    },
  },
  {
    name: "agent_os_jobs",
    description: "List durable Agent OS jobs for the configured organization.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "agent_os_job_retry",
    description: "Retry a failed or cancelled Agent OS job.",
    inputSchema: {
      type: "object" as const,
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "agent_os_job_cancel",
    description: "Cancel a queued or running Agent OS job.",
    inputSchema: {
      type: "object" as const,
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "agent_os_alerts",
    description: "List Agent OS operational alerts for the configured organization.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "agent_os_usage",
    description: "Read organization-scoped Agent OS usage and limits.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "agent_os_audit_export",
    description: "Export the organization-scoped Agent OS audit log.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  { name: "organization_get", description: "Read the configured Agent OS organization.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "organization_members", description: "List organization members and roles.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "organization_member_add", description: "Add an organization member.", inputSchema: { type: "object" as const, properties: { identity: { type: "string" }, role: { type: "string", enum: ["owner", "admin", "operator", "approver", "viewer", "worker"] } }, required: ["identity", "role"] } },
  { name: "organization_member_update", description: "Update an organization member role.", inputSchema: { type: "object" as const, properties: { identity: { type: "string" }, role: { type: "string", enum: ["owner", "admin", "operator", "approver", "viewer", "worker"] } }, required: ["identity", "role"] } },
  { name: "organization_member_remove", description: "Remove an organization member.", inputSchema: { type: "object" as const, properties: { identity: { type: "string" } }, required: ["identity"] } },
  { name: "organization_invitations", description: "List organization invitations.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "organization_invite", description: "Invite a member to the organization.", inputSchema: { type: "object" as const, properties: { email: { type: "string" }, role: { type: "string", enum: ["admin", "operator", "approver", "viewer", "worker"] }, expiresInHours: { type: "integer", minimum: 1, maximum: 720 } }, required: ["email", "role"] } },
  { name: "organization_invite_revoke", description: "Revoke a pending organization invitation.", inputSchema: { type: "object" as const, properties: { invitationId: { type: "string" } }, required: ["invitationId"] } },
  { name: "organization_policies", description: "List organization policies.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "organization_policy_create", description: "Create an organization policy.", inputSchema: { type: "object" as const, properties: { name: { type: "string" }, rules: { type: "object" }, active: { type: "boolean" } }, required: ["name", "rules"] } },
  { name: "organization_policy_update", description: "Update an organization policy.", inputSchema: { type: "object" as const, properties: { policyId: { type: "string" }, name: { type: "string" }, rules: { type: "object" }, active: { type: "boolean" } }, required: ["policyId"] } },
  { name: "organization_policy_delete", description: "Delete an organization policy.", inputSchema: { type: "object" as const, properties: { policyId: { type: "string" } }, required: ["policyId"] } },
  { name: "organization_agents", description: "List organization agents.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "organization_agent_create", description: "Create a governed organization agent.", inputSchema: { type: "object" as const, properties: { agentId: { type: "string" }, name: { type: "string" }, monthlyBudgetUsd: { type: "number", minimum: 0 }, policyId: { type: "string" } }, required: ["agentId", "name"] } },
  { name: "organization_agent_update", description: "Update a governed organization agent.", inputSchema: { type: "object" as const, properties: { id: { type: "string" }, name: { type: "string" }, status: { type: "string", enum: ["active", "paused", "disabled"] }, monthlyBudgetUsd: { type: "number", minimum: 0 }, policyId: { type: ["string", "null"] } }, required: ["id"] } },
  { name: "organization_agent_delete", description: "Delete a governed organization agent.", inputSchema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "organization_limits_update", description: "Operator-only update of organization agent, job, and browser budget limits.", inputSchema: { type: "object" as const, properties: { agentLimit: { type: "integer", minimum: 1 }, monthlyJobLimit: { type: "integer", minimum: 1 }, monthlyBrowserBudgetUsd: { type: "number", minimum: 0 } } } },
  { name: "operator_processes", description: "List managed Agent OS processes.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "operator_process_get", description: "Read one managed Agent OS process.", inputSchema: { type: "object" as const, properties: { processId: { type: "string" } }, required: ["processId"] } },
  { name: "operator_process_pause", description: "Pause one managed Agent OS process.", inputSchema: { type: "object" as const, properties: { processId: { type: "string" } }, required: ["processId"] } },
  { name: "operator_process_resume", description: "Resume one managed Agent OS process.", inputSchema: { type: "object" as const, properties: { processId: { type: "string" } }, required: ["processId"] } },
  { name: "operator_process_estop", description: "Emergency-stop one managed Agent OS process.", inputSchema: { type: "object" as const, properties: { processId: { type: "string" } }, required: ["processId"] } },
  { name: "operator_approvals", description: "List pending Agent OS approvals.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "operator_approval_decide", description: "Approve or reject an Agent OS approval request.", inputSchema: { type: "object" as const, properties: { approvalId: { type: "string" }, decision: { type: "string", enum: ["approve", "reject"] }, decidedBy: { type: "string" }, notes: { type: "string" } }, required: ["approvalId", "decision", "decidedBy"] } },
  { name: "operator_activity", description: "List Agent OS operator activity.", inputSchema: { type: "object" as const, properties: { limit: { type: "integer", minimum: 1, maximum: 1000 }, processId: { type: "string" } } } },
];

// ─── Tool execution ─────────────────────────────────────────────────────────

export async function executeTool(agent: Agent, name: string, args: Record<string, any>): Promise<string> {
  // Per-tenant governance state (ledger, audit chain, identities/capability
  // tokens, policy, rate counter, spatial audit). Lazily created.
  const gov = tenantGovernance(agent);
  const me = tenantIdOf(agent);
  switch (name) {
    case "remember": {
      const opts: any = {};
      if (args.importance !== undefined) opts.importance = args.importance;
      if (args.tags) opts.tags = args.tags;
      const id = await agent.remember(args.content, Object.keys(opts).length ? opts : undefined);
      return JSON.stringify({ id, status: "stored" });
    }

    case "recall": {
      const limit = args.limit ?? 5;
      const memories = args.query
        ? await agent.recall(args.query, limit)
        : await agent.recall(limit);

      // Optional read-only bridge into the shared brain corpus. Only active
      // when MNEMOPAY_BRAIN_PATH is set and the file exists. The agent's own
      // memories stay primary; brain hits are appended with a source flag so
      // the caller can tell them apart.
      const brain = getBrainAdapter();
      let brainHits: Array<{ id: string; content: string; score: number; source: "brain" }> = [];
      if (brain && args.query) {
        try {
          const queryVec = localEmbed(String(args.query));
          const hits = await brain.search(BRAIN_AGENT_ID, queryVec, limit);
          brainHits = hits.map((h) => ({
            id: h.id,
            content: h.content,
            score: h.score,
            source: "brain" as const,
          }));
        } catch (err: any) {
          console.error(
            `[mnemopay-mcp] brain bridge search failed (non-fatal): ${err?.message || err}`,
          );
        }
      }

      if (memories.length === 0 && brainHits.length === 0) return "No memories found.";

      // When the brain bridge is inactive, keep the legacy text format so
      // existing consumers (and tests) don't break.
      if (brainHits.length === 0) {
        return memories
          .map((m, i) => `${i + 1}. [score:${m.score.toFixed(2)}, importance:${m.importance.toFixed(2)}] ${m.content}`)
          .join("\n");
      }

      // With brain hits in the mix, return structured JSON so the caller
      // can tell which corpus each hit came from.
      return JSON.stringify({
        agent: memories.map((m) => ({
          id: m.id,
          content: m.content,
          score: m.score,
          importance: m.importance,
          source: "agent" as const,
        })),
        brain: brainHits,
      });
    }

    case "forget": {
      const deleted = await agent.forget(args.id);
      return deleted ? `Memory ${args.id} deleted.` : `Memory ${args.id} not found.`;
    }

    case "reinforce": {
      await agent.reinforce(args.id, args.boost ?? 0.1);
      return `Memory ${args.id} reinforced by +${args.boost ?? 0.1}`;
    }

    case "consolidate": {
      const pruned = await agent.consolidate();
      return `Consolidated: pruned ${pruned} stale memories.`;
    }

    case "charge": {
      let tx;
      try {
        tx = await agent.charge(args.amount, args.reason);
      } catch (err: any) {
        fireWebhook("charge.failed", {
          amount: args.amount,
          reason: args.reason,
          error: err?.message || String(err),
          errorCode: err?.code,
          rail: (agent as any).paymentRail?.name,
          agentId: (agent as any).agentId,
        });
        throw err;
      }
      fireWebhook("charge.success", { txId: tx.id, amount: tx.amount, status: tx.status, reason: tx.reason, agentId: (agent as any).agentId });
      return JSON.stringify({ txId: tx.id, amount: tx.amount, status: tx.status, reason: tx.reason });
    }

    case "settle": {
      let tx;
      try {
        tx = await agent.settle(args.txId, args.counterpartyId);
      } catch (err: any) {
        fireWebhook("settle.failed", {
          txId: args.txId,
          counterpartyId: args.counterpartyId,
          error: err?.message || String(err),
          errorCode: err?.code,
          rail: (agent as any).paymentRail?.name,
          agentId: (agent as any).agentId,
        });
        throw err;
      }
      fireWebhook("settle", { txId: tx.id, amount: tx.amount, status: tx.status, rail: (agent as any).paymentRail?.name, agentId: (agent as any).agentId });
      return JSON.stringify({ txId: tx.id, amount: tx.amount, status: tx.status, rail: (agent as any).paymentRail?.name });
    }

    case "refund": {
      let tx;
      try {
        tx = await agent.refund(args.txId);
      } catch (err: any) {
        fireWebhook("refund.failed", {
          txId: args.txId,
          error: err?.message || String(err),
          errorCode: err?.code,
          rail: (agent as any).paymentRail?.name,
          agentId: (agent as any).agentId,
        });
        throw err;
      }
      fireWebhook("refund", { txId: tx.id, status: tx.status, agentId: (agent as any).agentId });
      return JSON.stringify({ txId: tx.id, status: tx.status });
    }

    case "balance": {
      const bal = await agent.balance();
      return `Wallet: $${bal.wallet.toFixed(2)} | Reputation: ${bal.reputation.toFixed(2)}`;
    }

    case "profile": {
      const p = await agent.profile();
      return JSON.stringify(p, null, 2);
    }

    case "logs": {
      const entries = await agent.logs(args.limit ?? 20);
      return entries.map((e) => `[${e.createdAt.toISOString()}] ${e.action}: ${JSON.stringify(e.details)}`).join("\n");
    }

    case "history": {
      const txns = await agent.history(args.limit ?? 10);
      if (txns.length === 0) return "No transactions yet.";
      return txns.map((t) => `$${t.amount.toFixed(2)} — ${t.status} — ${t.reason}`).join("\n");
    }

    case "reputation": {
      const rep = await agent.reputation();
      return JSON.stringify(rep, null, 2);
    }

    case "dispute": {
      if (!("dispute" in agent)) throw new Error("Disputes only available in quick mode");
      const d = await (agent as MnemoPayLite).dispute(args.txId, args.reason);
      return JSON.stringify({ disputeId: d.id, txId: d.txId, status: d.status, reason: d.reason });
    }

    case "fraud_stats": {
      if (!("fraud" in agent)) throw new Error("Fraud stats only available in quick mode");
      const stats = (agent as MnemoPayLite).fraud.stats();
      return JSON.stringify(stats, null, 2);
    }

    // ── Commerce tools ───────────────────────────────────────────────────

    case "shop_set_mandate": {
      const commerce = await getCommerceEngine(agent);
      commerce.setMandate({
        budget: args.budget,
        maxPerItem: args.maxPerItem,
        categories: args.categories,
        blockedCategories: args.blockedCategories,
        allowedMerchants: args.allowedMerchants,
        approvalThreshold: args.approvalThreshold,
        issuedBy: args.issuedBy,
      });
      return JSON.stringify({
        status: "mandate_set",
        budget: args.budget,
        remainingBudget: commerce.remainingBudget,
        categories: args.categories ?? "any",
      });
    }

    case "shop_search": {
      const commerce = await getCommerceEngine(agent);
      const results = await commerce.search(args.query, {
        maxPrice: args.maxPrice,
        category: args.category,
        sortBy: args.sortBy,
        limit: args.limit,
      });
      if (results.length === 0) return "No products found matching your criteria.";
      return results.map((p: any, i: number) =>
        `${i + 1}. ${p.title} — $${p.price.toFixed(2)} from ${p.merchant}` +
        (p.rating ? ` (${p.rating}★, ${p.reviewCount} reviews)` : "") +
        (p.freeShipping ? " [Free shipping]" : "") +
        `\n   ID: ${p.productId}`
      ).join("\n\n") + `\n\nRemaining budget: $${commerce.remainingBudget.toFixed(2)}`;
    }

    case "shop_buy": {
      const commerce = await getCommerceEngine(agent);
      // Look up the product by ID from a fresh search
      const product = await commerce["provider"].getProduct(args.productId);
      if (!product) throw new Error(`Product not found: ${args.productId}`);
      const order = await commerce.purchase(product, args.deliveryInstructions);
      if (order.status === "cancelled") {
        return `Order cancelled: ${order.failureReason}`;
      }

      // If using a real provider (firecrawl/shopify), the purchase may need
      // browser checkout to actually complete. Attempt it if buyer profile is configured.
      const providerName = commerce["provider"]?.name;
      if (product.url && (providerName === "firecrawl" || providerName === "shopify")) {
        try {
          const { CheckoutExecutor } = await import("../commerce/checkout/index.js");
          const { loadProfileFromEnv } = await import("../commerce/checkout/profile.js");
          const buyerProfile = loadProfileFromEnv();
          if (buyerProfile) {
            const executor = new CheckoutExecutor({ profile: buyerProfile, headless: true });
            const checkoutResult = await executor.checkout(product.url);
            if (checkoutResult.success) {
              return JSON.stringify({
                orderId: order.id,
                product: order.product.title,
                price: order.product.price,
                status: "purchased",
                escrowTxId: order.txId,
                externalOrderId: checkoutResult.orderId,
                confirmationUrl: checkoutResult.confirmationUrl,
                totalCharged: checkoutResult.totalCharged,
                message: "Purchase completed via browser checkout. Funds in escrow until delivery confirmed.",
                remainingBudget: commerce.remainingBudget,
              });
            }
          }
        } catch { /* checkout executor not available — return standard result */ }
      }

      return JSON.stringify({
        orderId: order.id,
        product: order.product.title,
        price: order.product.price,
        status: order.status,
        escrowTxId: order.txId,
        message: "Funds held in escrow. Will be released when you confirm delivery.",
        remainingBudget: commerce.remainingBudget,
      });
    }

    case "shop_confirm_delivery": {
      const commerce = await getCommerceEngine(agent);
      const order = await commerce.confirmDelivery(args.orderId);
      return JSON.stringify({
        orderId: order.id,
        product: order.product.title,
        status: order.status,
        message: "Delivery confirmed. Escrow released. Merchant paid.",
      });
    }

    case "shop_orders": {
      const commerce = await getCommerceEngine(agent);
      const orders = commerce.listOrders(args.status);
      const summary = commerce.spendingSummary();
      if (orders.length === 0) return "No orders yet.";
      const list = orders.map((o: any) =>
        `• ${o.product.title} — $${o.product.price.toFixed(2)} [${o.status}]` +
        (o.trackingUrl ? ` Track: ${o.trackingUrl}` : "")
      ).join("\n");
      return `${list}\n\nSpent: $${summary.totalSpent.toFixed(2)} | Remaining: $${summary.remainingBudget.toFixed(2)} | Orders: ${summary.orderCount}`;
    }

    // ── Approval / HITL handlers ───────────────────────────────────────────

    case "shop_pending_approvals": {
      const queue = approvalQueue();
      const shopApprovals = Array.from(queue.shopApprovals.entries())
        .filter(([, entry]) => tenantOwns(entry.tenantId, me))
        .map(([id, entry]) => ({
          orderId: id,
          product: entry.order?.product?.title,
          price: entry.order?.product?.price,
          merchant: entry.order?.product?.merchant,
          waitingSince: new Date(entry.createdAt).toISOString(),
          expiresIn: Math.max(0, Math.round((600_000 - (Date.now() - entry.createdAt)) / 1000)) + "s",
        }));
      const chargeRequests = Array.from(queue.charges.entries())
        .filter(([, entry]) => tenantOwns(entry.tenantId, me))
        .map(([id, entry]) => ({
          requestId: id,
          amount: entry.amount,
          reason: entry.reason,
          waitingSince: new Date(entry.createdAt).toISOString(),
          expiresIn: Math.max(0, Math.round((600_000 - (Date.now() - entry.createdAt)) / 1000)) + "s",
        }));
      if (shopApprovals.length === 0 && chargeRequests.length === 0) {
        return "No pending approvals.";
      }
      return JSON.stringify({ shopApprovals, chargeRequests }, null, 2);
    }

    case "shop_approve": {
      requireApprover(args);
      const queue = approvalQueue();
      const entry = queue.shopApprovals.get(args.orderId);
      // Another tenant's order is reported as missing, not as forbidden (no existence oracle).
      if (!entry || !tenantOwns(entry.tenantId, me)) throw new Error(`No pending approval for order ${args.orderId}`);
      entry.resolve(true);
      queue.removeShopApproval(args.orderId);
      return JSON.stringify({ status: "approved", orderId: args.orderId, message: "Purchase approved. Escrow and purchase executing." });
    }

    case "shop_reject": {
      requireApprover(args);
      const queue = approvalQueue();
      const entry = queue.shopApprovals.get(args.orderId);
      if (!entry || !tenantOwns(entry.tenantId, me)) throw new Error(`No pending approval for order ${args.orderId}`);
      entry.resolve(false);
      queue.removeShopApproval(args.orderId);
      return JSON.stringify({ status: "rejected", orderId: args.orderId, message: "Purchase rejected. No money moved." });
    }

    case "charge_request": {
      // Fail closed on a malformed amount before it is queued.
      if (typeof args.amount !== "number" || !Number.isFinite(args.amount) || args.amount <= 0) {
        throw new Error("Amount must be a positive finite number");
      }
      const requestId = `cr_${Date.now()}_${require("crypto").randomBytes(4).toString("hex")}`;
      approvalQueue().addCharge({
        id: requestId,
        amount: args.amount,
        reason: args.reason,
        context: args.context,
        payOptions: args.payOptions,
        createdAt: Date.now(),
        tenantId: me,
      });
      return JSON.stringify({
        requestId,
        amount: args.amount,
        reason: args.reason,
        status: "pending_approval",
        message: `Charge of $${args.amount.toFixed(2)} queued for approval. A human approver must call charge_approve("${requestId}") with the approver token.`,
        expiresIn: "10 minutes",
      });
    }

    case "charge_approve": {
      requireApprover(args);
      const queue = approvalQueue();
      const pending = queue.charges.get(args.requestId);
      if (!pending || !tenantOwns(pending.tenantId, me)) throw new Error(`No pending charge request ${args.requestId}`);
      const req = queue.removeCharge(args.requestId);
      if (!req) throw new Error(`No pending charge request ${args.requestId}`);
      // Execute the real charge
      let tx;
      try {
        tx = await agent.charge(req.amount, req.reason, req.context, req.payOptions);
      } catch (err: any) {
        fireWebhook("charge.failed", {
          amount: req.amount,
          reason: req.reason,
          hitlRequestId: args.requestId,
          error: err?.message || String(err),
          errorCode: err?.code,
          rail: (agent as any).paymentRail?.name,
          agentId: (agent as any).agentId,
        });
        throw err;
      }
      fireWebhook("charge.success", { txId: tx.id, amount: tx.amount, status: tx.status, reason: req.reason, hitlRequestId: args.requestId, agentId: (agent as any).agentId });
      return JSON.stringify({
        status: "charged",
        requestId: args.requestId,
        txId: tx.id,
        amount: tx.amount,
        reason: req.reason,
        rail: (agent as any).paymentRail?.name,
        message: "Charge executed. Funds held in escrow. Use settle() to finalize.",
      });
    }

    case "charge_reject": {
      requireApprover(args);
      const queue = approvalQueue();
      const pending = queue.charges.get(args.requestId);
      if (!pending || !tenantOwns(pending.tenantId, me)) throw new Error(`No pending charge request ${args.requestId}`);
      const req = queue.removeCharge(args.requestId);
      if (!req) throw new Error(`No pending charge request ${args.requestId}`);
      return JSON.stringify({
        status: "rejected",
        requestId: args.requestId,
        message: `Charge of $${req.amount.toFixed(2)} for "${req.reason}" rejected. No money moved.`,
      });
    }

    // ── Payment method management ─────────────────────────────────────────

    case "payment_method_add": {
      const rail = (agent as any).paymentRail;
      if (!rail || rail.name !== "stripe") throw new Error("payment_method_add requires Stripe rail. Set MNEMOPAY_PAYMENT_RAIL=stripe");
      const customer = await rail.createCustomer(args.email, args.name);
      const setup = await rail.createSetupIntent(customer.customerId);
      return JSON.stringify({
        customerId: customer.customerId,
        setupIntentId: setup.setupIntentId,
        clientSecret: setup.clientSecret,
        message: "Use this clientSecret with Stripe.js to collect the card. Then pass customerId + paymentMethodId to charge().",
      });
    }

    case "payment_method_list": {
      const rail = (agent as any).paymentRail;
      if (!rail || rail.name !== "stripe") throw new Error("payment_method_list requires Stripe rail");
      const stripe = (rail as any).stripe;
      const methods = await stripe.paymentMethods.list({ customer: args.customerId, type: "card" });
      const cards = methods.data.map((pm: any) => ({
        id: pm.id,
        brand: pm.card?.brand,
        last4: pm.card?.last4,
        expMonth: pm.card?.exp_month,
        expYear: pm.card?.exp_year,
      }));
      if (cards.length === 0) return "No saved payment methods.";
      return JSON.stringify(cards, null, 2);
    }

    case "payment_method_remove": {
      const rail = (agent as any).paymentRail;
      if (!rail || rail.name !== "stripe") throw new Error("payment_method_remove requires Stripe rail");
      const stripe = (rail as any).stripe;
      await stripe.paymentMethods.detach(args.paymentMethodId);
      return JSON.stringify({ status: "removed", paymentMethodId: args.paymentMethodId });
    }

    // ── Receipts & Export ────────────────────────────────────────────────

    case "receipt_get": {
      const txHistory = await agent.history(10000);
      const tx = txHistory.find((t: any) => t.id === args.txId);
      if (!tx) throw new Error(`Transaction ${args.txId} not found`);
      const profile = await agent.profile();
      const receipt = [
        "═══════════════════════════════════════",
        "           MNEMOPAY RECEIPT            ",
        "═══════════════════════════════════════",
        `Transaction ID: ${tx.id}`,
        `Date:           ${tx.createdAt}`,
        `Agent:          ${tx.agentId || profile.id}`,
        `Amount:         $${tx.amount.toFixed(2)}`,
        `Status:         ${tx.status}`,
        `Reason:         ${tx.reason || "N/A"}`,
        tx.platformFee ? `Platform Fee:   $${tx.platformFee.toFixed(2)}` : null,
        tx.netAmount ? `Net Amount:     $${tx.netAmount.toFixed(2)}` : null,
        tx.externalId ? `External Ref:   ${tx.externalId}` : null,
        `Rail:           ${(agent as any).paymentRail?.name || "mock"}`,
        "═══════════════════════════════════════",
      ].filter(Boolean).join("\n");
      return receipt;
    }

    case "history_export": {
      const format = args.format || "json";
      const limit = args.limit || 10000;
      const txHistory = await agent.history(limit);
      if (format === "csv") {
        const railName = (agent as any).paymentRail?.name || "mock";
        const headers = "id,date,amount,status,reason,rail,externalId,platformFee,netAmount";
        const rows = txHistory.map((tx: any) =>
          [tx.id, tx.createdAt, tx.amount, tx.status, `"${(tx.reason || "").replace(/"/g, '""')}"`, railName, tx.externalId || "", tx.platformFee || "", tx.netAmount || ""].join(",")
        );
        return [headers, ...rows].join("\n");
      }
      return JSON.stringify(txHistory, null, 2);
    }

    // ── Agent FICO ─────────────────────────────────────────────────────────

    case "agent_fico_score": {
      const fico = new AgentCreditScore();
      const txHistory = await agent.history(1000);
      const profile = await agent.profile();
      const result = fico.compute({
        transactions: txHistory.map((tx: any) => ({
          id: tx.id,
          amount: tx.amount,
          status: tx.status,
          reason: tx.reason || "",
          createdAt: new Date(tx.createdAt),
          settledAt: tx.settledAt ? new Date(tx.settledAt) : undefined,
          counterparty: tx.counterparty,
        })),
        createdAt: new Date(Date.now() - 86400000 * 30),
        fraudFlags: args.fraudFlags ?? 0,
        disputeCount: args.disputeCount ?? 0,
        disputesLost: args.disputesLost ?? 0,
        warnings: args.warnings ?? 0,
        budgetCap: args.budgetCap ?? 10000,
        memoriesCount: profile.memoriesCount ?? 0,
      });
      return JSON.stringify(result, null, 2);
    }

    // ── Behavioral Finance ─────────────────────────────────────────────────

    case "behavioral_analysis": {
      const behavioral = new BehavioralEngine();
      const prospect = behavioral.prospectValue(args.amount);
      const analysis: any = { prospect };

      if (args.monthlyIncome) {
        analysis.coolingOff = behavioral.coolingOff(args.amount, args.monthlyIncome);
      }

      if (args.goalName && args.goalTarget && args.goalCurrent !== undefined && args.goalMonthlySavings) {
        analysis.lossFrame = behavioral.lossFrame(args.amount, {
          name: args.goalName,
          target: args.goalTarget,
          current: args.goalCurrent,
          monthlySavings: args.goalMonthlySavings,
        });
      }

      return JSON.stringify(analysis, null, 2);
    }

    // ── Memory Integrity ─────────────────────────────────────────────────

    case "memory_integrity_check": {
      const tree = gov.merkleTree;
      if (!tree || tree.size === 0) {
        // Build tree from current memories
        const memories = await agent.recall(50);
        for (const m of memories) {
          tree.addLeaf(m.id, m.content);
        }
      }
      const snapshot = tree.snapshot();
      const result: any = {
        rootHash: snapshot.rootHash,
        leafCount: snapshot.leafCount,
        snapshotHash: snapshot.snapshotHash,
      };
      if (args.snapshotHash) {
        const check = tree.detectTampering({
          rootHash: args.snapshotHash,
          leafCount: snapshot.leafCount,
          snapshotHash: args.snapshotHash,
          timestamp: new Date().toISOString(),
        });
        result.tampering = check;
      }
      return JSON.stringify(result, null, 2);
    }

    // ── Anomaly Detection ────────────────────────────────────────────────

    case "anomaly_check": {
      const result = gov.ewma.update(args.amount);
      return JSON.stringify(result, null, 2);
    }

    case "charter_validate": {
      const charter = validateCharter(args.charter);
      return JSON.stringify({ valid: true, charter }, null, 2);
    }

    case "policy_lint": {
      return JSON.stringify(lintPolicy(args.policy as Policy), null, 2);
    }

    case "policy_set": {
      const policy = args.policy
        ? args.policy as Policy
        : buildRiskPolicy({
            approvalThresholdUsd: args.approvalThresholdUsd,
            hardCapUsd: args.hardCapUsd,
            blockTargets: args.blockTargets,
          });
      const report = lintPolicy(policy);
      if (!report.ok) {
        const errors = report.issues.filter(i => i.severity === "error").map(i => i.message);
        throw new Error(`Policy failed lint: ${errors.join("; ")}`);
      }
      gov.policy = compilePolicy(policy);
      gov.ledger.auditChain().emit("policy.set", {
        policy_id: policy.id,
        version: policy.version,
        rule_count: policy.rules.length,
      });
      return JSON.stringify({ active: true, policy, lint: report }, null, 2);
    }

    case "policy_evaluate": {
      const action = policyActionFromArgs(args);
      const risk = classifyRisk(action);
      const verdict = evaluateAction(gov.policy, action, { rate_counter: gov.rateCounter });
      gov.ledger.auditChain().emit("policy.evaluated", { action, risk, verdict });
      return JSON.stringify({ action, risk, verdict, policy: gov.policy.policy.id }, null, 2);
    }

    case "risk_classify": {
      const action = policyActionFromArgs(args);
      return JSON.stringify({ action, risk: classifyRisk(action) }, null, 2);
    }

    case "action_begin": {
      const risk = args.risk ?? classifyRisk({
        kind: "tool_call",
        target: args.intent,
        args_text: args.plan,
      }).level;
      const record = gov.ledger.begin({
        agent_id: args.agentId || process.env.MNEMOPAY_AGENT_ID || "mcp-agent",
        intent: args.intent,
        plan: args.plan,
        risk,
      });
      return JSON.stringify(record, null, 2);
    }

    case "action_update": {
      const record = gov.ledger.update(args.actionId, {
        tools_used: args.toolsUsed,
        memories_used: args.memoriesUsed,
        files_accessed: args.filesAccessed,
        sites_visited: args.sitesVisited,
        cost_usd: args.costUsd,
        plan: args.plan,
        rollback: args.rollback,
      });
      if (args.executing) gov.ledger.markExecuting(args.actionId);
      return JSON.stringify(gov.ledger.get(record.id), null, 2);
    }

    case "action_end": {
      const record =
        args.status === "completed" ? gov.ledger.complete(args.actionId, args.result) :
        args.status === "failed" ? gov.ledger.fail(args.actionId, args.error || "Action failed") :
        args.status === "blocked" ? gov.ledger.block(args.actionId, args.error || "Action blocked") :
        gov.ledger.rollBack(args.actionId, args.result);
      return JSON.stringify(record, null, 2);
    }

    case "action_list": {
      return JSON.stringify(gov.ledger.list(args.agentId), null, 2);
    }

    case "audit_bundle_export": {
      return JSON.stringify(gov.ledger.auditChain().toBundle(args.meta || {}), null, 2);
    }

    case "audit_bundle_verify": {
      return JSON.stringify(verifyBundle(args.bundle as ChainBundle), null, 2);
    }

    case "identity_create": {
      gov.identity.createIdentity(args.agentId, args.ownerId, args.ownerEmail, {
        displayName: args.displayName,
        capabilities: args.capabilities,
        ownerType: args.ownerType,
        ownerCountry: args.ownerCountry,
      });
      const identity = gov.identity.getIdentity(args.agentId);
      gov.ledger.auditChain().emit("identity.created", { agent_id: args.agentId, owner_id: args.ownerId });
      return JSON.stringify(identity, null, 2);
    }

    case "identity_get": {
      const identity = gov.identity.getIdentity(args.agentId);
      if (!identity) throw new Error(`Unknown agent: ${args.agentId}`);
      return JSON.stringify({ identity, activeTokenCount: gov.identity.listActiveTokens(args.agentId).length }, null, 2);
    }

    case "capability_issue": {
      const token = gov.identity.issueToken(args.agentId, args.permissions as Permission[], {
        maxAmount: args.maxAmount,
        maxTotalSpend: args.maxTotalSpend,
        allowedCounterparties: args.allowedCounterparties,
        allowedCategories: args.allowedCategories,
        expiresInMinutes: args.expiresInMinutes,
        issuedBy: args.issuedBy,
      });
      gov.ledger.auditChain().emit("capability.issued", {
        token_id: token.id, agent_id: token.agentId, permissions: token.permissions, expires_at: token.expiresAt,
      });
      return JSON.stringify(token, null, 2);
    }

    case "capability_validate": {
      return JSON.stringify(gov.identity.validateToken(
        args.tokenId, args.action as Permission, args.amount, args.counterpartyId,
      ), null, 2);
    }

    case "capability_list": {
      return JSON.stringify(gov.identity.listActiveTokens(args.agentId), null, 2);
    }

    case "capability_revoke": {
      gov.identity.revokeToken(args.tokenId);
      gov.ledger.auditChain().emit("capability.revoked", { token_id: args.tokenId });
      return JSON.stringify({ revoked: true, tokenId: args.tokenId }, null, 2);
    }

    case "identity_killswitch": {
      const revoked = gov.identity.revokeAllTokens(args.agentId);
      gov.ledger.auditChain().emit("identity.killswitch", {
        agent_id: args.agentId, reason: args.reason, revoked_tokens: revoked,
      });
      return JSON.stringify({ agentId: args.agentId, revokedTokens: revoked, status: "halted", reason: args.reason }, null, 2);
    }

    case "skill_policy_preview": {
      const skill = declarativeSkill({
        skillId: args.skillId, purpose: `Preview policy for ${args.skillId}`, permissions: args.permissions, actions: [],
      });
      return JSON.stringify(policyForSkill(skill).policy, null, 2);
    }

    case "skill_run_plan": {
      const skill = declarativeSkill(args);
      const result = await runSkill(skill, { actions: args.actions }, {
        agent_id: args.agentId || process.env.MNEMOPAY_AGENT_ID || "mcp-agent",
        ledger: gov.ledger,
      });
      return JSON.stringify({
        ok: result.ok, output: result.output, error: result.error, action_id: result.action_id,
        pending_approval_id: result.pending_approval_id, action: result.ledger.get(result.action_id),
      }, null, 2);
    }

    case "spatial_evidence_verify": {
      const verification = verifySpatialEvidence(args.evidence);
      const fingerprint = verification.ok
        ? fingerprintSpatialEvidence(args.evidence as SpatialEvidence)
        : undefined;
      return JSON.stringify({ verification, fingerprint }, null, 2);
    }

    case "spatial_evidence_attach": {
      const result = attachSpatialEvidence(gov.spatialAudit, args.evidence as SpatialEvidence);
      gov.ledger.auditChain().emit("spatial.evidence.attached", {
        kind: args.evidence.kind,
        fingerprint: result.fingerprint,
      });
      return JSON.stringify({
        attached: true,
        fingerprint: result.fingerprint,
        auditDigest: gov.spatialAudit.finalize(),
        eventCount: gov.spatialAudit.getEvents().length,
      }, null, 2);
    }

    case "spatial_audit_export": {
      return JSON.stringify({
        verified: gov.spatialAudit.verify(),
        auditDigest: gov.spatialAudit.finalize(),
        ...gov.spatialAudit.toJSON(),
      }, null, 2);
    }

    case "agent_os_job_create": {
      const response = await agentOsRequest("POST", "/jobs", {
        type: args.type,
        agent_id: args.agentId,
        payload: args.payload,
        max_attempts: args.maxAttempts ?? 3,
      });
      gov.ledger.auditChain().emit("agent_os.job.created", {
        type: args.type,
        agent_id: args.agentId,
      });
      return JSON.stringify(response, null, 2);
    }

    case "agent_os_jobs":
      return JSON.stringify(await agentOsRequest("GET", "/jobs"), null, 2);

    case "agent_os_job_retry": {
      const response = await agentOsRequest("POST", `/jobs/${encodeURIComponent(args.jobId)}/retry`);
      gov.ledger.auditChain().emit("agent_os.job.retried", { job_id: args.jobId });
      return JSON.stringify(response, null, 2);
    }

    case "agent_os_job_cancel": {
      const response = await agentOsRequest("POST", `/jobs/${encodeURIComponent(args.jobId)}/cancel`);
      gov.ledger.auditChain().emit("agent_os.job.cancelled", { job_id: args.jobId });
      return JSON.stringify(response, null, 2);
    }

    case "agent_os_alerts":
      return JSON.stringify(await agentOsRequest("GET", "/alerts"), null, 2);

    case "agent_os_usage":
      return JSON.stringify(await agentOsRequest("GET", "/usage"), null, 2);

    case "agent_os_audit_export":
      return JSON.stringify(await agentOsRequest("GET", "/audit-export"), null, 2);

    case "organization_get":
      return JSON.stringify(await agentOsRequest("GET", ""), null, 2);
    case "organization_members":
      return JSON.stringify(await agentOsRequest("GET", "/members"), null, 2);
    case "organization_member_add":
      return JSON.stringify(await agentOsRequest("POST", "/members", { identity: args.identity, role: args.role }), null, 2);
    case "organization_member_update":
      return JSON.stringify(await agentOsRequest("PATCH", `/members/${encodeURIComponent(args.identity)}`, { role: args.role }), null, 2);
    case "organization_member_remove":
      return JSON.stringify(await agentOsRequest("DELETE", `/members/${encodeURIComponent(args.identity)}`), null, 2);
    case "organization_invitations":
      return JSON.stringify(await agentOsRequest("GET", "/invitations"), null, 2);
    case "organization_invite":
      return JSON.stringify(await agentOsRequest("POST", "/invitations", {
        email: args.email, role: args.role, expires_in_hours: args.expiresInHours ?? 168,
      }), null, 2);
    case "organization_invite_revoke":
      return JSON.stringify(await agentOsRequest("DELETE", `/invitations/${encodeURIComponent(args.invitationId)}`), null, 2);
    case "organization_policies":
      return JSON.stringify(await agentOsRequest("GET", "/policies"), null, 2);
    case "organization_policy_create":
      return JSON.stringify(await agentOsRequest("POST", "/policies", {
        name: args.name, rules: args.rules, active: args.active ?? true,
      }), null, 2);
    case "organization_policy_update":
      return JSON.stringify(await agentOsRequest("PATCH", `/policies/${encodeURIComponent(args.policyId)}`, compactObject({
        name: args.name, rules: args.rules, active: args.active,
      })), null, 2);
    case "organization_policy_delete":
      return JSON.stringify(await agentOsRequest("DELETE", `/policies/${encodeURIComponent(args.policyId)}`), null, 2);
    case "organization_agents":
      return JSON.stringify(await agentOsRequest("GET", "/agents"), null, 2);
    case "organization_agent_create":
      return JSON.stringify(await agentOsRequest("POST", "/agents", compactObject({
        agent_id: args.agentId, name: args.name, monthly_budget_usd: args.monthlyBudgetUsd ?? 100, policy_id: args.policyId,
      })), null, 2);
    case "organization_agent_update":
      return JSON.stringify(await agentOsRequest("PATCH", `/agents/${encodeURIComponent(args.id)}`, compactObject({
        name: args.name, status: args.status, monthly_budget_usd: args.monthlyBudgetUsd, policy_id: args.policyId,
      })), null, 2);
    case "organization_agent_delete":
      return JSON.stringify(await agentOsRequest("DELETE", `/agents/${encodeURIComponent(args.id)}`), null, 2);
    case "organization_limits_update":
      return JSON.stringify(await operatorPlatformRequest("PATCH", "/operator-limits", compactObject({
        agent_limit: args.agentLimit, monthly_job_limit: args.monthlyJobLimit,
        monthly_browser_budget_usd: args.monthlyBrowserBudgetUsd,
      })), null, 2);

    case "operator_processes":
      return JSON.stringify(await operatorRequest("GET", "/processes"), null, 2);
    case "operator_process_get":
      return JSON.stringify(await operatorRequest("GET", `/processes/${encodeURIComponent(args.processId)}`), null, 2);
    case "operator_process_pause":
      return JSON.stringify(await operatorRequest("POST", `/processes/${encodeURIComponent(args.processId)}/pause`), null, 2);
    case "operator_process_resume":
      return JSON.stringify(await operatorRequest("POST", `/processes/${encodeURIComponent(args.processId)}/resume`), null, 2);
    case "operator_process_estop": {
      const result = await operatorRequest("POST", `/processes/${encodeURIComponent(args.processId)}/estop`);
      gov.ledger.auditChain().emit("operator.process.estop", { process_id: args.processId });
      return JSON.stringify(result, null, 2);
    }
    case "operator_approvals":
      return JSON.stringify(await operatorRequest("GET", "/approvals"), null, 2);
    case "operator_approval_decide": {
      const result = await operatorRequest("POST", `/approvals/${encodeURIComponent(args.approvalId)}/decision`, compactObject({
        decision: args.decision, decided_by: args.decidedBy, notes: args.notes,
      }));
      gov.ledger.auditChain().emit("operator.approval.decided", {
        approval_id: args.approvalId, decision: args.decision, decided_by: args.decidedBy,
      });
      return JSON.stringify(result, null, 2);
    }
    case "operator_activity": {
      const query = new URLSearchParams(compactObject({
        limit: args.limit?.toString(), process_id: args.processId,
      }) as Record<string, string>).toString();
      return JSON.stringify(await operatorRequest("GET", `/activity${query ? `?${query}` : ""}`), null, 2);
    }

    // ── Payouts (Paystack) ──────────────────────────────────────────────

    case "payout_create": {
      const rail = (agent as any).paymentRail;
      if (!rail || rail.name !== "paystack") throw new Error("payout_create requires Paystack rail. Set MNEMOPAY_PAYMENT_RAIL=paystack");
      let recipient;
      let transfer;
      try {
        recipient = await rail.createTransferRecipient(
          args.accountName,
          args.accountNumber,
          args.bankCode,
        );
        transfer = await rail.initiateTransfer(
          recipient.recipientCode,
          args.amount,
          args.reason,
          (agent as any).agentId,
        );
      } catch (err: any) {
        fireWebhook("transfer.failed", {
          amount: args.amount,
          reason: args.reason,
          accountName: args.accountName,
          accountNumber: args.accountNumber,
          bankCode: args.bankCode,
          recipientCode: recipient?.recipientCode,
          stage: recipient ? "initiate_transfer" : "create_recipient",
          error: err?.message || String(err),
          errorCode: err?.code,
          rail: "paystack",
          agentId: (agent as any).agentId,
        });
        throw err;
      }
      fireWebhook("transfer.success", {
        transferCode: transfer.externalId,
        reference: transfer.reference,
        amount: transfer.amount,
        recipientCode: recipient.recipientCode,
        recipientName: recipient.name,
        transferStatus: transfer.transferStatus,
        agentId: (agent as any).agentId,
      });
      return JSON.stringify({
        status: "initiated",
        transferCode: transfer.externalId,
        reference: transfer.reference,
        amount: transfer.amount,
        recipientCode: recipient.recipientCode,
        recipientName: recipient.name,
        transferStatus: transfer.transferStatus,
      }, null, 2);
    }

    case "payout_status": {
      const rail = (agent as any).paymentRail;
      if (!rail || rail.name !== "paystack") throw new Error("payout_status requires Paystack rail");
      const response = await rail.request("GET", `/transfer/verify/${encodeURIComponent(args.transferCode)}`);
      return JSON.stringify({
        transferCode: args.transferCode,
        status: response.data?.status ?? "unknown",
        amount: response.data?.amount ? response.data.amount / 100 : null,
        recipient: response.data?.recipient?.details?.account_name,
        createdAt: response.data?.createdAt,
        updatedAt: response.data?.updatedAt,
      }, null, 2);
    }

    // ── Webhooks ────────────────────────────────────────────────────────

    case "webhook_register": {
      const webhookUrl = String(args.url || "");
      const allowLocal = process.env.MNEMOPAY_WEBHOOK_ALLOW_LOCAL === "1";
      try {
        const parsed = new URL(webhookUrl);
        if (parsed.protocol !== "https:" && !(allowLocal && parsed.protocol === "http:")) {
          throw new Error("Webhook URL must use HTTPS");
        }
        if (parsed.username || parsed.password) {
          throw new Error("Webhook URL must not contain credentials");
        }
        if (!allowLocal && isBlockedWebhookHost(parsed.hostname)) {
          throw new Error("Webhook URL must not point to private/local addresses");
        }
      } catch (e: any) {
        return JSON.stringify({ error: e.message || "Invalid webhook URL" });
      }
      const events = Array.isArray(args.events) ? args.events : [];
      const sub = webhookStore().register(webhookUrl, events, me);
      return JSON.stringify({
        webhookId: sub.id,
        url: sub.url,
        events: sub.events,
        signingSecret: sub.secret,
        status: "registered",
        message: "Store the signing secret — it will not be shown again. Verify the X-MnemoPay-Signature header (HMAC-SHA256, format `t=<ts>,v1=<hex>`).",
      });
    }

    case "webhook_list": {
      // Only this tenant's subscriptions (signing secrets are never listed).
      const hooks = webhookStore().list(me).map(w => ({
        webhookId: w.id,
        url: w.url,
        events: w.events,
        createdAt: new Date(w.createdAt).toISOString(),
      }));
      if (hooks.length === 0) return "No webhooks registered.";
      return JSON.stringify(hooks, null, 2);
    }

    case "shop_checkout": {
      const { CheckoutExecutor } = await import("../commerce/checkout/index.js");
      const { loadProfileFromEnv } = await import("../commerce/checkout/profile.js");
      const profile = loadProfileFromEnv();
      if (!profile) {
        throw new Error(
          "Buyer profile not configured. Set MNEMOPAY_BUYER_NAME, MNEMOPAY_BUYER_EMAIL, " +
          "MNEMOPAY_BUYER_ADDRESS_LINE1, MNEMOPAY_BUYER_ADDRESS_CITY, MNEMOPAY_BUYER_ADDRESS_STATE, " +
          "MNEMOPAY_BUYER_ADDRESS_ZIP, MNEMOPAY_BUYER_ADDRESS_COUNTRY env vars."
        );
      }
      const executor = new CheckoutExecutor({
        profile,
        headless: args.headless ?? true,
        screenshotDir: args.screenshotDir,
      });
      const result = await executor.checkout(args.productUrl);
      return JSON.stringify({
        success: result.success,
        orderId: result.orderId,
        totalCharged: result.totalCharged,
        confirmationUrl: result.confirmationUrl,
        steps: result.steps,
        elapsedMs: result.elapsedMs,
        failureReason: result.failureReason,
        screenshots: result.screenshots,
      }, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Per-tenant governance state ──────────────────────────────────────────────
// One bundle per acting agent id (audit S1: these were process-global, so one
// tenant could mint/revoke another's capability tokens, rewrite the shared
// policy, read the shared audit chain). Members are created on first use.

class TenantGovernance {
  private _ledger?: ActionLedger;
  private _identity?: IdentityRegistry;
  private _rate?: InMemoryRateCounter;
  private _spatial?: MerkleAudit;
  private _tree?: MerkleTree;
  private _ewma?: EWMADetector;
  policy: CompiledPolicy = compilePolicy(buildRiskPolicy());
  get ledger(): ActionLedger { return (this._ledger ??= new ActionLedger()); }
  get identity(): IdentityRegistry { return (this._identity ??= new IdentityRegistry()); }
  get rateCounter(): InMemoryRateCounter { return (this._rate ??= new InMemoryRateCounter()); }
  get spatialAudit(): MerkleAudit { return (this._spatial ??= new MerkleAudit()); }
  get merkleTree(): MerkleTree { return (this._tree ??= new MerkleTree()); }
  get ewma(): EWMADetector { return (this._ewma ??= new EWMADetector(0.15, 2.5, 3.5, 10)); }
}

const _tenantGovernance = new Map<string, TenantGovernance>();

function tenantGovernance(agent: Agent): TenantGovernance {
  const id = tenantIdOf(agent);
  let g = _tenantGovernance.get(id);
  if (!g) {
    g = new TenantGovernance();
    _tenantGovernance.set(id, g);
  }
  return g;
}

/** Test-only: drop all per-tenant governance state. */
export function _resetTenantGovernanceForTests(): void {
  _tenantGovernance.clear();
  _commerceEngines.clear();
}

async function agentOsRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  suffix: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const baseUrl = process.env.MNEMOPAY_GATEWAY_URL?.trim().replace(/\/+$/, "");
  const orgId = process.env.MNEMOPAY_ORG_ID?.trim();
  const orgKey = process.env.MNEMOPAY_ORG_API_KEY?.trim();
  const identity = process.env.MNEMOPAY_IDENTITY?.trim() || process.env.MNEMOPAY_AGENT_ID?.trim();
  if (!baseUrl?.startsWith("https://") || !orgId || !orgKey || !identity) {
    throw new Error(
      "Agent OS gateway is not configured. Set an HTTPS MNEMOPAY_GATEWAY_URL, MNEMOPAY_ORG_ID, MNEMOPAY_ORG_API_KEY, and MNEMOPAY_IDENTITY.",
    );
  }

  return gatewayRequest(
    `${baseUrl}/api/v1/platform/organizations/${encodeURIComponent(orgId)}${suffix}`,
    method,
    {
      authorization: `Bearer ${orgKey}`,
      "x-mnemopay-identity": identity,
    },
    body,
  );
}

async function operatorPlatformRequest(
  method: "PATCH",
  suffix: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const baseUrl = gatewayBaseUrl();
  const orgId = process.env.MNEMOPAY_ORG_ID?.trim();
  const operatorKey = process.env.MNEMOPAY_OPERATOR_API_KEY?.trim();
  if (!orgId || !operatorKey) {
    throw new Error("Agent OS operator is not configured. Set MNEMOPAY_ORG_ID and MNEMOPAY_OPERATOR_API_KEY.");
  }
  return gatewayRequest(
    `${baseUrl}/api/v1/platform/organizations/${encodeURIComponent(orgId)}${suffix}`,
    method,
    { authorization: `Bearer ${operatorKey}` },
    body,
  );
}

async function operatorRequest(
  method: "GET" | "POST",
  suffix: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const operatorKey = process.env.MNEMOPAY_OPERATOR_API_KEY?.trim();
  if (!operatorKey) throw new Error("Agent OS operator is not configured. Set MNEMOPAY_OPERATOR_API_KEY.");
  return gatewayRequest(
    `${gatewayBaseUrl()}/api/v1/operator${suffix}`,
    method,
    { authorization: `Bearer ${operatorKey}` },
    body,
  );
}

function gatewayBaseUrl(): string {
  const baseUrl = process.env.MNEMOPAY_GATEWAY_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl?.startsWith("https://")) {
    throw new Error("Agent OS gateway is not configured. Set an HTTPS MNEMOPAY_GATEWAY_URL.");
  }
  return baseUrl;
}

async function gatewayRequest(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  headers: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { text };
  }
  if (!response.ok) {
    throw new Error(`Agent OS gateway returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return parsed;
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function policyActionFromArgs(args: Record<string, any>): PolicyAction {
  return {
    kind: args.kind,
    target: args.target,
    ...(args.estimatedUsd !== undefined ? { estimated_usd: args.estimatedUsd } : {}),
    ...(args.argsText ? { args_text: args.argsText } : {}),
    ...(args.locale ? { locale: args.locale } : {}),
  };
}

function declarativeSkill(args: Record<string, any>): MnemoSkill<{ actions: SkillActRequest[] }, {
  grants: Array<SkillActRequest & { grant: unknown }>;
}> {
  const permissions = args.permissions as SkillPermissions;
  const actions = (args.actions ?? []) as SkillActRequest[];
  return {
    id: args.skillId,
    name: args.name || args.skillId,
    purpose: args.purpose,
    version: args.version || "1.0.0",
    owner: args.owner || "mcp-operator",
    permissions,
    run(ctx) {
      const grants = [];
      for (const action of actions) {
        const grant = ctx.act(action);
        grants.push({ ...action, grant });
        if (!grant.allowed) break;
      }
      return { grants };
    },
  };
}

// ── Approval queues (HITL) ──────────────────────────────────────────────────
// Backed by SQLite — `pod restart drops pending approvals` was a hard blocker
// for fintech buyers. PersistentApprovalQueue mirrors the Maps to disk and
// rehydrates on startup. See src/storage/approval-queue.ts.
//
// Tests that want a clean queue should pass MNEMOPAY_PERSIST_DIR=<tmpdir>
// or wipe ~/.mnemopay/approvals.db between runs.

let _approvalQueue: PersistentApprovalQueue | null = null;
export function approvalQueue(): PersistentApprovalQueue {
  if (!_approvalQueue) _approvalQueue = new PersistentApprovalQueue();
  return _approvalQueue;
}

// Test-only: reset the queue singleton (used by suite tear-down).
export function _resetApprovalQueueForTests(): void {
  try {
    _approvalQueue?.close();
  } catch {
    /* ignore */
  }
  _approvalQueue = null;
}

// ── Webhook registry ───────────────────────────────────────────────────────
// Backed by SQLite via WebhookStore. Subscriptions persist across restarts;
// deliveries enqueue + retry with exponential backoff; HMAC-SHA256 signing.

let _webhookStore: WebhookStore | null = null;
let _webhookPumpStarted = false;
export function webhookStore(): WebhookStore {
  if (!_webhookStore) {
    _webhookStore = new WebhookStore({ legacyTenantId: defaultTenantId() });
    if (!_webhookPumpStarted) {
      _webhookPumpStarted = true;
      // Drain pending deliveries every 2s. unref so we never block process exit.
      setInterval(() => {
        _webhookStore?.pumpOnce().catch((err) => {
          console.error(`[mnemopay-mcp] webhook pump error: ${err?.message || err}`);
        });
      }, 2000).unref?.();
    }
  }
  return _webhookStore;
}

// Test-only: reset the webhook store singleton.
export function _resetWebhookStoreForTests(): void {
  try {
    _webhookStore?.close();
  } catch {
    /* ignore */
  }
  _webhookStore = null;
  _webhookPumpStarted = false;
}

/** Convenience: fire if a store is open. Never throws; never blocks the caller. */
function fireWebhook(event: string, payload: any): void {
  try {
    // Deliver ONLY to the owning tenant's subscriptions (audit S3: a "*" hook
    // registered by tenant A used to receive tenant B's charge/settle events).
    const tenant = typeof payload?.agentId === "string" && payload.agentId ? payload.agentId : defaultTenantId();
    webhookStore().fire(event, payload, tenant);
  } catch (err: any) {
    console.error(`[mnemopay-mcp] webhook fire failed: ${err?.message || err}`);
  }
}

// Auto-expire pending approvals after 10 minutes — runs only when a queue
// has been instantiated, so module load alone doesn't open the DB.
setInterval(() => {
  if (_approvalQueue) {
    _approvalQueue.expireOlderThan(600_000);
  }
}, 60_000).unref?.();

// ── Commerce singleton ──────────────────────────────────────────────────────

// One engine per tenant (audit S1: a single engine was created with the FIRST
// caller's agent, so every later tenant's shop_* calls spent tenant #1's wallet
// and mandate). Holds the promise so concurrent first calls share one build.
const _commerceEngines = new Map<string, Promise<any>>();

function getCommerceEngine(agent: Agent): Promise<any> {
  const tenant = tenantIdOf(agent);
  let pending = _commerceEngines.get(tenant);
  if (!pending) {
    pending = buildCommerceEngine(agent, tenant);
    _commerceEngines.set(tenant, pending);
    pending.catch(() => { _commerceEngines.delete(tenant); });
  }
  return pending;
}

async function buildCommerceEngine(agent: Agent, tenant: string): Promise<any> {
  let engine: any;
  {
    const { CommerceEngine } = await import("../commerce.js");

    // ── Commerce provider selection ──────────────────────────────────────
    // Set MNEMOPAY_COMMERCE_PROVIDER to "firecrawl", "shopify", or "mock".
    const providerName = (process.env.MNEMOPAY_COMMERCE_PROVIDER || "mock").toLowerCase();
    let provider: any;

    switch (providerName) {
      case "firecrawl": {
        const { FirecrawlProvider } = await import("../commerce/providers/firecrawl.js");
        const apiKey = process.env.FIRECRAWL_API_KEY;
        if (!apiKey) throw new Error("FIRECRAWL_API_KEY required when MNEMOPAY_COMMERCE_PROVIDER=firecrawl");
        provider = new FirecrawlProvider({ apiKey });
        break;
      }
      case "shopify": {
        const { ShopifyProvider } = await import("../commerce/providers/shopify.js");
        const domain = process.env.SHOPIFY_STORE_DOMAIN;
        const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
        if (!domain || !token) throw new Error("SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_TOKEN required when MNEMOPAY_COMMERCE_PROVIDER=shopify");
        provider = new ShopifyProvider({ storeDomain: domain, storefrontToken: token });
        break;
      }
      default:
        provider = undefined; // CommerceEngine uses MockCommerceProvider
    }

    engine = new CommerceEngine(agent, provider);

    // ── Wire approval callback (HITL) ────────────────────────────────────
    engine.onApprovalRequired(async (order: any) => {
      // Queue the order for user approval instead of auto-approving.
      // Persist alongside the in-memory resolver so a pod restart leaves the
      // order visible to the operator (the original Promise is dead, but the
      // operator can shop_reject to release any downstream state).
      return new Promise<boolean>((resolve) => {
        approvalQueue().addShopApproval({
          orderId: order.id,
          order,
          createdAt: Date.now(),
          tenantId: tenant,
          resolve,
        });
      });
    });
  }
  return engine;
}

// ─── Server setup ───────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const agent = createAgent();
  // Multi-tenant wallet routing: one boot agent + a lazily-built per-tenant
  // agent (own wallet/ledger/memory/persistence file). When a request carries
  // no identity, registry.resolve() returns the boot agent unchanged.
  const registry = new AgentRegistry(agent);

  // Self-serve API-key store: maps a minted `mp_…` key → its tenant agent id.
  // Persisted alongside the per-tenant wallet files so a restart keeps keys
  // valid. Lives only on the HTTP path (the `/tenant/provision` route +
  // `/api/*` auth). In production mode there is no local persist dir, so the
  // store is in-memory and provisioning is unavailable (production routes
  // tenancy through the upstream services).
  const cfg = resolveAgentConfig();
  const tenantKeys = new TenantKeyStore(cfg.persistDir ?? null);

  const allowedTools = resolveToolFilter(getToolFilterSpec(process.argv));
  const filteredTools = TOOLS.filter(t => allowedTools.has(t.name));
  console.error(`[mnemopay-mcp] Tool filter: ${filteredTools.length}/${TOOLS.length} tools exposed`);

  const server = new Server(
    { name: "mnemopay", version: PKG_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  // ── Tools ───────────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: filteredTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      // Security: block tools outside the active filter
      if (!allowedTools.has(name)) {
        throw new Error(`Tool "${name}" is disabled — start server with --tools including this group`);
      }

      // Security: MCP-level rate limiting (prevents tool call flooding)
      mcpLimiter.check();

      // Security: API key auth when MNEMOPAY_API_KEY is set
      // Uses constant-time comparison to prevent timing attacks
      const requiredKey = process.env.MNEMOPAY_API_KEY;
      if (requiredKey) {
        const providedKey = (request as any).params?._apiKey || process.env.MNEMOPAY_CLIENT_KEY || "";
        if (!constantTimeEqual(providedKey, requiredKey)) {
          return {
            content: [{ type: "text", text: "Error: Unauthorized — invalid API key" }],
            isError: true,
          };
        }
      }

      // Multi-tenant routing: per-request acting agent from optional `_agentId`
      // arg. No id → boot agent (single-tenant behavior unchanged). Invalid /
      // traversal ids are rejected inside registry.resolve().
      const actingAgent = registry.resolve(
        authorizeTenantSelection({
          requested: agentIdFromArgs(args ?? {}),
          bootId: String((agent as any).agentId),
          credentialed: !_httpAnonymous,
          allowAnonymous: anonTenantSelectionAllowed(),
        }),
      );
      const result = await executeTool(actingAgent, name, args ?? {});
      return { content: [{ type: "text", text: result }] };
    } catch (err: any) {
      // Security: sanitize error messages — never leak internal state
      const safeMessage = (err.message || "Unknown error")
        .replace(/[\r\n]/g, " ")               // prevent header injection
        .replace(/\/[^\s]+/g, "[path]")        // strip file paths
        .replace(/[a-f0-9-]{36}/gi, "[id]")    // strip UUIDs
        .replace(/\$[\d.]+/g, "[amount]")       // strip dollar amounts from errors
        .slice(0, 200);                          // cap length
      return {
        content: [{ type: "text", text: `Error: ${safeMessage}` }],
        isError: true,
      };
    }
  });

  // ── Resources ───────────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "mnemopay://health",
        name: "Agent Health",
        description: "Current agent profile, wallet, reputation, and memory stats",
        mimeType: "application/json",
      },
      {
        uri: "mnemopay://memories",
        name: "All Memories",
        description: "Top 20 memories ranked by composite score",
        mimeType: "text/plain",
      },
      ...Object.entries(GUIDES).map(([slug, g]) => ({
        uri: `mnemopay://${slug}`,
        name: g.name,
        description: g.description,
        mimeType: "text/markdown",
      })),
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "mnemopay://health") {
      const profile = await agent.profile();
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(profile, null, 2) }],
      };
    }

    if (uri === "mnemopay://memories") {
      const memories = await agent.recall(20);
      const text = memories.length === 0
        ? "No memories stored."
        : memories
            .map((m, i) => `${i + 1}. [${m.importance.toFixed(2)}] ${m.content}`)
            .join("\n");
      return { contents: [{ uri, mimeType: "text/plain", text }] };
    }

    const slug = uri.replace(/^mnemopay:\/\//, "");
    if (GUIDES[slug]) {
      return { contents: [{ uri, mimeType: "text/markdown", text: GUIDES[slug].body }] };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // ── Prompts ─────────────────────────────────────────────────────────────

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "recall-and-decide",
        description:
          "Recall all relevant memories, analyze them, and make a decision. " +
          "Includes the agent's current reputation and wallet status.",
        arguments: [
          { name: "question", description: "The decision or question to address", required: true },
        ],
      },
      {
        name: "agent-status-report",
        description: "Generate a full status report of the agent's memory health and financial state.",
      },
      {
        name: "session-start",
        description:
          "Load memory context at the beginning of a session. " +
          "Recalls relevant memories from prior sessions. " +
          "Call this at the start of every Claude Code session.",
        arguments: [
          { name: "context", description: "Optional topic or task to focus memory recall on", required: false },
        ],
      },
      {
        name: "session-end",
        description:
          "Consolidate memory and save a session summary before stopping. " +
          "Prunes stale memories, stores a summary, and forces a disk save. " +
          "Call this before every session end.",
        arguments: [
          { name: "summary", description: "A brief summary of what was accomplished this session", required: false },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "recall-and-decide") {
      const memories = await agent.recall(10);
      const profile = await agent.profile();
      const memoryBlock = memories.length === 0
        ? "No memories available."
        : memories.map((m, i) => `${i + 1}. [${m.score.toFixed(2)}] ${m.content}`).join("\n");

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Question: ${args?.question || "What should I do next?"}`,
                "",
                "## Agent Status",
                `Reputation: ${profile.reputation} | Wallet: $${profile.wallet} | Memories: ${profile.memoriesCount}`,
                "",
                "## Relevant Memories",
                memoryBlock,
                "",
                "Based on these memories and the agent's current state, provide your analysis and recommendation.",
                "If you take an action that delivers value, use the charge tool to invoice for it.",
              ].join("\n"),
            },
          },
        ],
      };
    }

    if (name === "agent-status-report") {
      const profile = await agent.profile();
      const memories = await agent.recall(10);
      const recent = await agent.history(5);

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "## Agent Status Report",
                "",
                `Agent: ${profile.id}`,
                `Reputation: ${profile.reputation.toFixed(2)}`,
                `Wallet: $${profile.wallet.toFixed(2)}`,
                `Memories: ${profile.memoriesCount}`,
                `Transactions: ${profile.transactionsCount}`,
                "",
                "## Top Memories",
                ...memories.map((m, i) => `${i + 1}. [${m.importance.toFixed(2)}] ${m.content}`),
                "",
                "## Recent Transactions",
                ...(recent.length === 0
                  ? ["No transactions yet."]
                  : recent.map((t) => `$${t.amount.toFixed(2)} — ${t.status} — ${t.reason}`)),
                "",
                "Analyze this agent's health: memory quality, financial performance, reputation trajectory.",
              ].join("\n"),
            },
          },
        ],
      };
    }

    if (name === "session-start") {
      const query = args?.context as string | undefined;
      const memories = query ? await agent.recall(query, 10) : await agent.recall(10);
      const profile = await agent.profile();
      const memoryBlock =
        memories.length === 0
          ? "No memories found from previous sessions."
          : memories
              .map((m, i) => `${i + 1}. [score:${m.score.toFixed(2)}, importance:${m.importance.toFixed(2)}] ${m.content}`)
              .join("\n");

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "## Session Start — Memory Context",
                "",
                `Agent: ${profile.id} | Memories: ${profile.memoriesCount} | Reputation: ${profile.reputation.toFixed(2)}`,
                "",
                "## Recalled Memories",
                memoryBlock,
                "",
                "Use this context to inform your responses. When you learn new important information this session, call the remember tool.",
              ].join("\n"),
            },
          },
        ],
      };
    }

    if (name === "session-end") {
      const summary = args?.summary as string | undefined;
      const result = await (agent as any).onSessionEnd(summary);
      const profile = await agent.profile();
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "## Session End — Complete",
                "",
                `Memories pruned: ${result.pruned}`,
                `Session summary stored: ${result.memorized ? "yes" : "no"}`,
                `Remaining memories: ${profile.memoriesCount}`,
                "",
                summary ? `Summary recorded: "${summary}"` : "No summary provided.",
                "",
                "Memory store has been consolidated and saved to disk.",
              ].join("\n"),
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  // ── Start ───────────────────────────────────────────────────────────────

  const useHttp = process.argv.includes("--http") || !!process.env.PORT;

  if (useHttp) {
    const express = (await import("express")).default;
    const { SSEServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/sse.js"
    );

    const app = express();
    app.use(express.json());

    // ── Rate limiting middleware ──────────────────────────────────────────
    const rateLimiter = new RateLimiter({
      maxRequests: parseInt(process.env.MNEMOPAY_RATE_LIMIT || "60", 10),
      windowMs: 60_000,
      maxPaymentRequests: parseInt(process.env.MNEMOPAY_PAYMENT_RATE_LIMIT || "10", 10),
      paymentWindowMs: 60_000,
    });

    // Cleanup stale rate limit entries every 5 minutes
    setInterval(() => rateLimiter.cleanup(), 300_000);

    const getClientIp = clientIpFromRequest;

    app.use((req: any, res: any, next: any) => {
      const ip = getClientIp(req);
      // Store IP on request for downstream use
      req.clientIp = ip;

      const { allowed, remaining, retryAfterMs } = rateLimiter.check(ip);
      res.setHeader("X-RateLimit-Remaining", remaining);
      if (!allowed) {
        res.setHeader("Retry-After", Math.ceil((retryAfterMs || 60000) / 1000));
        res.status(429).json({ error: "Rate limit exceeded", retryAfterMs });
        return;
      }
      next();
    });

    const transports: Record<string, InstanceType<typeof SSEServerTransport>> = {};

    // ── Portal API Key Verification ──────────────────────────────────────
    const PORTAL_URL = process.env.PORTAL_URL || "https://getbizsuite.com";
    try {
      const pu = new URL(PORTAL_URL);
      if (pu.protocol !== "https:" && process.env.NODE_ENV === "production") {
        throw new Error("PORTAL_URL must use HTTPS in production");
      }
    } catch (e: any) {
      if (process.env.NODE_ENV === "production") {
        console.error(`[mnemopay-mcp] FATAL: Invalid PORTAL_URL: ${e.message}`);
        process.exit(1);
      }
    }
    const REQUIRE_PORTAL_AUTH = process.env.REQUIRE_PORTAL_AUTH !== "false";

    async function portalKeyAuth(req: any, res: any, next: any) {
      if (!REQUIRE_PORTAL_AUTH) return next();
      if (req.path === "/health" || req.path.startsWith("/.well-known")) return next();

      const apiKey = req.headers["x-api-key"] || req.query.key;
      if (!apiKey) return next(); // Fall through to existing mcpAuth if no portal key

      // Self-serve keys minted by this substrate's /tenant/provision route are
      // validated LOCALLY (no round-trip to the BizSuite portal). A hit both
      // authenticates the caller and pins the acting tenant agent id, so the
      // emitted key alone is enough to make a scoped, authenticated charge.
      const tenantRec = tenantKeys.lookup(String(apiKey));
      if (tenantRec) {
        req._tenantAgentId = tenantRec.agentId;
        req._localTenantKey = true;
        return next();
      }

      try {
        const resp = await fetch(`${PORTAL_URL}/portal/verify-key`, {
          headers: { "x-api-key": apiKey }
        });
        const data = await resp.json() as { valid: boolean; within_limits?: boolean; error?: string };
        if (!data.valid) { res.status(403).json({ error: data.error || "Invalid API key" }); return; }
        if (!data.within_limits) { res.status(429).json({ error: "Usage limit exceeded. Upgrade at getbizsuite.com/developers/" }); return; }
        req._portalKey = { apiKey, valid: data.valid, within_limits: data.within_limits };
        next();
      } catch {
        res.status(503).json({ error: "Auth service unavailable" });
        return;
      }
    }

    app.use(portalKeyAuth);

    app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        mode: process.env.MNEMOPAY_MODE || "quick",
        rail: (agent as any).paymentRail?.name || "mock",
      });
    });

    // Operational info — surfaces the live payment rail so callers can
    // confirm the server is on a real rail (not the in-memory MockRail).
    app.get("/api/info", (_req, res) => {
      res.json({
        name: "MnemoPay MCP",
        version: PKG_VERSION,
        mode: process.env.MNEMOPAY_MODE || "quick",
        rail: (agent as any).paymentRail?.name || "mock",
        currency: process.env.STRIPE_CURRENCY || "usd",
      });
    });

    // A2A Agent Card — makes this agent discoverable by other agents
    app.get("/.well-known/agent.json", (_req, res) => {
      res.json(agent.agentCard(
        process.env.MNEMOPAY_URL || `http://localhost:${process.env.PORT || 3200}`,
        process.env.MNEMOPAY_CONTACT,
      ));
    });

    // Smithery MCP Server Card — enables registry discovery without scanning
    app.get("/.well-known/mcp/server-card.json", (_req, res) => {
      res.json({
        serverInfo: { name: "MnemoPay", version: PKG_VERSION },
        authentication: { required: false },
        tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        resources: [],
        prompts: [],
      });
    });

    // ── Authentication for SSE/HTTP endpoints ────────────────────────────
    const MCP_AUTH_TOKEN = process.env.MNEMOPAY_MCP_TOKEN;
    if (!MCP_AUTH_TOKEN) {
      console.error("[mnemopay-mcp] WARNING: MNEMOPAY_MCP_TOKEN not set — SSE endpoints are unauthenticated");
    }

    _httpAnonymous = !MCP_AUTH_TOKEN;

    function mcpAuth(req: any, res: any, next: any) {
      if (!MCP_AUTH_TOKEN) { next(); return; }
      const auth = req.headers.authorization;
      if (!auth || !constantTimeEqual(auth, `Bearer ${MCP_AUTH_TOKEN}`)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      req._operatorAuthed = true;
      next();
    }

    // ── Tenant provisioning (self-serve buy-path) ───────────────────────
    // Guarded by a dedicated provisioner secret — NOT the per-tenant keys and
    // NOT the MCP bearer. Only the site's Stripe webhook (holding
    // MNEMOPAY_PROVISIONER_TOKEN) may mint tenants. Mints (or idempotently
    // returns) a working `mp_…` key bound to a stable tenant agent id; that key
    // then authenticates /api/charge for the tenant's own wallet.
    const PROVISIONER_TOKEN = process.env.MNEMOPAY_PROVISIONER_TOKEN;
    if (!PROVISIONER_TOKEN) {
      console.error(
        "[mnemopay-mcp] MNEMOPAY_PROVISIONER_TOKEN not set — /tenant/provision is DISABLED (returns 503)",
      );
    }

    function provisionerAuth(req: any, res: any, next: any): void {
      if (!PROVISIONER_TOKEN) {
        res.status(503).json({ error: "Provisioning disabled — MNEMOPAY_PROVISIONER_TOKEN not configured" });
        return;
      }
      const auth = req.headers.authorization || "";
      if (!constantTimeEqual(auth, `Bearer ${PROVISIONER_TOKEN}`)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    }

    const substratePublicUrl =
      process.env.MNEMOPAY_URL ||
      (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : `http://localhost:${process.env.PORT || 3200}`);

    app.post("/tenant/provision", provisionerAuth, (req: any, res: any) => {
      try {
        const body = req.body || {};
        const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
        if (!agentId) {
          res.status(400).json({ error: "agentId is required" });
          return;
        }
        if (!isValidTenantAgentId(agentId)) {
          res.status(400).json({ error: "Invalid agentId (must match ^[A-Za-z0-9._:-]{1,128}$, no '..')" });
          return;
        }
        // Key mode follows the rail/Stripe posture: a live Stripe rail mints
        // mp_live_ keys, anything else mints mp_test_. Callers may force it with
        // body.mode for an explicit test/live split independent of the rail.
        const railIsLive =
          (process.env.MNEMOPAY_PAYMENT_RAIL || "").toLowerCase() === "stripe" &&
          (process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_");
        const mode: "test" | "live" = body.mode === "live" || body.mode === "test"
          ? body.mode
          : railIsLive ? "live" : "test";

        const minted = tenantKeys.mint({
          agentId,
          plan: typeof body.plan === "string" ? body.plan : undefined,
          email: typeof body.email === "string" ? body.email : undefined,
          mode,
        });

        // Warm the wallet so the tenant exists in the registry immediately
        // (the first charge would lazily build it anyway; doing it here surfaces
        // any tenant-cap error at provision time instead of first-call time).
        try { registry.resolve(agentId); } catch { /* cap guard — non-fatal */ }

        res.json({
          ok: true,
          agentId: minted.agentId,
          apiKey: minted.apiKey, // null on idempotent re-provision (already minted)
          created: minted.created,
          substrateUrl: substratePublicUrl,
          agentHeader: "X-MnemoPay-Agent",
          mode,
        });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err?.message || "provision failed" });
      }
    });

    // ── Streamable HTTP transport (modern MCP, used by Smithery) ────────
    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );
    const streamTransports: Record<string, InstanceType<typeof StreamableHTTPServerTransport>> = {};

    app.post("/mcp", mcpAuth, async (req: any, res: any) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && streamTransports[sessionId]) {
        // Existing session — forward message
        await streamTransports[sessionId].handleRequest(req, res, req.body);
        return;
      }
      // New session
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
      const sid = (transport as any).sessionId || crypto.randomUUID();
      streamTransports[sid] = transport;
      transport.onclose = async () => {
        delete streamTransports[sid];
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      console.error(`[mnemopay-mcp] Streamable HTTP session: ${sid}`);
    });

    app.get("/mcp", mcpAuth, async (req: any, res: any) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && streamTransports[sessionId]) {
        await streamTransports[sessionId].handleRequest(req, res);
        return;
      }
      // Legacy SSE fallback
      const transport = new SSEServerTransport("/messages", res);
      transports[transport.sessionId] = transport;
      transport.onclose = async () => {
        delete transports[transport.sessionId];
        try {
          await (agent as any).onSessionEnd();
        } catch (err) {
          console.error("[mnemopay-mcp] onclose session-end error:", err);
        }
      };
      await server.connect(transport);
      console.error(`[mnemopay-mcp] SSE session: ${transport.sessionId}`);
    });

    app.delete("/mcp", mcpAuth, async (req: any, res: any) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && streamTransports[sessionId]) {
        await streamTransports[sessionId].handleRequest(req, res);
        delete streamTransports[sessionId];
        return;
      }
      res.status(404).json({ error: "Session not found" });
    });

    app.post("/messages", mcpAuth, async (req: any, res: any) => {
      const sessionId = req.query.sessionId as string;
      if (!sessionId || typeof sessionId !== "string" || sessionId.length > 128) {
        res.status(400).json({ error: "Invalid session ID" });
        return;
      }
      const transport = transports[sessionId];
      if (!transport) { res.status(404).json({ error: "Session not found" }); return; }
      await transport.handlePostMessage(req, res, req.body);
    });

    // ── REST API ─────────────────────────────────────────────────────────
    // Every MnemoPay tool as a simple POST endpoint.
    // Works from any client: browser, React Native, curl, other agents.

    // CORS for browser/mobile access
    app.use("/api", (req: any, res: any, next: any) => {
      // CORS: restrict to configured origins only. Default blocks cross-origin to prevent CSRF on payment APIs.
      const allowedOrigin = process.env.MNEMOPAY_CORS_ORIGIN || "";
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin || "null");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      if (req.method === "OPTIONS") { res.status(204).end(); return; }
      next();
    });

    // Tool discovery
    app.get("/api/tools", mcpAuth, (_req: any, res: any) => {
      res.json({
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
        version: "0.9.3",
      });
    });

    // Resolve the acting tenant for a REST request (see precedence above).
    function actingAgentFor(req: any): Agent {
      const rawAgentHeader = req.headers["x-mnemopay-agent"];
      const headerAgentId: string | undefined = Array.isArray(rawAgentHeader) ? rawAgentHeader[0] : rawAgentHeader;
      return registry.resolve(
        authorizeTenantSelection({
          requested: headerAgentId,
          bootId: String((agent as any).agentId),
          pinned: req._tenantAgentId,
          credentialed: !!req._operatorAuthed || !!req._portalKey,
          allowAnonymous: anonTenantSelectionAllowed(),
        }),
      );
    }

    // Generic tool executor: POST /api/:tool
    app.post("/api/:tool", mcpAuth, async (req: any, res: any) => {
      const toolName = req.params.tool;
      const validTools = TOOLS.map(t => t.name);
      if (!validTools.includes(toolName)) {
        res.status(404).json({ error: `Unknown tool: ${toolName}` });
        return;
      }
      const start = Date.now();
      try {
        // Multi-tenant routing. Precedence:
        //   1. A locally-minted tenant key PINS its own agent id (set by
        //      portalKeyAuth). The key alone determines the wallet — a caller
        //      cannot point someone else's key at a different tenant via the
        //      header.
        //   2. Otherwise the `X-MnemoPay-Agent` header selects the tenant
        //      (portal-key / Bearer path — unchanged).
        //   3. Absent → boot agent.
        // Invalid/traversal ids throw (caught below → 400). Header may arrive as
        // a string or string[].
        const actingAgent = actingAgentFor(req);
        // The approver token (human-only credential) may arrive as a header so it
        // never has to pass through the agent's own tool arguments.
        const toolArgs: Record<string, any> = { ...(req.body ?? {}) };
        const approverHdr = req.headers["x-mnemopay-approver-token"];
        if (approverHdr) toolArgs._approverToken = Array.isArray(approverHdr) ? approverHdr[0] : approverHdr;
        const result = await executeTool(actingAgent, toolName, toolArgs);
        // Log usage to portal
        if (req._portalKey?.apiKey) {
          fetch(`${PORTAL_URL}/portal/log-usage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: req._portalKey.apiKey, product: "mnemopay", tool: toolName, response_ms: Date.now() - start }),
          }).catch(() => {});
        }
        try {
          res.json({ ok: true, tool: toolName, result: JSON.parse(result) });
        } catch {
          res.json({ ok: true, tool: toolName, result });
        }
      } catch (err: any) {
        res.status(400).json({ ok: false, tool: toolName, error: err.message });
      }
    });

    // ── Commerce REST endpoints ──────────────────────────────────────────
    // Higher-level shopping flows on top of the core tools.

    // One engine per tenant: a shared engine bound to the boot agent made every
    // caller spend the boot wallet and share one mandate (audit S1).
    const restCommerceEngines = new Map<string, any>();

    async function getCommerce(req: any) {
      const acting = actingAgentFor(req);
      const key = tenantIdOf(acting);
      let engine = restCommerceEngines.get(key);
      if (!engine) {
        const { CommerceEngine } = await import("../commerce.js");
        engine = new CommerceEngine(acting);
        restCommerceEngines.set(key, engine);
      }
      return engine;
    }

    app.post("/api/commerce/mandate", mcpAuth, async (req: any, res: any) => {
      try {
        const commerce = await getCommerce(req);
        commerce.setMandate(req.body);
        res.json({ ok: true, mandate: commerce.getMandate(), remainingBudget: commerce.remainingBudget });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    app.post("/api/commerce/search", mcpAuth, async (req: any, res: any) => {
      try {
        const commerce = await getCommerce(req);
        const results = await commerce.search(req.body.query, req.body.options);
        res.json({ ok: true, results, remainingBudget: commerce.remainingBudget });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    app.post("/api/commerce/purchase", mcpAuth, async (req: any, res: any) => {
      try {
        const commerce = await getCommerce(req);
        const order = await commerce.purchase(req.body.product, req.body.deliveryInstructions);
        res.json({ ok: true, order });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    app.post("/api/commerce/confirm", mcpAuth, async (req: any, res: any) => {
      try {
        const commerce = await getCommerce(req);
        const order = await commerce.confirmDelivery(req.body.orderId);
        res.json({ ok: true, order });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    app.post("/api/commerce/cancel", mcpAuth, async (req: any, res: any) => {
      try {
        const commerce = await getCommerce(req);
        const order = await commerce.cancelOrder(req.body.orderId, req.body.reason);
        res.json({ ok: true, order });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    app.get("/api/commerce/orders", mcpAuth, async (req: any, res: any) => {
      try {
        const commerce = await getCommerce(req);
        const status = req.query.status as string | undefined;
        const orders = commerce.listOrders(status);
        res.json({ ok: true, orders, summary: commerce.spendingSummary() });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    const port = parseInt(process.env.PORT || "3200", 10);
    app.listen(port, () => {
      console.error(`[mnemopay] Server on port ${port} — MCP: /mcp | REST: /api/:tool | Commerce: /api/commerce/*`);
    });
  } else {
    const transport = new StdioServerTransport();
    process.on("exit", () => {
      if ("_saveToDisk" in agent) (agent as any)._saveToDisk();
    });
    await server.connect(transport);
    console.error("[mnemopay-mcp] Server started (stdio mode)");
  }
}

// ─── Smithery sandbox — allows tool scanning without real credentials ──────

export default function createSandboxServer(): Server {
  const agent = MnemoPay.quick("smithery-sandbox");

  // Sandbox honors MNEMOPAY_TOOLS but defaults to "all" so Smithery
  // can scan the full surface during indexing.
  const allowedTools = resolveToolFilter(process.env.MNEMOPAY_TOOLS ?? "all");
  const filteredTools = TOOLS.filter(t => allowedTools.has(t.name));

  const server = new Server(
    { name: "mnemopay", version: PKG_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: filteredTools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!allowedTools.has(name)) {
      return { content: [{ type: "text", text: `Error: Tool "${name}" is disabled` }], isError: true };
    }
    const result = await executeTool(agent, name, args ?? {});
    return { content: [{ type: "text", text: result }] };
  });

  return server;
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
  });
}
