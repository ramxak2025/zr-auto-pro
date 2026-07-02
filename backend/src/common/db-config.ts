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

/**
 * Имя не-суперпользовательской роли для тенантного трафика (волна B, RLS).
 * Создаётся/актуализируется MigrationRunner'ом при старте, если задан
 * DB_APP_PASSWORD. Константа, не env: роль зашита в бутстрап-SQL и политики
 * не зависят от имени, а лишний конфиг — лишняя поверхность ошибок.
 */
export const APP_DB_ROLE = 'autexa_app';

/**
 * Конфиг app-пула (роль autexa_app под RLS) или null, если режим выключен.
 *
 * Dual-mode рубильник: DB_APP_PASSWORD не задан → null → TenantAwarePool
 * работает одним admin-пулом, код полностью инертен (как GHCR_READ_TOKEN).
 *
 * Почему DATABASE_URL разбирается вручную: pg при наличии connectionString
 * СЛИВАЕТ распарсенные из URL поля ПОВЕРХ явных (Object.assign(config,
 * parse(connectionString)) в lib/connection-parameters.js) — передать
 * { connectionString, user: 'autexa_app' } нельзя, user из URL победит.
 * Поэтому строим дискретный конфиг: host/port/database из URL, user/password —
 * роли autexa_app. new URL() покрывает наш формат postgres://user:pass@host:port/db
 * (docker-compose и локалка); ssl-параметры в query URL не используются в этом
 * проекте (PG живёт в приватной docker-сети).
 */
export function getAppDbConfig(opts: { statementTimeout?: number | null } = {}): PoolConfig | null {
  const appPassword = process.env.DB_APP_PASSWORD;
  if (!appPassword) {
    return null;
  }

  const base = getDbConfig(opts);
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const parsed = new URL(databaseUrl);
    const { connectionString: _dropped, ...tuning } = base;
    void _dropped;
    return {
      ...tuning,
      host: parsed.hostname || 'postgres',
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'zr_auto_pro',
      user: APP_DB_ROLE,
      password: appPassword,
    };
  }
  return { ...base, user: APP_DB_ROLE, password: appPassword };
}
