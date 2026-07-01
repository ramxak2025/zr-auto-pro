import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { MarketingService } from './marketing.service';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';

@Injectable()
export class ReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ReminderService');
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private marketingService: MarketingService,
  ) {}

  onModuleInit() {
    if (!RUN_BACKGROUND_JOBS) {
      this.logger.log('Reminder scheduler disabled on this replica (RUN_BACKGROUND_JOBS=false)');
      return;
    }
    // Run every 24 hours
    this.schedulerInterval = setInterval(() => this.runScheduledSends(), 24 * 60 * 60 * 1000);
    this.logger.log('Reminder scheduler started (24h interval)');
  }

  onModuleDestroy() {
    if (this.schedulerInterval) clearInterval(this.schedulerInterval);
  }

  private async runScheduledSends() {
    try {
      const { rows } = await this.pool.query(
        `SELECT tenant_id FROM reminder_settings
         WHERE enabled = true
           AND (last_run_at IS NULL OR last_run_at < now() - interval '24 hours')`,
      );
      for (const row of rows) {
        try {
          await this.sendForTenant(row.tenant_id);
        } catch (err) {
          this.logger.error(`Reminder send failed for tenant ${row.tenant_id}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Reminder scheduler error: ${err}`);
    }
  }

  async getSettings(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT enabled, months_interval, message_template, last_run_at
       FROM reminder_settings WHERE tenant_id=$1`,
      [tenantId],
    );
    if (rows.length === 0) {
      await this.pool.query(
        `INSERT INTO reminder_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId],
      );
      const { rows: newRows } = await this.pool.query(
        `SELECT enabled, months_interval, message_template, last_run_at FROM reminder_settings WHERE tenant_id=$1`,
        [tenantId],
      );
      return this.mapRow(newRows[0]);
    }
    return this.mapRow(rows[0]);
  }

  private mapRow(r: any) {
    return {
      enabled: r.enabled,
      monthsInterval: r.months_interval,
      messageTemplate: r.message_template,
      lastRunAt: r.last_run_at || null,
    };
  }

  async updateSettings(
    tenantId: string,
    dto: { enabled?: boolean; monthsInterval?: number; messageTemplate?: string },
  ) {
    await this.pool.query(
      `INSERT INTO reminder_settings (tenant_id, enabled, months_interval, message_template)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id) DO UPDATE SET
         enabled = COALESCE($2, reminder_settings.enabled),
         months_interval = COALESCE($3, reminder_settings.months_interval),
         message_template = COALESCE($4, reminder_settings.message_template),
         updated_at = now()`,
      [tenantId, dto.enabled ?? null, dto.monthsInterval ?? null, dto.messageTemplate ?? null],
    );
    return this.getSettings(tenantId);
  }

  async sendForTenant(tenantId: string): Promise<{ sent: number; errors: number; message?: string }> {
    // Fetch settings
    const settings = await this.getSettings(tenantId);
    const monthsInterval = settings.monthsInterval;
    const template = settings.messageTemplate;

    // Get SMS adapter from MarketingService (uses messaging_integrations)
    const adapter = await (this.marketingService as any).getAdapter(tenantId);
    if (!adapter) {
      return { sent: 0, errors: 0, message: 'No SMS provider configured' };
    }

    // Find clients whose last check was >= months_interval months ago, capped at 100
    const { rows: clients } = await this.pool.query(
      `SELECT cl.id, cl.full_name, cl.phone,
              MAX(ch.date) as last_check_date,
              EXTRACT(MONTH FROM AGE(now(), MAX(ch.date))) +
                EXTRACT(YEAR FROM AGE(now(), MAX(ch.date))) * 12 AS months_ago
       FROM clients cl
       JOIN checks ch ON ch.client_id = cl.id AND ch.tenant_id = $1 AND ch.is_deferred = false AND ch.deleted_at IS NULL
       WHERE cl.tenant_id = $1 AND cl.phone IS NOT NULL AND cl.phone != ''
       GROUP BY cl.id, cl.full_name, cl.phone
       HAVING MAX(ch.date) <= now() - ($2 * interval '1 month')
       ORDER BY MAX(ch.date) ASC
       LIMIT 100`,
      [tenantId, monthsInterval],
    );

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      const monthsAgo = Math.round(parseFloat(client.months_ago) || monthsInterval);
      const message = template.replace('{name}', client.full_name || 'клиент').replace('{months}', String(monthsAgo));

      try {
        const result = await adapter.sendMessage(client.phone, message);
        if (result.success) {
          sent++;
        } else {
          errors++;
          this.logger.warn(`Reminder SMS failed for client ${client.id}: ${result.error}`);
        }
      } catch (err) {
        errors++;
        this.logger.error(`Reminder SMS exception for client ${client.id}: ${err}`);
      }
    }

    // Update last_run_at
    await this.pool.query(`UPDATE reminder_settings SET last_run_at=now(), updated_at=now() WHERE tenant_id=$1`, [
      tenantId,
    ]);

    return { sent, errors };
  }
}
