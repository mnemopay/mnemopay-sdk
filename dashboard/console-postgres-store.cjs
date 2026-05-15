/**
 * Postgres/Neon console store for the hosted MnemoPay dashboard.
 *
 * Production design:
 *   - `bootstrap()` creates the schema idempotently.
 *   - `loadSnapshot()` reads the full state into memory at startup.
 *   - `saveSnapshot()` is a reconcile: UPSERT every row in the in-memory state
 *     and DELETE any rows whose ids are not in the snapshot. All inside one
 *     transaction. UPSERT is idempotent so a partial failure cannot wipe rows.
 *
 * The earlier prototype used DELETE-ALL + INSERT-ALL which made every mutation
 * a tablewide write-lock and lost data if the transaction aborted mid-flight.
 * This version keeps existing rows in place when their payload is unchanged
 * (Postgres only re-tuples on actual UPDATE) and never has a window where the
 * tables are empty.
 */

const DEFAULT_PREFIX = 'console';
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(value, label) {
  if (!IDENT_RE.test(value)) {
    throw new Error(`PostgresConsoleStore: invalid ${label} "${value}"`);
  }
}

function tableNames(prefix = DEFAULT_PREFIX) {
  assertIdent(prefix, 'table prefix');
  return {
    apiKeys: `${prefix}_api_keys`,
    brainMemories: `${prefix}_brain_memories`,
    brainEntities: `${prefix}_brain_entities`,
    brainEdges: `${prefix}_brain_edges`,
    brainReasoningTraces: `${prefix}_brain_reasoning_traces`,
    auditEvents: `${prefix}_audit_events`,
    usageCounters: `${prefix}_usage_counters`,
    accountPlans: `${prefix}_account_plans`,
    sessions: `${prefix}_sessions`,
    authChallenges: `${prefix}_auth_challenges`,
    members: `${prefix}_account_members`,
    webhookEvents: `${prefix}_webhook_events`,
  };
}

function normalizeSnapshot(snapshot = {}) {
  return {
    apiKeys: snapshot.apiKeys || [],
    brainMemories: snapshot.brainMemories || [],
    brainEntities: snapshot.brainEntities || [],
    brainEdges: snapshot.brainEdges || [],
    brainReasoningTraces: snapshot.brainReasoningTraces || [],
    auditEvents: snapshot.auditEvents || [],
    usageCounters: snapshot.usageCounters || {},
    accountPlans: snapshot.accountPlans || [],
    consoleSessions: snapshot.consoleSessions || [],
    authChallenges: snapshot.authChallenges || [],
    accountMembers: snapshot.accountMembers || [],
    webhookEvents: snapshot.webhookEvents || [],
  };
}

function json(value) {
  return JSON.stringify(value ?? null);
}

async function loadPgPool(url, poolOptions = {}) {
  let pgMod;
  try {
    const modName = 'pg';
    pgMod = await import(modName);
    if (!pgMod.Pool && pgMod.default?.Pool) pgMod = pgMod.default;
  } catch (err) {
    throw new Error(`PostgresConsoleStore: install optional dependency "pg" to use Neon/Postgres persistence. ${err.message}`);
  }
  if (!pgMod.Pool) throw new Error('PostgresConsoleStore: loaded pg module has no Pool export');
  return new pgMod.Pool({
    connectionString: url,
    max: poolOptions.max ?? 10,
    idleTimeoutMillis: poolOptions.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: poolOptions.connectionTimeoutMillis ?? 5_000,
    ...poolOptions,
  });
}

function createSchemaSql(prefix = DEFAULT_PREFIX) {
  const t = tableNames(prefix);
  return [
    `CREATE TABLE IF NOT EXISTS ${t.apiKeys} (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.apiKeys}_account_idx ON ${t.apiKeys}(account_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ${t.apiKeys}_hash_idx ON ${t.apiKeys}(key_hash)`,
    `CREATE TABLE IF NOT EXISTS ${t.brainMemories} (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      content TEXT NOT NULL,
      importance DOUBLE PRECISION NOT NULL,
      tags JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.brainMemories}_account_namespace_idx ON ${t.brainMemories}(account_id, namespace)`,
    `CREATE TABLE IF NOT EXISTS ${t.brainEntities} (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      type TEXT NOT NULL,
      aliases JSONB NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.brainEntities}_account_namespace_idx ON ${t.brainEntities}(account_id, namespace)`,
    `CREATE TABLE IF NOT EXISTS ${t.brainEdges} (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_id TEXT NOT NULL,
      memory_ids JSONB NOT NULL,
      weight DOUBLE PRECISION NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.brainEdges}_account_namespace_idx ON ${t.brainEdges}(account_id, namespace)`,
    `CREATE TABLE IF NOT EXISTS ${t.brainReasoningTraces} (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      query TEXT NOT NULL,
      mode TEXT NOT NULL,
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
      generated_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.brainReasoningTraces}_account_namespace_idx ON ${t.brainReasoningTraces}(account_id, namespace, generated_at)`,
    `CREATE TABLE IF NOT EXISTS ${t.auditEvents} (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT NOT NULL,
      details JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.auditEvents}_account_created_idx ON ${t.auditEvents}(account_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ${t.usageCounters} (
      account_id TEXT PRIMARY KEY,
      brain_writes INTEGER NOT NULL DEFAULT 0,
      brain_queries INTEGER NOT NULL DEFAULT 0,
      rail_charges INTEGER NOT NULL DEFAULT 0,
      rail_settlements INTEGER NOT NULL DEFAULT 0,
      payload JSONB NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t.accountPlans} (
      account_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      interval TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      price_lookup_key TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      checkout_session_id TEXT,
      provisioned_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${t.sessions} (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.sessions}_account_idx ON ${t.sessions}(account_id)`,
    `CREATE TABLE IF NOT EXISTS ${t.authChallenges} (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.authChallenges}_account_idx ON ${t.authChallenges}(account_id)`,
    `CREATE TABLE IF NOT EXISTS ${t.members} (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.members}_account_idx ON ${t.members}(account_id)`,
    `CREATE TABLE IF NOT EXISTS ${t.webhookEvents} (
      id TEXT PRIMARY KEY,
      seen_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS ${t.webhookEvents}_seen_idx ON ${t.webhookEvents}(seen_at)`,
  ];
}

class PostgresConsoleStore {
  constructor({ url, pool, tablePrefix = DEFAULT_PREFIX, skipBootstrap = false, poolOptions = {} } = {}) {
    if (!url && !pool) throw new Error('PostgresConsoleStore: url or pool is required');
    this.url = url;
    this.pool = pool || null;
    this.poolOptions = poolOptions;
    this.tablePrefix = tablePrefix;
    this.tables = tableNames(tablePrefix);
    this.bootstrapped = skipBootstrap;
  }

  async getPool() {
    if (!this.pool) this.pool = await loadPgPool(this.url, this.poolOptions);
    return this.pool;
  }

  async bootstrap() {
    if (this.bootstrapped) return;
    const pool = await this.getPool();
    for (const statement of createSchemaSql(this.tablePrefix)) {
      await pool.query(statement);
    }
    this.bootstrapped = true;
  }

  async loadSnapshot() {
    await this.bootstrap();
    const pool = await this.getPool();
    const t = this.tables;
    const payloads = async (table, order = '') => {
      const res = await pool.query(`SELECT payload FROM ${table}${order}`);
      return res.rows.map((row) => row.payload);
    };
    const usageRows = await pool.query(`SELECT account_id, payload FROM ${t.usageCounters}`);
    return {
      apiKeys: await payloads(t.apiKeys),
      brainMemories: await payloads(t.brainMemories),
      brainEntities: await payloads(t.brainEntities),
      brainEdges: await payloads(t.brainEdges),
      brainReasoningTraces: await payloads(t.brainReasoningTraces),
      auditEvents: await payloads(t.auditEvents, ' ORDER BY created_at ASC'),
      usageCounters: Object.fromEntries(usageRows.rows.map((row) => [row.account_id, row.payload])),
      accountPlans: await payloads(t.accountPlans),
      consoleSessions: await payloads(t.sessions),
      authChallenges: await payloads(t.authChallenges),
      accountMembers: await payloads(t.members),
      webhookEvents: await payloads(t.webhookEvents),
    };
  }

  async saveSnapshot(input) {
    await this.bootstrap();
    const snapshot = normalizeSnapshot(input);
    const pool = await this.getPool();
    const t = this.tables;
    await pool.query('BEGIN');
    try {
      await reconcile(pool, t.apiKeys,
        snapshot.apiKeys,
        (k) => k.id,
        `INSERT INTO ${t.apiKeys} (id, account_id, name, prefix, key_hash, created_at, last_used_at, revoked_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           name = EXCLUDED.name,
           prefix = EXCLUDED.prefix,
           key_hash = EXCLUDED.key_hash,
           created_at = EXCLUDED.created_at,
           last_used_at = EXCLUDED.last_used_at,
           revoked_at = EXCLUDED.revoked_at,
           payload = EXCLUDED.payload`,
        (k) => [k.id, k.accountId, k.name, k.prefix, k.keyHash, k.createdAt, k.lastUsedAt || null, k.revokedAt || null, json(k)],
      );

      await reconcile(pool, t.brainMemories,
        snapshot.brainMemories,
        (m) => m.id,
        `INSERT INTO ${t.brainMemories} (id, account_id, namespace, content, importance, tags, created_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           namespace = EXCLUDED.namespace,
           content = EXCLUDED.content,
           importance = EXCLUDED.importance,
           tags = EXCLUDED.tags,
           created_at = EXCLUDED.created_at,
           payload = EXCLUDED.payload`,
        (m) => [m.id, m.accountId, m.namespace, m.content, m.importance, json(m.tags || []), m.createdAt, json(m)],
      );

      await reconcile(pool, t.brainEntities,
        snapshot.brainEntities,
        (e) => e.id,
        `INSERT INTO ${t.brainEntities} (id, account_id, namespace, name, normalized_name, type, aliases, mention_count, created_at, updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           namespace = EXCLUDED.namespace,
           name = EXCLUDED.name,
           normalized_name = EXCLUDED.normalized_name,
           type = EXCLUDED.type,
           aliases = EXCLUDED.aliases,
           mention_count = EXCLUDED.mention_count,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload`,
        (e) => [e.id, e.accountId, e.namespace, e.name, e.normalizedName, e.type, json(e.aliases || []), e.mentionCount || 0, e.createdAt, e.updatedAt, json(e)],
      );

      await reconcile(pool, t.brainEdges,
        snapshot.brainEdges,
        (e) => e.id,
        `INSERT INTO ${t.brainEdges} (id, account_id, namespace, subject_id, predicate, object_id, memory_ids, weight, created_at, updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           namespace = EXCLUDED.namespace,
           subject_id = EXCLUDED.subject_id,
           predicate = EXCLUDED.predicate,
           object_id = EXCLUDED.object_id,
           memory_ids = EXCLUDED.memory_ids,
           weight = EXCLUDED.weight,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload`,
        (e) => [e.id, e.accountId, e.namespace, e.subjectId, e.predicate, e.objectId, json(e.memoryIds || []), e.weight || 1, e.createdAt, e.updatedAt, json(e)],
      );

      await reconcile(pool, t.brainReasoningTraces,
        snapshot.brainReasoningTraces,
        (r) => r.id,
        `INSERT INTO ${t.brainReasoningTraces} (id, account_id, namespace, query, mode, confidence, generated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           namespace = EXCLUDED.namespace,
           query = EXCLUDED.query,
           mode = EXCLUDED.mode,
           confidence = EXCLUDED.confidence,
           generated_at = EXCLUDED.generated_at,
           payload = EXCLUDED.payload`,
        (r) => [r.id, r.accountId, r.namespace, r.query, r.mode, r.confidence || 0, r.generatedAt, json(r)],
      );

      // Audit events are append-only; ON CONFLICT DO NOTHING is correct.
      await upsertOnly(pool,
        snapshot.auditEvents,
        (e) => e.id,
        `INSERT INTO ${t.auditEvents} (id, account_id, action, subject, details, created_at, payload)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        (e) => [e.id, e.accountId, e.action, e.subject, json(e.details || {}), e.createdAt, json(e)],
      );

      await reconcileMap(pool, t.usageCounters,
        snapshot.usageCounters,
        'account_id',
        `INSERT INTO ${t.usageCounters} (account_id, brain_writes, brain_queries, rail_charges, rail_settlements, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (account_id) DO UPDATE SET
           brain_writes = EXCLUDED.brain_writes,
           brain_queries = EXCLUDED.brain_queries,
           rail_charges = EXCLUDED.rail_charges,
           rail_settlements = EXCLUDED.rail_settlements,
           payload = EXCLUDED.payload`,
        (accountId, c) => [accountId, c.brainWrites || 0, c.brainQueries || 0, c.railCharges || 0, c.railSettlements || 0, json(c)],
      );

      await reconcile(pool, t.accountPlans,
        snapshot.accountPlans,
        (p) => p.accountId,
        `INSERT INTO ${t.accountPlans} (account_id, plan, interval, status, source, price_lookup_key, stripe_customer_id, stripe_subscription_id, checkout_session_id, provisioned_at, updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         ON CONFLICT (account_id) DO UPDATE SET
           plan = EXCLUDED.plan,
           interval = EXCLUDED.interval,
           status = EXCLUDED.status,
           source = EXCLUDED.source,
           price_lookup_key = EXCLUDED.price_lookup_key,
           stripe_customer_id = EXCLUDED.stripe_customer_id,
           stripe_subscription_id = EXCLUDED.stripe_subscription_id,
           checkout_session_id = EXCLUDED.checkout_session_id,
           provisioned_at = EXCLUDED.provisioned_at,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload`,
        (p) => [p.accountId, p.plan, p.interval, p.status, p.source, p.priceLookupKey || null, p.stripeCustomerId || null, p.stripeSubscriptionId || null, p.checkoutSessionId || null, p.provisionedAt || null, p.updatedAt || null, json(p)],
        'account_id',
      );

      await reconcile(pool, t.sessions,
        snapshot.consoleSessions,
        (s) => s.id,
        `INSERT INTO ${t.sessions} (id, account_id, email, name, created_at, last_seen_at, expires_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           created_at = EXCLUDED.created_at,
           last_seen_at = EXCLUDED.last_seen_at,
           expires_at = EXCLUDED.expires_at,
           payload = EXCLUDED.payload`,
        (s) => [s.id, s.accountId, s.email || null, s.name || null, s.createdAt, s.lastSeenAt || null, s.expiresAt, json(s)],
      );

      await reconcile(pool, t.authChallenges,
        snapshot.authChallenges,
        (c) => c.id,
        `INSERT INTO ${t.authChallenges} (id, account_id, email, name, code_hash, attempts, max_attempts, created_at, expires_at, used_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           code_hash = EXCLUDED.code_hash,
           attempts = EXCLUDED.attempts,
           max_attempts = EXCLUDED.max_attempts,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at,
           used_at = EXCLUDED.used_at,
           payload = EXCLUDED.payload`,
        (c) => [c.id, c.accountId, c.email, c.name || null, c.codeHash, c.attempts || 0, c.maxAttempts || 5, c.createdAt, c.expiresAt, c.usedAt || null, json(c)],
      );

      await reconcile(pool, t.members,
        snapshot.accountMembers,
        (m) => m.id,
        `INSERT INTO ${t.members} (id, account_id, email, name, role, source, created_at, updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           source = EXCLUDED.source,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload`,
        (m) => [m.id, m.accountId, m.email, m.name || null, m.role, m.source, m.createdAt, m.updatedAt || null, json(m)],
      );

      // Webhook events are append-only with TTL handled elsewhere.
      await upsertOnly(pool,
        snapshot.webhookEvents,
        (e) => e.id,
        `INSERT INTO ${t.webhookEvents} (id, seen_at, payload)
         VALUES ($1, to_timestamp($2 / 1000.0), $3::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        (e) => [e.id, e.seenAt, json(e)],
      );

      await pool.query('COMMIT');
    } catch (err) {
      await pool.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  async close() {
    if (this.pool?.end) await this.pool.end();
  }
}

async function reconcile(pool, tableName, rows, idFn, upsertSql, valuesFn, idColumn = 'id') {
  const ids = [];
  for (const row of rows) {
    const id = idFn(row);
    if (!id) continue;
    ids.push(id);
    await pool.query(upsertSql, valuesFn(row));
  }
  if (ids.length === 0) {
    await pool.query(`DELETE FROM ${tableName}`);
  } else {
    await pool.query(`DELETE FROM ${tableName} WHERE ${idColumn} <> ALL($1::text[])`, [ids]);
  }
}

async function reconcileMap(pool, tableName, map, idColumn, upsertSql, valuesFn) {
  const entries = Object.entries(map || {});
  const ids = [];
  for (const [id, value] of entries) {
    ids.push(id);
    await pool.query(upsertSql, valuesFn(id, value));
  }
  if (ids.length === 0) {
    await pool.query(`DELETE FROM ${tableName}`);
  } else {
    await pool.query(`DELETE FROM ${tableName} WHERE ${idColumn} <> ALL($1::text[])`, [ids]);
  }
}

async function upsertOnly(pool, rows, idFn, sql, valuesFn) {
  for (const row of rows) {
    if (!idFn(row)) continue;
    await pool.query(sql, valuesFn(row));
  }
}

module.exports = {
  PostgresConsoleStore,
  createSchemaSql,
  normalizeSnapshot,
  tableNames,
};
