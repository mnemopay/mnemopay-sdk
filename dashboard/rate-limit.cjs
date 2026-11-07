/**
 * In-memory token-bucket rate limiter for the MnemoPay dashboard.
 *
 * Single-process design: each Fly machine has its own buckets. If the dashboard
 * scales to >1 machine, swap this for a Redis-backed limiter.
 *
 * Usage:
 *   const limiter = createRateLimiter({ capacity: 30, refillPerSec: 0.5 });
 *   const result = limiter.consume(key);
 *   if (!result.ok) return 429 with result.retryAfterSec.
 *
 * Buckets self-evict after 1h of inactivity to bound memory.
 */

const DEFAULT_SWEEP_MS = 60_000;
const DEFAULT_TTL_MS = 60 * 60_000;

function createRateLimiter({
  capacity = 60,
  refillPerSec = 1,
  ttlMs = DEFAULT_TTL_MS,
  sweepMs = DEFAULT_SWEEP_MS,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map();

  function bucket(key) {
    const existing = buckets.get(key);
    const t = now();
    if (existing) {
      const elapsed = Math.max(0, (t - existing.lastRefill) / 1000);
      existing.tokens = Math.min(capacity, existing.tokens + elapsed * refillPerSec);
      existing.lastRefill = t;
      existing.lastSeen = t;
      return existing;
    }
    const fresh = { tokens: capacity, lastRefill: t, lastSeen: t };
    buckets.set(key, fresh);
    return fresh;
  }

  function consume(key, cost = 1) {
    const b = bucket(key);
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { ok: true, remaining: Math.floor(b.tokens) };
    }
    const deficit = cost - b.tokens;
    const retryAfterSec = Math.ceil(deficit / refillPerSec);
    return { ok: false, remaining: 0, retryAfterSec };
  }

  function peek(key) {
    const b = bucket(key);
    return { remaining: Math.floor(b.tokens) };
  }

  const sweepTimer = setInterval(() => {
    const cutoff = now() - ttlMs;
    for (const [key, b] of buckets) {
      if (b.lastSeen < cutoff) buckets.delete(key);
    }
  }, sweepMs);
  sweepTimer.unref?.();

  return { consume, peek, _buckets: buckets, _sweepTimer: sweepTimer };
}

/**
 * Identify the client for rate limiting WITHOUT trusting client-supplied headers.
 *
 * The leftmost X-Forwarded-For entry is whatever the client wrote, so keying on
 * it let anyone pick a fresh bucket per request (audit D3). Each trusted proxy
 * APPENDS the address it saw, so the entry we can believe is counted from the
 * RIGHT: with N trusted proxy hops in front of us it is XFF[len - N].
 *
 *   MNEMOPAY_TRUSTED_PROXY_HOPS  number of proxies in front of this server that
 *       append to X-Forwarded-For (default 1: Railway/Fly edge). 0 = ignore XFF
 *       and use the socket address.
 *   MNEMOPAY_TRUST_FLY_CLIENT_IP=1  honour Fly's `fly-client-ip` header. Off by
 *       default: it is only trustworthy when Fly's edge is the only way in, and
 *       on Railway any client can send it.
 */
function clientKeyForRequest(req, opts = {}) {
  const hopsRaw = opts.trustedProxyHops ?? process.env.MNEMOPAY_TRUSTED_PROXY_HOPS;
  const parsed = hopsRaw === undefined || hopsRaw === '' ? 1 : Number.parseInt(hopsRaw, 10);
  const hops = Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
  const trustFly = opts.trustFlyClientIp ?? process.env.MNEMOPAY_TRUST_FLY_CLIENT_IP === '1';
  const headers = req.headers || {};

  if (trustFly) {
    const fly = String(headers['fly-client-ip'] || '').trim();
    if (fly) return fly;
  }
  if (hops > 0) {
    const parts = String(headers['x-forwarded-for'] || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= hops) return parts[parts.length - hops];
  }
  return req.socket?.remoteAddress || 'unknown';
}

module.exports = { createRateLimiter, clientKeyForRequest };
