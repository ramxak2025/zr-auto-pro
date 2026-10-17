import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { normalizeTimezone, zonedDateKey } from '../common/timezone';
import { CabinetActor } from './manager-scope';
import {
  CreatePlatformTenantNoteDto,
  PlatformReminderSettingsDto,
  SetPlatformTenantFollowUpDto,
} from './dto/platform-crm.dto';
import type {
  PlatformReminder,
  PlatformReminderFeed,
  PlatformReminderSettings,
  PlatformTenantFollowUp,
  PlatformTenantNote,
  PlatformTenantNotesPage,
} from './types';

export const DEFAULT_PLATFORM_REMINDERS: Readonly<PlatformReminderSettings> = {
  expiryEnabled: true,
  daysBefore: [7, 3, 1, 0],
  pushEnabled: false,
};

export interface ReminderTenantRow {
  id: string;
  name: string;
  timezone: string | null;
  subscription_end: Date | string | null;
  suspended_at: Date | null;
  is_active: boolean | null;
  next_contact_at: Date | string | null;
}

export interface ReminderSettingsRow {
  expiry_enabled: boolean;
  days_before: number[];
  push_enabled: boolean;
}

export function mapReminderSettings(row?: ReminderSettingsRow): PlatformReminderSettings {
  return row
    ? { expiryEnabled: row.expiry_enabled, daysBefore: [...row.days_before], pushEnabled: row.push_enabled }
    : { ...DEFAULT_PLATFORM_REMINDERS, daysBefore: [...DEFAULT_PLATFORM_REMINDERS.daysBefore] };
}

function calendarDays(due: Date, now: Date, timezone: string | null): number {
  const zone = normalizeTimezone(timezone);
  return Math.round((Date.parse(zonedDateKey(due, zone)) - Date.parse(zonedDateKey(now, zone))) / 86_400_000);
}

/** Pure calendar calculation shared by feed and the final push recheck. */
export function buildPlatformReminders(
  rows: ReminderTenantRow[],
  settings: PlatformReminderSettings,
  now: Date,
): PlatformReminder[] {
  const items: PlatformReminder[] = [];
  const thresholds = [...settings.daysBefore].sort((a, b) => a - b);
  for (const row of rows) {
    if (settings.expiryEnabled && row.subscription_end && !row.suspended_at && row.is_active !== false) {
      const end = new Date(row.subscription_end);
      const daysRemaining = calendarDays(end, now, row.timezone);
      const expired = end.getTime() < now.getTime();
      // The most recently crossed threshold wins (6 -> 7, 2 -> 3).
      // Expired subscriptions require an explicit 0-day threshold.
      const threshold = expired ? (thresholds.includes(0) ? 0 : undefined) : thresholds.find((d) => daysRemaining <= d);
      if (threshold !== undefined) {
        const dueAt = end.toISOString();
        items.push({
          id: `subscription_expiry:${row.id}:${dueAt}:${threshold}`,
          kind: 'subscription_expiry',
          tenantId: row.id,
          tenantName: row.name,
          dueAt,
          daysRemaining,
          subscriptionStatus: expired ? 'expired' : 'active',
        });
      }
    }
    if (row.next_contact_at) {
      const contact = new Date(row.next_contact_at);
      if (contact.getTime() <= now.getTime()) {
        const dueAt = contact.toISOString();
        items.push({
          id: `follow_up:${row.id}:${dueAt}`,
          kind: 'follow_up',
          tenantId: row.id,
          tenantName: row.name,
          dueAt,
          daysRemaining: calendarDays(contact, now, row.timezone),
        });
      }
    }
  }
  return items.sort(
    (a, b) => a.daysRemaining - b.daysRemaining || a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id),
  );
}

function pageNumber(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(String(raw))) throw new BadRequestException({ message: 'Неверные параметры страницы' });
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum)
    throw new BadRequestException({ message: 'Неверные параметры страницы' });
  return Math.min(parsed, maximum);
}

interface NoteRow {
  id: string;
  tenant_id: string;
  text: string;
  author_name: string | null;
  created_at: Date;
}

function mapNote(row: NoteRow): PlatformTenantNote {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    text: row.text,
    authorName: row.author_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Internal-only tables, reachable exclusively through the role-guarded /manager cabinet. */
@Injectable()
export class PlatformCrmService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async withTenant<T>(actor: CabinetActor, id: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id FROM tenants WHERE id = $1 AND ($2::uuid IS NULL OR manager_id = $2) FOR UPDATE`,
        [id, actor.scope.managerId ?? null],
      );
      if (!rows.length) throw new NotFoundException({ message: 'Тенант не найден' });
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  notes(actor: CabinetActor, id: string, limit?: string, offset?: string): Promise<PlatformTenantNotesPage> {
    const take = pageNumber(limit, 30, 1, 100);
    const skip = pageNumber(offset, 0, 0, 2_147_483_647);
    return this.withTenant(actor, id, async (client) => {
      const { rows } = await client.query<NoteRow>(
        `SELECT id, tenant_id, text, author_name, created_at FROM platform_tenant_notes
          WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [id, take, skip],
      );
      const { rows: counts } = await client.query<{ total: number; next_contact_at: Date | null }>(
        `SELECT (SELECT COUNT(*)::int FROM platform_tenant_notes WHERE tenant_id = $1) AS total,
                (SELECT next_contact_at FROM platform_tenant_followups WHERE tenant_id = $1) AS next_contact_at`,
        [id],
      );
      return {
        items: rows.map(mapNote),
        total: counts[0].total,
        nextContactAt: counts[0].next_contact_at?.toISOString() ?? null,
      };
    });
  }

  addNote(actor: CabinetActor, id: string, dto: CreatePlatformTenantNoteDto): Promise<PlatformTenantNote> {
    const text = typeof dto.text === 'string' ? dto.text.trim() : '';
    if (
      !text ||
      text.length > 4000 ||
      text.includes('\0') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.requestId ?? '')
    ) {
      throw new BadRequestException({ message: 'Укажите заметку до 4000 символов и идентификатор запроса' });
    }
    return this.withTenant(actor, id, async (client) => {
      const { rows } = await client.query<NoteRow>(
        `INSERT INTO platform_tenant_notes (tenant_id, author_user_id, author_name, request_id, text)
         VALUES ($1, $2, (SELECT full_name FROM users WHERE id = $2), $3, $4)
         ON CONFLICT (author_user_id, request_id) DO NOTHING RETURNING id, tenant_id, text, author_name, created_at`,
        [id, actor.userId, dto.requestId, text],
      );
      if (rows.length) return mapNote(rows[0]);
      // Separate statement sees a conflicting concurrent INSERT after its commit.
      const { rows: previous } = await client.query<NoteRow>(
        `SELECT id, tenant_id, text, author_name, created_at FROM platform_tenant_notes
          WHERE author_user_id = $1 AND request_id = $2`,
        [actor.userId, dto.requestId],
      );
      if (previous[0]?.tenant_id !== id || previous[0]?.text !== text) {
        throw new ConflictException({ message: 'Этот запрос уже использован для другой заметки' });
      }
      return mapNote(previous[0]);
    });
  }

  setFollowUp(actor: CabinetActor, id: string, dto: SetPlatformTenantFollowUpDto): Promise<PlatformTenantFollowUp> {
    const value = dto.nextContactAt;
    if (
      value !== null &&
      (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value)))
    ) {
      throw new BadRequestException({ message: 'Укажите дату и время с часовым поясом или очистите напоминание' });
    }
    return this.withTenant(actor, id, async (client) => {
      const { rows } = await client.query<{ next_contact_at: Date | null }>(
        `INSERT INTO platform_tenant_followups (tenant_id, next_contact_at, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE SET next_contact_at = EXCLUDED.next_contact_at,
           updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING next_contact_at`,
        [id, value, actor.userId],
      );
      return { nextContactAt: rows[0].next_contact_at?.toISOString() ?? null };
    });
  }

  async reminderSettings(actor: CabinetActor): Promise<PlatformReminderSettings> {
    const { rows } = await this.pool.query<ReminderSettingsRow>(
      `SELECT expiry_enabled, days_before, push_enabled FROM platform_reminder_settings WHERE user_id = $1`,
      [actor.userId],
    );
    return mapReminderSettings(rows[0]);
  }

  async updateReminderSettings(
    actor: CabinetActor,
    dto: PlatformReminderSettingsDto,
  ): Promise<PlatformReminderSettings> {
    if (
      typeof dto.expiryEnabled !== 'boolean' ||
      typeof dto.pushEnabled !== 'boolean' ||
      !Array.isArray(dto.daysBefore) ||
      dto.daysBefore.length > 8 ||
      new Set(dto.daysBefore).size !== dto.daysBefore.length ||
      dto.daysBefore.some((n) => !Number.isInteger(n) || n < 0 || n > 30) ||
      (dto.expiryEnabled && !dto.daysBefore.length)
    ) {
      throw new BadRequestException({ message: 'Выберите до 8 разных сроков от 0 до 30 дней' });
    }
    const { rows } = await this.pool.query<ReminderSettingsRow>(
      `INSERT INTO platform_reminder_settings (user_id, expiry_enabled, days_before, push_enabled) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET expiry_enabled = EXCLUDED.expiry_enabled, days_before = EXCLUDED.days_before,
         push_enabled = EXCLUDED.push_enabled, updated_at = now() RETURNING expiry_enabled, days_before, push_enabled`,
      [actor.userId, dto.expiryEnabled, [...dto.daysBefore].sort((a, b) => b - a), dto.pushEnabled],
    );
    return mapReminderSettings(rows[0]);
  }

  /** Scheduler uses the full candidates before applying its unclaimed batch cap. */
  async reminderCandidates(actor: CabinetActor, now: Date): Promise<PlatformReminder[]> {
    const settings = await this.reminderSettings(actor);
    const { rows } = await this.pool.query<ReminderTenantRow>(
      `SELECT t.id, t.name, t.timezone, t.subscription_end, t.suspended_at, t.is_active, f.next_contact_at
         FROM tenants t LEFT JOIN platform_tenant_followups f ON f.tenant_id = t.id
        WHERE ($1::uuid IS NULL OR t.manager_id = $1)
          AND (($2::boolean AND t.subscription_end IS NOT NULL AND t.suspended_at IS NULL AND t.is_active IS NOT FALSE)
               OR f.next_contact_at <= $3::timestamptz)`,
      [actor.scope.managerId ?? null, settings.expiryEnabled, now],
    );
    return buildPlatformReminders(rows, settings, now);
  }

  async reminders(actor: CabinetActor, now = new Date()): Promise<PlatformReminderFeed> {
    const items = await this.reminderCandidates(actor, now);
    return { items: items.slice(0, 200), total: items.length, generatedAt: now.toISOString() };
  }
}
