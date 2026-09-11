import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { isTenantLess } from '../common/auth-cache';
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
          await this.sendScheduledForTenant(row.tenant_id);
        } catch (err) {
          this.logger.error(`Reminder send failed for tenant ${row.tenant_id}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Reminder scheduler error: ${err}`);
    }
  }

  /**
   * Фоновый прогон одного тенанта. У джоба нет «текущего филиала», поэтому в
   * РАЗДЕЛЬНОМ режиме он идёт по точкам: строгий проход на каждый живой филиал
   * плюс проход по клиентам без филиала. Общая база (дефолт) и тенант без
   * точек — ровно один прежний проход по всему тенанту.
   */
  private async sendScheduledForTenant(tenantId: string): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT p.id
         FROM tenant_points p
         JOIN tenants t ON t.id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.is_active = true AND t.points_shared_clients = false
        ORDER BY p.sort_order ASC, p.created_at ASC, p.id ASC`,
      [tenantId],
    );
    if (rows.length === 0) {
      await this.sendPass(tenantId, { kind: 'all' });
      return;
    }
    for (const r of rows) {
      await this.sendPass(tenantId, { kind: 'point', pointId: r.id as string });
    }
    await this.sendPass(tenantId, { kind: 'orphan' });
  }

  async getSettings(tenantId: string) {
    // Tenant-less caller (superadmin, nil-UUID sentinel): return column defaults
    // WITHOUT seeding — the upsert-on-read below would FK-violate
    // reminder_settings_tenant_id_fkey (no such tenant) → 500. Shape mirrors a
    // fresh row (038 defaults).
    if (isTenantLess(tenantId)) {
      return this.mapRow({
        enabled: false,
        months_interval: 6,
        message_template:
          'Уважаемый(ая) {name}, напоминаем, что прошло {months} мес. с последнего визита. Будем рады видеть вас снова!',
        last_run_at: null,
      });
    }
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

  /**
   * «Давно не обслуживались» для одного тенанта.
   *
   * ФИЛИАЛЫ (161). В раздельном режиме (tenants.points_shared_clients=false)
   * филиал А не имеет права слать SMS клиентам филиала Б, поэтому:
   *   • РУЧНОЙ запуск («отправить сейчас») идёт от лица актора — его филиал и
   *     режет выборку, ровно как список клиентов у него на экране;
   *   • ФОНОВЫЙ прогон актора не имеет вовсе (см. runScheduledSends): он
   *     ИТЕРИРУЕТСЯ ПО ТОЧКАМ — по проходу на каждый живой филиал плюс один
   *     проход по «ничьим» клиентам (point_id IS NULL, общие и исторические).
   *     Разбиение СТРОГОЕ и без пересечений, поэтому одному человеку не может
   *     уйти два сообщения. Второй рубеж всё равно стоит: анти-спам-ключ
   *     `service_reminder:<clientId>:<YYYY-MM>` — не больше одного напоминания
   *     на клиента в календарный месяц.
   *     Отдельный проход на филиал нужен ещё и ради потолка LIMIT 100: один
   *     общий лимит на тенанта означал бы, что клиенты первого филиала
   *     съедают всю квоту, а остальные филиалы не рассылают никогда.
   */
  async sendForTenant(
    tenantId: string,
    actorPoint?: string | null,
  ): Promise<{ sent: number; errors: number; message?: string }> {
    const point = await this.marketingService.pointForActor(tenantId, actorPoint);
    return this.sendPass(tenantId, point ? { kind: 'point', pointId: point } : { kind: 'all' });
  }

  /**
   * Один проход рассылки. `scope`:
   *   • 'all'    — весь тенант (общая база клиентов / одноточечный тенант);
   *   • 'point'  — СТРОГО клиенты этого филиала;
   *   • 'orphan' — клиенты без филиала (общие и исторические).
   * Строгое разбиение (а не «точка ИЛИ NULL») выбрано сознательно: у фонового
   * прогона проходов несколько, и пересекающиеся выборки означали бы попытку
   * второй отправки тому же человеку.
   */
  private async sendPass(
    tenantId: string,
    scope: { kind: 'all' } | { kind: 'point'; pointId: string } | { kind: 'orphan' },
  ): Promise<{ sent: number; errors: number; message?: string }> {
    // Fetch settings
    const settings = await this.getSettings(tenantId);
    const monthsInterval = settings.monthsInterval;
    const template = settings.messageTemplate;

    // Get SMS adapter from MarketingService (uses messaging_integrations)
    const adapter = await (this.marketingService as any).getAdapter(tenantId);
    if (!adapter) {
      return { sent: 0, errors: 0, message: 'No SMS provider configured' };
    }

    const params: unknown[] = [tenantId, monthsInterval];
    let pointWhere = '';
    if (scope.kind === 'point') {
      params.push(scope.pointId);
      pointWhere = ` AND cl.point_id = $${params.length}`;
    } else if (scope.kind === 'orphan') {
      pointWhere = ' AND cl.point_id IS NULL';
    }

    // Find clients whose last check was >= months_interval months ago, capped at 100
    const { rows: clients } = await this.pool.query(
      `SELECT cl.id, cl.full_name, cl.phone,
              MAX(ch.date) as last_check_date,
              EXTRACT(MONTH FROM AGE(now(), MAX(ch.date))) +
                EXTRACT(YEAR FROM AGE(now(), MAX(ch.date))) * 12 AS months_ago
       FROM clients cl
       JOIN checks ch ON ch.client_id = cl.id AND ch.tenant_id = $1 AND ch.is_deferred = false AND ch.deleted_at IS NULL
       WHERE cl.tenant_id = $1 AND cl.phone IS NOT NULL AND cl.phone != ''${pointWhere}
       GROUP BY cl.id, cl.full_name, cl.phone
       HAVING MAX(ch.date) <= now() - ($2 * interval '1 month')
       ORDER BY MAX(ch.date) ASC
       LIMIT 100`,
      params,
    );

    let sent = 0;
    let errors = 0;
    const monthStamp = new Date().toISOString().slice(0, 7); // YYYY-MM

    for (const client of clients) {
      const monthsAgo = Math.round(parseFloat(client.months_ago) || monthsInterval);
      const message = template.replace('{name}', client.full_name || 'клиент').replace('{months}', String(monthsAgo));

      try {
        // Anti-spam gate: `service_reminder:<clientId>:<YYYY-MM>` = at most one
        // «давно не обслуживались» per client per calendar month. Reuse the
        // already-resolved adapter so no extra provider lookup per client.
        const result = await this.marketingService.guardAndLogSend({
          tenantId,
          phone: client.phone,
          body: message,
          messageType: 'reminder',
          clientId: client.id,
          dedupKey: `service_reminder:${client.id}:${monthStamp}`,
          adapter,
        });
        if (result.status === 'sent') {
          sent++;
        } else if (result.status === 'failed') {
          errors++;
          this.logger.warn(`Reminder SMS failed for client ${client.id}: ${result.error ?? result.reason}`);
        }
        // skipped_dedup → intentional anti-spam skip, not an error.
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
