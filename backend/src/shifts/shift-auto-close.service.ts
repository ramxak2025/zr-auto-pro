import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';

/**
 * Automatically closes shifts that were left open past the end of the day.
 *
 * Runs at 23:59 Moscow time every day. Also runs a safety sweep 10 minutes
 * after server startup to catch any shifts that were missed while the server
 * was down during the scheduled time.
 *
 * Idempotent — only touches rows where closed_at IS NULL AND date < today.
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

  @Cron('59 23 * * *', { timeZone: 'Europe/Moscow' })
  async handleDailyClose() {
    if (!RUN_BACKGROUND_JOBS) return;
    await this.closeStaleShifts('cron');
  }

  /**
   * Close every open shift whose date is before today in Moscow time.
   * "Today" is computed inside Postgres from now() AT TIME ZONE — server
   * timezone is irrelevant, so the job is correct regardless of container
   * locale settings.
   */
  async closeStaleShifts(trigger: 'cron' | 'startup' | 'manual') {
    try {
      const { rowCount } = await this.pool.query(
        `UPDATE shifts
           SET closed_at = now(),
               is_auto_closed = true
         WHERE closed_at IS NULL
           AND date < (now() AT TIME ZONE 'Europe/Moscow')::date`,
      );
      if (rowCount && rowCount > 0) {
        this.logger.log(`[${trigger}] auto-closed ${rowCount} stale shifts`);
      }
    } catch (err) {
      this.logger.error(`[${trigger}] shift auto-close failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
