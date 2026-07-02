import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { getDbConfig } from './common/db-config';

// Postgres advisory-lock key for serialising migration runs across replicas.
// Two replicas starting at the same time both grab this key on their own
// migration connection; the second blocks here until the first finishes,
// then sees every migration already applied and does nothing.
const MIGRATION_LOCK_KEY = 8274619;

/**
 * MigrationRunner
 * --------------------------------------------------------------------------
 * Runs every *.sql file in `backend/migrations/` exactly once. State is tracked
 * in the `_migrations` table by filename.
 *
 * Transaction modes:
 *   • Default — each migration is wrapped in BEGIN/COMMIT. A failure rolls
 *     back the whole file. Safe for normal DDL/DML.
 *   • No-transaction — for migrations that contain statements PostgreSQL
 *     refuses to run inside a transaction block, e.g. `CREATE INDEX
 *     CONCURRENTLY`, `VACUUM`, `REINDEX CONCURRENTLY`, `CREATE DATABASE`.
 *     A no-tx migration is split on `;` and executed statement-by-statement
 *     OUTSIDE any transaction. Atomicity is the migration author's job —
 *     every statement MUST be idempotent (use `IF NOT EXISTS`, `OR REPLACE`,
 *     etc.) so a partial failure can be retried safely on the next boot.
 *
 * How a migration opts into no-tx mode:
 *   1. Explicit marker on any of the first 10 lines:
 *        -- @no-transaction
 *      (or `-- pg-no-tx` for compatibility with other migration tools).
 *   2. Auto-detection: if the SQL contains `CONCURRENTLY`, `VACUUM`,
 *      `REINDEX`, or `CREATE DATABASE` (case-insensitive, outside strings/
 *      comments), the runner switches to no-tx mode.
 *
 * On success, the filename is inserted into `_migrations`. On failure, no
 * row is written, so the runner retries on next boot. For no-tx migrations
 * we only mark applied if EVERY statement succeeded.
 */
@Injectable()
export class MigrationRunner implements OnModuleInit {
  private readonly logger = new Logger('MigrationRunner');
  private pool: Pool;

  constructor() {
    // Migrations run DDL (GIN index builds, ANALYZE, backfills) that can take
    // longer than the 8s request-path statement_timeout — opt out of it here
    // so a legitimate long migration is never killed mid-flight.
    this.pool = new Pool(getDbConfig({ statementTimeout: null }));
  }

  async onModuleInit() {
    await this.runMigrations();
  }

  private async runMigrations() {
    const client = await this.pool.connect();
    try {
      // Serialise migration runs across replicas. A second replica starting at
      // the same time blocks here until the first finishes, then proceeds and
      // finds every migration already applied — so it runs none. Session-level
      // lock; it is released explicitly below and again when the connection
      // closes. The migration pool runs without statement_timeout
      // (getDbConfig({ statementTimeout: null })), so the wait is never cut off.
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

      await client.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          applied_at TIMESTAMPTZ DEFAULT now()
        )
      `);

      const migrationsDir = path.join(process.cwd(), 'migrations');
      if (!fs.existsSync(migrationsDir)) {
        this.logger.warn('No migrations directory found');
        return;
      }

      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
        if (rows.length > 0) continue;

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        const noTx = shouldRunWithoutTransaction(sql);
        this.logger.log(`Running migration: ${file}${noTx ? ' (no-transaction mode)' : ''}`);

        const ok = noTx
          ? await this.runWithoutTransaction(client, file, sql)
          : await this.runInTransaction(client, file, sql);

        if (!ok) {
          // FAIL-FAST (audit round 7, item 10). Historically a failed migration
          // was logged and the loop CONTINUED — later migrations ran on top of
          // the failed one's missing state and the app started anyway, serving
          // requests against a half-migrated schema. Abort startup instead: the
          // two-replica deploy keeps the OLD container serving while this one
          // crash-loops, and the failed file is retried on every boot (it was
          // never marked applied).
          throw new Error(`Migration ${file} failed — aborting startup (see error above)`);
        }

        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        this.logger.log(`Migration ${file} applied`);
      }

      // Бутстрап RLS-роли — внутри того же advisory lock (вторая реплика ждёт
      // и затем сходится к тому же состоянию) и ПОСЛЕ миграций (GRANT ON ALL
      // TABLES должен видеть только что созданные таблицы).
      await this.bootstrapAppRole(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
      client.release();
      await this.pool.end();
    }
  }

  /**
   * Бутстрап не-суперпользовательской роли autexa_app (волна B, RLS).
   *
   * Выполняется В КОДЕ, а не в SQL-миграции, потому что пароль приходит из env
   * (DB_APP_PASSWORD) и не должен попадать в git. Не задан → no-op, прод живёт
   * одним суперпользовательским пулом как раньше.
   *
   * Идемпотентно и сходяще на каждом старте:
   *   • CREATE ROLE через DO-блок с проверкой pg_roles (роль уже есть → skip);
   *   • ALTER ROLE каждый раз — подхватывает смену пароля и жёстко фиксирует
   *     атрибуты: LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
   *     NOREPLICATION. NOBYPASSRLS — суть всей волны: роль ОБЯЗАНА проходить
   *     через политики tenant_isolation (миграция 112);
   *   • GRANT ON ALL TABLES/SEQUENCES — покрывает существующие объекты
   *     (включая созданные только что миграциями выше);
   *   • ALTER DEFAULT PRIVILEGES — будущие таблицы/сиквенсы, создаваемые этим
   *     же admin-пользователем в следующих миграциях, доступны autexa_app сразу,
   *     даже до следующего перезапуска;
   *   • REVOKE на _migrations — app-роли там делать нечего (её использует только
   *     MigrationRunner через собственный admin-пул).
   *
   * Пароль эскейпится удвоением кавычек ('' — штатный SQL-эскейп при включённом
   * standard_conforming_strings, дефолт с PG 9.1); параметризовать DDL Postgres
   * не умеет. NUL-байт отвергается явно.
   */
  private async bootstrapAppRole(client: PoolClient): Promise<void> {
    const password = process.env.DB_APP_PASSWORD;
    if (!password) return;
    if (password.includes('\0')) {
      throw new Error('DB_APP_PASSWORD must not contain NUL bytes');
    }
    const escaped = password.replace(/'/g, "''");

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autexa_app') THEN
          CREATE ROLE autexa_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
        END IF;
      END
      $$;
    `);
    await client.query(
      `ALTER ROLE autexa_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD '${escaped}'`,
    );
    await client.query(`GRANT USAGE ON SCHEMA public TO autexa_app`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO autexa_app`);
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO autexa_app`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autexa_app`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO autexa_app`,
    );
    await client.query(`REVOKE ALL ON TABLE _migrations FROM autexa_app`);
    this.logger.log('App role autexa_app bootstrapped (RLS dual-pool mode ready)');
  }

  /**
   * Default path — wrap the whole file in BEGIN/COMMIT. Returns true on
   * success, false (and logs error) on failure.
   */
  private async runInTransaction(client: PoolClient, file: string, sql: string): Promise<boolean> {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Migration ${file} failed: ${err}`);
      return false;
    }
  }

  /**
   * No-tx path — split into individual statements and run each without a
   * transaction. ALL must succeed for the migration to be marked applied.
   * Idempotency is the migration author's responsibility.
   */
  private async runWithoutTransaction(client: PoolClient, file: string, sql: string): Promise<boolean> {
    const statements = splitSqlStatements(sql);
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await client.query(stmt);
      } catch (err) {
        this.logger.error(`Migration ${file} statement ${i + 1}/${statements.length} failed: ${err}`);
        return false;
      }
    }
    return true;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// helpers (exported for unit tests if added later)
// ───────────────────────────────────────────────────────────────────────────────

const NO_TX_MARKER_RE = /^\s*--\s*(@no-transaction|pg-no-tx)\b/im;
const CONCURRENT_KEYWORDS_RE = /\b(CONCURRENTLY|VACUUM|REINDEX|CREATE\s+DATABASE)\b/i;

export function shouldRunWithoutTransaction(sql: string): boolean {
  const firstChunk = sql.slice(0, 1000); // marker should be near the top
  if (NO_TX_MARKER_RE.test(firstChunk)) return true;
  // Strip comments + strings before keyword check to avoid false positives
  const stripped = stripCommentsAndStrings(sql);
  return CONCURRENT_KEYWORDS_RE.test(stripped);
}

/**
 * Split a SQL script on top-level semicolons, respecting:
 *   - line comments (-- to end of line)
 *   - block comments (slash-star ... star-slash)
 *   - single-quoted strings ('foo''s bar')
 *   - dollar-quoted strings ($$...$$ or $tag$...$tag$)
 *
 * Trims whitespace and drops empty statements. Good enough for the kinds of
 * migrations we run — pure DDL + simple DML + occasional plpgsql function
 * bodies in dollar quotes.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    // Line comment: -- ... \n
    if (c === '-' && next === '-') {
      const eol = sql.indexOf('\n', i);
      const end = eol === -1 ? n : eol + 1;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }

    // Block comment: /* ... */
    if (c === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }

    // Single-quoted string: '...''...'
    if (c === "'") {
      buf += c;
      i++;
      while (i < n) {
        const ch = sql[i];
        buf += ch;
        i++;
        if (ch === "'") {
          if (sql[i] === "'") {
            // escaped quote
            buf += "'";
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }

    // Dollar-quoted string: $$...$$ or $tag$...$tag$
    if (c === '$') {
      const tagMatch = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        const end = closeIdx === -1 ? n : closeIdx + tag.length;
        buf += sql.slice(i, end);
        i = end;
        continue;
      }
    }

    // Statement terminator
    if (c === ';') {
      const stmt = buf.trim();
      if (stmt.length > 0) out.push(stmt);
      buf = '';
      i++;
      continue;
    }

    buf += c;
    i++;
  }

  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/**
 * Best-effort: remove comments and string literals from a SQL string so a
 * subsequent regex check (e.g. for CONCURRENTLY) doesn't false-positive on
 * a keyword inside a comment or string.
 */
function stripCommentsAndStrings(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === '-' && next === '-') {
      const eol = sql.indexOf('\n', i);
      i = eol === -1 ? n : eol + 1;
      continue;
    }

    if (c === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }

    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === '$') {
      const tagMatch = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        i = closeIdx === -1 ? n : closeIdx + tag.length;
        continue;
      }
    }

    out += c;
    i++;
  }
  return out;
}
