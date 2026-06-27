import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { InstallmentsService } from './installments.service';

/**
 * Daily installment-reminder cron. For every tenant whose
 * installment_reminder_settings.mode = 'auto' (and not already run in the last
 * 24h), sends the templated reminder for plans due in `days_before` days / due
 * today / overdue, via the shared messaging adapter.
 *
 * Gated on RUN_BACKGROUND_JOBS so it fires on exactly ONE replica (the HTTP-only
 * `backend2` sets it false), exactly like the review / shift-auto-close jobs —
 * otherwise every reminder would be sent twice. Best-effort & fully guarded: a
 * failure for one tenant never aborts the sweep.
 */
@Injectable()
export class InstallmentsReminderService implements OnModuleInit {
  private readonly logger = new Logger('InstallmentsReminderService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private installments: InstallmentsService,
  ) {}

  onModuleInit() {
    if (!RUN_BACKGROUND_JOBS) {
      this.logger.log('Installment reminder cron disabled on this replica (RUN_BACKGROUND_JOBS=false)');
    }
  }

  // 10:00 Moscow every day — a sane "morning reminder" hour.
  @Cron('0 10 * * *', { timeZone: 'Europe/Moscow' })
  async handleDailyReminders() {
    if (!RUN_BACKGROUND_JOBS) return;
    await this.runDailySweep();
  }

  async runDailySweep() {
    try {
      const { rows } = await this.pool.query(
        `SELECT tenant_id FROM installment_reminder_settings
          WHERE mode = 'auto'
            AND (last_run_at IS NULL OR last_run_at < now() - interval '20 hours')`,
      );
      for (const row of rows) {
        try {
          const result = await this.installments.sendRemindersForTenant(row.tenant_id);
          if (result.total > 0) {
            this.logger.log(
              `Installment reminders tenant=${row.tenant_id}: sent=${result.sent} failed=${result.failed} total=${result.total}`,
            );
          }
        } catch (err) {
          this.logger.error(`Installment reminder send failed for tenant ${row.tenant_id}: ${err}`);
        } finally {
          // Mark run regardless of per-send outcome so a tenant isn't re-swept
          // within the same day on a partial failure.
          await this.pool
            .query(`UPDATE installment_reminder_settings SET last_run_at = now() WHERE tenant_id = $1`, [row.tenant_id])
            .catch(() => {
              /* best-effort */
            });
        }
      }
    } catch (err) {
      this.logger.error(`Installment reminder sweep error: ${err}`);
    }
  }
}
