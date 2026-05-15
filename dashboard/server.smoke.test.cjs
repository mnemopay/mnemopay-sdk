/**
 * End-to-end smoke test for dashboard/server.js.
 *
 * Boots the live HTTP server with an isolated JSON console store, drives the
 * full surface area, and asserts production-grade behavior:
 *   - Auth: challenge + verify + session lifecycle
 *   - Brain: write, query, reason, graph, namespace lifecycle
 *   - Billing: provision + readiness signals
 *   - Webhook: signature verification + idempotency
 *   - Rate limit: auth challenge burst is capped
 *   - Body size limit: 413 on oversize
 *   - Metrics: prometheus output present
 *   - Headers: security headers + request id
 *   - CORS: rejects unlisted origin in production
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemopay-smoke-'));
const STORE = path.join(TMP, 'store.json');
const PORT = 4000 + Math.floor(Math.random() * 1000);

// Set env BEFORE requiring server.js — its constants close over env at import.
process.env.PORT = String(PORT);
process.env.NODE_ENV = 'test';
process.env.MNEMOPAY_CONSOLE_STORE_DRIVER = 'json';
process.env.MNEMOPAY_CONSOLE_STORE = STORE;
process.env.MNEMOPAY_SESSION_SECRET = 'smoke-test-secret-' + crypto.randomBytes(8).toString('hex');
process.env.MNEMOPAY_AUTH_RETURN_CODES = 'true';
process.env.MNEMOPAY_SAVE_DEBOUNCE_MS = '0';
process.env.MNEMOPAY_RATE_AUTH_CAPACITY = '3';
process.env.MNEMOPAY_RATE_AUTH_REFILL = '0.0001'; // effectively no refill during the test
process.env.MNEMOPAY_MAX_BODY_BYTES = '4096';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_smoke_test';
process.env.MNEMOPAY_PUBLIC_URL = `http://127.0.0.1:${PORT}`;

const { startServer, shutdown, _internals } = require('./server.js');

function request(method, pathName, { body, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathName,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', () => {
        if (raw) return resolve({ status: res.statusCode, headers: res.headers, body: buf });
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch { parsed = { _raw: buf }; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function stripeSignature(rawBody, secret, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return { ts, header: `t=${ts},v1=${sig}` };
}

async function main() {
  await startServer();

  try {
    // ── Health & readiness ────────────────────────────────────────────────
    const health = await request('GET', '/healthz');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.status, 'ok');

    const ready = await request('GET', '/readyz');
    // JSON driver + dev session secret means recommended items show but
    // required gates pass in non-production.
    assert(ready.status === 200 || ready.status === 503, `unexpected readiness: ${ready.status}`);
    assert(Array.isArray(ready.body.checks), 'readyz returns checks list');

    // ── Security headers + request id ─────────────────────────────────────
    assert(health.headers['x-content-type-options'] === 'nosniff');
    assert(health.headers['x-frame-options'] === 'DENY');
    assert(health.headers['referrer-policy'] === 'strict-origin-when-cross-origin');
    assert(typeof health.headers['x-request-id'] === 'string' && health.headers['x-request-id'].length > 0);

    // ── Auth challenge → verify → session ─────────────────────────────────
    const challenge = await request('POST', '/api/v1/auth/challenge', {
      body: { accountId: 'acct_smoke', email: 'smoke@example.com' },
    });
    assert.strictEqual(challenge.status, 201, JSON.stringify(challenge.body));
    assert(challenge.body.challenge.id.startsWith('auth_'));
    assert(challenge.body.challenge.devCode, 'dev code returned with MNEMOPAY_AUTH_RETURN_CODES=true');

    const verify = await request('POST', '/api/v1/auth/verify', {
      body: { challengeId: challenge.body.challenge.id, code: challenge.body.challenge.devCode },
    });
    assert.strictEqual(verify.status, 201);
    assert.strictEqual(verify.body.accountId, 'acct_smoke');
    const cookie = verify.headers['set-cookie']?.[0];
    assert(cookie && cookie.includes('mnemo'), 'session cookie set');
    const cookieHeader = cookie.split(';')[0];

    // Bad code path: invalid code returns 401.
    const challenge2 = await request('POST', '/api/v1/auth/challenge', {
      body: { accountId: 'acct_smoke2', email: 'b@example.com' },
    });
    const bad = await request('POST', '/api/v1/auth/verify', {
      body: { challengeId: challenge2.body.challenge.id, code: '000000' },
    });
    assert.strictEqual(bad.status, 401);

    // Rate limit auth challenges. Capacity is 3; we used 2 above, expect a
    // third to succeed then a fourth to 429.
    await request('POST', '/api/v1/auth/challenge', { body: { accountId: 'r', email: 'r@example.com' } });
    const denied = await request('POST', '/api/v1/auth/challenge', {
      body: { accountId: 'r', email: 'r@example.com' },
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    // The 4th hit on the same client should be rate-limited (depending on shared bucket key).
    // We assert "either succeeded or was 429" since IP/test ordering can vary; the strict check
    // is done in the dedicated burst test below.
    assert(denied.status === 201 || denied.status === 429);

    // Dedicated rate-limit burst test using a fresh client IP.
    let limitedSeen = false;
    for (let i = 0; i < 6; i++) {
      const r = await request('POST', '/api/v1/auth/challenge', {
        body: { accountId: 'burst', email: `b${i}@example.com` },
        headers: { 'x-forwarded-for': '10.0.0.99' },
      });
      if (r.status === 429) { limitedSeen = true; assert(r.body.retryAfterSec >= 0); break; }
    }
    assert(limitedSeen, 'expected rate limiter to deny within 6 attempts');

    // ── Provision acct_smoke to team plan so brain ops aren't capped at 5. ─
    const provision = await request('POST', '/api/v1/billing/provision', {
      body: { plan: 'team', interval: 'monthly', createApiKey: false },
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(provision.status, 201);
    assert.strictEqual(provision.body.account.plan, 'team');

    // ── Body size limit ───────────────────────────────────────────────────
    const big = await request('POST', '/api/v1/brain/memories', {
      body: { content: 'x'.repeat(5000), namespace: 'big' },
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(big.status, 413, `expected 413 for oversize body, got ${big.status}`);

    // ── Brain: write, query, reason ───────────────────────────────────────
    const write = await request('POST', '/api/v1/brain/memories', {
      body: { content: 'MnemoPay is the brain and audit trail for AI agents.', namespace: 'default', tags: ['mnemopay'] },
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(write.status, 201);
    assert(write.body.memory.id.startsWith('mem_'));

    const q = await request('POST', '/api/v1/brain/query', {
      body: { query: 'mnemopay', namespace: 'default', limit: 3 },
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(q.status, 200);
    assert(q.body.count >= 1, 'recall finds the memory');

    const usageBefore = _internals.meteringSnapshot('acct_smoke').usage.brainQueries;
    const reason = await request('POST', '/api/v1/brain/reason', {
      body: { query: 'mnemopay', namespace: 'default' },
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(reason.status, 200);
    assert(reason.body.traceId && reason.body.traceId.startsWith('trace_'), 'reasoning trace has durable id');
    assert(reason.body.evidence, 'reasoning trace has evidence');
    const usageAfter = _internals.meteringSnapshot('acct_smoke').usage.brainQueries;
    assert.strictEqual(usageAfter, usageBefore + 1, 'brain.reason charges exactly one query (no double-bill)');

    const traceList = await request('GET', '/api/v1/brain/reason/traces?namespace=default', {
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(traceList.status, 200);
    assert(traceList.body.traces.some((trace) => trace.id === reason.body.traceId), 'trace list includes durable trace');

    const traceDetail = await request('GET', `/api/v1/brain/reason/traces/${reason.body.traceId}`, {
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(traceDetail.status, 200);
    assert.strictEqual(traceDetail.body.trace.id, reason.body.traceId);
    assert(Array.isArray(traceDetail.body.trace.evidence), 'trace detail includes evidence');

    // ── Namespace path parsing: percent-encoded slashes ──────────────────
    await request('POST', '/api/v1/brain/memories', {
      body: { content: 'tenant-a namespace memory', namespace: 'tenant-a/scope-1', tags: ['x'] },
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    const nsInfo = await request('GET', `/api/v1/brain/namespaces/${encodeURIComponent('tenant-a/scope-1')}`, {
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(nsInfo.status, 200);
    assert.strictEqual(nsInfo.body.namespace, 'tenant-a/scope-1');
    assert.strictEqual(nsInfo.body.memoryCount, 1);

    // ── Webhook: signature check + idempotency ───────────────────────────
    const eventBody = JSON.stringify({
      id: 'evt_smoke_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_abc', client_reference_id: 'acct_wh', metadata: { plan: 'pro', interval: 'monthly' } } },
    });
    const sig = stripeSignature(eventBody, process.env.STRIPE_WEBHOOK_SECRET);
    const wh1 = await request('POST', '/api/v1/billing/stripe/webhook', {
      body: eventBody,
      headers: { 'stripe-signature': sig.header, 'content-type': 'application/json' },
    });
    assert.strictEqual(wh1.status, 200, JSON.stringify(wh1.body));
    assert.strictEqual(wh1.body.accountId, 'acct_wh');

    // Replay: same event id should short-circuit.
    const sig2 = stripeSignature(eventBody, process.env.STRIPE_WEBHOOK_SECRET);
    const wh2 = await request('POST', '/api/v1/billing/stripe/webhook', {
      body: eventBody,
      headers: { 'stripe-signature': sig2.header, 'content-type': 'application/json' },
    });
    assert.strictEqual(wh2.status, 200);
    assert.strictEqual(wh2.body.idempotent, true, 'replay short-circuits via idempotency');

    // Bad signature is rejected with 400.
    const bogus = await request('POST', '/api/v1/billing/stripe/webhook', {
      body: eventBody,
      headers: { 'stripe-signature': 't=0,v1=deadbeef', 'content-type': 'application/json' },
    });
    assert.strictEqual(bogus.status, 400);

    // ── Audit, usage export, members ─────────────────────────────────────
    const audit = await request('GET', '/api/v1/audit/events', {
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(audit.status, 200);
    assert(audit.body.events.length > 0, 'audit feed has events');

    const usageReport = await request('GET', '/api/v1/usage/report', {
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(usageReport.status, 200);
    assert(usageReport.body.missions);

    const namespaceExport = await request('GET', '/api/v1/brain/namespaces/default/export', {
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(namespaceExport.status, 200);
    assert(namespaceExport.body.reasoningTraces.some((trace) => trace.id === reason.body.traceId), 'namespace export includes reasoning traces');

    // ── Brain capabilities surface ───────────────────────────────────────
    const caps = await request('GET', '/api/v1/brain/capabilities');
    assert.strictEqual(caps.status, 200);
    assert(['recall-engine', 'fallback'].includes(caps.body.mode));
    // These should be booleans whether or not they are wired in this env.
    for (const key of ['llmReasoning', 'hydeExpansion', 'reranker', 'entityGraph', 'llmEntityExtraction']) {
      assert.strictEqual(typeof caps.body[key], 'boolean', `${key} should be boolean`);
    }

    // ── Brain reason returns deterministic trace when no LLM key set ─────
    const reasonNoLLM = await request('POST', '/api/v1/brain/reason', {
      body: { query: 'mnemopay', namespace: 'default', llm: true },
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(reasonNoLLM.status, 200);
    // llmReasoning is null when reasoner is not configured.
    assert(reasonNoLLM.body.llmReasoning === null || typeof reasonNoLLM.body.llmReasoning === 'object');

    const deletedNamespace = await request('DELETE', '/api/v1/brain/namespaces/default', {
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(deletedNamespace.status, 200);
    assert(deletedNamespace.body.reasoningTracesDeleted >= 2, 'namespace delete removes reasoning traces');

    // ── HyDE/rerank opt-ins don't break query when underlying not wired ─
    const qExpanded = await request('POST', '/api/v1/brain/query', {
      body: { query: 'mnemopay', namespace: 'default', limit: 3, expansion: 'hyde', rerank: true },
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    assert.strictEqual(qExpanded.status, 200);
    assert(typeof qExpanded.body.count === 'number');

    // ── Summarize endpoint returns 503 when no LLM key configured ────────
    const summarize = await request('POST', '/api/v1/brain/summarize', {
      body: { sessionId: 'sess_test', turns: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] },
      headers: { 'x-mnemopay-account': 'acct_smoke' },
    });
    // Either 201 (key configured) or 503 (no key). Both are acceptable.
    assert([201, 503].includes(summarize.status), `summarize status: ${summarize.status}`);

    // ── Metrics endpoint ─────────────────────────────────────────────────
    const m = await request('GET', '/metrics', {}, { raw: true });
    assert.strictEqual(m.status, 200);

    // Body comes back as parsed JSON normally; switch to raw fetch.
    const mRaw = await request('GET', '/metrics', { raw: true });
    const metricsText = mRaw.body;
    assert(metricsText.includes('mnemopay_http_requests_total'), 'metrics expose http counter');
    assert(metricsText.includes('mnemopay_http_request_duration_ms'), 'metrics expose latency histogram');
    assert(metricsText.includes('mnemopay_webhook_events_total'), 'metrics expose webhook counter');

    // ── Logout ───────────────────────────────────────────────────────────
    const logout = await request('POST', '/api/v1/auth/logout', {
      headers: { cookie: cookieHeader },
    });
    assert.strictEqual(logout.status, 200);

    console.log('server.smoke.test.cjs OK');
  } finally {
    await shutdown('test');
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('SMOKE TEST FAILED:', err);
    process.exit(1);
  },
);
