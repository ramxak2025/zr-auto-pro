import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { PG_POOL } from '../database.module';
import { LocalStorageAdapter, PRIVATE_SUBDIR } from '../uploads/storage.service';

/**
 * One-shot (but idempotent and re-runnable) startup bootstrap, same spirit as
 * MigrationRunner: legacy employee documents were uploaded into the PUBLIC
 * `/api/uploads/<tenant>/...` tier where nginx serves them to anyone who knows
 * the URL — including passports. This moves every file referenced by
 * `employee_documents` into the private subtree
 * (`uploads/private/<tenant>/<file>`) and rewrites the row to hold the
 * private stored path.
 *
 * Uses OnApplicationBootstrap (NOT OnModuleInit) so it runs strictly AFTER
 * MigrationRunner.onModuleInit has applied all migrations (the table is
 * guaranteed to exist).
 *
 * Safety properties:
 *  - safe to run on every boot: only rows still carrying a public
 *    `/api/uploads/` URL are touched;
 *  - tolerates missing files: the row is still rewritten (the authenticated
 *    endpoint will 404 for it — exactly what the public tier does today);
 *  - tolerates a previous partial run: if the file already sits at the
 *    private destination, only the row is updated;
 *  - never crashes startup: every failure is logged and swallowed.
 */
@Injectable()
export class PrivateDocsBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger('PrivateDocsBootstrap');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private storage: LocalStorageAdapter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.moveLegacyDocuments();
    } catch (err) {
      this.logger.error(`Private documents bootstrap failed (will retry next boot): ${String(err)}`);
    }
  }

  private async moveLegacyDocuments(): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, file_url FROM employee_documents
        WHERE file_url LIKE '/api/uploads/%'
          AND file_url NOT LIKE '/api/uploads/${PRIVATE_SUBDIR}/%'`,
    );
    if (rows.length === 0) return;

    this.logger.log(`Moving ${rows.length} legacy employee document(s) into the private uploads subtree`);

    const base = this.storage.getBasePath();
    let moved = 0;
    let missing = 0;

    for (const row of rows as Array<{ id: string; tenant_id: string; file_url: string }>) {
      try {
        const legacyStoredPath = path.normalize(row.file_url.slice('/api/uploads/'.length));
        // Refuse anything that would escape the uploads dir (corrupt rows).
        const src = path.resolve(base, legacyStoredPath);
        if (!src.startsWith(base) || legacyStoredPath.includes('..')) {
          this.logger.warn(`Skipping document ${row.id}: suspicious path "${row.file_url}"`);
          continue;
        }

        const filename = path.basename(legacyStoredPath);
        const privateStoredPath = path.join(PRIVATE_SUBDIR, row.tenant_id, filename);
        const dest = path.join(base, privateStoredPath);

        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(src, dest);
          moved++;
        } else if (fs.existsSync(dest)) {
          // Previous run moved the file but the row update didn't land.
          moved++;
        } else {
          // File lost before this fix shipped — rewrite the row anyway so the
          // document stops pointing at the public tier; download will 404.
          missing++;
          this.logger.warn(`Document ${row.id}: file not found on disk (${legacyStoredPath})`);
        }

        await this.pool.query(`UPDATE employee_documents SET file_url=$1 WHERE id=$2`, [privateStoredPath, row.id]);
      } catch (err) {
        this.logger.error(`Failed to move document ${row.id}: ${String(err)}`);
      }
    }

    this.logger.log(`Private documents bootstrap done: ${moved} moved, ${missing} missing`);
  }
}
