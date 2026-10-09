import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { userHasPermission } from '../common/guards/permissions.guard';
import { actorPointId } from '../common/point-scope';
import { mergeEffectivePermissions } from '../common/role-matrix';
import { invalidateReportsForTenant } from '../common/reports-cache';
import {
  AttendanceEntry,
  attendanceClock,
  classifyArrival,
  hasRecordedAttendance,
  lockAttendanceUser,
  plannedStart,
} from './attendance';
import { staleShiftSql } from './shift-auto-close.sql';
import { NfcScanDto, NfcTagNameDto, NfcTokenDto } from './dto/nfc.dto';
import { NFC_CLOSE_DUPLICATE_MS, NFC_OPEN_WINDOW_MS, nfcDecision, nfcTokenHash, nfcUri } from './nfc-attendance';
import { ShiftsService } from './shifts.service';

type TagRow = {
  id: string;
  tenant_id: string;
  point_id: string | null;
  name: string;
  token_hash: string;
  status: 'pending' | 'active' | 'revoked';
  created_at: Date;
  activated_at: Date | null;
  revoked_at: Date | null;
  archived_at: Date | null;
};
type ShiftRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  point_id: string | null;
  date: string;
  opened_at: Date;
  closed_at: Date | null;
  is_auto_closed: boolean;
  note: string | null;
  first_nfc_at: Date | null;
  nfc_closed_at: Date | null;
};
type ActorInfo = { actor: JwtPayload; timezone: string; attendanceMode: 'admin' | 'manual' | 'nfc'; fullName: string };
const iso = (value: Date | null) => value?.toISOString() ?? null;
const tagDto = (row: TagRow) => ({
  id: row.id,
  pointId: row.point_id,
  name: row.name,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  activatedAt: iso(row.activated_at),
  revokedAt: iso(row.revoked_at),
});
const shiftDto = (row: ShiftRow) => ({
  id: row.id,
  tenantId: row.tenant_id,
  userId: row.user_id,
  pointId: row.point_id,
  date: row.date,
  openedAt: row.opened_at.toISOString(),
  closedAt: iso(row.closed_at),
  isAutoClosed: row.is_auto_closed,
  note: row.note,
  firstNfcAt: iso(row.first_nfc_at),
});

@Injectable()
export class ShiftsNfcService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly shifts: ShiftsService,
  ) {}

  /** Reuse the authoritative SQL point-membership function and role flattening.
   * No tenant/user/point from the scan body participates in authorization. */
  private async actorInfo(client: PoolClient, actor: JwtPayload): Promise<ActorInfo> {
    const pointId = actorPointId(actor);
    const { rows } = await client.query(
      `SELECT u.role,u.full_name,u.is_active,u.dismissed_at,u.purged_at,r.matrix,
        t.timezone,t.shifts_enabled,t.attendance_mode,t.is_active AS tenant_active,
        CASE WHEN $3::uuid IS NULL THEN NOT EXISTS(SELECT 1 FROM tenant_points p WHERE p.tenant_id=u.tenant_id AND p.is_active)
          ELSE autexa_point_is_allowed(u.tenant_id,u.id,$3::uuid) END AS point_allowed
      FROM users u JOIN tenants t ON t.id=u.tenant_id LEFT JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id
      WHERE u.id=$1 AND u.tenant_id=$2`,
      [actor.userID, actor.tenantID, pointId],
    );
    const row = rows[0];
    if (!row || !row.is_active || row.dismissed_at || row.purged_at || !row.tenant_active || !row.point_allowed) {
      throw new ForbiddenException({ message: 'Сотрудник или текущий филиал больше не доступны' });
    }
    const attendanceMode = row.attendance_mode ?? (row.shifts_enabled === true ? 'manual' : 'admin');
    return {
      actor: { ...actor, role: row.role, permissions: mergeEffectivePermissions(row.matrix) },
      timezone: row.timezone || 'Europe/Moscow',
      attendanceMode,
      fullName: row.full_name,
    };
  }
  private manage(info: ActorInfo) {
    if (!userHasPermission(info.actor, 'company_manage'))
      throw new ForbiddenException({ message: 'Нет права управлять NFC-метками компании' });
  }
  private name(dto: NfcTagNameDto) {
    const name = typeof dto?.name === 'string' ? dto.name.trim() : '';
    if (!name || name.length > 80) throw new BadRequestException({ message: 'Укажите название метки до 80 символов' });
    return name;
  }
  private async transaction<T>(
    actor: JwtPayload,
    manage: boolean,
    work: (client: PoolClient, info: ActorInfo, started: Date) => Promise<T>,
    requestId?: string,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Before lock waits, solely for deduplicating distinct concurrent closing
      // events. Attendance always uses the clock read AFTER employee/shift locks.
      const {
        rows: [{ instant: started }],
      } = await client.query<{ instant: Date }>('SELECT clock_timestamp() AS instant');
      if (requestId)
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `attendance-nfc:${actor.tenantID}:${requestId.toLowerCase()}`,
        ]);
      await lockAttendanceUser(client, actor.tenantID, actor.userID);
      const info = await this.actorInfo(client, actor);
      if (manage) this.manage(info);
      const result = await work(client, info, started);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async lockTag(client: PoolClient, actor: JwtPayload, id: string): Promise<TagRow> {
    const { rows } = await client.query<TagRow>(
      `SELECT * FROM attendance_nfc_tags WHERE id=$1 AND tenant_id=$2
      AND point_id IS NOT DISTINCT FROM $3::uuid AND archived_at IS NULL FOR UPDATE`,
      [id, actor.tenantID, actorPointId(actor)],
    );
    if (!rows[0]) throw new NotFoundException({ message: 'Метка не найдена в текущем филиале' });
    return rows[0];
  }
  async createTag(actor: JwtPayload, dto: NfcTagNameDto) {
    const name = this.name(dto),
      token = randomBytes(32).toString('base64url'),
      tokenHash = nfcTokenHash(token),
      uri = nfcUri(token);
    return this.transaction(actor, true, async (client) => {
      const { rows } = await client.query<TagRow>(
        `INSERT INTO attendance_nfc_tags(tenant_id,point_id,name,token_hash,created_by)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [actor.tenantID, actorPointId(actor), name, tokenHash, actor.userID],
      );
      return { ...tagDto(rows[0]), token, ndefUri: uri };
    });
  }
  async listTags(actor: JwtPayload) {
    return this.transaction(actor, true, async (client) => {
      const { rows } = await client.query<TagRow>(
        `SELECT * FROM attendance_nfc_tags WHERE tenant_id=$1
        AND point_id IS NOT DISTINCT FROM $2::uuid AND archived_at IS NULL ORDER BY created_at DESC,id`,
        [actor.tenantID, actorPointId(actor)],
      );
      return rows.map(tagDto);
    });
  }
  async activateTag(actor: JwtPayload, id: string, dto: NfcTokenDto) {
    const readback = nfcTokenHash(dto?.token);
    return this.transaction(actor, true, async (client) => {
      const tag = await this.lockTag(client, actor, id);
      if (tag.status === 'revoked') throw new ConflictException({ message: 'Метка отозвана. Создайте новую метку.' });
      if (!timingSafeEqual(Buffer.from(tag.token_hash, 'hex'), Buffer.from(readback, 'hex')))
        throw new BadRequestException({ message: 'Прочитанная метка не совпадает с записанной' });
      const { rows } = await client.query<TagRow>(
        `UPDATE attendance_nfc_tags SET status='active',activated_at=COALESCE(activated_at,clock_timestamp()) WHERE id=$1 AND tenant_id=$2 RETURNING *`,
        [id, actor.tenantID],
      );
      return tagDto(rows[0]);
    });
  }
  async renameTag(actor: JwtPayload, id: string, dto: NfcTagNameDto) {
    const name = this.name(dto);
    return this.transaction(actor, true, async (client) => {
      const tag = await this.lockTag(client, actor, id);
      if (tag.status === 'revoked') throw new ConflictException({ message: 'Отозванную метку нельзя переименовать' });
      const { rows } = await client.query<TagRow>(
        'UPDATE attendance_nfc_tags SET name=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
        [name, id, actor.tenantID],
      );
      return tagDto(rows[0]);
    });
  }
  async revokeTag(actor: JwtPayload, id: string) {
    return this.transaction(actor, true, async (client) => {
      await this.lockTag(client, actor, id);
      const { rows } = await client.query<TagRow>(
        `UPDATE attendance_nfc_tags SET status='revoked',revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1 AND tenant_id=$2 RETURNING *`,
        [id, actor.tenantID],
      );
      return tagDto(rows[0]);
    });
  }
  async archiveTag(actor: JwtPayload, id: string) {
    return this.transaction(actor, true, async (client) => {
      const tag = await this.lockTag(client, actor, id);
      if (tag.status !== 'revoked') throw new ConflictException({ message: 'Сначала отзовите NFC-метку' });
      const { rows } = await client.query<TagRow>(
        `UPDATE attendance_nfc_tags SET archived_at=COALESCE(archived_at,clock_timestamp())
         WHERE id=$1 AND tenant_id=$2 AND status='revoked' AND archived_at IS NULL RETURNING *`,
        [id, actor.tenantID],
      );
      if (!rows[0]) throw new NotFoundException({ message: 'Метка уже убрана из списка' });
      return tagDto(rows[0]);
    });
  }
  async status(actor: JwtPayload) {
    return this.transaction(actor, false, async (client, info) => {
      const clock = await attendanceClock(client, info.timezone),
        pointId = actorPointId(actor);
      const { rows: tags } = await client.query(
        `SELECT 1 FROM attendance_nfc_tags WHERE tenant_id=$1 AND point_id IS NOT DISTINCT FROM $2::uuid AND status='active' LIMIT 1`,
        [actor.tenantID, pointId],
      );
      const { rows: active } = await client.query<ShiftRow>(
        `SELECT *,date::text AS date FROM shifts WHERE tenant_id=$1 AND user_id=$2
        AND date=$3 AND closed_at IS NULL ORDER BY opened_at,id LIMIT 1`,
        [actor.tenantID, actor.userID, clock.today],
      );
      const current = active[0];
      return {
        shiftsEnabled: info.attendanceMode !== 'admin',
        attendanceMode: info.attendanceMode,
        canManageTags: userHasPermission(info.actor, 'company_manage'),
        hasActiveTag: tags.length > 0,
        canScan: info.attendanceMode === 'nfc' && tags.length > 0,
        hasOpenShift: !!current,
        needsFirstScanConfirmation: !!current && !current.first_nfc_at,
        openShiftInOtherPoint: !!current && (current.point_id ?? null) !== pointId,
        pointId,
        firstNfcAt: current ? iso(current.first_nfc_at) : null,
      };
    });
  }
  /** Historical self-read: it cannot execute an attendance intent and does not
   * require a still-active tag. Unknown is not evidence that an in-flight POST
   * rolled back; clients retain its original UUID until a proved result. */
  async result(actor: JwtPayload, requestId: string) {
    return this.transaction(actor, false, async (client) => {
      const { rows } = await client.query<{ response: unknown }>(
        `SELECT response FROM attendance_nfc_requests WHERE tenant_id=$1 AND user_id=$2
          AND point_id IS NOT DISTINCT FROM $3::uuid AND request_id=$4`,
        [actor.tenantID, actor.userID, actorPointId(actor), requestId],
      );
      return rows[0] ? { status: 'completed' as const, result: rows[0].response } : { status: 'unknown' as const };
    });
  }
  async scan(actor: JwtPayload, dto: NfcScanDto) {
    if (!dto || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.requestId ?? ''))
      throw new BadRequestException({ message: 'Для сканирования нужен UUID запроса' });
    const hash = nfcTokenHash(dto.token),
      pointId = actorPointId(actor);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ userId: actor.userID, pointId, tokenHash: hash }))
      .digest('hex');
    const result = await this.transaction(
      actor,
      false,
      async (client, initialInfo, started) => {
        if (initialInfo.attendanceMode !== 'nfc')
          throw new ForbiddenException({ message: 'Отметка NFC отключена для вашей компании' });
        // Shared lock allows different employees to scan one tag concurrently;
        // activation/revoke take FOR UPDATE and cannot race this transaction.
        const { rows: tags } = await client.query<TagRow>(
          `SELECT * FROM attendance_nfc_tags WHERE tenant_id=$1 AND token_hash=$2
        AND point_id IS NOT DISTINCT FROM $3::uuid FOR SHARE`,
          [actor.tenantID, hash, pointId],
        );
        const tag = tags[0];
        if (!tag || tag.status !== 'active')
          throw new ForbiddenException({ message: 'Метка не активна или принадлежит другому автосервису/филиалу' });
        // Membership/feature may have changed while waiting for a tag operation.
        const info = await this.actorInfo(client, actor);
        if (info.attendanceMode !== 'nfc')
          throw new ForbiddenException({ message: 'Отметка NFC отключена для вашей компании' });
        const { rows: requests } = await client.query<{ fingerprint: string; response: unknown }>(
          'SELECT fingerprint,response FROM attendance_nfc_requests WHERE tenant_id=$1 AND request_id=$2',
          [actor.tenantID, dto.requestId],
        );
        if (requests[0]) {
          if (requests[0].fingerprint !== fingerprint)
            throw new ConflictException({
              code: 'IDEMPOTENCY_CONFLICT',
              message: 'UUID сканирования уже использован с другими данными',
            });
          return { response: requests[0].response, push: null, changed: false };
        }
        let clock = await attendanceClock(client, info.timezone);
        const readEntry = async (date: string) =>
          (
            await client.query<AttendanceEntry>(
              `SELECT *,date::text AS date FROM schedule_entries
        WHERE tenant_id=$1 AND user_id=$2 AND date=$3 FOR UPDATE`,
              [actor.tenantID, actor.userID, date],
            )
          ).rows[0];
        let entry = await readEntry(clock.today);
        // Existing close/manual/midnight UPDATEs use these same rows. Read again
        // after acquiring the lock, so a concurrent close is never overwritten.
        const { rows: openRows } = await client.query<ShiftRow>(
          `SELECT *,date::text AS date FROM shifts WHERE tenant_id=$1 AND user_id=$2
        AND closed_at IS NULL ORDER BY opened_at,id FOR UPDATE`,
          [actor.tenantID, actor.userID],
        );
        const afterLocks = await attendanceClock(client, info.timezone);
        if (afterLocks.today !== clock.today) entry = await readEntry(afterLocks.today);
        clock = afterLocks;
        const stale = staleShiftSql('$3', '$4');
        await client.query(
          `UPDATE shifts SET closed_at=${stale.closedAt},is_auto_closed=true
        WHERE tenant_id=$1 AND user_id=$2 AND closed_at IS NULL AND ${stale.predicate}`,
          [actor.tenantID, actor.userID, info.timezone, clock.instant],
        );
        const active = openRows.filter((row) => row.date === clock.today);
        if (entry && (entry.point_id ?? null) !== pointId)
          throw new ConflictException({
            message: 'График этого дня назначен в другом филиале. Обратитесь к руководителю.',
          });
        if (active.some((row) => (row.point_id ?? null) !== pointId))
          throw new ConflictException({ message: 'Смена открыта в другом филиале. Обратитесь к руководителю.' });
        if (active.length > 1)
          throw new ConflictException({
            message: 'Найдено несколько открытых смен. Руководителю нужно закрыть лишние смены.',
          });
        const { rows: closed } = await client.query<ShiftRow>(
          `SELECT *,date::text AS date FROM shifts WHERE tenant_id=$1 AND user_id=$2 AND date=$3
        AND nfc_closed_at IS NOT NULL ORDER BY nfc_closed_at DESC,id DESC LIMIT 1`,
          [actor.tenantID, actor.userID, clock.today],
        );
        let shift = active[0];
        const decision = nfcDecision({
          now: clock.instant,
          requestStartedAt: started,
          hasOpenShift: !!shift,
          firstNfcAt: shift?.first_nfc_at ?? null,
          lastNfcClose: closed[0]?.nfc_closed_at ?? null,
        });
        let late: { minutes: number; status: string } | null = null;
        if (decision.action === 'opened') {
          const { rows } = await client.query<ShiftRow>(
            `INSERT INTO shifts(tenant_id,user_id,point_id,date,opened_at,first_nfc_at)
          VALUES($1,$2,$3,$4,$5,$5) RETURNING *,date::text AS date`,
            [actor.tenantID, actor.userID, pointId, clock.today, clock.instant],
          );
          shift = rows[0];
        } else if (decision.action === 'confirmed') {
          const { rows } = await client.query<ShiftRow>(
            'UPDATE shifts SET first_nfc_at=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *,date::text AS date',
            [clock.instant, shift.id, actor.tenantID],
          );
          shift = rows[0];
        } else if (decision.action === 'closed') {
          const { rows } = await client.query<ShiftRow>(
            'UPDATE shifts SET closed_at=$1,nfc_closed_at=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *,date::text AS date',
            [clock.instant, shift.id, actor.tenantID],
          );
          shift = rows[0];
        } else if (!shift) {
          shift = closed[0];
        }
        if (
          (decision.action === 'opened' || decision.action === 'confirmed') &&
          (!entry || !hasRecordedAttendance(entry))
        ) {
          const { rows: first } = await client.query<{ opened_at: Date }>(
            `SELECT opened_at FROM shifts WHERE tenant_id=$1 AND user_id=$2 AND date=$3
          AND point_id IS NOT DISTINCT FROM $4::uuid ORDER BY opened_at,id LIMIT 1`,
            [actor.tenantID, actor.userID, clock.today, pointId],
          );
          const arrival = first[0].opened_at,
            classified = classifyArrival(arrival, info.timezone, entry?.shift_start);
          late = { minutes: classified.lateMinutes, status: classified.lateStatus };
          await client.query(
            `INSERT INTO schedule_entries(tenant_id,user_id,point_id,date,shift_start,shift_end,actual_arrival,late_minutes,late_status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,user_id,date) DO UPDATE SET
          actual_arrival=EXCLUDED.actual_arrival,late_minutes=EXCLUDED.late_minutes,late_status=EXCLUDED.late_status,shift_start=EXCLUDED.shift_start`,
            [
              actor.tenantID,
              actor.userID,
              pointId,
              clock.today,
              plannedStart(entry?.shift_start),
              entry?.shift_end || '18:00',
              arrival,
              classified.lateMinutes,
              classified.lateStatus,
            ],
          );
        }
        const response = {
          action: decision.action,
          reason: decision.reason,
          shift: shiftDto(shift),
          serverAt: clock.instant.toISOString(),
          firstNfcAt: iso(shift.first_nfc_at),
          closeAfter: shift.first_nfc_at
            ? new Date(shift.first_nfc_at.getTime() + NFC_OPEN_WINDOW_MS).toISOString()
            : null,
          reopenAfter: shift.nfc_closed_at
            ? new Date(shift.nfc_closed_at.getTime() + NFC_CLOSE_DUPLICATE_MS).toISOString()
            : null,
        };
        await client.query(
          `INSERT INTO attendance_nfc_requests(tenant_id,request_id,user_id,point_id,tag_id,fingerprint,response)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [actor.tenantID, dto.requestId, actor.userID, pointId, tag.id, fingerprint, JSON.stringify(response)],
        );
        const push =
          decision.action === 'opened' || decision.action === 'closed'
            ? {
                kind: decision.action === 'opened' ? ('arrived' as const) : ('left' as const),
                late,
                fullName: info.fullName,
              }
            : null;
        return { response, push, changed: decision.action !== 'unchanged' };
      },
      dto.requestId,
    );
    if (result.changed) invalidateReportsForTenant(actor.tenantID);
    if (result.push) {
      void this.shifts.notifyNfcAttendance(
        actor.tenantID,
        actor.userID,
        result.push.fullName,
        result.push.kind,
        result.push.late,
        pointId,
      );
    }
    return result.response;
  }
}
