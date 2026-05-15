/**
 * MnemoPay Live Dashboard Server
 * REST API backed by the real SDK + GitHub repo monitoring
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { createLogger, createRequestLogger } = require('./logger.cjs');
const { createRateLimiter, clientKeyForRequest } = require('./rate-limit.cjs');
const { createRegistry } = require('./metrics.cjs');
const { createIdempotencyLog } = require('./idempotency.cjs');
const { createDripQueue } = require('./drip-queue.cjs');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3200;
const GITHUB_USER = process.env.GITHUB_USER || 'mnemopay';
const GH_CLI = process.env.GH_CLI || 'C:/Program Files/GitHub CLI/gh';
const BRAIN_AGENT_ID = process.env.MNEMOPAY_BRAIN_AGENT_ID || 'hosted-brain';
const DEFAULT_PLAN = process.env.MNEMOPAY_PLAN || 'free';
const DEFAULT_ACCOUNT_ID = process.env.MNEMOPAY_ACCOUNT_ID || 'default';
const CONSOLE_STORE_PATH = process.env.MNEMOPAY_CONSOLE_STORE || path.join(process.cwd(), '.mnemopay-console', 'console-store.json');
const CONSOLE_STORE_DRIVER = process.env.MNEMOPAY_CONSOLE_STORE_DRIVER || (process.env.MNEMOPAY_CONSOLE_SQLITE ? 'sqlite' : 'json');
const CONSOLE_SQLITE_PATH = process.env.MNEMOPAY_CONSOLE_SQLITE || path.join(process.cwd(), '.mnemopay-console', 'console-store.sqlite');
const CONSOLE_POSTGRES_URL = process.env.MNEMOPAY_CONSOLE_POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL;
const SESSION_COOKIE_NAME = (() => {
  const configured = process.env.MNEMOPAY_SESSION_COOKIE;
  if (configured) return configured;
  return PROD ? '__Host-mnemo_console_session' : 'mnemo_console_session';
})();
const SESSION_SECRET = process.env.MNEMOPAY_SESSION_SECRET || process.env.MNEMOPAY_SECRET || 'mnemopay-console-dev-secret';
const SESSION_TTL_MS = Math.max(3600_000, parseInt(process.env.MNEMOPAY_SESSION_TTL_MS || String(7 * 24 * 3600_000), 10));
const AUTH_CODE_TTL_MS = Math.max(60_000, parseInt(process.env.MNEMOPAY_AUTH_CODE_TTL_MS || String(10 * 60_000), 10));
const AUTH_RETURN_CODES = process.env.MNEMOPAY_AUTH_RETURN_CODES === 'true' || !PROD;
const MAX_BODY_BYTES = Math.max(1024, parseInt(process.env.MNEMOPAY_MAX_BODY_BYTES || String(1024 * 1024), 10));
const MAX_WEBHOOK_BODY_BYTES = Math.max(MAX_BODY_BYTES, parseInt(process.env.MNEMOPAY_MAX_WEBHOOK_BODY_BYTES || String(2 * 1024 * 1024), 10));
const AUDIT_RING_SIZE = Math.max(1000, parseInt(process.env.MNEMOPAY_AUDIT_RING_SIZE || '5000', 10));
const SAVE_DEBOUNCE_MS = Math.max(0, parseInt(process.env.MNEMOPAY_SAVE_DEBOUNCE_MS || '250', 10));
const CORS_ALLOWLIST = (process.env.MNEMOPAY_CORS_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const RATE_LIMIT_DISABLED = process.env.MNEMOPAY_DISABLE_RATE_LIMIT === 'true';

const log = createLogger('server');
let consoleSqlite;
let consolePostgresStore;
let consolePostgresSaveChain = Promise.resolve();

// ── Observability ───────────────────────────────────────────────────────────
const metrics = createRegistry();
const httpRequestsTotal = metrics.counter('mnemopay_http_requests_total', 'HTTP request count', ['method', 'route', 'status']);
const httpRequestDuration = metrics.histogram('mnemopay_http_request_duration_ms', 'HTTP request duration (ms)', ['route'], [5, 25, 100, 250, 500, 1000, 2500, 5000]);
const rateLimitDeniedTotal = metrics.counter('mnemopay_rate_limit_denied_total', 'Requests denied by rate limiter', ['route']);
const planGateDeniedTotal = metrics.counter('mnemopay_plan_gate_denied_total', 'Requests denied by plan gate', ['action', 'plan']);
const webhookEventsTotal = metrics.counter('mnemopay_webhook_events_total', 'Webhook events processed', ['type', 'verification', 'idempotent']);
const persistenceFailuresTotal = metrics.counter('mnemopay_persistence_failures_total', 'Failed persistence writes', ['driver']);
const persistenceLatency = metrics.histogram('mnemopay_persistence_duration_ms', 'Persistence write duration (ms)', ['driver'], [5, 25, 100, 250, 500, 1000, 5000]);
const inflightRequests = metrics.gauge('mnemopay_inflight_requests', 'Currently in-flight HTTP requests');
const processUptime = metrics.gauge('mnemopay_process_uptime_seconds', 'Process uptime in seconds');

// ── Rate limiters ───────────────────────────────────────────────────────────
const generalLimiter = createRateLimiter({
  capacity: parseInt(process.env.MNEMOPAY_RATE_GENERAL_CAPACITY || '120', 10),
  refillPerSec: parseFloat(process.env.MNEMOPAY_RATE_GENERAL_REFILL || '2'),
});
const authChallengeLimiter = createRateLimiter({
  capacity: parseInt(process.env.MNEMOPAY_RATE_AUTH_CAPACITY || '5', 10),
  refillPerSec: parseFloat(process.env.MNEMOPAY_RATE_AUTH_REFILL || '0.0833'), // ~5/min
});
const webhookLimiter = createRateLimiter({
  capacity: parseInt(process.env.MNEMOPAY_RATE_WEBHOOK_CAPACITY || '60', 10),
  refillPerSec: parseFloat(process.env.MNEMOPAY_RATE_WEBHOOK_REFILL || '5'),
});

// ── Webhook idempotency ─────────────────────────────────────────────────────
const webhookIdempotency = createIdempotencyLog({ ttlMs: 7 * 24 * 60 * 60_000 });

// ── Initialize the real SDK ─────────────────────────────────────────────────
let agent;
let brain;
let reasoner; // ReasoningPostProcessor — real LLM reasoning
let hyde;     // HyDEGenerator — query expansion
let reranker; // CrossEncoderReranker — post-recall rerank
let entityGraph; // SDK EntityGraph (typed edges, bitemporal, spreading activation)
let extractEntitiesFn; // LLM-backed entity extraction with deterministic fallback
let dripQueue; // Onboarding drip — initialized once sqlite is open in loadConsoleStore()
const brainMemories = new Map();
const brainEntities = new Map();
const brainEdges = new Map();
const brainReasoningTraces = new Map();
const apiKeys = new Map();
const usageCounters = new Map();
const accountPlans = new Map();
const consoleSessions = new Map();
const accountMembers = new Map();
const authChallenges = new Map();
const auditEvents = [];

function tryRequireSDK() {
  // Production path: SDK installed via npm as @mnemopay/sdk (Dockerfile vendors
  // the locally-built dist into node_modules and strips the ESM-only exports
  // field so CJS require() works).
  // Dev path: fall back to local ../dist/index.js when running outside a build.
  const attempts = [
    () => {
      const main = require('@mnemopay/sdk');
      // main re-exports RecallEngine from /recall, so we can just reuse it.
      return { main, recall: { RecallEngine: main.RecallEngine }, source: '@mnemopay/sdk' };
    },
    () => ({
      main: require('../dist/index.js'),
      recall: require('../dist/recall/engine.js'),
      source: '../dist',
    }),
  ];
  let lastErr;
  for (const attempt of attempts) {
    try { return attempt(); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

try {
  const SDK = tryRequireSDK();
  agent = SDK.main.MnemoPay.quick(process.env.MNEMOPAY_AGENT_ID || 'dashboard-live');
  const RecallEngine = SDK.recall.RecallEngine || SDK.main.RecallEngine;
  if (RecallEngine) {
    brain = new RecallEngine({
      strategy: process.env.MNEMOPAY_BRAIN_STRATEGY || 'hybrid',
      embeddingProvider: process.env.MNEMOPAY_BRAIN_EMBEDDING || 'local',
      agentId: BRAIN_AGENT_ID,
      openaiApiKey: process.env.OPENAI_API_KEY,
    });
  }
  // Optional: real LLM reasoning. Off unless an API key is set.
  // Provider precedence:
  //   1. MNEMOPAY_REASONING_PROVIDER explicit override (anthropic|openai)
  //   2. ANTHROPIC_API_KEY → anthropic
  //   3. OPENAI_API_KEY → openai
  const providerOverride = (process.env.MNEMOPAY_REASONING_PROVIDER || '').toLowerCase();
  const llmProvider = providerOverride === 'anthropic' || providerOverride === 'openai'
    ? providerOverride
    : (process.env.ANTHROPIC_API_KEY ? 'anthropic' : (process.env.OPENAI_API_KEY ? 'openai' : null));
  const llmKey = llmProvider === 'anthropic' ? process.env.ANTHROPIC_API_KEY
    : llmProvider === 'openai' ? process.env.OPENAI_API_KEY
    : null;
  const ReasoningPostProcessor = SDK.main.ReasoningPostProcessor;
  if (ReasoningPostProcessor && llmKey) {
    reasoner = new ReasoningPostProcessor({
      provider: llmProvider,
      apiKey: llmKey,
      model: process.env.MNEMOPAY_REASONING_MODEL,
      maxTokens: parseInt(process.env.MNEMOPAY_REASONING_MAX_TOKENS || '1024', 10),
      includeChainOfThought: process.env.MNEMOPAY_REASONING_COT === 'true',
    });
  }
  // Optional: HyDE query expansion. Off unless an API key is set.
  const HyDEGenerator = SDK.main.HyDEGenerator;
  if (HyDEGenerator && llmKey) {
    hyde = new HyDEGenerator({
      provider: llmProvider,
      apiKey: llmKey,
      model: process.env.MNEMOPAY_HYDE_MODEL,
      numHypotheses: parseInt(process.env.MNEMOPAY_HYDE_HYPOTHESES || '3', 10),
    });
  }
  // Optional: cross-encoder reranker. Lazy-loads its model on first use.
  const CrossEncoderReranker = SDK.main.CrossEncoderReranker;
  if (CrossEncoderReranker && process.env.MNEMOPAY_RERANKER_ENABLED === 'true') {
    reranker = new CrossEncoderReranker({
      model: process.env.MNEMOPAY_RERANKER_MODEL,
      maxCandidates: parseInt(process.env.MNEMOPAY_RERANKER_MAX_CANDIDATES || '50', 10),
    });
  }
  if (SDK.main.EntityGraph) entityGraph = new SDK.main.EntityGraph();
  if (SDK.main.extractEntities) extractEntitiesFn = SDK.main.extractEntities;
  console.log(`[sdk] initialized from ${SDK.source} (reasoner=${!!reasoner}, hyde=${!!hyde}, reranker=${!!reranker})`);
} catch (e) {
  console.error('[sdk] Failed to load SDK:', e.message);
  console.log('[sdk] Falling back to inline implementation');
  agent = createFallbackAgent();
}

function createFallbackAgent() {
  const memories = new Map();
  const transactions = new Map();
  const auditLog = [];
  let wallet = 0, reputation = 0.5;

  function uuid() { return crypto.randomUUID(); }
  function autoScore(c) {
    let s = 0.5;
    if (c.length > 200) s += 0.1;
    if (/error|fail|crash|critical|bug/i.test(c)) s += 0.2;
    if (/success|complete|paid|delivered/i.test(c)) s += 0.15;
    if (/prefer|always|never|important|must/i.test(c)) s += 0.15;
    return Math.min(s, 1.0);
  }
  function computeScore(imp, lastAcc, accCnt, decay = 0.05) {
    const hrs = (Date.now() - new Date(lastAcc).getTime()) / 3600000;
    return imp * Math.exp(-decay * hrs) * (1 + Math.log(1 + accCnt));
  }

  return {
    agentId: 'dashboard-live',
    async remember(content, opts = {}) {
      const importance = opts.importance ?? autoScore(content);
      const id = uuid();
      const now = new Date();
      memories.set(id, { id, agentId: 'dashboard-live', content, importance: Math.min(Math.max(importance, 0), 1), score: importance, createdAt: now, lastAccessed: now, accessCount: 0, tags: opts.tags || [] });
      auditLog.push({ id: uuid(), agentId: 'dashboard-live', action: 'memory:stored', details: { id, content: content.slice(0, 100), importance }, createdAt: now });
      return id;
    },
    async recall(queryOrLimit, maybeLimit) {
      const limit = typeof queryOrLimit === 'number' ? queryOrLimit : (maybeLimit ?? 5);
      const all = Array.from(memories.values()).map(m => { m.score = computeScore(m.importance, m.lastAccessed, m.accessCount); return m; });
      all.sort((a, b) => b.score - a.score);
      const results = all.slice(0, limit);
      results.forEach(m => { m.lastAccessed = new Date(); m.accessCount++; });
      return results;
    },
    async forget(id) { return memories.delete(id); },
    async reinforce(id, boost = 0.1) {
      const m = memories.get(id); if (!m) return false;
      m.importance = Math.min(m.importance + boost, 1.0); m.lastAccessed = new Date();
      auditLog.push({ id: uuid(), agentId: 'dashboard-live', action: 'memory:reinforced', details: { id, boost }, createdAt: new Date() });
      return true;
    },
    async consolidate() {
      let pruned = 0;
      for (const [id, m] of memories) { if (computeScore(m.importance, m.lastAccessed, m.accessCount) < 0.01) { memories.delete(id); pruned++; } }
      return pruned;
    },
    async charge(amount, reason) {
      const id = uuid(); const tx = { id, agentId: 'dashboard-live', amount, reason, status: 'pending', createdAt: new Date() };
      transactions.set(id, tx);
      auditLog.push({ id: uuid(), agentId: 'dashboard-live', action: 'payment:pending', details: { id, amount, reason }, createdAt: new Date() });
      return { ...tx };
    },
    async settle(txId) {
      const tx = transactions.get(txId); if (!tx || tx.status !== 'pending') return null;
      tx.status = 'completed'; tx.completedAt = new Date();
      wallet += tx.amount; reputation = Math.min(reputation + 0.01, 1.0);
      const oneHourAgo = Date.now() - 3600000; let reinforced = 0;
      for (const m of memories.values()) { if (new Date(m.lastAccessed).getTime() > oneHourAgo) { m.importance = Math.min(m.importance + 0.05, 1.0); reinforced++; } }
      auditLog.push({ id: uuid(), agentId: 'dashboard-live', action: 'payment:completed', details: { id: txId, amount: tx.amount, reinforced }, createdAt: new Date() });
      return { ...tx };
    },
    async refund(txId) {
      const tx = transactions.get(txId); if (!tx) return null;
      if (tx.status === 'completed') { wallet = Math.max(wallet - tx.amount, 0); reputation = Math.max(reputation - 0.05, 0); }
      tx.status = 'refunded';
      auditLog.push({ id: uuid(), agentId: 'dashboard-live', action: 'payment:refunded', details: { id: txId, amount: tx.amount }, createdAt: new Date() });
      return { ...tx };
    },
    balance() { return { wallet, reputation }; },
    profile() { return { id: 'dashboard-live', reputation, wallet, memoriesCount: memories.size, transactionsCount: transactions.size }; },
    logs(limit = 30) { return auditLog.slice(-limit).reverse(); },
    history(limit = 20) { return Array.from(transactions.values()).reverse().slice(0, limit); },
  };
}

// ── GitHub repo cache ───────────────────────────────────────────────────────
let repoCache = { data: null, lastFetch: 0 };
const REPO_CACHE_TTL = 60_000; // 1 minute

const MONITORED_REPOS = [
  { upstream: 'coinbase/agentkit', fork: `${GITHUB_USER}/agentkit`, branch: 'feat/mnemopay-action-provider' },
  { upstream: 'elizaOS/eliza', fork: `${GITHUB_USER}/eliza`, branch: 'feat/plugin-mnemopay' },
  { upstream: 'mastra-ai/mastra', fork: `${GITHUB_USER}/mastra`, branch: 'feat/mnemopay-integration' },
  { upstream: 'coinbase/x402', fork: `${GITHUB_USER}/x402`, branch: 'feat/mnemopay-middleware' },
  { upstream: 'Xiaoher-C/agentbnb', fork: `${GITHUB_USER}/agentbnb`, branch: 'feat/mnemopay-adapter' },
];

async function fetchRepoStatus() {
  if (Date.now() - repoCache.lastFetch < REPO_CACHE_TTL && repoCache.data) return repoCache.data;

  const results = [];
  for (const repo of MONITORED_REPOS) {
    try {
      // Get fork info
      const forkJson = execSync(`"${GH_CLI}" repo view ${repo.fork} --json name,stargazerCount,updatedAt,url,description `, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
      const fork = JSON.parse(forkJson);

      // Get upstream stars
      let upstreamStars = 0;
      try {
        const upJson = execSync(`"${GH_CLI}" repo view ${repo.upstream} --json stargazerCount `, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
        upstreamStars = JSON.parse(upJson).stargazerCount;
      } catch (e) {}

      // Get PR status
      let pr = null;
      try {
        const prJson = execSync(`"${GH_CLI}" pr list --repo ${repo.upstream} --author ${GITHUB_USER} --json number,title,state,url,createdAt,reviews,statusCheckRollup --limit 1 `, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
        const prs = JSON.parse(prJson);
        if (prs.length > 0) pr = prs[0];
      } catch (e) {}

      // Also check PRs on own fork
      if (!pr) {
        try {
          const prJson = execSync(`"${GH_CLI}" pr list --repo ${repo.fork} --json number,title,state,url,createdAt --limit 1 `, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
          const prs = JSON.parse(prJson);
          if (prs.length > 0) pr = prs[0];
        } catch (e) {}
      }

      results.push({
        name: repo.upstream,
        fork: repo.fork,
        branch: repo.branch,
        forkUrl: fork.url,
        upstreamStars,
        forkStars: fork.stargazerCount,
        updatedAt: fork.updatedAt,
        description: fork.description,
        pr: pr ? { number: pr.number, title: pr.title, state: pr.state, url: pr.url, createdAt: pr.createdAt } : null,
        status: pr ? (pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'pr-open' : 'pr-closed') : 'forked',
      });
    } catch (e) {
      results.push({ name: repo.upstream, fork: repo.fork, branch: repo.branch, status: 'error', error: e.message });
    }
  }

  repoCache = { data: results, lastFetch: Date.now() };
  return results;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

class BodyTooLargeError extends Error {
  constructor(limit) {
    super(`request body exceeds ${limit} bytes`);
    this.name = 'BodyTooLargeError';
    this.status = 413;
  }
}

function readRawBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let overLimit = false;
    req.on('data', (chunk) => {
      if (overLimit) return; // drain silently so the socket can close cleanly
      total += chunk.length;
      if (total > maxBytes) {
        overLimit = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overLimit) reject(new BodyTooLargeError(maxBytes));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function readBody(req, opts = {}) {
  const raw = await readRawBody(req, opts);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function errorJson(res, e, fallbackStatus = 400) {
  const status = e.status || fallbackStatus;
  return json(res, { ok: false, error: e.message, details: e.details || undefined }, status);
}

function resolveCorsOrigin(origin) {
  if (!origin) return null;
  if (CORS_ALLOWLIST.length === 0) return PROD ? null : origin;
  return CORS_ALLOWLIST.includes(origin) ? origin : null;
}

function applyCors(req, res) {
  const origin = resolveCorsOrigin(String(req.headers.origin || ''));
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MnemoPay-Account, Stripe-Signature, X-Request-Id');
}

function applySecurityHeaders(res, { html = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (html) {
    // Dashboard HTML embeds Tailwind + React/Babel from CDN (see index.html).
    // CSP must allow those origins or the page renders blank.
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
    ].join('; '));
  }
}

function tooManyRequests(res, retryAfterSec, routeLabel) {
  rateLimitDeniedTotal.inc({ route: routeLabel });
  res.setHeader('Retry-After', String(retryAfterSec));
  return json(res, { ok: false, error: 'rate limit exceeded', retryAfterSec }, 429);
}

function rateLimit(req, res, limiter, routeLabel, keySuffix = '') {
  if (RATE_LIMIT_DISABLED) return true;
  const key = `${clientKeyForRequest(req)}:${keySuffix}`;
  const result = limiter.consume(key);
  if (!result.ok) {
    tooManyRequests(res, result.retryAfterSec, routeLabel);
    return false;
  }
  return true;
}

function routeLabelFromPath(pathname, method) {
  if (pathname === '/' || pathname === '/index.html') return `${method} /`;
  // Normalize ids in known patterns so we don't blow up the cardinality.
  const normalized = pathname
    .replace(/^\/api\/v1\/developer\/api-keys\/[^/]+\/revoke$/, '/api/v1/developer/api-keys/:id/revoke')
    .replace(/^\/api\/v1\/brain\/namespaces\/[^/]+\/(graph|enrich|export)$/, '/api/v1/brain/namespaces/:id/$1')
    .replace(/^\/api\/v1\/brain\/namespaces\/[^/]+$/, '/api/v1/brain/namespaces/:id')
    .replace(/^\/api\/memories\/[^/]+$/, '/api/memories/:id');
  return `${method} ${normalized}`;
}

function deploymentReadiness() {
  const checks = [];
  const add = (id, ok, message, severity = 'required') => {
    checks.push({ id, ok: !!ok, severity, message });
  };
  const defaultSecret = SESSION_SECRET === 'mnemopay-console-dev-secret';
  add('session-secret', !defaultSecret, defaultSecret ? 'Set MNEMOPAY_SESSION_SECRET or MNEMOPAY_SECRET.' : 'Session secret configured.');
  // Both sqlite (with persistent Fly volume) and postgres (Neon/RDS) are
  // valid production stores. JSON is dev-only.
  const isProd = process.env.NODE_ENV === 'production';
  const validProdDriver = CONSOLE_STORE_DRIVER === 'postgres' || CONSOLE_STORE_DRIVER === 'sqlite';
  add('store-driver', validProdDriver || !isProd, `Store driver is ${CONSOLE_STORE_DRIVER}.`, isProd ? 'required' : 'recommended');
  add('postgres-url', CONSOLE_STORE_DRIVER !== 'postgres' || !!CONSOLE_POSTGRES_URL, 'Postgres/Neon URL required when using postgres store.');
  add('sqlite-path', CONSOLE_STORE_DRIVER !== 'sqlite' || !!CONSOLE_SQLITE_PATH, 'SQLite path required when using sqlite store.');
  add('stripe-secret', !!process.env.STRIPE_SECRET_KEY, process.env.STRIPE_SECRET_KEY ? 'Stripe secret configured.' : 'Set STRIPE_SECRET_KEY for checkout sessions.', 'recommended');
  add('stripe-webhook-secret', !!process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET ? 'Stripe webhook secret configured.' : 'Set STRIPE_WEBHOOK_SECRET before live webhooks.', 'recommended');
  add('resend-key', !!process.env.RESEND_API_KEY, process.env.RESEND_API_KEY ? 'Resend API key configured.' : 'Set RESEND_API_KEY for passwordless email delivery.', 'recommended');
  add('auth-email-from', !!process.env.MNEMOPAY_AUTH_EMAIL_FROM, process.env.MNEMOPAY_AUTH_EMAIL_FROM ? 'Auth email sender configured.' : 'Set MNEMOPAY_AUTH_EMAIL_FROM for passwordless email delivery.', 'recommended');
  add('public-url', !!process.env.MNEMOPAY_PUBLIC_URL, process.env.MNEMOPAY_PUBLIC_URL ? 'Public URL configured.' : 'Set MNEMOPAY_PUBLIC_URL for Stripe return URLs.', 'recommended');
  const requiredOk = checks.filter((check) => check.severity === 'required').every((check) => check.ok);
  const recommendedOk = checks.every((check) => check.ok);
  return {
    ok: requiredOk,
    productionReady: requiredOk && recommendedOk,
    storeDriver: CONSOLE_STORE_DRIVER,
    nodeEnv: process.env.NODE_ENV || 'development',
    checks,
  };
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function hashAuthCode(code) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(code)).digest('hex');
}

function hmac(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(value)).digest('base64url');
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  return header.split(';').reduce((cookies, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    return cookies;
  }, {});
}

function signedSessionCookie(sessionId) {
  return `${sessionId}.${hmac(sessionId)}`;
}

function verifySessionCookie(value) {
  const raw = String(value || '');
  const idx = raw.lastIndexOf('.');
  if (idx < 1) return null;
  const sessionId = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = hmac(sessionId);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return sessionId;
}

function publicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    accountId: session.accountId,
    email: session.email || null,
    name: session.name || null,
    role: session.role || roleForPrincipal(session.accountId, session.email),
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt || null,
  };
}

function memberKey(accountId, email) {
  return `${accountId}:${String(email || '').toLowerCase()}`;
}

function membersForAccount(accountId) {
  return Array.from(accountMembers.values())
    .filter((member) => member.accountId === accountId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function publicMember(member) {
  return {
    id: member.id,
    accountId: member.accountId,
    email: member.email,
    name: member.name || null,
    role: member.role,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt || null,
  };
}

function roleForPrincipal(accountId, email) {
  if (!email) return membersForAccount(accountId).length === 0 ? 'owner' : 'admin';
  return accountMembers.get(memberKey(accountId, email))?.role || (membersForAccount(accountId).length === 0 ? 'owner' : 'member');
}

function upsertAccountMember(accountId, { email, name, role = 'member', source = 'manual' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('email required');
  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) throw new Error(`unsupported role: ${role}`);
  const now = new Date().toISOString();
  const id = memberKey(accountId, normalizedEmail);
  const existing = accountMembers.get(id);
  const member = {
    id,
    accountId,
    email: normalizedEmail,
    name: name ? String(name).slice(0, 120) : existing?.name || null,
    role,
    source,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  accountMembers.set(id, member);
  recordAudit(accountId, existing ? 'auth.member.updated' : 'auth.member.created', `member:${normalizedEmail}`, { email: normalizedEmail, role, source });
  saveConsoleStore();
  return member;
}

function ensureSessionMembership(session) {
  if (!session.email) {
    session.role = roleForPrincipal(session.accountId, session.email);
    return session.role;
  }
  let role = roleForPrincipal(session.accountId, session.email);
  if (!accountMembers.has(memberKey(session.accountId, session.email))) {
    role = membersForAccount(session.accountId).length === 0 ? 'owner' : 'member';
    upsertAccountMember(session.accountId, { email: session.email, name: session.name, role, source: 'session-login' });
  }
  session.role = role;
  return role;
}

function roleRank(role) {
  return { owner: 4, admin: 3, member: 2, viewer: 1 }[role] || 0;
}

function assertSessionRole(req, accountId, minimum = 'admin') {
  const session = sessionForRequest(req);
  if (!session || session.accountId !== accountId) throw Object.assign(new Error('signed session required'), { status: 401 });
  ensureSessionMembership(session);
  if (roleRank(session.role) < roleRank(minimum)) throw Object.assign(new Error('insufficient role'), { status: 403, details: { required: minimum, role: session.role } });
  return session;
}

function sessionForRequest(req) {
  const sessionId = verifySessionCookie(parseCookies(req)[SESSION_COOKIE_NAME]);
  if (!sessionId) return null;
  const session = consoleSessions.get(sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    consoleSessions.delete(sessionId);
    saveConsoleStore();
    return null;
  }
  session.lastSeenAt = new Date().toISOString();
  return session;
}

function setSessionCookie(res, sessionId) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedSessionCookie(sessionId))}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

function createAuthChallenge({ accountId, email, name }) {
  const normalizedAccountId = String(accountId || DEFAULT_ACCOUNT_ID).trim().slice(0, 120);
  const normalizedEmail = String(email || '').trim().toLowerCase().slice(0, 180);
  if (!normalizedAccountId) throw new Error('accountId required');
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('valid email required');
  const now = new Date();
  const code = String(crypto.randomInt(100000, 1000000));
  const challenge = {
    id: `auth_${uuid()}`,
    accountId: normalizedAccountId,
    email: normalizedEmail,
    name: name ? String(name).slice(0, 120) : null,
    codeHash: hashAuthCode(code),
    attempts: 0,
    maxAttempts: 5,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS).toISOString(),
    usedAt: null,
  };
  authChallenges.set(challenge.id, challenge);
  recordAudit(challenge.accountId, 'auth.challenge.created', `auth:${challenge.id}`, { email: challenge.email, expiresAt: challenge.expiresAt });
  saveConsoleStore();
  return { challenge, code };
}

function publicAuthChallenge(challenge, code) {
  return {
    id: challenge.id,
    accountId: challenge.accountId,
    email: challenge.email,
    expiresAt: challenge.expiresAt,
    delivery: challenge.delivery || null,
    devCode: AUTH_RETURN_CODES ? code : undefined,
  };
}

async function deliverAuthChallenge(challenge, code) {
  const { sendAuthCodeEmail } = require('./auth-email.cjs');
  try {
    const delivery = await sendAuthCodeEmail({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.MNEMOPAY_AUTH_EMAIL_FROM,
      to: challenge.email,
      code,
      accountId: challenge.accountId,
    });
    challenge.delivery = delivery;
    recordAudit(challenge.accountId, delivery.delivered ? 'auth.challenge.email.sent' : 'auth.challenge.email.skipped', `auth:${challenge.id}`, {
      email: challenge.email,
      provider: delivery.provider,
      reason: delivery.reason || null,
      id: delivery.id || null,
    });
    saveConsoleStore();
    return delivery;
  } catch (e) {
    challenge.delivery = { delivered: false, provider: 'resend', reason: e.message };
    recordAudit(challenge.accountId, 'auth.challenge.email.failed', `auth:${challenge.id}`, { email: challenge.email, error: e.message });
    saveConsoleStore();
    if (process.env.NODE_ENV === 'production') throw e;
    return challenge.delivery;
  }
}

function verifyAuthChallenge({ challengeId, code }) {
  const challenge = authChallenges.get(String(challengeId || ''));
  if (!challenge) throw Object.assign(new Error('auth challenge not found'), { status: 404 });
  if (challenge.usedAt) throw Object.assign(new Error('auth challenge already used'), { status: 409 });
  if (new Date(challenge.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error('auth challenge expired'), { status: 410 });
  if (challenge.attempts >= challenge.maxAttempts) throw Object.assign(new Error('too many auth attempts'), { status: 429 });
  challenge.attempts++;
  if (hashAuthCode(String(code || '').trim()) !== challenge.codeHash) {
    saveConsoleStore();
    throw Object.assign(new Error('invalid auth code'), { status: 401, details: { attempts: challenge.attempts, maxAttempts: challenge.maxAttempts } });
  }
  challenge.usedAt = new Date().toISOString();
  const session = createConsoleSession({ accountId: challenge.accountId, email: challenge.email, name: challenge.name });
  recordAudit(challenge.accountId, 'auth.challenge.verified', `auth:${challenge.id}`, { email: challenge.email, sessionId: session.id });
  saveConsoleStore();
  return { challenge, session };
}

function blankUsage() {
  return { brainWrites: 0, brainQueries: 0, railCharges: 0, railSettlements: 0 };
}

const PLAN_CATALOG = {
  free: {
    plan: 'free',
    name: 'Free',
    monthlyCents: 0,
    missions: 5,
    llmCapCents: 100,
    seats: 1,
    features: ['public charters', 'hosted brain dev mode'],
  },
  pro: {
    plan: 'pro',
    name: 'Pro',
    monthlyCents: 2900,
    yearlyCents: 29000,
    missions: 100,
    llmCapCents: 2500,
    seats: 1,
    features: ['private charters', 'EU AI Act audit bundles', 'hosted brain namespaces'],
  },
  team: {
    plan: 'team',
    name: 'Team',
    monthlyCents: 9900,
    yearlyCents: 99000,
    missions: 'unlimited',
    llmCapCents: 10000,
    seats: 5,
    features: ['marketplace publish', 'team audit feed', 'BYOK above cap'],
  },
  enterprise: {
    plan: 'enterprise',
    name: 'Enterprise',
    monthlyCents: null,
    missions: 'custom',
    llmCapCents: null,
    seats: 'custom',
    features: ['SLA', 'on-prem', 'KYA governance', '7y audit retention'],
  },
};

const PRICE_LOOKUP_TO_PLAN = {
  mnemopay_pro_monthly: { plan: 'pro', interval: 'monthly' },
  mnemopay_pro_yearly: { plan: 'pro', interval: 'yearly' },
  mnemopay_team_monthly: { plan: 'team', interval: 'monthly' },
  mnemopay_team_yearly: { plan: 'team', interval: 'yearly' },
  praetor_pro_monthly: { plan: 'pro', interval: 'monthly' },
  praetor_pro_yearly: { plan: 'pro', interval: 'yearly' },
  praetor_team_monthly: { plan: 'team', interval: 'monthly' },
  praetor_team_yearly: { plan: 'team', interval: 'yearly' },
};

function usageForAccount(accountId) {
  if (!usageCounters.has(accountId)) usageCounters.set(accountId, blankUsage());
  return usageCounters.get(accountId);
}

function defaultAccountPlan(accountId) {
  const plan = PLAN_CATALOG[DEFAULT_PLAN] ? DEFAULT_PLAN : 'free';
  return {
    accountId,
    plan,
    interval: 'monthly',
    status: 'active',
    source: 'default',
    priceLookupKey: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    checkoutSessionId: null,
    provisionedAt: null,
    updatedAt: null,
    limits: PLAN_CATALOG[plan],
  };
}

function accountPlanFor(accountId) {
  const current = accountPlans.get(accountId);
  if (current) return { ...current, limits: PLAN_CATALOG[current.plan] || PLAN_CATALOG.free };
  return defaultAccountPlan(accountId);
}

function createConsoleSession({ accountId, email, name }) {
  const now = new Date();
  const normalizedEmail = email ? String(email).trim().toLowerCase().slice(0, 180) : null;
  const role = roleForPrincipal(String(accountId || DEFAULT_ACCOUNT_ID).slice(0, 120), normalizedEmail);
  const session = {
    id: `sess_${uuid()}`,
    accountId: String(accountId || DEFAULT_ACCOUNT_ID).slice(0, 120),
    email: normalizedEmail,
    name: name ? String(name).slice(0, 120) : null,
    role,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };
  consoleSessions.set(session.id, session);
  ensureSessionMembership(session);
  recordAudit(session.accountId, 'auth.session.created', `session:${session.id}`, { email: session.email, name: session.name });
  saveConsoleStore();
  return session;
}

function missionUsage(usage) {
  return (usage.brainWrites || 0) + (usage.brainQueries || 0) + (usage.railCharges || 0);
}

class PlanLimitError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PlanLimitError';
    this.status = 402;
    this.details = details;
  }
}

function meteringSnapshot(accountId) {
  const usage = usageForAccount(accountId);
  const billing = accountPlanFor(accountId);
  const limits = billing.limits || PLAN_CATALOG.free;
  const missionsUsed = missionUsage(usage);
  const missionLimit = limits.missions;
  const unlimited = missionLimit === 'unlimited' || missionLimit === 'custom';
  const missionsRemaining = unlimited ? null : Math.max(0, Number(missionLimit || 0) - missionsUsed);
  return {
    accountId,
    period: 'lifetime-prototype',
    billing,
    usage,
    missions: {
      used: missionsUsed,
      limit: missionLimit,
      remaining: missionsRemaining,
      overLimit: !unlimited && missionsUsed >= Number(missionLimit || 0),
    },
    llmCapCents: limits.llmCapCents,
    seats: limits.seats,
    features: limits.features || [],
  };
}

function assertPlanAllows(accountId, action) {
  const snapshot = meteringSnapshot(accountId);
  const missionActions = new Set(['brain.write', 'brain.query', 'rail.charge']);
  if (!missionActions.has(action)) return snapshot;
  if (snapshot.missions.overLimit) {
    planGateDeniedTotal.inc({ action, plan: snapshot.billing.plan });
    throw new PlanLimitError(`mission limit reached for ${snapshot.billing.plan}`, {
      action,
      plan: snapshot.billing.plan,
      used: snapshot.missions.used,
      limit: snapshot.missions.limit,
    });
  }
  return snapshot;
}

function verifyStripeWebhookSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!secret) return { ok: true, mode: 'unsigned-dev' };
  const parts = String(signatureHeader || '').split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    if (key && value) {
      if (!acc[key]) acc[key] = [];
      acc[key].push(value);
    }
    return acc;
  }, {});
  const timestamp = Number(parts.t?.[0]);
  if (!timestamp || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp outside tolerance' };
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const signatures = parts.v1 || [];
  const ok = signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  });
  return ok ? { ok: true, mode: 'verified' } : { ok: false, reason: 'signature mismatch' };
}

function provisioningBodyFromStripeEvent(event, fallbackAccountId) {
  const object = event?.data?.object || {};
  const metadata = object.metadata || {};
  const subscriptionMetadata = object.subscription_details?.metadata || {};
  const merged = { ...subscriptionMetadata, ...metadata };
  const customerEmail = object.customer_email
    || object.customer_details?.email
    || merged.email
    || null;
  return {
    accountId: merged.accountId || object.client_reference_id || fallbackAccountId,
    plan: merged.plan,
    interval: merged.interval,
    priceLookupKey: merged.priceLookupKey || merged.lookupKey,
    status: object.status === 'canceled' ? 'canceled' : (object.status || 'active'),
    source: 'stripe-webhook',
    stripeCustomerId: object.customer || object.customer_id || null,
    stripeSubscriptionId: object.subscription || object.id || null,
    checkoutSessionId: event.type === 'checkout.session.completed' ? object.id : null,
    createApiKey: merged.createApiKey !== 'false',
    customerEmail,
    tier: merged.tier || merged.product || null,
  };
}

function requestBaseUrl(req) {
  return String(process.env.MNEMOPAY_PUBLIC_URL || req.headers.origin || `http://localhost:${PORT}`).replace(/\/$/, '');
}

function lookupKeyForPlan(plan, interval) {
  const cleanPlan = String(plan || '').toLowerCase();
  const cleanInterval = String(interval || 'monthly').toLowerCase();
  if (!['pro', 'team'].includes(cleanPlan)) throw new Error('live checkout is available for pro and team plans');
  if (!['monthly', 'yearly'].includes(cleanInterval)) throw new Error('live checkout interval must be monthly or yearly');
  return `mnemopay_${cleanPlan}_${cleanInterval}`;
}

function stripeBillingClient() {
  const { createStripeBillingClient } = require('./stripe-billing.cjs');
  return createStripeBillingClient({ secretKey: process.env.STRIPE_SECRET_KEY });
}

async function createBillingCheckoutSession(req, body, accountId) {
  const lookupKey = body.priceLookupKey ? String(body.priceLookupKey).slice(0, 120) : lookupKeyForPlan(body.plan, body.interval);
  const mapped = PRICE_LOOKUP_TO_PLAN[lookupKey];
  if (!mapped) throw new Error(`unsupported priceLookupKey: ${lookupKey}`);
  const baseUrl = requestBaseUrl(req);
  const successUrl = String(body.successUrl || `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`).slice(0, 500);
  const cancelUrl = String(body.cancelUrl || `${baseUrl}/?checkout=cancel`).slice(0, 500);
  const billing = accountPlanFor(accountId);
  const session = await stripeBillingClient().createCheckoutSession({
    accountId,
    priceLookupKey: lookupKey,
    priceId: body.priceId ? String(body.priceId).slice(0, 180) : null,
    plan: mapped.plan,
    interval: mapped.interval,
    successUrl,
    cancelUrl,
    customer: billing.stripeCustomerId || body.stripeCustomerId || null,
    customerEmail: body.customerEmail || null,
  });
  recordAudit(accountId, 'billing.stripe.checkout.created', `stripe:${session.id || 'checkout'}`, {
    sessionId: session.id || null,
    priceLookupKey: lookupKey,
    plan: mapped.plan,
    interval: mapped.interval,
  });
  saveConsoleStore();
  return { session, priceLookupKey: lookupKey, plan: mapped.plan, interval: mapped.interval };
}

async function createBillingPortalSession(req, body, accountId) {
  const billing = accountPlanFor(accountId);
  const customer = body.customerId || body.stripeCustomerId || billing.stripeCustomerId;
  const baseUrl = requestBaseUrl(req);
  const returnUrl = String(body.returnUrl || `${baseUrl}/?billing=portal`).slice(0, 500);
  const session = await stripeBillingClient().createPortalSession({ customer, returnUrl });
  recordAudit(accountId, 'billing.stripe.portal.created', `stripe:${session.id || 'portal'}`, {
    sessionId: session.id || null,
    customer,
  });
  saveConsoleStore();
  return { session, customer };
}

function publicApiKey(key) {
  return {
    id: key.id,
    accountId: key.accountId,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt || null,
    revokedAt: key.revokedAt || null,
  };
}

function publicAuditEvent(event) {
  return {
    id: event.id,
    accountId: event.accountId,
    action: event.action,
    subject: event.subject,
    details: event.details || {},
    createdAt: event.createdAt,
  };
}

function recordAudit(accountId, action, subject, details = {}) {
  const event = {
    id: `evt_${uuid()}`,
    accountId,
    action,
    subject,
    details,
    createdAt: new Date().toISOString(),
  };
  auditEvents.push(event);
  // Persist before eviction so durable stores see every event. We only drop
  // the in-memory tail; Postgres/SQLite hold the full history thanks to
  // append-only ON CONFLICT DO NOTHING inserts.
  if (auditEvents.length > AUDIT_RING_SIZE) {
    auditEvents.splice(0, auditEvents.length - AUDIT_RING_SIZE);
  }
  return event;
}

function accountIdForRequest(req) {
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m?.[1]) {
    const keyHash = hashSecret(m[1].trim());
    const key = Array.from(apiKeys.values()).find((k) => k.keyHash === keyHash && !k.revokedAt);
    if (key) {
      key.lastUsedAt = new Date().toISOString();
      saveConsoleStore();
      return key.accountId;
    }
  }
  const session = sessionForRequest(req);
  if (session?.accountId) return session.accountId;
  const headerAccount = req.headers['x-mnemopay-account'];
  return String(Array.isArray(headerAccount) ? headerAccount[0] : headerAccount || DEFAULT_ACCOUNT_ID).slice(0, 120);
}

function openConsoleSqlite() {
  if (consoleSqlite) return consoleSqlite;
  // Optional dependency already ships with the SDK. JSON remains the default dev store.
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(CONSOLE_SQLITE_PATH), { recursive: true });
  const db = new Database(CONSOLE_SQLITE_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS console_api_keys (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_api_keys_account ON console_api_keys(account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_console_api_keys_hash ON console_api_keys(key_hash);

    CREATE TABLE IF NOT EXISTS console_brain_memories (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL NOT NULL,
      tags_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_brain_account_namespace ON console_brain_memories(account_id, namespace);

    CREATE TABLE IF NOT EXISTS console_brain_entities (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      type TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_brain_entities_account_namespace ON console_brain_entities(account_id, namespace);

    CREATE TABLE IF NOT EXISTS console_brain_edges (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_id TEXT NOT NULL,
      memory_ids_json TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_brain_edges_account_namespace ON console_brain_edges(account_id, namespace);

    CREATE TABLE IF NOT EXISTS console_brain_reasoning_traces (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      query TEXT NOT NULL,
      mode TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      generated_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_reasoning_traces_account_namespace ON console_brain_reasoning_traces(account_id, namespace, generated_at);

    CREATE TABLE IF NOT EXISTS console_audit_events (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_audit_account_created ON console_audit_events(account_id, created_at);

    CREATE TABLE IF NOT EXISTS console_usage_counters (
      account_id TEXT PRIMARY KEY,
      brain_writes INTEGER NOT NULL DEFAULT 0,
      brain_queries INTEGER NOT NULL DEFAULT 0,
      rail_charges INTEGER NOT NULL DEFAULT 0,
      rail_settlements INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS console_account_plans (
      account_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      interval TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      price_lookup_key TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      checkout_session_id TEXT,
      provisioned_at TEXT,
      updated_at TEXT,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS console_sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT,
      name TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT,
      expires_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_sessions_account ON console_sessions(account_id);

    CREATE TABLE IF NOT EXISTS console_auth_challenges (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_auth_challenges_account ON console_auth_challenges(account_id);

    CREATE TABLE IF NOT EXISTS console_account_members (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_members_account ON console_account_members(account_id);
  `);
  consoleSqlite = db;
  return consoleSqlite;
}

function loadConsoleStoreFromSqlite() {
  const db = openConsoleSqlite();
  for (const row of db.prepare('SELECT payload FROM console_api_keys').all()) {
    const key = JSON.parse(row.payload);
    apiKeys.set(key.id, key);
  }
  for (const row of db.prepare('SELECT payload FROM console_brain_memories').all()) {
    const memory = JSON.parse(row.payload);
    brainMemories.set(memory.id, memory);
  }
  for (const row of db.prepare('SELECT payload FROM console_brain_entities').all()) {
    const entity = JSON.parse(row.payload);
    brainEntities.set(entity.id, entity);
  }
  for (const row of db.prepare('SELECT payload FROM console_brain_edges').all()) {
    const edge = JSON.parse(row.payload);
    brainEdges.set(edge.id, edge);
  }
  for (const row of db.prepare('SELECT payload FROM console_brain_reasoning_traces').all()) {
    const trace = JSON.parse(row.payload);
    brainReasoningTraces.set(trace.id, trace);
  }
  for (const row of db.prepare('SELECT payload FROM console_audit_events ORDER BY created_at ASC').all()) {
    auditEvents.push(JSON.parse(row.payload));
  }
  for (const row of db.prepare('SELECT account_id, payload FROM console_usage_counters').all()) {
    const counters = JSON.parse(row.payload);
    usageCounters.set(row.account_id, { ...blankUsage(), ...counters });
  }
  for (const row of db.prepare('SELECT account_id, payload FROM console_account_plans').all()) {
    accountPlans.set(row.account_id, JSON.parse(row.payload));
  }
  for (const row of db.prepare('SELECT id, payload FROM console_sessions').all()) {
    const session = JSON.parse(row.payload);
    if (new Date(session.expiresAt).getTime() > Date.now()) consoleSessions.set(row.id, session);
  }
  for (const row of db.prepare('SELECT id, payload FROM console_auth_challenges').all()) {
    const challenge = JSON.parse(row.payload);
    if (!challenge.usedAt && new Date(challenge.expiresAt).getTime() > Date.now()) authChallenges.set(row.id, challenge);
  }
  for (const row of db.prepare('SELECT id, payload FROM console_account_members').all()) {
    accountMembers.set(row.id, JSON.parse(row.payload));
  }
  console.log(`[console-store] loaded ${apiKeys.size} keys, ${brainMemories.size} brain memories, ${auditEvents.length} audit events from sqlite ${CONSOLE_SQLITE_PATH}`);
}

function saveConsoleStoreToSqlite() {
  const db = openConsoleSqlite();
  const usage = {};
  for (const [accountId, counters] of usageCounters.entries()) usage[accountId] = counters;

  const write = db.transaction(() => {
    db.prepare('DELETE FROM console_api_keys').run();
    db.prepare('DELETE FROM console_brain_memories').run();
    db.prepare('DELETE FROM console_brain_entities').run();
    db.prepare('DELETE FROM console_brain_edges').run();
    db.prepare('DELETE FROM console_brain_reasoning_traces').run();
    db.prepare('DELETE FROM console_audit_events').run();
    db.prepare('DELETE FROM console_usage_counters').run();
    db.prepare('DELETE FROM console_account_plans').run();
    db.prepare('DELETE FROM console_sessions').run();
    db.prepare('DELETE FROM console_auth_challenges').run();
    db.prepare('DELETE FROM console_account_members').run();

    const insertKey = db.prepare(`INSERT INTO console_api_keys
      (id, account_id, name, prefix, key_hash, created_at, last_used_at, revoked_at, payload)
      VALUES (@id, @accountId, @name, @prefix, @keyHash, @createdAt, @lastUsedAt, @revokedAt, @payload)`);
    for (const key of apiKeys.values()) {
      insertKey.run({
        ...key,
        lastUsedAt: key.lastUsedAt || null,
        revokedAt: key.revokedAt || null,
        payload: JSON.stringify(key),
      });
    }

    const insertMemory = db.prepare(`INSERT INTO console_brain_memories
      (id, account_id, namespace, content, importance, tags_json, created_at, payload)
      VALUES (@id, @accountId, @namespace, @content, @importance, @tagsJson, @createdAt, @payload)`);
    for (const memory of brainMemories.values()) {
      insertMemory.run({
        ...memory,
        tagsJson: JSON.stringify(memory.tags || []),
        payload: JSON.stringify(memory),
      });
    }

    const insertEntity = db.prepare(`INSERT INTO console_brain_entities
      (id, account_id, namespace, name, normalized_name, type, aliases_json, mention_count, created_at, updated_at, payload)
      VALUES (@id, @accountId, @namespace, @name, @normalizedName, @type, @aliasesJson, @mentionCount, @createdAt, @updatedAt, @payload)`);
    for (const entity of brainEntities.values()) {
      insertEntity.run({
        ...entity,
        aliasesJson: JSON.stringify(entity.aliases || []),
        mentionCount: entity.mentionCount || 0,
        payload: JSON.stringify(entity),
      });
    }

    const insertEdge = db.prepare(`INSERT INTO console_brain_edges
      (id, account_id, namespace, subject_id, predicate, object_id, memory_ids_json, weight, created_at, updated_at, payload)
      VALUES (@id, @accountId, @namespace, @subjectId, @predicate, @objectId, @memoryIdsJson, @weight, @createdAt, @updatedAt, @payload)`);
    for (const edge of brainEdges.values()) {
      insertEdge.run({
        ...edge,
        memoryIdsJson: JSON.stringify(edge.memoryIds || []),
        weight: edge.weight || 1,
        payload: JSON.stringify(edge),
      });
    }

    const insertTrace = db.prepare(`INSERT INTO console_brain_reasoning_traces
      (id, account_id, namespace, query, mode, confidence, generated_at, payload)
      VALUES (@id, @accountId, @namespace, @query, @mode, @confidence, @generatedAt, @payload)`);
    for (const trace of brainReasoningTraces.values()) {
      insertTrace.run({
        ...trace,
        confidence: trace.confidence || 0,
        payload: JSON.stringify(trace),
      });
    }

    const insertAudit = db.prepare(`INSERT INTO console_audit_events
      (id, account_id, action, subject, details_json, created_at, payload)
      VALUES (@id, @accountId, @action, @subject, @detailsJson, @createdAt, @payload)`);
    for (const event of auditEvents) {
      insertAudit.run({
        ...event,
        detailsJson: JSON.stringify(event.details || {}),
        payload: JSON.stringify(event),
      });
    }

    const insertUsage = db.prepare(`INSERT INTO console_usage_counters
      (account_id, brain_writes, brain_queries, rail_charges, rail_settlements, payload)
      VALUES (@accountId, @brainWrites, @brainQueries, @railCharges, @railSettlements, @payload)`);
    for (const [accountId, counters] of Object.entries(usage)) {
      insertUsage.run({
        accountId,
        brainWrites: counters.brainWrites || 0,
        brainQueries: counters.brainQueries || 0,
        railCharges: counters.railCharges || 0,
        railSettlements: counters.railSettlements || 0,
        payload: JSON.stringify(counters),
      });
    }

    const insertPlan = db.prepare(`INSERT INTO console_account_plans
      (account_id, plan, interval, status, source, price_lookup_key, stripe_customer_id, stripe_subscription_id, checkout_session_id, provisioned_at, updated_at, payload)
      VALUES (@accountId, @plan, @interval, @status, @source, @priceLookupKey, @stripeCustomerId, @stripeSubscriptionId, @checkoutSessionId, @provisionedAt, @updatedAt, @payload)`);
    for (const plan of accountPlans.values()) {
      insertPlan.run({
        ...plan,
        priceLookupKey: plan.priceLookupKey || null,
        stripeCustomerId: plan.stripeCustomerId || null,
        stripeSubscriptionId: plan.stripeSubscriptionId || null,
        checkoutSessionId: plan.checkoutSessionId || null,
        provisionedAt: plan.provisionedAt || null,
        updatedAt: plan.updatedAt || null,
        payload: JSON.stringify(plan),
      });
    }

    const insertSession = db.prepare(`INSERT INTO console_sessions
      (id, account_id, email, name, created_at, last_seen_at, expires_at, payload)
      VALUES (@id, @accountId, @email, @name, @createdAt, @lastSeenAt, @expiresAt, @payload)`);
    for (const session of consoleSessions.values()) {
      if (new Date(session.expiresAt).getTime() <= Date.now()) continue;
      insertSession.run({
        ...session,
        email: session.email || null,
        name: session.name || null,
        lastSeenAt: session.lastSeenAt || null,
        payload: JSON.stringify(session),
      });
    }

    const insertChallenge = db.prepare(`INSERT INTO console_auth_challenges
      (id, account_id, email, name, code_hash, attempts, max_attempts, created_at, expires_at, used_at, payload)
      VALUES (@id, @accountId, @email, @name, @codeHash, @attempts, @maxAttempts, @createdAt, @expiresAt, @usedAt, @payload)`);
    for (const challenge of authChallenges.values()) {
      if (challenge.usedAt || new Date(challenge.expiresAt).getTime() <= Date.now()) continue;
      insertChallenge.run({
        ...challenge,
        name: challenge.name || null,
        usedAt: challenge.usedAt || null,
        attempts: challenge.attempts || 0,
        maxAttempts: challenge.maxAttempts || 5,
        payload: JSON.stringify(challenge),
      });
    }

    const insertMember = db.prepare(`INSERT INTO console_account_members
      (id, account_id, email, name, role, source, created_at, updated_at, payload)
      VALUES (@id, @accountId, @email, @name, @role, @source, @createdAt, @updatedAt, @payload)`);
    for (const member of accountMembers.values()) {
      insertMember.run({
        ...member,
        name: member.name || null,
        updatedAt: member.updatedAt || null,
        payload: JSON.stringify(member),
      });
    }
  });

  write();
}

function consoleSnapshot() {
  const usage = {};
  for (const [accountId, counters] of usageCounters.entries()) usage[accountId] = counters;
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    apiKeys: Array.from(apiKeys.values()),
    brainMemories: Array.from(brainMemories.values()),
    brainEntities: Array.from(brainEntities.values()),
    brainEdges: Array.from(brainEdges.values()),
    brainReasoningTraces: Array.from(brainReasoningTraces.values()),
    auditEvents,
    usageCounters: usage,
    accountPlans: Array.from(accountPlans.values()),
    consoleSessions: Array.from(consoleSessions.values()).filter((session) => new Date(session.expiresAt).getTime() > Date.now()),
    authChallenges: Array.from(authChallenges.values()).filter((challenge) => !challenge.usedAt && new Date(challenge.expiresAt).getTime() > Date.now()),
    accountMembers: Array.from(accountMembers.values()),
    webhookEvents: webhookIdempotency.snapshot(),
  };
}

function applyConsoleSnapshot(data = {}) {
  for (const row of data.apiKeys || []) apiKeys.set(row.id, row);
  for (const row of data.brainMemories || []) brainMemories.set(row.id, row);
  for (const row of data.brainEntities || []) brainEntities.set(row.id, row);
  for (const row of data.brainEdges || []) brainEdges.set(row.id, row);
  for (const row of data.brainReasoningTraces || []) brainReasoningTraces.set(row.id, row);
  for (const row of data.auditEvents || []) auditEvents.push(row);
  for (const [accountId, usage] of Object.entries(data.usageCounters || {})) {
    usageCounters.set(accountId, { ...blankUsage(), ...usage });
  }
  for (const row of data.accountPlans || []) accountPlans.set(row.accountId, row);
  for (const row of data.consoleSessions || []) {
    if (new Date(row.expiresAt).getTime() > Date.now()) consoleSessions.set(row.id, row);
  }
  for (const row of data.authChallenges || []) {
    if (!row.usedAt && new Date(row.expiresAt).getTime() > Date.now()) authChallenges.set(row.id, row);
  }
  for (const row of data.accountMembers || []) accountMembers.set(row.id, row);
  webhookIdempotency.load(data.webhookEvents || []);
}

async function openConsolePostgresStore() {
  if (consolePostgresStore) return consolePostgresStore;
  if (!CONSOLE_POSTGRES_URL) {
    throw new Error('MNEMOPAY_CONSOLE_POSTGRES_URL, NEON_URL, or DATABASE_URL is required for postgres console store');
  }
  const { PostgresConsoleStore } = require('./console-postgres-store.cjs');
  consolePostgresStore = new PostgresConsoleStore({
    url: CONSOLE_POSTGRES_URL,
    tablePrefix: process.env.MNEMOPAY_CONSOLE_POSTGRES_PREFIX || 'console',
  });
  return consolePostgresStore;
}

async function loadConsoleStoreFromPostgres() {
  const store = await openConsolePostgresStore();
  const data = await store.loadSnapshot();
  applyConsoleSnapshot(data);
  console.log(`[console-store] loaded ${apiKeys.size} keys, ${brainMemories.size} brain memories, ${auditEvents.length} audit events from postgres`);
}

function saveConsoleStoreToPostgres() {
  consolePostgresSaveChain = consolePostgresSaveChain
    .then(async () => {
      const store = await openConsolePostgresStore();
      await store.saveSnapshot(consoleSnapshot());
    })
    .catch((e) => {
      console.warn(`[console-store] failed to save postgres snapshot: ${e.message}`);
    });
  return consolePostgresSaveChain;
}

async function loadConsoleStore() {
  try {
    if (CONSOLE_STORE_DRIVER === 'postgres') {
      await loadConsoleStoreFromPostgres();
      return;
    }
    if (CONSOLE_STORE_DRIVER === 'sqlite') {
      loadConsoleStoreFromSqlite();
      return;
    }
    if (!fs.existsSync(CONSOLE_STORE_PATH)) return;
    const raw = fs.readFileSync(CONSOLE_STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    applyConsoleSnapshot(data);
    log.info('console-store loaded', {
      driver: CONSOLE_STORE_DRIVER,
      keys: apiKeys.size,
      memories: brainMemories.size,
      audit: auditEvents.length,
      path: CONSOLE_STORE_PATH,
    });
  } catch (e) {
    log.warn('console-store load failed', { driver: CONSOLE_STORE_DRIVER, err: e });
  }

  // ── Drip queue ───────────────────────────────────────────────────────────
  // Sqlite-backed. Only spins up when the console is on sqlite (Postgres path
  // is a TODO — the rest of the dashboard moves to it together). 5-min tick.
  try {
    if (CONSOLE_STORE_DRIVER === 'sqlite') {
      const db = openConsoleSqlite();
      dripQueue = createDripQueue({ db, logger: log });
      dripQueue.start();
    }
  } catch (e) {
    log.warn('drip queue init failed', { err: e });
  }
}

// Debounced async save: every saveConsoleStore() call schedules a flush rather
// than writing inline. Hot-path mutations no longer pay the cost of a full
// snapshot write. Flushes also coalesce when many mutations arrive in quick
// succession.
let saveDirty = false;
let saveTimer = null;
let saveInFlight = Promise.resolve();

function flushConsoleStoreNow() {
  saveDirty = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const driver = CONSOLE_STORE_DRIVER;
  const started = Date.now();
  const flush = async () => {
    try {
      if (driver === 'postgres') {
        await saveConsoleStoreToPostgres();
      } else if (driver === 'sqlite') {
        saveConsoleStoreToSqlite();
      } else {
        fs.mkdirSync(path.dirname(CONSOLE_STORE_PATH), { recursive: true });
        fs.writeFileSync(CONSOLE_STORE_PATH, JSON.stringify(consoleSnapshot(), null, 2));
      }
      persistenceLatency.observe({ driver }, Date.now() - started);
    } catch (e) {
      persistenceFailuresTotal.inc({ driver });
      log.error('console-store save failed', { driver, err: e });
    }
  };
  saveInFlight = saveInFlight.then(flush, flush);
  return saveInFlight;
}

function saveConsoleStore() {
  if (SAVE_DEBOUNCE_MS === 0) {
    return flushConsoleStoreNow();
  }
  saveDirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (saveDirty) flushConsoleStoreNow();
  }, SAVE_DEBOUNCE_MS);
  saveTimer.unref?.();
}

async function flushConsoleStoreOnShutdown() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await flushConsoleStoreNow();
  await saveInFlight;
}

function publicBrainMemory(memory) {
  return {
    id: memory.id,
    accountId: memory.accountId,
    namespace: memory.namespace,
    content: memory.content,
    importance: memory.importance,
    tags: memory.tags,
    createdAt: memory.createdAt,
  };
}

function publicBrainReasoningTrace(trace, { includePayload = true } = {}) {
  const base = {
    id: trace.id,
    traceId: trace.id,
    accountId: trace.accountId,
    namespace: trace.namespace,
    query: trace.query,
    generatedAt: trace.generatedAt,
    mode: trace.mode,
    confidence: trace.confidence,
    evidenceCount: (trace.evidence || []).length,
    entityCount: (trace.entities || []).length,
    edgeCount: (trace.edges || []).length,
    llm: !!trace.llmReasoning,
  };
  if (!includePayload) return base;
  return {
    ...base,
    steps: trace.steps || [],
    answer: trace.answer || '',
    evidence: trace.evidence || [],
    entities: trace.entities || [],
    edges: trace.edges || [],
    llmReasoning: trace.llmReasoning || null,
  };
}

function listBrainReasoningTraces(accountId, { namespace, limit = 50 } = {}) {
  return Array.from(brainReasoningTraces.values())
    .filter((trace) => trace.accountId === accountId && (!namespace || trace.namespace === namespace))
    .sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')))
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map((trace) => publicBrainReasoningTrace(trace, { includePayload: false }));
}

function normalizeBrainEntityName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.@-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferEntityType(name) {
  const n = String(name || '');
  if (/@/.test(n)) return 'person';
  if (/\.(com|ai|io|dev|app|chat|org|net)\b/i.test(n)) return 'product';
  if (/\b(inc|llc|ltd|corp|company|construction|flowers|suite|pay|bank|labs|studio|agency|systems)\b/i.test(n)) return 'org';
  if (/^\d{4}(-\d{2})?(-\d{2})?$/.test(n) || /\b(q[1-4]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(n)) return 'date';
  if (/\b(api|sdk|mcp|stripe|webhook|dashboard|console|brain|agent|memory|audit|billing|forge|gridstamp|praetor)\b/i.test(n)) return 'concept';
  const words = n.trim().split(/\s+/);
  if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Z][a-zA-Z0-9'.-]+$/.test(w))) return 'person';
  return 'other';
}

function extractHostedBrainEntities(content, tags = []) {
  const text = String(content || '').slice(0, 6000);
  const found = new Map();
  const add = (name, type) => {
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    if (clean.length < 3 || clean.length > 80) return;
    const normalizedName = normalizeBrainEntityName(clean);
    if (!normalizedName || /^[0-9]+$/.test(normalizedName)) return;
    if (['account', 'use this', 'hosted brain', 'default'].includes(normalizedName)) return;
    if (!found.has(normalizedName)) found.set(normalizedName, { name: clean, normalizedName, type: type || inferEntityType(clean) });
  };

  for (const match of text.matchAll(/\b[A-Z][a-zA-Z0-9'.-]*(?:\s+[A-Z][a-zA-Z0-9'.-]*){0,3}\b/g)) {
    add(match[0]);
  }
  for (const match of text.matchAll(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})*\b/g)) {
    add(match[0], 'concept');
  }
  for (const match of text.matchAll(/\b[a-z0-9-]+\.(?:com|ai|io|dev|app|chat|org|net)\b/gi)) {
    add(match[0], 'product');
  }
  for (const tag of tags || []) {
    if (/^[a-z0-9-]{3,40}$/i.test(String(tag))) add(String(tag), 'concept');
  }
  return Array.from(found.values()).slice(0, 24);
}

function brainEntityId(accountId, namespace, normalizedName) {
  return `ent_${crypto.createHash('sha1').update(`${accountId}:${namespace}:${normalizedName}`).digest('hex').slice(0, 24)}`;
}

function publicBrainEntity(entity) {
  return {
    id: entity.id,
    accountId: entity.accountId,
    namespace: entity.namespace,
    name: entity.name,
    normalizedName: entity.normalizedName,
    type: entity.type,
    aliases: entity.aliases || [],
    memoryIds: entity.memoryIds || [],
    mentionCount: entity.mentionCount || 0,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function publicBrainEdge(edge) {
  return {
    id: edge.id,
    accountId: edge.accountId,
    namespace: edge.namespace,
    subjectId: edge.subjectId,
    predicate: edge.predicate,
    objectId: edge.objectId,
    memoryIds: edge.memoryIds || [],
    weight: edge.weight || 1,
    createdAt: edge.createdAt,
    updatedAt: edge.updatedAt,
  };
}

function upsertBrainEntity(accountId, namespace, extracted, memoryId, createdAt) {
  const normalizedName = extracted.normalizedName || normalizeBrainEntityName(extracted.name);
  if (!normalizedName) return null;
  const id = brainEntityId(accountId, namespace, normalizedName);
  const existing = brainEntities.get(id);
  const now = createdAt || new Date().toISOString();
  if (existing) {
    const memoryIds = new Set(existing.memoryIds || []);
    memoryIds.add(memoryId);
    const aliases = new Set(existing.aliases || []);
    if (existing.name !== extracted.name) aliases.add(extracted.name);
    existing.aliases = Array.from(aliases);
    existing.memoryIds = Array.from(memoryIds);
    existing.mentionCount = existing.memoryIds.length;
    existing.updatedAt = now;
    if (existing.type === 'other' && extracted.type) existing.type = extracted.type;
    return existing;
  }
  const entity = {
    id,
    accountId,
    namespace,
    name: extracted.name,
    normalizedName,
    type: extracted.type || inferEntityType(extracted.name),
    aliases: [],
    memoryIds: [memoryId],
    mentionCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  brainEntities.set(id, entity);
  return entity;
}

function brainEdgeId(accountId, namespace, a, b, predicate) {
  const pair = [a, b].sort().join(':');
  return `edge_${crypto.createHash('sha1').update(`${accountId}:${namespace}:${predicate}:${pair}`).digest('hex').slice(0, 24)}`;
}

function upsertBrainEdge(accountId, namespace, subjectId, objectId, memoryId, predicate = 'co_occurs_with', createdAt) {
  if (!subjectId || !objectId || subjectId === objectId) return null;
  const id = brainEdgeId(accountId, namespace, subjectId, objectId, predicate);
  const now = createdAt || new Date().toISOString();
  const existing = brainEdges.get(id);
  if (existing) {
    const memoryIds = new Set(existing.memoryIds || []);
    memoryIds.add(memoryId);
    existing.memoryIds = Array.from(memoryIds);
    existing.weight = existing.memoryIds.length;
    existing.updatedAt = now;
    return existing;
  }
  const [left, right] = [subjectId, objectId].sort();
  const edge = {
    id,
    accountId,
    namespace,
    subjectId: left,
    predicate,
    objectId: right,
    memoryIds: [memoryId],
    weight: 1,
    createdAt: now,
    updatedAt: now,
  };
  brainEdges.set(id, edge);
  return edge;
}

function ingestMemoryGraph(memory) {
  const entities = extractHostedBrainEntities(memory.content, memory.tags);
  const nodes = entities
    .map((entity) => upsertBrainEntity(memory.accountId, memory.namespace, entity, memory.id, memory.createdAt))
    .filter(Boolean);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      upsertBrainEdge(memory.accountId, memory.namespace, nodes[i].id, nodes[j].id, memory.id, 'co_occurs_with', memory.createdAt);
    }
  }
  return { entities: nodes.map(publicBrainEntity), edgesCreated: Math.max(0, (nodes.length * (nodes.length - 1)) / 2) };
}

function clearBrainGraph(accountId, namespace) {
  for (const [id, entity] of brainEntities.entries()) {
    if (entity.accountId === accountId && entity.namespace === namespace) brainEntities.delete(id);
  }
  for (const [id, edge] of brainEdges.entries()) {
    if (edge.accountId === accountId && edge.namespace === namespace) brainEdges.delete(id);
  }
}

function rebuildBrainGraph(accountId, namespace) {
  clearBrainGraph(accountId, namespace);
  const rows = Array.from(brainMemories.values()).filter((m) => m.accountId === accountId && m.namespace === namespace);
  for (const memory of rows) ingestMemoryGraph(memory);
  return brainGraphSnapshot(accountId, namespace);
}

function brainGraphSnapshot(accountId, namespace, limit = 200) {
  const entities = Array.from(brainEntities.values())
    .filter((entity) => entity.accountId === accountId && entity.namespace === namespace)
    .sort((a, b) => (b.mentionCount || 0) - (a.mentionCount || 0))
    .slice(0, limit)
    .map(publicBrainEntity);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const edges = Array.from(brainEdges.values())
    .filter((edge) => edge.accountId === accountId && edge.namespace === namespace && entityIds.has(edge.subjectId) && entityIds.has(edge.objectId))
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, limit * 2)
    .map(publicBrainEdge);
  return {
    accountId,
    namespace,
    entities,
    edges,
    stats: {
      memories: Array.from(brainMemories.values()).filter((m) => m.accountId === accountId && m.namespace === namespace).length,
      entities: entities.length,
      edges: edges.length,
    },
  };
}

async function storeBrainMemory(body, accountId) {
  const namespace = String(body.namespace || 'default').slice(0, 120);
  const content = String(body.content || '').trim();
  if (!content) throw new Error('content required');
  const id = body.id ? String(body.id).slice(0, 160) : `mem_${uuid()}`;
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).slice(0, 64)).slice(0, 16) : [];
  const importance = Number.isFinite(Number(body.importance)) ? Math.max(0, Math.min(1, Number(body.importance))) : 0.6;
  const createdAt = new Date().toISOString();
  if (!body.systemWrite) assertPlanAllows(accountId, 'brain.write');
  const memory = { id, accountId, namespace, content, importance, score: importance, createdAt, lastAccessed: createdAt, accessCount: 0, tags };
  brainMemories.set(id, memory);
  if (!body.systemWrite) usageForAccount(accountId).brainWrites++;
  recordAudit(accountId, 'brain.memory.created', `brain:${namespace}`, { memoryId: id, namespace, tags, importance });
  const graph = ingestMemoryGraph(memory);
  if (graph.entities.length > 0) {
    recordAudit(accountId, 'brain.graph.enriched', `brain:${namespace}`, { memoryId: id, entityCount: graph.entities.length });
  }
  if (brain?.embed) {
    await brain.embed(id, content, { accountId, namespace, tags, importance, createdAt });
  }
  saveConsoleStore();
  return publicBrainMemory(memory);
}

async function provisionAccount(body, accountId) {
  const lookup = body.priceLookupKey ? PRICE_LOOKUP_TO_PLAN[String(body.priceLookupKey)] : null;
  const plan = lookup?.plan || String(body.plan || DEFAULT_PLAN || 'free').toLowerCase();
  if (!PLAN_CATALOG[plan]) throw new Error(`unsupported plan: ${plan}`);
  const interval = lookup?.interval || String(body.interval || 'monthly').toLowerCase();
  if (!['monthly', 'yearly', 'custom'].includes(interval)) throw new Error(`unsupported interval: ${interval}`);

  const now = new Date().toISOString();
  const existing = accountPlans.get(accountId) || {};
  const accountPlan = {
    accountId,
    plan,
    interval,
    status: String(body.status || 'active').slice(0, 40),
    source: String(body.source || (body.checkoutSessionId ? 'checkout' : 'manual')).slice(0, 40),
    priceLookupKey: body.priceLookupKey ? String(body.priceLookupKey).slice(0, 120) : null,
    stripeCustomerId: body.stripeCustomerId ? String(body.stripeCustomerId).slice(0, 160) : null,
    stripeSubscriptionId: body.stripeSubscriptionId ? String(body.stripeSubscriptionId).slice(0, 160) : null,
    checkoutSessionId: body.checkoutSessionId ? String(body.checkoutSessionId).slice(0, 180) : null,
    provisionedAt: existing.provisionedAt || now,
    updatedAt: now,
  };
  accountPlans.set(accountId, accountPlan);

  const namespace = String(body.namespace || 'default').slice(0, 120);
  const hasNamespaceMemory = Array.from(brainMemories.values())
    .some((m) => m.accountId === accountId && m.namespace === namespace && (m.tags || []).includes('provisioning'));
  let starterMemory = null;
  if (!hasNamespaceMemory) {
    starterMemory = await storeBrainMemory({
      id: `mem_provision_${crypto.createHash('sha1').update(`${accountId}:${namespace}`).digest('hex').slice(0, 24)}`,
      namespace,
      content: `Account ${accountId} provisioned on MnemoPay ${PLAN_CATALOG[plan].name} (${interval}). Use this namespace as the default hosted brain for onboarding and first agent memory.`,
      tags: ['provisioning', 'system'],
      importance: 0.85,
      systemWrite: true,
    }, accountId);
  }

  let apiKey = null;
  const shouldCreateKey = body.createApiKey !== false;
  const hasActiveKey = Array.from(apiKeys.values()).some((key) => key.accountId === accountId && !key.revokedAt);
  if (shouldCreateKey && !hasActiveKey) {
    apiKey = createApiKey(accountId, body.apiKeyName || `${plan}-default`);
  }

  recordAudit(accountId, 'billing.account.provisioned', `account:${accountId}`, {
    plan,
    interval,
    source: accountPlan.source,
    priceLookupKey: accountPlan.priceLookupKey,
    checkoutSessionId: accountPlan.checkoutSessionId,
    starterMemoryId: starterMemory?.id || null,
    apiKeyId: apiKey?.id || null,
  });
  saveConsoleStore();

  // Fire 4-touch onboarding drip via Maileroo. Best-effort — never fail
  // provisioning because the drip couldn't enqueue.
  if (dripQueue && body.customerEmail) {
    try {
      const priceMonthly = PLAN_CATALOG[plan]?.priceMonthly || PLAN_CATALOG[plan]?.amount || null;
      dripQueue.enqueueOnboardingDrip({
        accountId,
        email: String(body.customerEmail).slice(0, 240),
        tier: body.tier || plan,
        priceMonthly,
        apiKey: apiKey ? apiKey.secret : null,
      });
    } catch (e) {
      log.warn('drip enqueue failed', { accountId, err: e });
    }
  }

  return {
    account: accountPlanFor(accountId),
    starterMemory,
    apiKey: apiKey ? { ...publicApiKey(apiKey), secret: apiKey.secret } : null,
    onboarding: onboardingState(accountId),
  };
}

async function queryBrain(body, accountId, opts = {}) {
  const internal = opts.internal === true;
  const namespace = String(body.namespace || 'default').slice(0, 120);
  const query = String(body.query || '').trim();
  const limit = Math.max(1, Math.min(25, parseInt(body.limit || '8', 10)));
  const expansion = String(body.expansion || '').toLowerCase(); // 'hyde' | ''
  const wantRerank = body.rerank === true;
  if (!query) throw new Error('query required');
  if (!internal) {
    assertPlanAllows(accountId, 'brain.query');
    usageForAccount(accountId).brainQueries++;
  }
  const candidates = Array.from(brainMemories.values()).filter((m) => m.accountId === accountId && m.namespace === namespace);

  // Optional query expansion via HyDE — generate hypothetical answers and use
  // them as extra retrieval queries. Off by default; opt-in per request.
  const queryVariants = [query];
  let hydeApplied = false;
  if (expansion === 'hyde' && hyde) {
    try {
      const expansionResult = await hyde.generate(query);
      const hypotheses = (expansionResult?.hypotheses || []).slice(0, 3);
      queryVariants.push(...hypotheses);
      hydeApplied = hypotheses.length > 0;
    } catch (e) {
      log.warn('hyde expansion failed', { err: e });
    }
  }

  // Run recall over each query variant and merge.
  const mergedById = new Map();
  if (brain?.search) {
    for (const q of queryVariants) {
      const results = await brain.search(q, candidates, limit);
      for (const r of results) {
        const existing = mergedById.get(r.id);
        const score = r.combinedScore ?? r.score ?? 0;
        if (!existing || score > existing.score) {
          mergedById.set(r.id, { ...r, score });
        }
      }
    }
  } else {
    const terms = queryVariants.join(' ').toLowerCase().split(/\W+/).filter(Boolean);
    for (const m of candidates) {
      const score = terms.reduce((sum, term) => sum + (m.content.toLowerCase().includes(term) ? 1 : 0), 0) + m.importance;
      mergedById.set(m.id, { ...m, score });
    }
  }

  let merged = Array.from(mergedById.values()).sort((a, b) => b.score - a.score);

  // Optional cross-encoder rerank on top-k candidates.
  let rerankApplied = false;
  if (wantRerank && reranker && merged.length > 1) {
    try {
      const top = merged.slice(0, Math.min(50, merged.length));
      const reranked = await reranker.rerank(
        query,
        top.map((m) => ({ id: m.id, content: m.content, priorScore: m.score, timestamp: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt) })),
        limit,
      );
      const ordered = reranked
        .map((r) => merged.find((m) => m.id === r.item.id))
        .filter(Boolean)
        .map((m, i) => ({ ...m, score: 1 / (i + 1) })); // normalize to rank-based
      merged = ordered;
      rerankApplied = true;
    } catch (e) {
      log.warn('reranker failed', { err: e });
    }
  }

  const finalResults = merged.slice(0, limit);
  if (!internal) {
    recordAudit(accountId, 'brain.query', `brain:${namespace}`, {
      namespace, query, limit,
      resultCount: finalResults.length,
      hydeApplied, rerankApplied,
    });
    saveConsoleStore();
  }
  return {
    namespace,
    query,
    count: finalResults.length,
    expansion: hydeApplied ? 'hyde' : null,
    rerank: rerankApplied,
    results: finalResults.map((r) => ({
      id: r.id,
      content: r.content,
      importance: r.importance,
      score: r.score,
      tags: r.tags,
    })),
  };
}

async function reasonOverBrain(body, accountId) {
  const namespace = String(body.namespace || 'default').slice(0, 120);
  const query = String(body.query || '').trim();
  const limit = Math.max(1, Math.min(12, parseInt(body.limit || '6', 10)));
  if (!query) throw new Error('query required');
  // Reason charges its own mission credit; the inner recall is treated as
  // internal so we don't double-bill or double-audit the same logical request.
  assertPlanAllows(accountId, 'brain.query');
  usageForAccount(accountId).brainQueries++;

  const recall = await queryBrain({ namespace, query, limit, mode: body.mode || 'hybrid' }, accountId, { internal: true });
  const graph = brainGraphSnapshot(accountId, namespace, 120);
  const resultIds = new Set((recall.results || []).map((r) => r.id));
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const entities = (graph.entities || []).filter((entity) => {
    const entityText = `${entity.name} ${entity.normalizedName} ${entity.type}`.toLowerCase();
    const queryMatch = terms.some((term) => entityText.includes(term));
    const memoryMatch = (entity.memoryIds || []).some((id) => resultIds.has(id));
    return queryMatch || memoryMatch;
  }).slice(0, 12);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const edges = (graph.edges || [])
    .filter((edge) => entityIds.has(edge.subjectId) || entityIds.has(edge.objectId))
    .slice(0, 16);
  const evidence = (recall.results || []).slice(0, limit).map((result, index) => ({
    rank: index + 1,
    memoryId: result.id,
    score: result.score || result.importance || 0,
    content: result.content,
    tags: result.tags || [],
  }));

  // Optional: real LLM reasoning when ReasoningPostProcessor is configured.
  // Off otherwise (deterministic trace). Opt-in via `body.llm === true`.
  let llmReasoning = null;
  const useLLM = body.llm === true && !!reasoner;
  if (useLLM) {
    try {
      const memories = (recall.results || []).map((r) => ({
        id: r.id,
        content: r.content,
        importance: r.importance,
        score: r.score,
        createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
        lastAccessed: r.lastAccessed ? new Date(r.lastAccessed) : new Date(),
        accessCount: r.accessCount || 0,
        tags: r.tags || [],
      }));
      const reasoningResult = await reasoner.reason(query, memories);
      llmReasoning = {
        facts: reasoningResult.facts || [],
        rankedIds: reasoningResult.rankedIds || [],
        reasoning: reasoningResult.reasoning || null,
        durationMs: reasoningResult.durationMs || 0,
      };
    } catch (e) {
      log.error('reasoner failed', { err: e, query, namespace, model: process.env.MNEMOPAY_REASONING_MODEL });
      llmReasoning = { error: e.message };
    }
  }

  const confidence = Math.max(0, Math.min(1, (evidence.length / Math.max(1, limit)) * 0.7 + (entities.length > 0 ? 0.2 : 0) + (edges.length > 0 ? 0.1 : 0)));
  const baseAnswer = evidence.length
    ? `Found ${evidence.length} relevant memories in ${namespace}. The strongest signals mention ${entities.slice(0, 4).map((e) => e.name).join(', ') || 'matching terms'} and connect through ${edges.length} graph edge${edges.length === 1 ? '' : 's'}.`
    : `No strong evidence found in ${namespace} for this query.`;
  const answer = llmReasoning && llmReasoning.facts.length
    ? `${llmReasoning.facts.length} fact${llmReasoning.facts.length === 1 ? '' : 's'} extracted from ${evidence.length} memories: ${llmReasoning.facts.slice(0, 2).join('; ')}${llmReasoning.facts.length > 2 ? '…' : ''}`
    : baseAnswer;

  const trace = {
    id: `trace_${uuid()}`,
    accountId,
    query,
    namespace,
    generatedAt: new Date().toISOString(),
    mode: useLLM ? 'llm' : (body.mode || 'hybrid'),
    confidence: Number(confidence.toFixed(2)),
    steps: [
      { name: 'scope', detail: `Searched namespace ${namespace}.` },
      { name: 'recall', detail: `Ranked ${recall.count || 0} memories with limit ${limit}.` },
      { name: 'graph', detail: `Loaded ${graph.stats.entities} entities and ${graph.stats.edges} edges.` },
      { name: 'evidence', detail: `Selected ${evidence.length} memories, ${entities.length} entities, and ${edges.length} edges for the trace.` },
      ...(useLLM ? [{ name: 'llm', detail: llmReasoning ? `LLM extracted ${llmReasoning.facts.length} facts in ${llmReasoning.durationMs}ms.` : 'LLM reasoning unavailable; deterministic trace returned.' }] : []),
    ],
    answer,
    evidence,
    entities,
    edges,
    llmReasoning,
  };
  brainReasoningTraces.set(trace.id, trace);
  recordAudit(accountId, 'brain.reasoning.trace', `brain:${namespace}`, {
    traceId: trace.id,
    namespace,
    query,
    evidenceCount: evidence.length,
    entityCount: entities.length,
    edgeCount: edges.length,
    confidence: trace.confidence,
    llm: useLLM && !!llmReasoning,
  });
  saveConsoleStore();
  return publicBrainReasoningTrace(trace);
}

function createApiKey(accountId, name = 'default') {
  const secret = `mnemo_${crypto.randomBytes(32).toString('base64url')}`;
  const key = {
    id: `key_${uuid()}`,
    accountId,
    name: String(name).slice(0, 64),
    prefix: secret.slice(0, 14),
    keyHash: hashSecret(secret),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  apiKeys.set(key.id, key);
  recordAudit(accountId, 'api_key.created', `api_key:${key.id}`, { keyId: key.id, name: key.name, prefix: key.prefix });
  saveConsoleStore();
  return { ...key, secret };
}

function onboardingState(accountId) {
  const usage = usageForAccount(accountId);
  const billing = accountPlanFor(accountId);
  const hasKey = Array.from(apiKeys.values()).some((k) => k.accountId === accountId && !k.revokedAt);
  const hasBrainMemory = Array.from(brainMemories.values()).some((m) => m.accountId === accountId);
  const hasAuditExport = auditEvents.some((event) => event.accountId === accountId && ['brain.namespace.exported', 'usage.report.exported'].includes(event.action));
  const profileTasks = [
    { id: 'provision-account', label: 'Provision account plan', done: !!billing.provisionedAt || billing.source !== 'default' },
    { id: 'create-api-key', label: 'Create first API key', done: hasKey },
    { id: 'write-brain-memory', label: 'Write first hosted brain memory', done: hasBrainMemory },
    { id: 'run-brain-query', label: 'Run first hosted recall query', done: usage.brainQueries > 0 },
    { id: 'test-payment-rail', label: 'Create first rail hold', done: usage.railCharges > 0 },
    { id: 'export-audit', label: 'Export first audit bundle', done: hasAuditExport },
  ];
  return {
    accountId,
    plan: billing.plan,
    billing,
    complete: profileTasks.every((task) => task.done),
    tasks: profileTasks,
  };
}

// ── Server ──────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

async function handleRequest(req, res) {
  const requestStart = Date.now();
  inflightRequests.set({}, inflightRequests.values?.get('') || 0);
  const reqLog = createRequestLogger(req, 'http');
  res.setHeader('X-Request-Id', req._rid);

  applyCors(req, res);
  applySecurityHeaders(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const routeLabel = routeLabelFromPath(pathname, req.method || 'GET');

  // Wrap the original res.end so we can emit metrics on completion.
  const originalEnd = res.end.bind(res);
  let finished = false;
  res.end = (...args) => {
    if (!finished) {
      finished = true;
      const elapsed = Date.now() - requestStart;
      const status = String(res.statusCode || 200);
      httpRequestsTotal.inc({ method: req.method || 'GET', route: routeLabel, status });
      httpRequestDuration.observe({ route: routeLabel }, elapsed);
      reqLog.info('request', {
        method: req.method,
        path: pathname,
        status: Number(status),
        ms: elapsed,
      });
    }
    return originalEnd(...args);
  };

  // General per-IP rate limit on everything except metrics/health probes and
  // the webhook (which has its own limiter with replay protection).
  const exempt = pathname === '/metrics' || pathname === '/healthz' || pathname === '/readyz';
  const isWebhook = pathname === '/api/v1/billing/stripe/webhook';
  if (!exempt && !isWebhook) {
    if (!rateLimit(req, res, generalLimiter, routeLabel, 'gen')) return;
  }

  // ── API Routes ──────────────────────────────────────────────────────────

  if (pathname === '/api/v1/auth/session' && req.method === 'GET') {
    const session = sessionForRequest(req);
    if (session) ensureSessionMembership(session);
    return json(res, { ok: true, authenticated: !!session, session: publicSession(session) });
  }

  if (pathname === '/api/v1/auth/challenge' && req.method === 'POST') {
    if (!rateLimit(req, res, authChallengeLimiter, routeLabel, 'auth')) return;
    try {
      const body = await readBody(req);
      const created = createAuthChallenge(body);
      await deliverAuthChallenge(created.challenge, created.code);
      return json(res, { ok: true, challenge: publicAuthChallenge(created.challenge, created.code) }, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/v1/auth/verify' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const verified = verifyAuthChallenge(body);
      setSessionCookie(res, verified.session.id);
      return json(res, { ok: true, session: publicSession(verified.session), accountId: verified.session.accountId }, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const accountId = String(body.accountId || DEFAULT_ACCOUNT_ID).trim().slice(0, 120);
      if (!accountId) throw new Error('accountId required');
      const session = createConsoleSession({ accountId, email: body.email, name: body.name });
      setSessionCookie(res, session.id);
      return json(res, { ok: true, session: publicSession(session), accountId: session.accountId }, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/v1/auth/logout' && req.method === 'POST') {
    const session = sessionForRequest(req);
    if (session) {
      consoleSessions.delete(session.id);
      recordAudit(session.accountId, 'auth.session.revoked', `session:${session.id}`, {});
      saveConsoleStore();
    }
    clearSessionCookie(res);
    return json(res, { ok: true });
  }

  if (pathname === '/api/v1/auth/members' && req.method === 'GET') {
    const accountId = accountIdForRequest(req);
    return json(res, { ok: true, accountId, members: membersForAccount(accountId).map(publicMember) });
  }

  if (pathname === '/api/v1/auth/members' && req.method === 'POST') {
    try {
      const accountId = accountIdForRequest(req);
      assertSessionRole(req, accountId, 'admin');
      const body = await readBody(req);
      const member = upsertAccountMember(accountId, body);
      return json(res, { ok: true, accountId, member: publicMember(member) }, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  // Memories
  if (pathname === '/api/memories' && req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const query = url.searchParams.get('q');
    const memories = query ? await agent.recall(query, limit) : await agent.recall(limit);
    return json(res, memories);
  }

  if (pathname === '/api/memories' && req.method === 'POST') {
    const body = await readBody(req);
    const id = await agent.remember(body.content, { importance: body.importance, tags: body.tags });
    return json(res, { id, status: 'stored' }, 201);
  }

  if (pathname.startsWith('/api/memories/') && req.method === 'DELETE') {
    const id = pathname.split('/')[3];
    const deleted = await agent.forget(id);
    return json(res, { deleted });
  }

  if (pathname === '/api/memories/reinforce' && req.method === 'POST') {
    const body = await readBody(req);
    await agent.reinforce(body.id, body.boost || 0.1);
    return json(res, { reinforced: true });
  }

  if (pathname === '/api/memories/consolidate' && req.method === 'POST') {
    const pruned = await agent.consolidate();
    return json(res, { pruned });
  }

  // Payments
  if (pathname === '/api/charge' && req.method === 'POST') {
    try {
      const accountId = accountIdForRequest(req);
      const body = await readBody(req);
      assertPlanAllows(accountId, 'rail.charge');
      const tx = await agent.charge(body.amount, body.reason);
      usageForAccount(accountId).railCharges++;
      recordAudit(accountId, 'rail.charge.created', `tx:${tx.id || 'unknown'}`, { txId: tx.id, amount: body.amount, reason: body.reason });
      saveConsoleStore();
      return json(res, tx, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/settle' && req.method === 'POST') {
    const accountId = accountIdForRequest(req);
    const body = await readBody(req);
    const tx = await agent.settle(body.txId);
    if (tx) {
      usageForAccount(accountId).railSettlements++;
      recordAudit(accountId, 'rail.charge.settled', `tx:${body.txId}`, { txId: body.txId });
      saveConsoleStore();
    }
    return json(res, tx || { error: 'Transaction not found or not pending' });
  }

  if (pathname === '/api/refund' && req.method === 'POST') {
    const body = await readBody(req);
    const tx = await agent.refund(body.txId);
    return json(res, tx || { error: 'Transaction not found' });
  }

  // Profile & status
  if (pathname === '/api/profile' && req.method === 'GET') {
    const profile = await agent.profile();
    return json(res, profile);
  }

  if (pathname === '/api/balance' && req.method === 'GET') {
    const balance = await agent.balance();
    return json(res, balance);
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const history = await agent.history(limit);
    return json(res, history);
  }

  if (pathname === '/api/logs' && req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '30');
    const logs = await agent.logs(limit);
    return json(res, logs);
  }

  // Console/app surface
  if (pathname === '/api/v1/console/overview' && req.method === 'GET') {
    const accountId = accountIdForRequest(req);
    const profile = await agent.profile();
    const balance = await agent.balance();
    const billing = accountPlanFor(accountId);
    const accountKeys = Array.from(apiKeys.values()).filter((key) => key.accountId === accountId);
    const accountMemories = Array.from(brainMemories.values()).filter((memory) => memory.accountId === accountId);
    return json(res, {
      ok: true,
      accountId,
      positioning: 'brain, wallet, and audit trail for AI agents',
      plan: billing.plan,
      billing,
      profile,
      balance,
      usage: usageForAccount(accountId),
      metering: meteringSnapshot(accountId),
      onboarding: onboardingState(accountId),
      members: membersForAccount(accountId).map(publicMember),
      apiKeys: accountKeys.map(publicApiKey),
      brain: {
        mode: brain ? 'recall-engine' : 'fallback',
        namespaces: Array.from(new Set(accountMemories.map((m) => m.namespace))).length,
        memories: accountMemories.length,
        entities: Array.from(brainEntities.values()).filter((entity) => entity.accountId === accountId).length,
        edges: Array.from(brainEdges.values()).filter((edge) => edge.accountId === accountId).length,
      },
    });
  }

  if (pathname === '/api/v1/developer/api-keys' && req.method === 'GET') {
    const accountId = accountIdForRequest(req);
    return json(res, { ok: true, accountId, keys: Array.from(apiKeys.values()).filter((key) => key.accountId === accountId).map(publicApiKey) });
  }

  if (pathname.startsWith('/api/v1/developer/api-keys/') && pathname.endsWith('/revoke') && req.method === 'POST') {
    const accountId = accountIdForRequest(req);
    const keyId = pathname.split('/')[5];
    const key = apiKeys.get(keyId);
    if (!key || key.accountId !== accountId) return json(res, { ok: false, error: 'API key not found' }, 404);
    if (!key.revokedAt) {
      key.revokedAt = new Date().toISOString();
      recordAudit(accountId, 'api_key.revoked', `api_key:${key.id}`, { keyId: key.id, name: key.name, prefix: key.prefix });
      saveConsoleStore();
    }
    return json(res, { ok: true, key: publicApiKey(key) });
  }

  if (pathname === '/api/v1/developer/api-keys' && req.method === 'POST') {
    const accountId = accountIdForRequest(req);
    const body = await readBody(req);
    const key = createApiKey(accountId, body.name || 'default');
    const { secret } = key;
    const publicKey = publicApiKey(key);
    return json(res, { ok: true, key: publicKey, secret, warning: 'Store this secret now. MnemoPay will not show it again.' }, 201);
  }

  if (pathname === '/api/v1/billing/onboarding' && req.method === 'GET') {
    const accountId = accountIdForRequest(req);
    return json(res, { ok: true, ...onboardingState(accountId), usage: usageForAccount(accountId) });
  }

  if (pathname === '/api/v1/billing/checkout/session' && req.method === 'POST') {
    try {
      const accountId = accountIdForRequest(req);
      const body = await readBody(req);
      const created = await createBillingCheckoutSession(req, body, accountId);
      return json(res, {
        ok: true,
        accountId,
        sessionId: created.session.id,
        url: created.session.url,
        tier: created.plan,
        interval: created.interval,
        priceLookupKey: created.priceLookupKey,
      }, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/v1/billing/portal/session' && req.method === 'POST') {
    try {
      const accountId = accountIdForRequest(req);
      const body = await readBody(req);
      const created = await createBillingPortalSession(req, body, accountId);
      return json(res, {
        ok: true,
        accountId,
        customer: created.customer,
        sessionId: created.session.id,
        url: created.session.url,
      }, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if ((pathname === '/api/v1/billing/provision' || pathname === '/api/v1/billing/checkout/success') && req.method === 'POST') {
    try {
      const accountId = accountIdForRequest(req);
      const body = await readBody(req);
      const provisioned = await provisionAccount(body, accountId);
      return json(res, { ok: true, accountId, ...provisioned }, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  // ── Public checkout-session lookup ──────────────────────────────────────
  // Used by /thanks.html to display the freshly-provisioned API key after a
  // Stripe success_url redirect. Returns { email, tier, api_key } once the
  // webhook has provisioned the account; returns { pending: true } and HTTP
  // 202 while we wait (client retries). 402 if not paid. 404 if unknown.
  const checkoutSessionMatch = pathname.match(/^\/api\/checkout\/session\/([A-Za-z0-9_-]+)$/);
  if (checkoutSessionMatch && req.method === 'GET') {
    if (!rateLimit(req, res, generalLimiter, routeLabel, 'cs')) return;
    const sessionId = checkoutSessionMatch[1].slice(0, 200);
    try {
      // Resolve email from the cached account plan we provisioned via webhook.
      // We look up by checkoutSessionId, which `provisionAccount` already
      // stores. If the webhook hasn't landed yet, fall back to Stripe directly.
      let matchedPlan = null;
      let matchedAccountId = null;
      for (const [accId, plan] of accountPlans.entries()) {
        if (plan.checkoutSessionId === sessionId) {
          matchedPlan = plan;
          matchedAccountId = accId;
          break;
        }
      }

      // If we found a provisioned plan, return key + tier + email.
      if (matchedPlan && matchedAccountId) {
        const accountKey = Array.from(apiKeys.values())
          .find((k) => k.accountId === matchedAccountId && !k.revokedAt);
        // Email is stored on the account_member row for this account.
        const member = Array.from(accountMembers.values())
          .find((m) => m.accountId === matchedAccountId);
        const email = member?.email || matchedPlan.customerEmail || null;
        if (accountKey) {
          // We never persist plaintext API secrets, only hashes. Therefore the
          // secret on this endpoint is only present on the FIRST request after
          // provisioning when it's still in-memory on the `key.secret` field.
          // For subsequent requests we return the prefix only and direct the
          // user to rotate via the console. That's a deliberate trade-off —
          // /thanks should be hit immediately after checkout, while the
          // secret is fresh.
          return json(res, {
            email,
            tier: matchedPlan.plan,
            api_key: accountKey.secret || accountKey.prefix,
            secretPrefix: accountKey.prefix,
            accountId: matchedAccountId,
          });
        }
      }

      // No provisioned plan yet — talk to Stripe to confirm the session and,
      // when paid, wait briefly for the webhook to land. We tell the client to
      // retry by returning 202 + { pending: true }.
      const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
      if (!STRIPE_KEY) {
        return json(res, { error: 'session not provisioned and STRIPE_SECRET_KEY missing' }, 503);
      }
      let session;
      try {
        const client = stripeBillingClient();
        session = await client.retrieveCheckoutSession(sessionId);
      } catch (e) {
        if (e.statusCode === 404) return json(res, { error: 'session not found' }, 404);
        return errorJson(res, e);
      }
      if (!session) return json(res, { error: 'session not found' }, 404);
      const paid = session.payment_status === 'paid' || session.status === 'complete';
      if (!paid) {
        return json(res, { error: 'session not paid yet', pending: true, status: 'unpaid' }, 402);
      }

      // Paid but webhook not yet landed. Poll the in-memory accountPlans for
      // up to 5 seconds, then 202 the client to retry.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        for (const [accId, plan] of accountPlans.entries()) {
          if (plan.checkoutSessionId === sessionId) {
            const accountKey = Array.from(apiKeys.values())
              .find((k) => k.accountId === accId && !k.revokedAt);
            const member = Array.from(accountMembers.values())
              .find((m) => m.accountId === accId);
            const email = member?.email || session.customer_details?.email || session.customer_email || null;
            if (accountKey) {
              return json(res, {
                email,
                tier: plan.plan,
                api_key: accountKey.secret || accountKey.prefix,
                secretPrefix: accountKey.prefix,
                accountId: accId,
              });
            }
          }
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      // Still pending — tell the client to retry.
      return json(res, {
        pending: true,
        status: 'provisioning',
        email: session.customer_details?.email || session.customer_email || null,
      }, 202);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/v1/billing/stripe/webhook' && req.method === 'POST') {
    if (!rateLimit(req, res, webhookLimiter, routeLabel, 'wh')) return;
    try {
      const rawBody = await readRawBody(req, { maxBytes: MAX_WEBHOOK_BODY_BYTES });
      const signature = req.headers['stripe-signature'];
      const verification = verifyStripeWebhookSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
      if (!verification.ok) {
        webhookEventsTotal.inc({ type: 'unknown', verification: verification.reason || 'invalid', idempotent: 'no' });
        return json(res, { ok: false, error: verification.reason }, 400);
      }
      let event;
      try { event = JSON.parse(rawBody || '{}'); }
      catch { return json(res, { ok: false, error: 'invalid webhook payload' }, 400); }

      const eventId = event?.id;
      // Idempotency: if Stripe re-delivers (network blip, retry, or replay),
      // short-circuit and return the cached response so we don't re-provision.
      if (eventId) {
        const seen = webhookIdempotency.get(eventId);
        if (seen) {
          webhookEventsTotal.inc({ type: event.type || 'unknown', verification: verification.mode, idempotent: 'yes' });
          return json(res, { ok: true, idempotent: true, eventId, ...seen.result }, 200);
        }
      }

      const handledTypes = new Set(['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted']);
      if (!handledTypes.has(event.type)) {
        const result = { ignored: true, type: event.type || 'unknown', verification };
        if (eventId) webhookIdempotency.record(eventId, result);
        webhookEventsTotal.inc({ type: event.type || 'unknown', verification: verification.mode, idempotent: 'no' });
        saveConsoleStore();
        return json(res, { ok: true, ...result });
      }
      const fallbackAccountId = accountIdForRequest(req);
      const provisionBody = provisioningBodyFromStripeEvent(event, fallbackAccountId);
      const accountId = String(provisionBody.accountId || fallbackAccountId).slice(0, 120);
      delete provisionBody.accountId;
      const provisioned = await provisionAccount(provisionBody, accountId);
      recordAudit(accountId, 'billing.stripe.webhook.handled', `stripe:${event.id || event.type}`, {
        eventId: event.id || null,
        type: event.type,
        verification: verification.mode,
      });
      const result = { accountId, type: event.type, verification, ...provisioned };
      if (eventId) webhookIdempotency.record(eventId, { accountId, type: event.type });
      webhookEventsTotal.inc({ type: event.type, verification: verification.mode, idempotent: 'no' });
      saveConsoleStore();
      return json(res, { ok: true, ...result }, 200);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/v1/usage/report' && req.method === 'GET') {
    const accountId = accountIdForRequest(req);
    return json(res, { ok: true, ...meteringSnapshot(accountId) });
  }

  if (pathname === '/api/v1/usage/export' && req.method === 'GET') {
    const accountId = accountIdForRequest(req);
    const report = meteringSnapshot(accountId);
    const events = auditEvents
      .filter((event) => event.accountId === accountId)
      .slice(-200)
      .map(publicAuditEvent);
    recordAudit(accountId, 'usage.report.exported', `account:${accountId}`, {
      period: report.period,
      missionsUsed: report.missions.used,
      missionLimit: report.missions.limit,
    });
    saveConsoleStore();
    return json(res, { ok: true, exportedAt: new Date().toISOString(), report, events });
  }

  if (pathname === '/api/v1/audit/events' && req.method === 'GET') {
    const accountId = accountIdForRequest(req);
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10)));
    const events = auditEvents
      .filter((event) => event.accountId === accountId)
      .slice(-limit)
      .reverse()
      .map(publicAuditEvent);
    return json(res, { ok: true, accountId, events });
  }

  // Hosted Brain API prototype. This is the contract that becomes the
  // production brain service once auth + persistent storage are wired.
  if (pathname === '/api/v1/brain/memories' && req.method === 'POST') {
    try {
      const accountId = accountIdForRequest(req);
      const body = await readBody(req);
      const memory = await storeBrainMemory(body, accountId);
      return json(res, { ok: true, memory }, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/v1/brain/query' && req.method === 'POST') {
    try {
      const accountId = accountIdForRequest(req);
      const body = await readBody(req);
      const result = await queryBrain(body, accountId);
      return json(res, { ok: true, ...result });
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/v1/brain/reason' && req.method === 'POST') {
    try {
      const accountId = accountIdForRequest(req);
      const body = await readBody(req);
      const trace = await reasonOverBrain(body, accountId);
      return json(res, { ok: true, ...trace });
    } catch (e) {
      return errorJson(res, e);
    }
  }

  if (pathname === '/api/v1/brain/reason/traces' && req.method === 'GET') {
    const accountId = accountIdForRequest(req);
    const namespace = url.searchParams.get('namespace') ? String(url.searchParams.get('namespace')).slice(0, 240) : null;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    return json(res, { ok: true, accountId, namespace, traces: listBrainReasoningTraces(accountId, { namespace, limit }) });
  }

  const reasoningTraceMatch = pathname.match(/^\/api\/v1\/brain\/reason\/traces\/([^/]+)$/);
  if (reasoningTraceMatch && req.method === 'GET') {
    const accountId = accountIdForRequest(req);
    const traceId = decodeURIComponent(reasoningTraceMatch[1] || '').slice(0, 200);
    const trace = brainReasoningTraces.get(traceId);
    if (!trace || trace.accountId !== accountId) return json(res, { ok: false, error: 'reasoning trace not found' }, 404);
    return json(res, { ok: true, trace: publicBrainReasoningTrace(trace) });
  }

  const namespaceMatch = pathname.match(/^\/api\/v1\/brain\/namespaces\/([^/]+)(?:\/(graph|enrich|export))?$/);
  if (namespaceMatch) {
    const accountId = accountIdForRequest(req);
    const namespace = decodeURIComponent(namespaceMatch[1] || 'default').slice(0, 240);
    const sub = namespaceMatch[2];

    if (sub === 'graph' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') || '200', 10)));
      return json(res, { ok: true, ...brainGraphSnapshot(accountId, namespace, limit) });
    }

    if (sub === 'enrich' && req.method === 'POST') {
      const graph = rebuildBrainGraph(accountId, namespace);
      recordAudit(accountId, 'brain.graph.rebuilt', `brain:${namespace}`, graph.stats);
      saveConsoleStore();
      return json(res, { ok: true, ...graph });
    }

    if (sub === 'export' && req.method === 'GET') {
      const rows = Array.from(brainMemories.values())
        .filter((m) => m.accountId === accountId && m.namespace === namespace)
        .map(publicBrainMemory);
      const reasoningTraces = listBrainReasoningTraces(accountId, { namespace, limit: 200 });
      recordAudit(accountId, 'brain.namespace.exported', `brain:${namespace}`, { namespace, memoryCount: rows.length, reasoningTraceCount: reasoningTraces.length });
      saveConsoleStore();
      return json(res, { ok: true, accountId, namespace, exportedAt: new Date().toISOString(), memories: rows, reasoningTraces });
    }

    if (!sub && req.method === 'GET') {
      const rows = Array.from(brainMemories.values()).filter((m) => m.accountId === accountId && m.namespace === namespace);
      const lastWrite = rows.map((m) => m.createdAt).sort().pop() || null;
      const graph = brainGraphSnapshot(accountId, namespace, 1);
      return json(res, { ok: true, accountId, namespace, memoryCount: rows.length, lastWrite, mode: brain ? 'recall-engine' : 'fallback', graph: graph.stats });
    }

    if (!sub && req.method === 'DELETE') {
      let deleted = 0;
      for (const [id, memory] of brainMemories.entries()) {
        if (memory.accountId === accountId && memory.namespace === namespace) {
          brainMemories.delete(id);
          if (brain?.remove) brain.remove(id);
          deleted++;
        }
      }
      let tracesDeleted = 0;
      for (const [id, trace] of brainReasoningTraces.entries()) {
        if (trace.accountId === accountId && trace.namespace === namespace) {
          brainReasoningTraces.delete(id);
          tracesDeleted++;
        }
      }
      clearBrainGraph(accountId, namespace);
      recordAudit(accountId, 'brain.namespace.deleted', `brain:${namespace}`, { namespace, deleted, reasoningTracesDeleted: tracesDeleted });
      saveConsoleStore();
      return json(res, { ok: true, accountId, namespace, deleted, reasoningTracesDeleted: tracesDeleted });
    }
  }

  // GitHub repos
  if (pathname === '/api/repos' && req.method === 'GET') {
    try {
      const repos = await fetchRepoStatus();
      return json(res, repos);
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // Health: liveness probe — process is alive and event loop responsive.
  if (pathname === '/healthz') {
    return json(res, { status: 'ok', mode: 'live', agentId: agent.agentId || 'dashboard-live', storeDriver: CONSOLE_STORE_DRIVER });
  }

  // Readiness: deps reachable + required config present. Returns 503 when not ready.
  if (pathname === '/readyz') {
    const readiness = deploymentReadiness();
    return json(res, { status: readiness.ok ? 'ok' : 'not-ready', ...readiness }, readiness.ok ? 200 : 503);
  }

  if (pathname === '/api/v1/ops/readiness' && req.method === 'GET') {
    return json(res, { ok: true, ...deploymentReadiness() });
  }

  // Summarize a conversation session into a dated factual digest, then store
  // it as a memory in the target namespace. Requires Groq or Anthropic key.
  if (pathname === '/api/v1/brain/summarize' && req.method === 'POST') {
    try {
      const accountId = accountIdForRequest(req);
      const body = await readBody(req);
      const sdkMain = (() => { try { return require('@mnemopay/sdk'); } catch { try { return require('../dist/index.js'); } catch { return null; } } })();
      if (!sdkMain?.summarizeSession) return errorJson(res, new Error('summarizer unavailable'), 503);
      const groqKey = process.env.GROQ_API_KEY;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!groqKey && !anthropicKey) return errorJson(res, new Error('GROQ_API_KEY or ANTHROPIC_API_KEY required'), 503);
      assertPlanAllows(accountId, 'brain.write');
      const turns = Array.isArray(body.turns) ? body.turns : [];
      if (turns.length === 0) return errorJson(res, new Error('turns required'));
      const namespace = String(body.namespace || 'default').slice(0, 120);
      const sessionId = String(body.sessionId || `sess_${uuid()}`).slice(0, 80);
      const date = String(body.date || new Date().toISOString().slice(0, 10));
      const summary = await sdkMain.summarizeSession(turns, {
        provider: groqKey ? 'groq' : 'anthropic',
        apiKey: groqKey || anthropicKey,
        date,
      });
      const content = sdkMain.formatSummaryMemory({ sessionId, date, summary });
      const memory = await storeBrainMemory({
        namespace, content,
        tags: ['summary', 'session', sessionId],
        importance: 0.85,
      }, accountId);
      return json(res, { ok: true, sessionId, summary, memory }, 201);
    } catch (e) {
      return errorJson(res, e);
    }
  }

  // Brain capability report — tells clients which optional features are wired.
  if (pathname === '/api/v1/brain/capabilities' && req.method === 'GET') {
    return json(res, {
      ok: true,
      mode: brain ? 'recall-engine' : 'fallback',
      strategy: process.env.MNEMOPAY_BRAIN_STRATEGY || (brain ? 'hybrid' : 'lexical'),
      embeddingProvider: process.env.MNEMOPAY_BRAIN_EMBEDDING || 'local',
      llmReasoning: !!reasoner,
      hydeExpansion: !!hyde,
      reranker: !!reranker,
      entityGraph: !!entityGraph,
      llmEntityExtraction: !!extractEntitiesFn,
    });
  }

  // Prometheus metrics scrape endpoint.
  if (pathname === '/metrics' && req.method === 'GET') {
    processUptime.set({}, Math.floor(process.uptime()));
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    return res.end(metrics.render());
  }

  // ── Static files ────────────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
      applySecurityHeaders(res, { html: true });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch (e) {
      reqLog.error('failed to serve index.html', { err: e });
      return json(res, { error: 'index missing' }, 500);
    }
  }

  // 404
  json(res, { error: 'Not found' }, 404);
}

const server = http.createServer((req, res) => {
  Promise.resolve()
    .then(() => handleRequest(req, res))
    .catch((err) => {
      // Last-resort safety net. Individual routes catch their own errors;
      // anything that reaches here is an unexpected throw from middleware.
      log.error('unhandled request error', { err, rid: req._rid, path: req.url });
      if (err && err.name === 'BodyTooLargeError') {
        return errorJson(res, err);
      }
      if (!res.headersSent) {
        try { errorJson(res, { message: 'internal server error' }, 500); }
        catch { try { res.end(); } catch {} }
      } else {
        try { res.end(); } catch {}
      }
    });
});

server.on('clientError', (err, socket) => {
  if (err.code === 'ECONNRESET' || !socket.writable) return;
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
});

async function startServer() {
  await loadConsoleStore();
  return new Promise((resolve) => {
    server.listen(PORT, () => {
      log.info('dashboard started', {
        port: PORT,
        agentId: agent.agentId || 'dashboard-live',
        storeDriver: CONSOLE_STORE_DRIVER,
        nodeEnv: process.env.NODE_ENV || 'development',
        repos: MONITORED_REPOS.length,
      });
      resolve(server);
    });
  });
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown initiated', { signal });
  // Stop accepting new connections.
  server.close((err) => {
    if (err) log.error('server.close error', { err });
  });
  try {
    // Wait up to 15s for in-flight requests to drain.
    const drainDeadline = Date.now() + 15_000;
    while (server.connections > 0 && Date.now() < drainDeadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // Flush any pending persistence writes.
    await flushConsoleStoreOnShutdown();
    if (consolePostgresStore?.close) await consolePostgresStore.close();
    log.info('shutdown complete');
  } catch (err) {
    log.error('shutdown error', { err });
  } finally {
    // Don't kill the process when the smoke test drives shutdown.
    if (signal !== 'test' && require.main === module) process.exit(0);
  }
}

if (require.main === module) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', { err });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
  });
  startServer().catch((e) => {
    log.error('failed to start', { err: e });
    process.exit(1);
  });
}

module.exports = {
  server,
  startServer,
  shutdown,
  handleRequest,
  metrics,
  // Surface helpers for tests.
  _internals: {
    apiKeys, brainMemories, brainEntities, brainEdges, auditEvents,
    accountPlans, accountMembers, consoleSessions, authChallenges,
    usageCounters, webhookIdempotency, deploymentReadiness,
    verifyStripeWebhookSignature, recordAudit, createApiKey,
    storeBrainMemory, queryBrain, reasonOverBrain, provisionAccount,
    onboardingState, meteringSnapshot, accountPlanFor, routeLabelFromPath,
    PLAN_CATALOG,
  },
};
