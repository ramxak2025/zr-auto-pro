import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';
import { invalidateAuthUser } from '../common/auth-cache';
import { PushService } from '../push/push.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/** A field of the profile a user may self-edit / request a change to. */
export type ProfileField = 'fullName' | 'phone' | 'avatar';

/** One per-field change, client-facing camelCase field name. Stored verbatim in
 *  profile_change_requests.changes (JSONB) and mapped to a `users` column only
 *  at apply time. Exported so the controller's inferred return types are
 *  nameable (TS4053). */
export interface ProfileChangeDiff {
  field: ProfileField;
  oldValue: string | null;
  newValue: string | null;
}

/** camelCase diff field → `users` column. The ONLY columns this flow may touch. */
const FIELD_TO_COLUMN: Record<ProfileField, string> = {
  fullName: 'full_name',
  phone: 'phone',
  avatar: 'avatar',
};

/** node-pg may hand back JSONB already parsed or, on a legacy text column, as a
 *  string — accept both and never let a malformed value throw. */
function parseChanges(raw: unknown): ProfileChangeDiff[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: ProfileChangeDiff[] = [];
  for (const item of arr) {
    const d = item as { field?: unknown; oldValue?: unknown; newValue?: unknown };
    if (d && (d.field === 'fullName' || d.field === 'phone' || d.field === 'avatar')) {
      out.push({
        field: d.field,
        oldValue: d.oldValue == null ? null : String(d.oldValue),
        newValue: d.newValue == null ? null : String(d.newValue),
      });
    }
  }
  return out;
}

// SELECT for a profile_change_request joined with its requester (for the owner's
// review list and decision return values — the UI renders who + old→new).
const REQUEST_SELECT = `
  SELECT r.id, r.tenant_id, r.user_id, r.changes, r.status, r.created_at, r.decided_by, r.decided_at,
         u.full_name AS requester_full_name, u.phone AS requester_phone,
         u.avatar AS requester_avatar, u.role AS requester_role
    FROM profile_change_requests r
    LEFT JOIN users u ON u.id = r.user_id`;

interface SelfRow {
  id: string;
  role: string;
  full_name: string | null;
  phone: string | null;
  avatar: string | null;
  password: string;
  tenant_id: string;
}

/**
 * «Мой профиль».
 *
 * Two self-service actions and an owner approval queue:
 *
 *  • PATCH /profile  — edit ФИО / телефон / аватар.
 *      - director / superadmin («владелец») → applied DIRECTLY to `users`.
 *      - admin / master («сотрудник»)       → creates / supersedes a
 *        profile_change_request (status 'pending'); the user row is NOT touched.
 *
 *  • POST /profile/password — change own password. Self-service for EVERY role:
 *    verify current via bcrypt.compare, store bcrypt.hash(new, 12). Password is
 *    NEVER part of the request/approval flow and is never logged or returned.
 *
 *  • Owner queue (director / superadmin, RolesGuard): list pending, approve
 *    (applies the diff to the user with a PHONE-UNIQUENESS check — phone is the
 *    login) or reject. Push notifications are best-effort, fired AFTER commit.
 *
 * The deterministic App-Review DEMO tenant (migration 094) is treated as a
 * no-op for the two credential-mutating paths (direct profile apply + password
 * change), so a reviewer can walk the whole flow without breaking the seeded
 * login for the next review — mirrors AccountService.
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger('ProfileService');

  /** Seeded App Store / Google Play review tenant (migration 094). */
  private static readonly DEMO_TENANT_ID = 'de100000-0000-4000-a000-000000000002';

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private push: PushService,
  ) {}

  private isDemoTenant(tenantId: string | null | undefined): boolean {
    return tenantId === ProfileService.DEMO_TENANT_ID;
  }

  // ─── Self profile edit ──────────────────────────────────────────────────
  async updateProfile(user: JwtPayload, dto: UpdateProfileDto) {
    const self = await this.loadSelf(user.userID);
    const diff = this.computeDiff(self, dto);

    // Nothing actually changed — idempotent no-op, report applied with the
    // current canonical user.
    if (diff.length === 0) {
      return { status: 'applied' as const, applied: true, user: await this.fetchUser(self.id) };
    }

    const isOwner = self.role === 'director' || self.role === 'superadmin';
    if (isOwner) {
      await this.applyProfileChanges(this.pool, self.id, diff, self.tenant_id);
      invalidateAuthUser(self.id);
      return { status: 'applied' as const, applied: true, user: await this.fetchUser(self.id) };
    }

    // admin / master → request, do NOT mutate `users`.
    // Soft pre-check phone uniqueness so the employee gets immediate feedback
    // instead of a request that is doomed at approve time. The AUTHORITATIVE
    // check still runs on apply (another user could grab the number meanwhile).
    const phoneDiff = diff.find((d) => d.field === 'phone');
    if (phoneDiff && phoneDiff.newValue) {
      await this.assertPhoneFree(this.pool, phoneDiff.newValue, self.id);
    }

    const request = await this.upsertPendingRequest(self.id, self.tenant_id, diff);

    // Notify the tenant's владельцы — best-effort, after the row is committed.
    void this.notifyOwnersOfRequest(self.tenant_id, self.id, self.full_name, request.id);

    return { status: 'requested' as const, applied: false, request };
  }

  // ─── Self password change (all roles) ───────────────────────────────────
  async changePassword(user: JwtPayload, dto: ChangePasswordDto): Promise<{ message: string }> {
    const self = await this.loadSelf(user.userID);

    // Re-authenticate. bcrypt.compare returns false (never throws) for a wrong
    // password or an unusable stored hash.
    const ok = await bcrypt.compare(dto.currentPassword, self.password || '');
    if (!ok) {
      throw new UnauthorizedException({ message: 'Неверный текущий пароль' });
    }

    // Strength — mirrors /auth/register so the rule is identical everywhere
    // (covers Cyrillic capitals too).
    if (dto.newPassword.length < 8) {
      throw new BadRequestException({ message: 'Пароль должен быть не менее 8 символов' });
    }
    if (!/[A-ZА-Я]/.test(dto.newPassword) || !/[0-9]/.test(dto.newPassword)) {
      throw new BadRequestException({ message: 'Пароль должен содержать заглавную букву и цифру' });
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException({ message: 'Новый пароль должен отличаться от текущего' });
    }

    // DEMO review account: validate as usual but never persist, so the seeded
    // login keeps working for the next App Store / Google Play review.
    if (this.isDemoTenant(self.tenant_id)) {
      this.logger.log(`Password change on DEMO tenant by ${self.id} — no-op (preserved for review)`);
      return { message: 'Пароль изменён' };
    }

    const hash = await bcrypt.hash(dto.newPassword, 12);
    // СМЕНА ПАРОЛЯ ГАСИТ ВСЕ РАНЕЕ ВЫДАННЫЕ СЕССИИ (165). Раньше пароль менялся,
    // а токены, выписанные до этого, жили до 30 суток: украденный или
    // оставшийся на чужом телефоне токен продолжал работать, то есть сменить
    // пароль «чтобы выгнать чужого» было НЕВОЗМОЖНО. Ревокация по jti (021)
    // адресует один токен, а списка живых jti пользователя не существует —
    // поэтому граница пишется одной колонкой и проверяется в JwtStrategy
    // против claim `iat`. Текущая сессия тоже умирает: её токен выписан
    // РАНЬШЕ смены, и исключать её значило бы оставить живым ровно тот
    // сценарий, от которого защищаемся (менял пароль как раз не владелец
    // устройства).
    await this.pool.query('UPDATE users SET password=$1, sessions_valid_from=now(), updated_at=now() WHERE id=$2', [
      hash,
      self.id,
    ]);
    // 30-секундный auth-кеш обязан забыть положительные валидации этого
    // пользователя немедленно — иначе украденный токен прожил бы ещё полминуты.
    invalidateAuthUser(self.id);
    // Never log the plaintext or the hash.
    return { message: 'Пароль изменён — войдите заново' };
  }

  // ─── Owner review queue (director / superadmin) ─────────────────────────
  async listChangeRequests(tenantID: string) {
    const { rows } = await this.pool.query(
      `${REQUEST_SELECT}
        WHERE r.tenant_id = $1 AND r.status = 'pending'
        ORDER BY r.created_at DESC`,
      [tenantID],
    );
    return rows.map((r) => this.mapRequestRow(r));
  }

  /** The caller's own current pending request (or null) — lets the employee's
   *  profile screen render the «на рассмотрении» state after an app restart. */
  async getMyChangeRequest(userID: string) {
    const { rows } = await this.pool.query(
      `${REQUEST_SELECT}
        WHERE r.user_id = $1 AND r.status = 'pending'
        ORDER BY r.created_at DESC
        LIMIT 1`,
      [userID],
    );
    return rows.length > 0 ? this.mapRequestRow(rows[0]) : null;
  }

  async approveChangeRequest(user: JwtPayload, id: string) {
    const req = await this.loadRequestRow(id, user.tenantID);
    if (req.status !== 'pending') {
      throw new BadRequestException({ message: 'Запрос уже обработан' });
    }
    const diff = parseChanges(req.changes);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Apply the requested diff to the requester. Throws ConflictException if
      // the requested phone is now taken (phone is the login) — the whole
      // transaction rolls back and the request stays pending.
      await this.applyProfileChanges(client, req.user_id, diff, req.tenant_id);

      // Flip to approved, guarded on status='pending' so a concurrent
      // approve/reject by another owner can't double-decide.
      const { rows } = await client.query(
        `UPDATE profile_change_requests
            SET status='approved', decided_by=$1, decided_at=now()
          WHERE id=$2 AND tenant_id=$3 AND status='pending'
          RETURNING id`,
        [user.userID, id, user.tenantID],
      );
      if (rows.length === 0) {
        // Lost a race to another owner's decision — the catch below rolls back.
        throw new BadRequestException({ message: 'Запрос уже обработан' });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    invalidateAuthUser(req.user_id);
    void this.notifyRequesterDecision(req.user_id, req.tenant_id, id, 'approved');
    return this.fetchRequestById(id, user.tenantID);
  }

  async rejectChangeRequest(user: JwtPayload, id: string) {
    const req = await this.loadRequestRow(id, user.tenantID);
    if (req.status !== 'pending') {
      throw new BadRequestException({ message: 'Запрос уже обработан' });
    }

    const { rows } = await this.pool.query(
      `UPDATE profile_change_requests
          SET status='rejected', decided_by=$1, decided_at=now()
        WHERE id=$2 AND tenant_id=$3 AND status='pending'
        RETURNING id`,
      [user.userID, id, user.tenantID],
    );
    if (rows.length === 0) {
      // Lost a race to another owner's decision.
      throw new BadRequestException({ message: 'Запрос уже обработан' });
    }

    void this.notifyRequesterDecision(req.user_id, req.tenant_id, id, 'rejected');
    return this.fetchRequestById(id, user.tenantID);
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async loadSelf(userID: string): Promise<SelfRow> {
    const { rows } = await this.pool.query(
      `SELECT id, role, full_name, phone, avatar, password,
              COALESCE(tenant_id::text, '') AS tenant_id
         FROM users WHERE id=$1 LIMIT 1`,
      [userID],
    );
    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Пользователь не найден' });
    }
    return rows[0] as SelfRow;
  }

  /**
   * Build the diff of fields that are PRESENT in the DTO and DIFFERENT from the
   * current value. Validates inputs (non-empty name, plausible phone). Empty
   * avatar string clears it to NULL.
   */
  private computeDiff(self: SelfRow, dto: UpdateProfileDto): ProfileChangeDiff[] {
    const diff: ProfileChangeDiff[] = [];

    if (dto.fullName !== undefined) {
      const next = dto.fullName.trim();
      if (next.length === 0) {
        throw new BadRequestException({ message: 'ФИО не может быть пустым' });
      }
      if (next !== (self.full_name ?? '')) {
        diff.push({ field: 'fullName', oldValue: self.full_name ?? null, newValue: next });
      }
    }

    if (dto.phone !== undefined) {
      const next = normalizePhone(dto.phone);
      if (!/^\+\d{10,15}$/.test(next)) {
        throw new BadRequestException({ message: 'Неверный формат телефона' });
      }
      if (next !== (self.phone ?? '')) {
        diff.push({ field: 'phone', oldValue: self.phone ?? null, newValue: next });
      }
    }

    if (dto.avatar !== undefined) {
      const next = dto.avatar === '' ? null : dto.avatar;
      if (next !== (self.avatar ?? null)) {
        diff.push({ field: 'avatar', oldValue: self.avatar ?? null, newValue: next });
      }
    }

    return diff;
  }

  /** Reject when `phone` already belongs to ANOTHER user (phone is globally
   *  unique — the login). Excludes the user themselves. */
  private async assertPhoneFree(executor: Pool | PoolClient, phone: string, exceptUserId: string): Promise<void> {
    const { rows } = await executor.query(`SELECT 1 FROM users WHERE phone=$1 AND id<>$2 LIMIT 1`, [
      phone,
      exceptUserId,
    ]);
    if (rows.length > 0) {
      throw new ConflictException({ message: 'Этот телефон уже занят другим пользователем' });
    }
  }

  /**
   * Apply a profile diff to a `users` row. Used by BOTH the direct (owner) edit
   * and the approve path — single source of truth for the mutation + the phone
   * uniqueness guard. Runs on the supplied executor (pool, or a transaction
   * client during approve).
   */
  private async applyProfileChanges(
    executor: Pool | PoolClient,
    userId: string,
    diff: ProfileChangeDiff[],
    tenantId: string,
  ): Promise<void> {
    if (diff.length === 0) return;

    // DEMO review account: never mutate the seeded login data.
    if (this.isDemoTenant(tenantId)) {
      this.logger.log(`Profile apply on DEMO tenant for ${userId} — no-op (preserved for review)`);
      return;
    }

    const phoneDiff = diff.find((d) => d.field === 'phone');
    if (phoneDiff && phoneDiff.newValue) {
      await this.assertPhoneFree(executor, phoneDiff.newValue, userId);
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    for (const d of diff) {
      const col = FIELD_TO_COLUMN[d.field];
      sets.push(`${col}=$${idx++}`);
      vals.push(d.newValue);
    }
    sets.push('updated_at=now()');
    vals.push(userId);

    try {
      await executor.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${idx}`, vals);
    } catch (err: unknown) {
      // Unique-violation on phone (lost the race after assertPhoneFree).
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictException({ message: 'Этот телефон уже занят другим пользователем' });
      }
      throw err;
    }
  }

  /**
   * Create the employee's pending request, or SUPERSEDE the existing one (the
   * partial UNIQUE index guarantees at most one pending per user). On the rare
   * concurrent-insert race we fall back to updating the existing row.
   */
  private async upsertPendingRequest(userId: string, tenantId: string, diff: ProfileChangeDiff[]) {
    const changesJson = JSON.stringify(diff);

    // Supersede the existing pending request (one per user — partial UNIQUE
    // index) with the latest diff, so the owner always reviews the current ask.
    const existing = await this.pool.query(
      `SELECT id FROM profile_change_requests WHERE user_id=$1 AND status='pending' LIMIT 1`,
      [userId],
    );
    if (existing.rows.length > 0) {
      const requestId = existing.rows[0].id as string;
      await this.pool.query(`UPDATE profile_change_requests SET changes=$1::jsonb, created_at=now() WHERE id=$2`, [
        changesJson,
        requestId,
      ]);
      return this.fetchRequestById(requestId, tenantId);
    }

    try {
      const inserted = await this.pool.query(
        `INSERT INTO profile_change_requests (tenant_id, user_id, changes, status)
         VALUES ($1, $2, $3::jsonb, 'pending') RETURNING id`,
        [tenantId, userId, changesJson],
      );
      return this.fetchRequestById(inserted.rows[0].id as string, tenantId);
    } catch (err: unknown) {
      // Concurrent submit beat us to the unique pending slot — update it instead.
      if ((err as { code?: string })?.code === '23505') {
        await this.pool.query(
          `UPDATE profile_change_requests SET changes=$1::jsonb, created_at=now()
            WHERE user_id=$2 AND status='pending'`,
          [changesJson, userId],
        );
        const again = await this.getMyChangeRequest(userId);
        if (again) return again;
      }
      throw err;
    }
  }

  private async loadRequestRow(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, user_id, changes, status, created_at, decided_by, decided_at
         FROM profile_change_requests WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [id, tenantID],
    );
    if (rows.length === 0) {
      throw new NotFoundException({ message: 'Запрос не найден' });
    }
    return rows[0] as {
      id: string;
      tenant_id: string;
      user_id: string;
      changes: unknown;
      status: string;
      created_at: string;
      decided_by: string | null;
      decided_at: string | null;
    };
  }

  private async fetchRequestById(id: string, tenantID: string) {
    const { rows } = await this.pool.query(`${REQUEST_SELECT} WHERE r.id=$1 AND r.tenant_id=$2 LIMIT 1`, [
      id,
      tenantID,
    ]);
    if (rows.length === 0) {
      throw new NotFoundException({ message: 'Запрос не найден' });
    }
    return this.mapRequestRow(rows[0]);
  }

  private mapRequestRow(row: Record<string, unknown>) {
    const userId = row.user_id as string | null;
    const requester =
      userId && row.requester_full_name !== undefined
        ? {
            id: userId,
            fullName: (row.requester_full_name as string) ?? '',
            phone: (row.requester_phone as string) ?? '',
            avatar: (row.requester_avatar as string | null) ?? undefined,
            role: (row.requester_role as string) ?? '',
          }
        : undefined;

    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string) ?? undefined,
      userId: userId ?? '',
      requester,
      changes: parseChanges(row.changes),
      status: row.status as 'pending' | 'approved' | 'rejected',
      createdAt: row.created_at as string,
      decidedBy: (row.decided_by as string | null) ?? undefined,
      decidedAt: (row.decided_at as string | null) ?? undefined,
    };
  }

  /**
   * Return the canonical, camelCase user (same shape as /auth/me, tenant
   * included) so the client can swap its current user in after a direct edit
   * without a refetch. Mirrors AuthService.me's projection deliberately — the
   * protected auth module stays untouched.
   */
  private async fetchUser(userID: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.phone, u.full_name, u.avatar, u.role,
              COALESCE(u.salary_percent, 0) AS salary_percent,
              COALESCE(u.permissions, '{}') AS permissions,
              u.is_active, u.tenant_id, u.created_at,
              CASE WHEN t.id IS NOT NULL THEN
                json_build_object('id',t.id,'name',t.name,'slug',COALESCE(t.slug,''),
                  'phone',COALESCE(t.phone,''),'address',COALESCE(t.address,''),
                  'email',COALESCE(t.email,''),'isActive',t.is_active,
                  'maxUsers',t.max_users,'subscriptionEnd',t.subscription_end,
                  'subscriptionNote',COALESCE(t.subscription_note,''),
                  'createdAt',t.created_at,'updatedAt',t.updated_at)::text
              ELSE NULL END AS tenant_json
         FROM users u
         LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id=$1`,
      [userID],
    );
    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Пользователь не найден' });
    }
    const row = rows[0];
    const user: Record<string, unknown> = {
      id: row.id,
      phone: row.phone,
      fullName: row.full_name,
      avatar: row.avatar,
      role: row.role,
      salaryPercent: parseFloat(row.salary_percent) || 0,
      permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
      isActive: row.is_active,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
    };
    if (row.tenant_json) {
      try {
        user.tenant = JSON.parse(row.tenant_json);
      } catch {
        /* ignore malformed tenant JSON */
      }
    }
    return user;
  }

  // ─── Notifications (best-effort, fired AFTER commit) ────────────────────

  /** Tell the tenant's владельцы (director + superadmin) a new request landed. */
  private async notifyOwnersOfRequest(
    tenantId: string,
    requesterId: string,
    requesterName: string | null,
    requestId: string,
  ): Promise<void> {
    try {
      if (!tenantId) return;
      const { rows } = await this.pool.query(
        `SELECT id FROM users
          WHERE tenant_id=$1 AND role IN ('director','superadmin')
            AND is_active=true AND dismissed_at IS NULL AND purged_at IS NULL
            AND id<>$2`,
        [tenantId, requesterId],
      );
      const name = requesterName && requesterName.trim().length > 0 ? requesterName : 'Сотрудник';
      const data = { type: 'profile_change_requested' as const, requestId, tenantId };
      await Promise.all(
        rows.map((r: { id: string }) =>
          this.push.sendToUserInTenant(
            r.id,
            tenantId,
            'profile_request',
            'Запрос на изменение профиля',
            `${name} просит изменить профиль`,
            data,
          ),
        ),
      );
    } catch (err) {
      this.logger.warn(`notifyOwnersOfRequest failed for tenant=${tenantId}: ${err}`);
    }
  }

  /** Tell the requester their request was approved / rejected. */
  private async notifyRequesterDecision(
    requesterId: string,
    tenantId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    try {
      const title = decision === 'approved' ? 'Профиль обновлён' : 'Изменения отклонены';
      const body =
        decision === 'approved'
          ? 'Владелец одобрил изменения вашего профиля'
          : 'Владелец отклонил изменения вашего профиля';
      await this.push.sendToUserInTenant(requesterId, tenantId, 'profile_request', title, body, {
        type: `profile_change_${decision}` as const,
        requestId,
        tenantId,
      });
    } catch (err) {
      this.logger.warn(`notifyRequesterDecision failed for user=${requesterId}: ${err}`);
    }
  }
}
