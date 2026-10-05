import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { listTenantTimezones } from '../common/timezone';
import { staleShiftSql } from './shift-auto-close.sql';

/**
 * Automatically closes shifts that were left open past the end of the day.
 *
 * The minute sweep closes shifts from completed tenant-local days and stores
 * their midnight boundary. Each run also recovers missed earlier runs; actual
 * execution may lag midnight without changing the recorded closing time.
 *
 * Also runs a safety sweep 10 seconds after server startup to catch any shifts
 * that were missed while the server was down during the scheduled time; там
 * пояс тоже учитывается — подметаем только по-настоящему устаревшие смены.
 *
 * Idempotent — only touches rows where closed_at IS NULL AND date < today
 * (today — в поясе тенанта).
 */
@Injectable()
export class ShiftAutoCloseService implements OnModuleInit {
  private readonly logger = new Logger('ShiftAutoCloseService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async onModuleInit() {
    // Фоновая работа — только на leader-реплике (на backend2 = false).
    if (!RUN_BACKGROUND_JOBS) return;
    // Safety sweep on startup (in case server was down during cron time).
    // Delayed 10s so the DB is definitely ready.
    setTimeout(() => this.closeStaleShifts('startup'), 10_000);
  }

  // No local-hour gate: every run recovers stale shifts in every timezone.
  @Cron('* * * * *', { timeZone: 'UTC' })
  async handleDailyClose() {
    if (!RUN_BACKGROUND_JOBS) return;
    await this.closeStaleShifts('cron');
  }

  /**
   * Close every open shift whose date is before today in the TENANT's time
   * zone. «Сегодня» считает Postgres из `now() AT TIME ZONE $2` — таймзона
   * сервера не участвует, джоб корректен при любой локали контейнера.
   *
   * All triggers sweep all tenants. The stale-date predicate is idempotent
   * and never touches a shift belonging to the current local day.
   */
  async closeStaleShifts(trigger: 'cron' | 'startup' | 'manual') {
    try {
      const tzByTenant = await listTenantTimezones(this.pool);
      // Группируем тенантов по поясу: запросов будет столько, сколько РАЗНЫХ
      // поясов у обрабатываемых тенантов (обычно один), а не сколько тенантов.
      const tenantsByZone = new Map<string, string[]>();
      for (const [tenantID, tz] of tzByTenant) {
        const bucket = tenantsByZone.get(tz);
        if (bucket) bucket.push(tenantID);
        else tenantsByZone.set(tz, [tenantID]);
      }
      if (tenantsByZone.size === 0) return;

      let closed = 0;
      const stale = staleShiftSql('$2');
      for (const [tz, tenantIds] of tenantsByZone) {
        const { rowCount } = await this.pool.query(
          `UPDATE shifts
             SET closed_at = ${stale.closedAt},
                 is_auto_closed = true
           WHERE closed_at IS NULL
             AND tenant_id = ANY($1::uuid[])
             AND ${stale.predicate}`,
          [tenantIds, tz],
        );
        closed += rowCount ?? 0;
      }
      if (closed > 0) {
        this.logger.log(`[${trigger}] auto-closed ${closed} stale shifts`);
      }
    } catch (err) {
      this.logger.error(`[${trigger}] shift auto-close failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
