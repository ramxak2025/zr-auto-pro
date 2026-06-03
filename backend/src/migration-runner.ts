import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { getDbConfig } from './common/db-config';

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

        if (ok) {
          await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
          this.logger.log(`Migration ${file} applied`);
        }
      }
    } finally {
      client.release();
      await this.pool.end();
    }
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
