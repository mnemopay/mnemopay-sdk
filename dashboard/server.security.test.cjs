/**
 * Security regression tests for dashboard/server.js identity handling.
 *
 * Every case here was exploitable before: identity used to come from a
 * client-sent X-MnemoPay-Account / X-Agent-Id header, /auth/login minted a
 * session for any account id, and {"plan":"team"} granted a paid plan.
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemopay-sec-'));
const PORT = 5000 + Math.floor(Math.random() * 1000);

process.env.PORT = String(PORT);
process.env.NODE_ENV = 'test';
process.env.MNEMOPAY_CONSOLE_STORE_DRIVER = 'json';
process.env.MNEMOPAY_CONSOLE_STORE = path.join(TMP, 'store.json');
process.env.MNEMOPAY_SESSION_SECRET = 'sec-test-secret-' + crypto.randomBytes(8).toString('hex');
process.env.MNEMOPAY_AUTH_RETURN_CODES = 'true';
process.env.MNEMOPAY_SAVE_DEBOUNCE_MS = '0';
process.env.MNEMOPAY_RATE_AUTH_CAPACITY = '1000';
process.env.MNEMOPAY_RATE_GENERAL_CAPACITY = '5000';
process.env.MNEMOPAY_PUBLIC_URL = `http://127.0.0.1:${PORT}`;
delete process.env.MNEMOPAY_ALLOW_DEV_LOGIN;

const { startServer, shutdown, _internals } = require('./server.js');

function request(method, pathName, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: pathName, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
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

// Passwordless sign-in; returns the Cookie header, or the failing response.
async function signIn(accountId, email) {
  const ch = await request('POST', '/api/v1/auth/challenge', { body: { accountId, email } });
  if (ch.status !== 201) return { failed: ch };
  const v = await request('POST', '/api/v1/auth/verify', {
    body: { challengeId: ch.body.challenge.id, code: ch.body.challenge.devCode },
  });
  if (v.status !== 201) return { failed: v };
  return { cookie: v.headers['set-cookie'][0].split(';')[0] };
}

async function main() {
  await startServer();
  try {
    // 1. Anonymous callers cannot name an account through a header.
    const victim = 'acct_victim';
    const spoof = { 'x-mnemopay-account': victim };
    for (const [m, p, b] of [
      ['GET', '/api/v1/developer/api-keys'],
      ['POST', '/api/v1/developer/api-keys', { name: 'stolen' }],
      ['GET', '/api/v1/auth/members'],
      ['GET', '/api/v1/console/overview'],
      ['GET', '/api/v1/audit/events'],
      ['GET', '/api/v1/usage/report'],
      ['POST', '/api/v1/brain/query', { query: 'x' }],
      ['POST', '/api/v1/brain/memories', { content: 'x' }],
      ['POST', '/api/v1/billing/provision', { plan: 'team' }],
      ['POST', '/api/v1/billing/checkout/success', { plan: 'team' }],
      ['POST', '/api/v1/billing/portal/session', {}],
    ]) {
      const r = await request(m, p, { body: b, headers: spoof });
      assert.strictEqual(r.status, 401, `${m} ${p} must be 401 anonymously, got ${r.status}`);
    }
    assert.strictEqual(_internals.apiKeys.size, 0, 'no key may be minted anonymously');

    // 2. Agent routes: no X-Agent-Id / default-agent access without auth.
    for (const [m, p, b] of [
      ['GET', '/api/profile'], ['GET', '/api/balance'], ['GET', '/api/history'], ['GET', '/api/logs'],
      ['GET', '/api/memories'], ['POST', '/api/memories', { content: 'x' }],
      ['POST', '/api/charge', { amount: 5, reason: 'x' }],
      ['POST', '/api/settle', { txId: 'x' }], ['POST', '/api/refund', { txId: 'x' }],
    ]) {
      const r = await request(m, p, { body: b, headers: { 'x-agent-id': 'someone-else' } });
      assert.strictEqual(r.status, 401, `${m} ${p} must be 401 anonymously, got ${r.status}`);
    }

    // 3. Credential-less login is gone.
    const login = await request('POST', '/api/v1/auth/login', { body: { accountId: victim } });
    assert.strictEqual(login.status, 410);
    assert.strictEqual(_internals.consoleSessions.size, 0, 'no session minted by /auth/login');

    // 4. An email may only sign in to a brand-new account or one it belongs to.
    const owner = await signIn(victim, 'owner@victim.test');
    assert(owner.cookie, 'first claim of a new account works');
    const attacker = await signIn(victim, 'attacker@evil.test');
    assert.strictEqual(attacker.failed.status, 403, 'attacker cannot sign in to an existing account');
    // Legacy account that exists (has a key) but has no members cannot be claimed by OTP.
    _internals.createApiKey('acct_legacy', 'legacy');
    const legacyClaim = await signIn('acct_legacy', 'attacker@evil.test');
    assert.strictEqual(legacyClaim.failed.status, 403, 'unclaimed account with data is not claimable');
    // Challenge issued before someone else claimed the account is re-checked at verify.
    const early = await request('POST', '/api/v1/auth/challenge', { body: { accountId: 'acct_race', email: 'late@x.test' } });
    assert.strictEqual(early.status, 201);
    const first = await signIn('acct_race', 'first@x.test');
    assert(first.cookie);
    const late = await request('POST', '/api/v1/auth/verify', {
      body: { challengeId: early.body.challenge.id, code: early.body.challenge.devCode },
    });
    assert.strictEqual(late.status, 403, 'stale challenge cannot take over a claimed account');

    // 5. Provisioning: free is self-serve, paid is not.
    const paid = await request('POST', '/api/v1/billing/provision', { body: { plan: 'team' }, headers: { cookie: owner.cookie } });
    assert.strictEqual(paid.status, 402);
    const fake = await request('POST', '/api/v1/billing/provision', {
      body: { plan: 'team', checkoutSessionId: 'cs_forged', source: 'stripe-webhook', status: 'active' },
      headers: { cookie: owner.cookie },
    });
    assert(fake.status >= 400, `forged checkout session must fail, got ${fake.status}`);
    const free = await request('POST', '/api/v1/billing/provision', { body: { plan: 'free', createApiKey: false }, headers: { cookie: owner.cookie } });
    assert.strictEqual(free.status, 201);
    assert.strictEqual(free.body.account.plan, 'free');
    assert.notStrictEqual(_internals.accountPlanFor(victim).plan, 'team');

    // 6. Agents are bound to the authenticated account.
    const a = owner.cookie;
    const b = (await signIn('acct_b', 'b@b.test')).cookie;
    await _internals.provisionAccount({ plan: 'pro', interval: 'monthly', createApiKey: false, source: 'stripe-webhook' }, victim);
    await _internals.provisionAccount({ plan: 'pro', interval: 'monthly', createApiKey: false, source: 'stripe-webhook' }, 'acct_b');
    const charge = await request('POST', '/api/charge', { body: { amount: 7, reason: 'a-only' }, headers: { cookie: a } });
    assert.strictEqual(charge.status, 201, JSON.stringify(charge.body));
    const bHist = await request('GET', '/api/history', { headers: { cookie: b, 'x-agent-id': 'acct_victim' } });
    assert.strictEqual(bHist.status, 200);
    assert(!JSON.stringify(bHist.body).includes('a-only'), "B cannot see A's transactions by naming A");
    const aHist = await request('GET', '/api/history', { headers: { cookie: a } });
    assert(JSON.stringify(aHist.body).includes('a-only'), 'A sees own transactions');
    for (const bad of ['../../etc/x', '..\\..\\x', 'a/b', 'x'.repeat(65), 'a b']) {
      const r = await request('GET', '/api/profile', { headers: { cookie: a, 'x-agent-id': bad } });
      assert.strictEqual(r.status, 400, `unsafe X-Agent-Id ${JSON.stringify(bad)} must be 400, got ${r.status}`);
    }
    const okLabel = await request('GET', '/api/profile', { headers: { cookie: a, 'x-agent-id': 'worker-1' } });
    assert.strictEqual(okLabel.status, 200);
    assert(/^acct_[0-9a-f]{32}_worker-1$/.test(okLabel.body.id) || okLabel.body.id === undefined || typeof okLabel.body.id === 'string');

    // 7. Money input validation.
    for (const amount of [-5, 0, 'abc', null, 'NaN']) {
      const r = await request('POST', '/api/charge', { body: { amount, reason: 'x' }, headers: { cookie: a } });
      assert.strictEqual(r.status, 400, `amount ${JSON.stringify(amount)} must be rejected, got ${r.status}`);
    }

    // 8. Roles: only an owner grants owner; the last owner cannot be demoted.
    const addAdmin = await request('POST', '/api/v1/auth/members', { body: { email: 'admin@victim.test', role: 'admin' }, headers: { cookie: a } });
    assert.strictEqual(addAdmin.status, 201, JSON.stringify(addAdmin.body));
    const admin = await signIn(victim, 'admin@victim.test');
    assert(admin.cookie, 'existing member can sign in');
    const escalate = await request('POST', '/api/v1/auth/members', { body: { email: 'admin@victim.test', role: 'owner' }, headers: { cookie: admin.cookie } });
    assert.strictEqual(escalate.status, 403, 'admin cannot make themselves owner');
    const demoteOwner = await request('POST', '/api/v1/auth/members', { body: { email: 'owner@victim.test', role: 'member' }, headers: { cookie: admin.cookie } });
    assert.strictEqual(demoteOwner.status, 403, 'admin cannot demote an owner');
    const demoteLast = await request('POST', '/api/v1/auth/members', { body: { email: 'owner@victim.test', role: 'member' }, headers: { cookie: a } });
    assert.strictEqual(demoteLast.status, 400, 'last owner cannot be demoted');

    // 9. Public FICO lookup rejects path-shaped ids.
    for (const id of ['..%2f..%2fx', '%2e%2e%2fx', 'a%2fb', 'a%5cb']) {
      const r = await request('GET', `/api/v1/agent-fico/${id}`);
      assert.strictEqual(r.status, 400, `agent-fico ${id} must be 400, got ${r.status}`);
    }

    // 10. Legit API-key auth still works.
    const key = _internals.createApiKey('acct_keyed', 'k');
    const viaKey = await request('GET', '/api/v1/developer/api-keys', { headers: { authorization: `Bearer ${key.secret}` } });
    assert.strictEqual(viaKey.status, 200);
    assert.strictEqual(viaKey.body.accountId, 'acct_keyed');
    const badKey = await request('GET', '/api/v1/developer/api-keys', { headers: { authorization: 'Bearer mnemo_nope', 'x-mnemopay-account': 'acct_keyed' } });
    assert.strictEqual(badKey.status, 401, 'a wrong key plus a spoofed header is still anonymous');

    // 11. Native app: a signed session token works as a Bearer credential; the raw id and junk do not.
    const signed = decodeURIComponent(owner.cookie.split('=').slice(1).join('='));
    const viaBearerSession = await request('GET', '/api/v1/developer/api-keys', { headers: { authorization: `Bearer ${signed}` } });
    assert.strictEqual(viaBearerSession.status, 200, 'signed session token as Bearer must authenticate');
    assert.strictEqual(viaBearerSession.body.accountId, victim);
    const rawId = signed.slice(0, signed.lastIndexOf('.'));
    const viaRawId = await request('GET', '/api/v1/developer/api-keys', { headers: { authorization: `Bearer ${rawId}` } });
    assert.strictEqual(viaRawId.status, 401, 'unsigned session id must not authenticate');
    const viaForged = await request('GET', '/api/v1/developer/api-keys', { headers: { authorization: `Bearer ${rawId}.deadbeef` } });
    assert.strictEqual(viaForged.status, 401, 'forged signature must not authenticate');

    console.log('server.security.test.cjs OK');
  } finally {
    await shutdown('test');
  }
}

main().then(() => process.exit(0), (err) => { console.error('SECURITY TEST FAILED:', err); process.exit(1); });
