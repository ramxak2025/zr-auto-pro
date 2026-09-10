import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { listTenantTimezones, zonedHour } from '../common/timezone';

/**
 * Automatically closes shifts that were left open past the end of the day.
 *
 * КОГДА. В 23:59 ПО МЕСТНОМУ ВРЕМЕНИ КАЖДОГО ТЕНАНТА. Раньше это было 23:59
 * МСК для всех сразу: автосервису во Владивостоке смены закрывались в 06:59
 * утра следующего дня, а калининградскому — в 22:59 своего вечера. Теперь cron
 * будится каждый час в :59 и обрабатывает только тех тенантов, у которых
 * СЕЙЧАС местный час равен 23. Для тенанта в Москве это ровно 23:59 МСК —
 * поведение не изменилось ни на минуту.
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

  /** Местный час, в который тенанту закрываются висящие смены. */
  private static readonly CLOSE_HOUR = 23;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async onModuleInit() {
    // Фоновая работа — только на leader-реплике (на backend2 = false).
    if (!RUN_BACKGROUND_JOBS) return;
    // Safety sweep on startup (in case server was down during cron time).
    // Delayed 10s so the DB is definitely ready.
    setTimeout(() => this.closeStaleShifts('startup'), 10_000);
  }

  // Каждый час в :59. Тенант обрабатывается только в свой местный 23-й час,
  // поэтому фактическая частота на тенанта — по-прежнему раз в сутки.
  @Cron('59 * * * *', { timeZone: 'UTC' })
  async handleDailyClose() {
    if (!RUN_BACKGROUND_JOBS) return;
    await this.closeStaleShifts('cron');
  }

  /**
   * Close every open shift whose date is before today in the TENANT's time
   * zone. «Сегодня» считает Postgres из `now() AT TIME ZONE $2` — таймзона
   * сервера не участвует, джоб корректен при любой локали контейнера.
   *
   * `trigger`:
   *   • 'cron'    — обрабатываем только тенантов, у которых сейчас 23-й час
   *                 (их локальные сутки заканчиваются);
   *   • 'startup' / 'manual' — подметаем ВСЕХ: это страховка после даунтайма,
   *                 и условие `date < сегодня` само по себе идемпотентно и
   *                 никогда не трогает смену текущего дня.
   */
  async closeStaleShifts(trigger: 'cron' | 'startup' | 'manual') {
    try {
      const now = new Date();
      const tzByTenant = await listTenantTimezones(this.pool);
      // Группируем тенантов по поясу: запросов будет столько, сколько РАЗНЫХ
      // поясов у обрабатываемых тенантов (обычно один), а не сколько тенантов.
      const tenantsByZone = new Map<string, string[]>();
      for (const [tenantID, tz] of tzByTenant) {
        if (trigger === 'cron' && zonedHour(now, tz) !== ShiftAutoCloseService.CLOSE_HOUR) continue;
        const bucket = tenantsByZone.get(tz);
        if (bucket) bucket.push(tenantID);
        else tenantsByZone.set(tz, [tenantID]);
      }
      if (tenantsByZone.size === 0) return;

      let closed = 0;
      for (const [tz, tenantIds] of tenantsByZone) {
        const { rowCount } = await this.pool.query(
          `UPDATE shifts
             SET closed_at = now(),
                 is_auto_closed = true
           WHERE closed_at IS NULL
             AND tenant_id = ANY($1::uuid[])
             AND date < (now() AT TIME ZONE $2::text)::date`,
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
