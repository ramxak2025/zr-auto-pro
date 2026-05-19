import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class ScheduleService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private async assertUserInTenant(userID: string, tenantID: string): Promise<void> {
    if (!userID) {
      throw new BadRequestException({ message: 'Сотрудник обязателен' });
    }
    const { rows } = await this.pool.query(
      'SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [userID, tenantID],
    );
    if (rows.length === 0) {
      throw new BadRequestException({ message: 'Сотрудник не найден' });
    }
  }

  private mapEntry(row: any) {
    const entry: any = {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      date: row.date,
      shiftStart: row.shift_start,
      shiftEnd: row.shift_end,
      isDayOff: row.is_day_off,
      actualArrival: row.actual_arrival,
      lateMinutes: row.late_minutes || 0,
      lateStatus: row.late_status,
      note: row.note,
      isManualOverride: row.is_manual_override,
    };
    if (row.user_full_name) {
      entry.user = {
        id: row.user_id,
        fullName: row.user_full_name,
        role: row.user_role,
        isActive: row.user_is_active !== false,
      };
    }
    return entry;
  }

  async getAll(tenantID: string, query: any) {
    const dateFrom = query.dateFrom;
    const dateTo = query.dateTo;

    if (!dateFrom || !dateTo) {
      return [];
    }

    const { rows } = await this.pool.query(
      `SELECT se.*, u.full_name as user_full_name, u.role as user_role, u.is_active as user_is_active
       FROM schedule_entries se
       JOIN users u ON u.id = se.user_id
       WHERE se.tenant_id = $1 AND se.date >= $2 AND se.date <= $3
       ORDER BY u.full_name, se.date
       LIMIT 5000`,
      [tenantID, dateFrom, dateTo],
    );
    return rows.map(this.mapEntry);
  }

  async getToday(tenantID: string) {
    // Safety net: if the nightly cron didn't run, sweep any stale open shifts
    // (date earlier than "today" in Moscow) before we render today's status.
    // Idempotent and cheap — only updates rows that actually need closing.
    await this.pool.query(
      `UPDATE shifts SET closed_at = now(), is_auto_closed = true
       WHERE tenant_id = $1 AND closed_at IS NULL
         AND date < (now() AT TIME ZONE 'Europe/Moscow')::date`,
      [tenantID],
    );

    // "Today" is computed in Moscow time inside Postgres, not the container's
    // locale. Previously used UTC date which caused 3-hour window every day
    // where Moscow shifts wouldn't match.
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (u.id) u.id as user_id, u.full_name, u.role, u.avatar,
              se.is_day_off, se.shift_start, se.shift_end,
              se.actual_arrival, se.late_minutes, se.late_status, se.note,
              CASE WHEN s.id IS NOT NULL AND s.closed_at IS NULL THEN true ELSE false END as is_working,
              CASE WHEN se.id IS NOT NULL THEN true ELSE false END as has_schedule
       FROM users u
       LEFT JOIN schedule_entries se
              ON se.user_id = u.id
             AND se.date = (now() AT TIME ZONE 'Europe/Moscow')::date
             AND se.tenant_id = $1
       LEFT JOIN shifts s
              ON s.user_id = u.id
             AND s.date = (now() AT TIME ZONE 'Europe/Moscow')::date
             AND s.tenant_id = $1
             AND s.closed_at IS NULL
       WHERE u.tenant_id = $1 AND u.is_active = true AND u.role IN ('master', 'admin')
       ORDER BY u.id, u.full_name`,
      [tenantID],
    );

    return rows.map((r) => ({
      userId: r.user_id,
      fullName: r.full_name,
      role: r.role,
      isDayOff: r.is_day_off || false,
      shiftStart: r.shift_start,
      shiftEnd: r.shift_end,
      actualArrival: r.actual_arrival,
      lateMinutes: r.late_minutes || 0,
      lateStatus: r.late_status,
      note: r.note || null,
      isWorking: r.is_working,
      hasSchedule: r.has_schedule,
    }));
  }

  async getMyStats(tenantID: string, userID: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const { rows } = await this.pool.query(
      `SELECT
         COUNT(*) as total_scheduled,
         COUNT(CASE WHEN actual_arrival IS NOT NULL THEN 1 END) as total_worked,
         COUNT(CASE WHEN late_status IN ('late_minor','late_major') THEN 1 END) as total_late,
         COUNT(CASE WHEN late_status = 'late_minor' THEN 1 END) as total_late_minor,
         COUNT(CASE WHEN late_status = 'late_major' THEN 1 END) as total_late_major,
         COUNT(CASE WHEN late_status = 'on_time' THEN 1 END) as total_on_time,
         COUNT(CASE WHEN is_day_off = true THEN 1 END) as total_days_off,
         COALESCE(AVG(CASE WHEN late_minutes > 0 THEN late_minutes END), 0) as avg_late_minutes
       FROM schedule_entries
       WHERE user_id = $1 AND tenant_id = $2 AND date >= $3 AND date <= $4`,
      [userID, tenantID, monthStart, monthEnd],
    );

    const r = rows[0];
    return {
      totalScheduled: parseInt(r.total_scheduled) || 0,
      totalWorked: parseInt(r.total_worked) || 0,
      totalLate: parseInt(r.total_late) || 0,
      totalLateMinor: parseInt(r.total_late_minor) || 0,
      totalLateMajor: parseInt(r.total_late_major) || 0,
      totalOnTime: parseInt(r.total_on_time) || 0,
      totalDaysOff: parseInt(r.total_days_off) || 0,
      avgLateMinutes: Math.round(parseFloat(r.avg_late_minutes) || 0),
    };
  }

  // Helper: ensure shift is opened when admin manually sets attendance status
  private async ensureShiftOpen(tenantID: string, userID: string, date: string, lateStatus: string | null) {
    if (!['on_time', 'late_minor', 'late_major'].includes(lateStatus || '')) return;
    // Check if shift already exists for this user/date
    const { rows: existing } = await this.pool.query(
      `SELECT id FROM shifts WHERE user_id=$1 AND date=$2 AND tenant_id=$3 LIMIT 1`,
      [userID, date, tenantID],
    );
    if (existing.length > 0) return;
    // Auto-open shift — opened_at adjusted based on late status
    await this.pool.query(
      `INSERT INTO shifts (user_id, date, tenant_id, opened_at) VALUES ($1, $2, $3, now())`,
      [userID, date, tenantID],
    );
  }

  async create(tenantID: string, dto: any) {
    // Verify the schedule entry references a user inside the caller's tenant.
    // Otherwise the entry lands with tenant_id from JWT but user_id from a
    // foreign tenant — the schedule listing then JOIN's against that other
    // tenant's user row.
    await this.assertUserInTenant(dto.userId, tenantID);

    // Upsert — backed by unique index (tenant_id, user_id, date).
    // Prevents duplicate entries that caused attendance rating to count
    // a single day as multiple shifts.
    const { rows } = await this.pool.query(
      `INSERT INTO schedule_entries (user_id, date, shift_start, shift_end, is_day_off, note, late_status, late_minutes, actual_arrival, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, user_id, date) DO UPDATE SET
         shift_start     = EXCLUDED.shift_start,
         shift_end       = EXCLUDED.shift_end,
         is_day_off      = EXCLUDED.is_day_off,
         note            = EXCLUDED.note,
         late_status     = EXCLUDED.late_status,
         late_minutes    = EXCLUDED.late_minutes,
         actual_arrival  = EXCLUDED.actual_arrival
       RETURNING *`,
      [dto.userId, dto.date, dto.shiftStart, dto.shiftEnd,
       dto.isDayOff || false, dto.note, dto.lateStatus || null, dto.lateMinutes || 0,
       dto.actualArrival || null, tenantID],
    );
    // Auto-open shift if manually marked as attending
    await this.ensureShiftOpen(tenantID, dto.userId, dto.date, dto.lateStatus);
    return this.mapEntry(rows[0]);
  }

  async update(id: string, tenantID: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.shiftStart !== undefined) { sets.push(`shift_start=$${idx++}`); vals.push(dto.shiftStart); }
    if (dto.shiftEnd !== undefined) { sets.push(`shift_end=$${idx++}`); vals.push(dto.shiftEnd); }
    if (dto.isDayOff !== undefined) { sets.push(`is_day_off=$${idx++}`); vals.push(dto.isDayOff); }
    if (dto.note !== undefined) { sets.push(`note=$${idx++}`); vals.push(dto.note); }
    if (dto.lateStatus !== undefined) { sets.push(`late_status=$${idx++}`); vals.push(dto.lateStatus); }
    if (dto.lateMinutes !== undefined) { sets.push(`late_minutes=$${idx++}`); vals.push(dto.lateMinutes); }
    if (dto.actualArrival !== undefined) { sets.push(`actual_arrival=$${idx++}`); vals.push(dto.actualArrival); }

    if (sets.length === 0) {
      const { rows } = await this.pool.query('SELECT * FROM schedule_entries WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
      return rows.length > 0 ? this.mapEntry(rows[0]) : null;
    }

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE schedule_entries SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Запись не найдена' });
    // Auto-open shift if manually marked as attending
    if (dto.lateStatus && rows[0].user_id && rows[0].date) {
      const dateStr = typeof rows[0].date === 'string' ? rows[0].date.slice(0, 10) : new Date(rows[0].date).toISOString().slice(0, 10);
      await this.ensureShiftOpen(tenantID, rows[0].user_id, dateStr, dto.lateStatus);
    }
    return this.mapEntry(rows[0]);
  }

  async remove(id: string, tenantID: string) {
    await this.pool.query('DELETE FROM schedule_entries WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }

  // Work modes

  async getWorkModes(tenantID: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM work_modes WHERE tenant_id=$1 ORDER BY name',
      [tenantID],
    );
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      type: r.type,
      workDays: r.work_days,
      offDays: r.off_days,
      weekDays: r.week_days || [],
      shiftStart: r.shift_start,
      shiftEnd: r.shift_end,
    }));
  }

  async createWorkMode(tenantID: string, dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO work_modes (name, type, work_days, off_days, week_days, shift_start, shift_end, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [dto.name, dto.type || 'rotating', dto.workDays || 2, dto.offDays || 2,
       JSON.stringify(dto.weekDays || []), dto.shiftStart || '09:00', dto.shiftEnd || '18:00', tenantID],
    );
    const r = rows[0];
    return {
      id: r.id, tenantId: r.tenant_id, name: r.name, type: r.type,
      workDays: r.work_days, offDays: r.off_days, weekDays: r.week_days || [],
      shiftStart: r.shift_start, shiftEnd: r.shift_end,
    };
  }

  async applyWorkMode(tenantID: string, dto: any) {
    // Apply a work mode schedule to one or all masters for a date range
    const { workModeId, userId, dateFrom, dateTo } = dto;

    // Get the work mode
    const { rows: wmRows } = await this.pool.query(
      'SELECT * FROM work_modes WHERE id=$1 AND tenant_id=$2',
      [workModeId, tenantID],
    );
    if (wmRows.length === 0) throw new NotFoundException({ message: 'Режим работы не найден' });
    const wm = wmRows[0];

    // Get target users with their days_off
    let userRows: Array<{ id: string; days_off: number[] }> = [];
    if (userId) {
      const { rows: uRows } = await this.pool.query(
        `SELECT id, COALESCE(days_off, '[]') as days_off FROM users WHERE id=$1 AND tenant_id=$2`,
        [userId, tenantID],
      );
      userRows = uRows.map(r => ({ id: r.id, days_off: typeof r.days_off === 'string' ? JSON.parse(r.days_off) : (r.days_off || []) }));
    } else {
      const { rows: uRows } = await this.pool.query(
        `SELECT id, COALESCE(days_off, '[]') as days_off FROM users WHERE tenant_id=$1 AND is_active=true AND role IN ('master', 'admin')`,
        [tenantID],
      );
      userRows = uRows.map(r => ({ id: r.id, days_off: typeof r.days_off === 'string' ? JSON.parse(r.days_off) : (r.days_off || []) }));
    }

    if (userRows.length === 0) return { created: 0 };

    // Generate entries for each day in range (only tomorrow and future — today and past preserved)
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    let created = 0;

    for (const userInfo of userRows) {
      const uid = userInfo.id;
      const userDaysOff: number[] = userInfo.days_off || [];
      const cursor = new Date(start);
      while (cursor <= end) {
        const dateStr = cursor.toISOString().split('T')[0];

        // Skip today and past days — keep existing entries unchanged
        if (cursor < tomorrow) {
          cursor.setDate(cursor.getDate() + 1);
          continue;
        }

        const dayOfWeek = cursor.getDay(); // 0=Sun, 6=Sat

        // Determine if working day based on weekDays array (if specified) + per-user days off
        const weekDays: number[] = wm.week_days || [];
        let isWorkDay = true;
        if (weekDays.length > 0) {
          isWorkDay = weekDays.includes(dayOfWeek);
        }
        // Per-user days off override
        if (userDaysOff.includes(dayOfWeek)) {
          isWorkDay = false;
        }

        // Delete existing entry for this user/date
        await this.pool.query(
          'DELETE FROM schedule_entries WHERE user_id=$1 AND date=$2 AND tenant_id=$3',
          [uid, dateStr, tenantID],
        );

        // Insert new entry
        await this.pool.query(
          `INSERT INTO schedule_entries (user_id, date, shift_start, shift_end, is_day_off, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uid, dateStr,
           isWorkDay ? wm.shift_start : null,
           isWorkDay ? wm.shift_end : null,
           !isWorkDay,
           tenantID],
        );
        created++;

        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return { created };
  }

  async updateWorkMode(id: string, tenantID: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) { sets.push(`name=$${idx++}`); vals.push(dto.name); }
    if (dto.type !== undefined) { sets.push(`type=$${idx++}`); vals.push(dto.type); }
    if (dto.shiftStart !== undefined) { sets.push(`shift_start=$${idx++}`); vals.push(dto.shiftStart); }
    if (dto.shiftEnd !== undefined) { sets.push(`shift_end=$${idx++}`); vals.push(dto.shiftEnd); }

    if (sets.length === 0) return {};

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE work_modes SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Режим не найден' });
    const r = rows[0];
    return {
      id: r.id, tenantId: r.tenant_id, name: r.name, type: r.type,
      workDays: r.work_days, offDays: r.off_days, weekDays: r.week_days || [],
      shiftStart: r.shift_start, shiftEnd: r.shift_end,
    };
  }
}
