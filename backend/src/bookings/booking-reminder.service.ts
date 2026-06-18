import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { MarketingService } from '../marketing/marketing.service';

/**
 * BookingReminderService
 * --------------------------------------------------------------------------
 * Mirrors the marketing ReminderService pattern (setInterval + OnModuleInit /
 * OnModuleDestroy). Every ~15 min it finds `scheduled` bookings whose tenant
 * has reminders enabled, that are due within `reminder_hours` and haven't been
 * reminded yet, and sends the client an SMS/WhatsApp reminder.
 *
 * IDEMPOTENCY — the safe choice (documented):
 *   We claim each booking by stamping `reminder_sent_at = now()` in a single
 *   atomic UPDATE … RETURNING (FOR UPDATE SKIP LOCKED) *before* sending, so a
 *   second overlapping run can never pick the same row → no double-send.
 *
 *   NO-PROVIDER POLICY: we only claim (stamp) bookings for tenants that HAVE an
 *   active messaging provider. A tenant with no provider is filtered out
 *   up-front, so its bookings are left untouched (reminder_sent_at stays NULL)
 *   and will be reminded later once a provider is configured — instead of being
 *   silently burned. If a provider exists but the individual send fails
 *   (network/provider error), the stamp stays (we already claimed it): we
 *   accept "reminded-but-maybe-not-delivered" over a retry storm. Delivery is
 *   best-effort, exactly like every other messaging path in the app.
 */
@Injectable()
export class BookingReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('BookingReminderService');
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private marketingService: MarketingService,
  ) {}

  onModuleInit() {
    // Every 15 minutes.
    this.interval = setInterval(() => void this.run(), 15 * 60 * 1000);
    this.logger.log('Booking reminder scheduler started (15m interval)');
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  private async run() {
    // Guard against overlap if a previous run is still in flight.
    if (this.running) return;
    this.running = true;
    try {
      // Claim due bookings atomically. Conditions:
      //   • status still 'scheduled'
      //   • tenant has reminders enabled
      //   • not yet reminded (reminder_sent_at IS NULL)
      //   • due window reached: scheduled_at - reminder_hours <= now()
      //   • appointment still in the future (don't remind for past slots)
      //   • tenant has an ACTIVE messaging provider (else leave it for later)
      // The UPDATE stamps reminder_sent_at so concurrent runs can't re-pick.
      const { rows } = await this.pool.query(
        `UPDATE bookings b
            SET reminder_sent_at = now()
          WHERE b.id IN (
            SELECT b2.id
              FROM bookings b2
              JOIN booking_settings bs ON bs.tenant_id = b2.tenant_id
             WHERE b2.status = 'scheduled'
               AND bs.reminder_enabled = true
               AND b2.reminder_sent_at IS NULL
               AND b2.scheduled_at > now()
               AND b2.scheduled_at - (bs.reminder_hours || ' hours')::interval <= now()
               AND EXISTS (
                 SELECT 1 FROM messaging_integrations mi
                  WHERE mi.tenant_id = b2.tenant_id AND mi.is_active = true
               )
             ORDER BY b2.scheduled_at ASC
             LIMIT 200
             FOR UPDATE SKIP LOCKED
          )
          RETURNING b.id, b.tenant_id, b.scheduled_at, b.client_id`,
      );

      if (rows.length === 0) return;

      for (const row of rows) {
        try {
          const { rows: clientRows } = await this.pool.query(`SELECT full_name, phone FROM clients WHERE id = $1`, [
            row.client_id,
          ]);
          const phone = clientRows[0]?.phone;
          if (!phone) {
            // Claimed but unsendable (no phone). Stays stamped — we won't retry
            // forever for a client with no number.
            continue;
          }
          const message = `Вы записаны на ${this.formatWhen(row.scheduled_at)}. Если передумали — позвоните, чтобы отменить.`;
          const result = await this.marketingService.sendClientMessage(row.tenant_id, phone, message);
          if (!result.sent) {
            this.logger.warn(
              `Booking reminder not delivered (booking ${row.id}, tenant ${row.tenant_id}): ${result.reason}${result.error ? ` — ${result.error}` : ''}`,
            );
          }
        } catch (err) {
          this.logger.error(`Booking reminder send failed for booking ${row.id}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Booking reminder scheduler error: ${err}`);
    } finally {
      this.running = false;
    }
  }

  private formatWhen(value: Date | string): string {
    try {
      const d = value instanceof Date ? value : new Date(value);
      return d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      });
    } catch {
      return String(value);
    }
  }
}
