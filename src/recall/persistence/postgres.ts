/**
 * PostgresAdapter — PersistenceAdapter backed by any Postgres + pgvector
 * (Neon, Supabase, Amazon RDS/Aurora, Cloud SQL, or a self-hosted instance).
 *
 * MnemoPay already ships `NeonAdapter`, which is a full pgvector-backed
 * Postgres adapter — "Neon" is just a hosted Postgres, and the SQL it emits
 * is standard Postgres + the `vector` extension. `PostgresAdapter` is the
 * vendor-neutral name for that same implementation so standalone SDK
 * consumers on Supabase / RDS / plain Postgres can discover it, plus a
 * `{ type: "postgres" }` persistence option (see `PersistenceOptions`).
 *
 * It requires the `pg` package as an optional peer dep, dynamically imported
 * on first query, so consumers who only use the in-memory adapter never need
 * `pg` installed.
 *
 * ```ts
 * import { PostgresAdapter } from "@mnemopay/sdk/recall/postgres";
 *
 * const adapter = new PostgresAdapter({ url: process.env.DATABASE_URL! });
 * // pass to RecallEngine via { type: "custom", adapter }, or use
 * // MnemoPay.create({ ..., persist: { type: "postgres", url } }).
 * ```
 *
 * Schema (auto-bootstrapped on first set() unless skipBootstrap: true) — see
 * `postgresMigrationSql()` for the exact DDL you can run by hand in a
 * migration tool instead.
 */

import { NeonAdapter, type NeonAdapterConfig } from "./neon.js";

/** Config for {@link PostgresAdapter}. Identical shape to NeonAdapterConfig. */
export interface PostgresAdapterConfig extends NeonAdapterConfig {}

export class PostgresAdapter extends NeonAdapter {
  constructor(config: PostgresAdapterConfig) {
    super(config);
  }
}

/**
 * The migration DDL `PostgresAdapter` (and `NeonAdapter`) auto-applies on the
 * first `set()`. Exposed so you can run it in your own migration tool and pass
 * `skipBootstrap: true` to skip the runtime CREATE statements.
 *
 * @param table  Table name (default "mnemopay_memories"). MUST be a valid
 *               Postgres identifier — callers are responsible for trusting it.
 * @param dimensions  Embedding dimensionality (default 384, the local BGE size).
 */
export function postgresMigrationSql(
  table = "mnemopay_memories",
  dimensions = 384,
): string {
  return [
    `CREATE EXTENSION IF NOT EXISTS vector;`,
    `CREATE TABLE IF NOT EXISTS ${table} (`,
    `  agent_id   TEXT             NOT NULL,`,
    `  id         TEXT             NOT NULL,`,
    `  content    TEXT             NOT NULL,`,
    `  embedding  VECTOR(${dimensions}) NOT NULL,`,
    `  metadata   JSONB,`,
    `  created_at TIMESTAMPTZ      DEFAULT NOW(),`,
    `  PRIMARY KEY (agent_id, id)`,
    `);`,
    `CREATE INDEX IF NOT EXISTS ${table}_hnsw`,
    `  ON ${table} USING hnsw (embedding vector_cosine_ops);`,
  ].join("\n");
}
