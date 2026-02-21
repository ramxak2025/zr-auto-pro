import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { getDbConfig } from './common/db-config';

@Injectable()
export class MigrationRunner implements OnModuleInit {
  private readonly logger = new Logger('MigrationRunner');
  private pool: Pool;

  constructor() {
    this.pool = new Pool(getDbConfig());
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

      const files = fs.readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const { rows } = await client.query(
          'SELECT 1 FROM _migrations WHERE name = $1',
          [file],
        );
        if (rows.length > 0) continue;

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        this.logger.log(`Running migration: ${file}`);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO _migrations (name) VALUES ($1)',
            [file],
          );
          await client.query('COMMIT');
          this.logger.log(`Migration ${file} applied`);
        } catch (err) {
          await client.query('ROLLBACK');
          this.logger.error(`Migration ${file} failed: ${err}`);
        }
      }
    } finally {
      client.release();
      await this.pool.end();
    }
  }
}
