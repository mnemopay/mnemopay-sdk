const assert = require('assert');
const {
  PostgresConsoleStore,
  createSchemaSql,
  normalizeSnapshot,
  tableNames,
} = require('./console-postgres-store.cjs');

class MockPool {
  constructor() {
    this.queries = [];
    this.rowsByTable = new Map();
  }

  async query(text, values = []) {
    this.queries.push({ text, values });
    const match = text.match(/SELECT payload FROM ([A-Za-z0-9_]+)/);
    if (match) return { rows: this.rowsByTable.get(match[1]) || [] };
    const usageMatch = text.match(/SELECT account_id, payload FROM ([A-Za-z0-9_]+)/);
    if (usageMatch) return { rows: this.rowsByTable.get(usageMatch[1]) || [] };
    return { rows: [], rowCount: 0 };
  }

  async end() {}
}

async function main() {
  const sql = createSchemaSql('mnemo_console');
  assert(sql.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS mnemo_console_api_keys')));
  assert(sql.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS mnemo_console_auth_challenges')));
  assert(sql.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS mnemo_console_webhook_events')));
  assert(sql.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS mnemo_console_brain_reasoning_traces')));
  assert.throws(() => tableNames('bad-prefix'), /invalid table prefix/);

  const normalized = normalizeSnapshot({
    apiKeys: [{ id: 'key_1' }],
    usageCounters: { acct: { brainWrites: 1 } },
  });
  assert.deepStrictEqual(normalized.brainMemories, []);
  assert.deepStrictEqual(normalized.brainReasoningTraces, []);
  assert.deepStrictEqual(normalized.usageCounters.acct, { brainWrites: 1 });
  assert.deepStrictEqual(normalized.webhookEvents, []);

  const pool = new MockPool();
  const store = new PostgresConsoleStore({ pool, tablePrefix: 'mnemo_console' });
  await store.saveSnapshot({
    apiKeys: [{
      id: 'key_1',
      accountId: 'acct_1',
      name: 'default',
      prefix: 'mnemo_abc',
      keyHash: 'hash',
      createdAt: '2026-05-10T00:00:00.000Z',
    }],
    brainMemories: [{
      id: 'mem_1',
      accountId: 'acct_1',
      namespace: 'default',
      content: 'MnemoPay remembers.',
      importance: 0.8,
      tags: ['brain'],
      createdAt: '2026-05-10T00:00:00.000Z',
    }],
    brainReasoningTraces: [{
      id: 'trace_1',
      accountId: 'acct_1',
      namespace: 'default',
      query: 'What is MnemoPay?',
      mode: 'hybrid',
      confidence: 0.9,
      generatedAt: '2026-05-10T00:01:00.000Z',
      evidence: [{ memoryId: 'mem_1' }],
    }],
    usageCounters: { acct_1: { brainWrites: 1, brainQueries: 0, railCharges: 0, railSettlements: 0 } },
    authChallenges: [{
      id: 'auth_1',
      accountId: 'acct_1',
      email: 'j@example.com',
      codeHash: 'hash',
      attempts: 0,
      maxAttempts: 5,
      createdAt: '2026-05-10T00:00:00.000Z',
      expiresAt: '2026-05-10T00:10:00.000Z',
    }],
    webhookEvents: [{ id: 'evt_1', seenAt: 1700000000000 }],
  });

  // Transaction wrapping.
  assert(pool.queries.some((q) => q.text === 'BEGIN'));
  assert(pool.queries.some((q) => q.text === 'COMMIT'));

  // Production-grade upserts: every insert should use ON CONFLICT.
  const inserts = pool.queries.filter((q) => /^INSERT INTO/.test(q.text));
  assert(inserts.length > 0, 'expected at least one INSERT');
  for (const insert of inserts) {
    assert(/ON CONFLICT/i.test(insert.text), `INSERT must use ON CONFLICT: ${insert.text.slice(0, 80)}`);
  }

  // No more delete-all-then-insert: should use scoped DELETE WHERE id NOT IN snapshot.
  const truncates = pool.queries.filter((q) => /^DELETE FROM/.test(q.text) && !/<> ALL/.test(q.text));
  // The only acceptable unscoped DELETE is when a particular snapshot set is empty.
  // In this test, brainEntities / brainEdges / accountPlans / consoleSessions /
  // accountMembers are empty, so they get scope-free DELETE FROM. apiKeys etc are
  // non-empty and must use scoped DELETE.
  const scopedDeletes = pool.queries.filter((q) => /^DELETE FROM/.test(q.text) && /<> ALL/.test(q.text));
  assert(scopedDeletes.length >= 3, 'expected scoped DELETEs for non-empty snapshot tables');
  for (const q of scopedDeletes) {
    assert(Array.isArray(q.values?.[0]), 'scoped DELETE must receive id list');
  }

  // Webhook events use append-only ON CONFLICT DO NOTHING.
  const webhookInsert = inserts.find((q) => /mnemo_console_webhook_events/.test(q.text));
  assert(webhookInsert);
  assert(/ON CONFLICT \(id\) DO NOTHING/i.test(webhookInsert.text), 'webhook insert is append-only');

  const traceInsert = inserts.find((q) => /mnemo_console_brain_reasoning_traces/.test(q.text));
  assert(traceInsert, 'reasoning trace insert is present');
  assert(/ON CONFLICT \(id\) DO UPDATE/i.test(traceInsert.text), 'reasoning trace insert is durable upsert');

  // Audit events are also append-only.
  const auditInserts = inserts.filter((q) => /mnemo_console_audit_events/.test(q.text));
  for (const q of auditInserts) {
    assert(/DO NOTHING/i.test(q.text), 'audit insert is append-only');
  }

  // Load round-trip.
  pool.rowsByTable.set('mnemo_console_api_keys', [{ payload: { id: 'key_1' } }]);
  pool.rowsByTable.set('mnemo_console_usage_counters', [{ account_id: 'acct_1', payload: { brainWrites: 1 } }]);
  pool.rowsByTable.set('mnemo_console_auth_challenges', [{ payload: { id: 'auth_1' } }]);
  pool.rowsByTable.set('mnemo_console_webhook_events', [{ payload: { id: 'evt_1' } }]);
  pool.rowsByTable.set('mnemo_console_brain_reasoning_traces', [{ payload: { id: 'trace_1' } }]);
  const loaded = await store.loadSnapshot();
  assert.strictEqual(loaded.apiKeys[0].id, 'key_1');
  assert.strictEqual(loaded.usageCounters.acct_1.brainWrites, 1);
  assert.strictEqual(loaded.authChallenges[0].id, 'auth_1');
  assert.strictEqual(loaded.webhookEvents[0].id, 'evt_1');
  assert.strictEqual(loaded.brainReasoningTraces[0].id, 'trace_1');

  // Rollback on partial failure does not commit.
  class FailingPool extends MockPool {
    async query(text, values) {
      if (text.includes('INSERT INTO mnemo_console_brain_memories')) {
        throw new Error('disk full');
      }
      return super.query(text, values);
    }
  }
  const fpool = new FailingPool();
  const fstore = new PostgresConsoleStore({ pool: fpool, tablePrefix: 'mnemo_console' });
  let failed = false;
  try {
    await fstore.saveSnapshot({
      apiKeys: [{ id: 'k', accountId: 'a', name: 'n', prefix: 'p', keyHash: 'h', createdAt: '2026-01-01T00:00:00Z' }],
      brainMemories: [{ id: 'm', accountId: 'a', namespace: 'd', content: 'x', importance: 0.5, tags: [], createdAt: '2026-01-01T00:00:00Z' }],
    });
  } catch (e) {
    failed = true;
    assert.strictEqual(e.message, 'disk full');
  }
  assert(failed, 'expected save to throw');
  assert(fpool.queries.some((q) => q.text === 'ROLLBACK'), 'expected ROLLBACK on failure');
  assert(!fpool.queries.some((q) => q.text === 'COMMIT'), 'no COMMIT on failure');

  console.log('console-postgres-store.test.cjs OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
