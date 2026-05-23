import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WarehouseAnalyticsService } from './warehouse-analytics.service';

/**
 * Daily stock-value snapshot job.
 *
 *   • Runs once on application start (delayed 30s so the migration runner
 *     has finished and the pool is warm).
 *   • Then every day at 03:30 Europe/Moscow — well after end-of-day owner
 *     activity so the snapshot reflects "yesterday's close" once owners
 *     wake up.
 *
 * Idempotent — re-running the job on the same day overwrites the row (we
 * use ON CONFLICT DO UPDATE in the service so a manual re-run during the
 * day just refreshes the latest numbers).
 */
@Injectable()
export class WarehouseAnalyticsScheduler implements OnModuleInit {
  private readonly logger = new Logger('WarehouseAnalyticsScheduler');

  constructor(private analytics: WarehouseAnalyticsService) {}

  onModuleInit() {
    // Delay startup snapshot so migrations + initial DB warm-up finish first.
    setTimeout(() => {
      this.snapshot('startup').catch((err) =>
        this.logger.error(`startup snapshot failed: ${err}`),
      );
    }, 30_000);
  }

  @Cron('30 3 * * *', { timeZone: 'Europe/Moscow' })
  async dailySnapshot() {
    await this.snapshot('daily');
  }

  private async snapshot(reason: string) {
    const t0 = Date.now();
    const res = await this.analytics.recomputeDailySnapshots();
    this.logger.log(`Stock snapshot (${reason}): wrote ${res.written} rows in ${Date.now() - t0}ms`);
  }
}
