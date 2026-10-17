import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { PushService } from '../push/push.service';
import { cabinetActor } from './manager-scope';
import {
  buildPlatformReminders,
  mapReminderSettings,
  PlatformCrmService,
  ReminderSettingsRow,
  ReminderTenantRow,
} from './platform-crm.service';
import { PlatformReminder } from './types';

/** Opt-in personal operator reminders. At most one attempt per user/event. */
@Injectable()
export class PlatformReminderService {
  private readonly logger = new Logger('PlatformReminderService');
  private running = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly crm: PlatformCrmService,
    private readonly push: PushService,
  ) {}

  @Cron('0 */10 * * * *')
  async tick(): Promise<void> {
    if (!RUN_BACKGROUND_JOBS || this.running) return;
    this.running = true;
    try {
      const { rows: operators } = await this.pool.query<{ id: string; role: string }>(
        `SELECT u.id, u.role FROM users u JOIN platform_reminder_settings s ON s.user_id = u.id
          WHERE s.push_enabled = true AND u.role IN ('manager', 'superadmin')
            AND u.is_active = true AND u.dismissed_at IS NULL AND u.purged_at IS NULL ORDER BY u.id`,
      );
      for (const user of operators) {
        const actor = cabinetActor({ userID: user.id, tenantID: '', role: user.role, permissions: {} });
        const candidates = await this.crm.reminderCandidates(actor, new Date());
        if (!candidates.length) continue;
        const { rows: claims } = await this.pool.query<{ event_key: string }>(
          `SELECT event_key FROM platform_reminder_claims WHERE user_id = $1 AND event_key = ANY($2::text[])`,
          [user.id, candidates.map((item) => item.id)],
        );
        const claimed = new Set(claims.map((row) => row.event_key));
        for (const item of candidates.filter((item) => !claimed.has(item.id)).slice(0, 100)) {
          await this.deliver(user.id, item);
        }
      }
    } catch (error) {
      this.logger.error(`Platform reminder sweep failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      this.running = false;
    }
  }

  /** Recheck role, scope, settings and event under locks before the durable claim. */
  private async deliver(userId: string, candidate: PlatformReminder): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: users } = await client.query<{ role: string }>(
        `SELECT role FROM users WHERE id = $1 AND role IN ('manager', 'superadmin')
          AND is_active = true AND dismissed_at IS NULL AND purged_at IS NULL FOR SHARE`,
        [userId],
      );
      const { rows: settingsRows } = await client.query<ReminderSettingsRow>(
        `SELECT expiry_enabled, days_before, push_enabled FROM platform_reminder_settings WHERE user_id = $1 FOR SHARE`,
        [userId],
      );
      if (!users.length || !settingsRows[0]?.push_enabled) {
        await client.query('COMMIT');
        return;
      }
      const { rows: tenants } = await client.query<Omit<ReminderTenantRow, 'next_contact_at'>>(
        `SELECT t.id, t.name, t.timezone, t.subscription_end, t.suspended_at, t.is_active
           FROM tenants t
          WHERE t.id = $1 AND ($2::uuid IS NULL OR t.manager_id = $2) FOR SHARE`,
        [candidate.tenantId, users[0].role === 'manager' ? userId : null],
      );
      if (!tenants.length) {
        await client.query('COMMIT');
        return;
      }
      // Read after the tenant lock, in a NEW statement snapshot. A LEFT JOIN in
      // the locking statement could retain the old contact while waiting for a
      // concurrent setFollowUp transaction that clears it under the same lock.
      const { rows: followups } = await client.query<{ next_contact_at: Date | null }>(
        `SELECT next_contact_at FROM platform_tenant_followups WHERE tenant_id = $1`,
        [candidate.tenantId],
      );
      const current = buildPlatformReminders(
        [{ ...tenants[0], next_contact_at: followups[0]?.next_contact_at ?? null }],
        mapReminderSettings(settingsRows[0]),
        new Date(),
      ).find((item) => item.id === candidate.id);
      if (!current || !(await this.push.canSendToUserCategory(userId, 'platform_reminder'))) {
        await client.query('COMMIT');
        return;
      }
      // A separate autocommit connection persists the attempt BEFORE network I/O.
      // FK KEY SHARE locks are compatible with the authorization SHARE locks held
      // here; a process crash cannot turn an uncertain send into a duplicate.
      const claim = await this.pool.query(
        `INSERT INTO platform_reminder_claims (user_id, event_key, tenant_id) VALUES ($1, $2, $3)
          ON CONFLICT (user_id, event_key) DO NOTHING RETURNING event_key`,
        [userId, current.id, current.tenantId],
      );
      if (claim.rows.length) await this.sendClaimed(userId, current);
      // Hold scope/active-user/settings locks through delivery, so a transfer,
      // deactivation or opt-out cannot overtake a send authorized for old state.
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async sendClaimed(userId: string, reminder: PlatformReminder): Promise<void> {
    await this.push.sendToUserCategory(
      userId,
      'platform_reminder',
      reminder.kind === 'follow_up' ? 'Связаться с автосервисом' : 'Срок подписки автосервиса',
      reminder.tenantName,
      { type: 'platform_reminder', operatorUserId: userId, tenantId: reminder.tenantId, kind: reminder.kind },
    );
  }
}
