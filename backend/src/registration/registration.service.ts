import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';
import { TenantsService } from '../tenants/tenants.service';
import { AuditService, AuditActor } from '../tenants/audit.service';
import { SubmitRegistrationDto } from './dto/submit-registration.dto';
import { ApproveRegistrationDto, RejectRegistrationDto } from './dto/review-registration.dto';

/** Postgres unique-violation SQLSTATE — the pending-phone partial unique index (mig 123). */
const PG_UNIQUE_VIOLATION = '23505';

type RegistrationStatus = 'pending' | 'approved' | 'rejected';

/** Public-facing registration request row (NEVER carries password_hash). */
export interface RegistrationRequestView {
  id: string;
  companyName: string;
  ownerName: string;
  phone: string;
  comment: string | null;
  status: RegistrationStatus;
  rejectReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdTenantId: string | null;
  createdAt: string;
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger('RegistrationService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private tenantsService: TenantsService,
    private audit: AuditService,
  ) {}

  /** Map a raw row → the public view. The SELECTs below never fetch password_hash. */
  private mapRequest(row: any): RegistrationRequestView {
    return {
      id: row.id,
      companyName: row.company_name,
      ownerName: row.owner_name,
      phone: row.phone,
      comment: row.comment ?? null,
      status: row.status,
      rejectReason: row.reject_reason ?? null,
      reviewedBy: row.reviewed_by ?? null,
      reviewedAt: row.reviewed_at ?? null,
      createdTenantId: row.created_tenant_id ?? null,
      createdAt: row.created_at,
    };
  }

  // ─── PUBLIC (unauthenticated) ─────────────────────────────────────────────

  /**
   * PUBLIC submit from the login screen. Normalizes the phone, bcrypt-hashes the
   * chosen password, and stores a `pending` request. Politely rejects (400) when
   * the phone already belongs to a registered USER or already has a PENDING
   * request (dedupe). Returns only `{ ok: true }` — never echoes the hash.
   */
  async submit(dto: SubmitRegistrationDto): Promise<{ ok: true }> {
    const phone = normalizePhone(dto.phone);

    // Already a registered user? (Mirrors AuthService.register's non-atomic
    // EXISTS check — there is no DB unique on users.phone.) Politely steer them
    // to log in instead. Enumeration is bounded by the strict per-IP rate limit.
    const { rows: userRows } = await this.pool.query('SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1) AS exists', [
      phone,
    ]);
    if (userRows[0].exists) {
      throw new BadRequestException({
        message: 'Этот номер уже зарегистрирован. Пожалуйста, войдите в приложение.',
      });
    }

    // Already a pending request for this phone? (Rejected requests may re-apply.)
    const { rows: pendingRows } = await this.pool.query(
      `SELECT EXISTS(SELECT 1 FROM registration_requests WHERE phone=$1 AND status='pending') AS exists`,
      [phone],
    );
    if (pendingRows[0].exists) {
      throw new BadRequestException({
        message: 'Заявка с этим номером уже отправлена и ожидает рассмотрения.',
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    try {
      await this.pool.query(
        `INSERT INTO registration_requests (company_name, owner_name, phone, password_hash, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [dto.companyName.trim(), dto.ownerName.trim(), phone, passwordHash, dto.comment?.trim() || null],
      );
    } catch (err: any) {
      // Race: a concurrent submit created the pending row between our check and
      // this insert. The partial unique index (mig 123) caught it — reply with
      // the same polite dedupe message, not a 500.
      if (err?.code === PG_UNIQUE_VIOLATION) {
        throw new BadRequestException({
          message: 'Заявка с этим номером уже отправлена и ожидает рассмотрения.',
        });
      }
      this.logger.error(`Registration submit error: ${err}`);
      throw new InternalServerErrorException({ message: 'Не удалось отправить заявку. Попробуйте позже.' });
    }

    this.logger.log(`Registration request submitted: phone=${phone}`);
    return { ok: true };
  }

  // ─── SUPERADMIN ───────────────────────────────────────────────────────────

  /** List requests (newest first), optionally filtered by status. Never returns password_hash. */
  async list(status?: string): Promise<RegistrationRequestView[]> {
    const validStatus = status === 'pending' || status === 'approved' || status === 'rejected' ? status : undefined;
    const { rows } = await this.pool.query(
      `SELECT id, company_name, owner_name, phone, comment, status, reject_reason,
              reviewed_by, reviewed_at, created_tenant_id, created_at
         FROM registration_requests
        ${validStatus ? 'WHERE status = $1' : ''}
        ORDER BY created_at DESC`,
      validStatus ? [validStatus] : [],
    );
    return rows.map((r) => this.mapRequest(r));
  }

  /**
   * APPROVE: in ONE transaction — create the tenant + owner (reusing the stored
   * PRE-HASHED password, no re-hash) + a FREE trial + ledger row, then mark the
   * request approved with reviewer/tenant back-refs. Guards double-approve and a
   * phone that was taken by a real user between submit and approve. Returns the
   * created tenant. Best-effort audit after commit.
   */
  async approve(id: string, dto: ApproveRegistrationDto, actor: AuditActor) {
    // Validate trial inputs BEFORE opening the transaction (specific messages).
    const until = typeof dto.until === 'string' && dto.until.length > 0 ? dto.until : null;
    if (until !== null) {
      const ts = new Date(until).getTime();
      if (!Number.isFinite(ts) || ts <= Date.now()) {
        throw new BadRequestException({ message: 'Дата окончания пробного периода должна быть в будущем' });
      }
    }
    const trialDays =
      typeof dto.trialDays === 'number' && Number.isFinite(dto.trialDays) && dto.trialDays > 0
        ? Math.trunc(dto.trialDays)
        : 14;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the request row: serialises concurrent approves and lets us guard
      // the status transition atomically.
      const { rows } = await client.query(
        `SELECT id, company_name, owner_name, phone, password_hash, status
           FROM registration_requests
          WHERE id = $1
          FOR UPDATE`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException({ message: 'Заявка не найдена' });
      }
      const req = rows[0];
      if (req.status !== 'pending') {
        throw new BadRequestException({
          message: req.status === 'approved' ? 'Заявка уже одобрена' : 'Заявка уже отклонена',
        });
      }

      // The phone may have become a real user between submit and approve (there
      // is no DB unique on users.phone). Fail clearly instead of creating a
      // duplicate account.
      const { rows: userRows } = await client.query('SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1) AS exists', [
        req.phone,
      ]);
      if (userRows[0].exists) {
        throw new BadRequestException({
          message: 'Этот номер уже занят зарегистрированным пользователем — заявку нельзя одобрить.',
        });
      }

      const { tenant } = await this.tenantsService.createWithOwnerAndTrialTx(client, {
        companyName: req.company_name,
        ownerName: req.owner_name,
        ownerPhone: req.phone, // stored already-normalized at submit time
        ownerPasswordHash: req.password_hash, // reuse verbatim — do NOT re-hash
        until,
        trialDays,
        createdBy: actor.userId,
      });

      await client.query(
        `UPDATE registration_requests
            SET status = 'approved',
                reviewed_by = $2,
                reviewed_at = now(),
                created_tenant_id = $3
          WHERE id = $1`,
        [id, actor.userId, tenant.id],
      );

      await client.query('COMMIT');

      // Best-effort audit — never fails the committed approval.
      await this.audit.log(actor, 'registration_approve', {
        targetType: 'tenant',
        targetId: tenant.id,
        targetName: tenant.name,
        detail: { requestId: id, phone: req.phone, trialDays: until ? null : trialDays, until },
      });

      return tenant;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already dead — release below discards it */
      }
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(`Registration approve error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка при одобрении заявки' });
    } finally {
      client.release();
    }
  }

  /**
   * REJECT: mark the request rejected with an optional reason + reviewer stamp.
   * Guards double-review (already approved/rejected → 400). Best-effort audit.
   */
  async reject(id: string, dto: RejectRegistrationDto, actor: AuditActor): Promise<RegistrationRequestView> {
    const reason = typeof dto.reason === 'string' && dto.reason.trim().length > 0 ? dto.reason.trim() : null;

    // Only a pending request can be rejected; the WHERE clause makes the guard
    // atomic (no separate read). A non-pending / missing row returns zero rows.
    const { rows } = await this.pool.query(
      `UPDATE registration_requests
          SET status = 'rejected',
              reject_reason = $2,
              reviewed_by = $3,
              reviewed_at = now()
        WHERE id = $1 AND status = 'pending'
        RETURNING id, company_name, owner_name, phone, comment, status, reject_reason,
                  reviewed_by, reviewed_at, created_tenant_id, created_at`,
      [id, reason, actor.userId],
    );

    if (rows.length === 0) {
      // Distinguish "missing" from "already reviewed" for a clear operator error.
      const { rows: existing } = await this.pool.query('SELECT status FROM registration_requests WHERE id = $1', [id]);
      if (existing.length === 0) throw new NotFoundException({ message: 'Заявка не найдена' });
      throw new BadRequestException({
        message: existing[0].status === 'approved' ? 'Заявка уже одобрена' : 'Заявка уже отклонена',
      });
    }

    const view = this.mapRequest(rows[0]);

    await this.audit.log(actor, 'registration_reject', {
      targetType: 'registration_request',
      targetId: id,
      targetName: view.companyName,
      detail: { phone: view.phone, reason },
    });

    return view;
  }
}
