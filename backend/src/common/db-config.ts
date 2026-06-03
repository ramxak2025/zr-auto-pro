import { PoolConfig } from 'pg';

/**
 * Pool tuning.
 *
 * `statement_timeout` (8s) + `connectionTimeoutMillis` (5s) protect the fast
 * list endpoints from head-of-line blocking: a single heavy aggregate can no
 * longer hold a pooled connection open indefinitely and starve the cheap
 * queries behind it. `max: 20` is unchanged.
 *
 * The MigrationRunner passes `{ statementTimeout: null }` so DDL (GIN index
 * builds, ANALYZE, backfills) is NOT capped at 8s — those legitimately run
 * longer than a request and must never be killed mid-flight.
 */
export function getDbConfig(opts: { statementTimeout?: number | null } = {}): PoolConfig {
  // Default to 8s for the runtime pool; callers (migration runner) opt out
  // by passing null.
  const statementTimeout = opts.statementTimeout === undefined ? 8000 : opts.statementTimeout;

  const base: PoolConfig = {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  if (statementTimeout !== null) {
    base.statement_timeout = statementTimeout;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return { ...base, connectionString: databaseUrl };
  }
  const password = process.env.DB_PASSWORD;
  if (!password) {
    throw new Error('FATAL: DB_PASSWORD environment variable must be set');
  }
  return {
    ...base,
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password,
    database: process.env.DB_NAME || 'zr_auto_pro',
  };
}
