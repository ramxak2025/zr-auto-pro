import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { isTenantLess } from '../common/auth-cache';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { MarketingService } from '../marketing/marketing.service';
import { PushService } from '../push/push.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { UpdateBookingSettingsDto } from './dto/update-booking-settings.dto';

/**
 * Owner-class roles see ALL bookings in the tenant and may edit/cancel any.
 * A `master` sees and may mutate ONLY their own (master_id = self). This is a
 * dedicated rule (role-based) per the design — NOT the checks_view_all flag.
 */
const OWNER_CLASS_ROLES = new Set(['superadmin', 'director', 'admin']);

function isOwnerClass(user: JwtPayload): boolean {
  return !!user.role && OWNER_CLASS_ROLES.has(user.role);
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger('BookingsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private marketingService: MarketingService,
    private pushService: PushService,
  ) {}

  // ─── Row mapping ───────────────────────────────────────────────────
  private mapRow(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      clientId: r.client_id,
      clientName: r.client_name ?? null,
      clientPhone: r.client_phone ?? null,
      carId: r.car_id ?? null,
      carPlate: r.car_plate ?? null,
      carMakeModel: r.car_make_model ?? null,
      masterId: r.master_id ?? null,
      masterName: r.master_name ?? null,
      createdBy: r.created_by ?? null,
      scheduledAt: r.scheduled_at,
      comment: r.comment ?? null,
      status: r.status,
      checkId: r.check_id ?? null,
      checkNumber: r.check_number ?? null,
      notifyOnCreate: r.notify_on_create,
      reminderSentAt: r.reminder_sent_at ?? null,
      createdAt: r.created_at,
      cancelledAt: r.cancelled_at ?? null,
      cancelledBy: r.cancelled_by ?? null,
    };
  }

  // Shared SELECT with the joins the list/detail responses need. Every query
  // that uses it MUST keep `b.tenant_id = $1` as the leading predicate.
  private readonly SELECT_BOOKING = `
    SELECT b.*,
           cl.full_name AS client_name, cl.phone AS client_phone,
           ca.plate_number AS car_plate, ca.make_model AS car_make_model,
           u.full_name AS master_name,
           ch.number AS check_number
      FROM bookings b
      LEFT JOIN clients cl ON cl.id = b.client_id
      LEFT JOIN cars ca ON ca.id = b.car_id
      LEFT JOIN users u ON u.id = b.master_id
      LEFT JOIN checks ch ON ch.id = b.check_id`;

  // ─── List ──────────────────────────────────────────────────────────
  async list(user: JwtPayload, query: { scope?: string; from?: string; to?: string }) {
    const tenantId = user.tenantID;
    const params: any[] = [tenantId];
    let idx = 2;
    let sql = `${this.SELECT_BOOKING} WHERE b.tenant_id = $1`;

    // VISIBILITY: master sees only own; owner-class sees all.
    if (!isOwnerClass(user)) {
      sql += ` AND b.master_id = $${idx++}`;
      params.push(user.userID);
    }

    const scope = query.scope;
    if (scope === 'upcoming') {
      // Still-active bookings from today onwards.
      sql += ` AND b.status = 'scheduled' AND b.scheduled_at >= date_trunc('day', now())`;
    } else if (scope === 'past') {
      // Everything else: any non-scheduled status OR a scheduled time already in the past.
      sql += ` AND (b.status <> 'scheduled' OR b.scheduled_at < now())`;
    }

    if (query.from) {
      sql += ` AND b.scheduled_at >= $${idx++}`;
      params.push(query.from);
    }
    if (query.to) {
      sql += ` AND b.scheduled_at <= $${idx++}`;
      params.push(query.to);
    }

    // Upcoming reads best soonest-first; past reads best most-recent-first.
    sql += scope === 'past' ? ` ORDER BY b.scheduled_at DESC` : ` ORDER BY b.scheduled_at ASC`;
    sql += ` LIMIT 500`;

    const { rows } = await this.pool.query(sql, params);
    return rows.map((r) => this.mapRow(r));
  }

  // ─── Fetch one (tenant-scoped) ─────────────────────────────────────
  private async getOwnedRow(id: string, tenantId: string): Promise<any> {
    const { rows } = await this.pool.query(`${this.SELECT_BOOKING} WHERE b.tenant_id = $1 AND b.id = $2`, [
      tenantId,
      id,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Запись не найдена' });
    return rows[0];
  }

  // ─── Create ────────────────────────────────────────────────────────
  async create(user: JwtPayload, dto: CreateBookingDto) {
    const tenantId = user.tenantID;

    // Client must exist in this tenant.
    const { rows: clientRows } = await this.pool.query(
      `SELECT id, full_name, phone FROM clients WHERE id = $1 AND tenant_id = $2`,
      [dto.clientId, tenantId],
    );
    if (clientRows.length === 0) throw new BadRequestException({ message: 'Клиент не найден' });

    // Car (if given) must belong to this tenant and that client.
    if (dto.carId) {
      const { rows: carRows } = await this.pool.query(
        `SELECT id FROM cars WHERE id = $1 AND tenant_id = $2 AND client_id = $3`,
        [dto.carId, tenantId, dto.clientId],
      );
      if (carRows.length === 0) throw new BadRequestException({ message: 'Автомобиль не найден у этого клиента' });
    }

    // Resolve master_id:
    //  • master caller, masterId omitted → self
    //  • master caller, masterId set → must be self (can't book onto others)
    //  • owner-class → any tenant master, or null (unassigned)
    let masterId: string | null;
    if (!isOwnerClass(user)) {
      if (dto.masterId && dto.masterId !== user.userID) {
        throw new ForbiddenException({ message: 'Мастер может создавать запись только на себя' });
      }
      masterId = user.userID;
    } else {
      masterId = dto.masterId ?? null;
      if (masterId) {
        const { rows: masterRows } = await this.pool.query(
          `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'master'`,
          [masterId, tenantId],
        );
        if (masterRows.length === 0) throw new BadRequestException({ message: 'Мастер не найден' });
      }
    }

    // SOFT CONFLICT: if the chosen master already has an overlapping scheduled
    // booking near this time, surface it as a warning but DO NOT block.
    let conflictWarning: ReturnType<BookingsService['mapRow']> | null = null;
    if (masterId) {
      conflictWarning = await this.findConflict(tenantId, masterId, dto.scheduledAt, null);
    }

    const notifyOnCreate = dto.notifyOnCreate ?? true;

    const { rows } = await this.pool.query(
      `INSERT INTO bookings (tenant_id, client_id, car_id, master_id, created_by, scheduled_at, comment, notify_on_create)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        tenantId,
        dto.clientId,
        dto.carId ?? null,
        masterId,
        user.userID,
        dto.scheduledAt,
        dto.comment ?? null,
        notifyOnCreate,
      ],
    );
    const bookingId = rows[0].id;

    // Best-effort client confirmation: only when the tenant opted in AND the
    // caller didn't turn it off for this booking. No provider → skipped
    // silently by sendClientMessage.
    if (notifyOnCreate) {
      const settings = await this.getSettings(tenantId);
      if (settings.notifyClientOnCreate) {
        const phone = clientRows[0].phone;
        const message = `Вы записаны на ${this.formatWhen(dto.scheduledAt)}. Ждём вас!`;
        // Fire-and-forget — never block the API response on a messaging provider.
        void this.marketingService
          .sendClientMessage(tenantId, phone, message, {
            clientId: dto.clientId ?? null,
            messageType: 'booking',
            dedupKey: `booking_confirm:${bookingId}`,
          })
          .catch((err) => this.logger.warn(`Booking confirmation send failed: ${err}`));
      }
    }

    // Best-effort silent data push so other staff devices refresh their list.
    void this.pushService
      .sendDataToTenant(tenantId, user.userID, { type: 'booking-created', tenantId })
      .catch(() => undefined);

    const created = this.mapRow(await this.getOwnedRow(bookingId, tenantId));
    return { ...created, conflictWarning };
  }

  /**
   * Find a *scheduled* booking for the same master whose time overlaps the
   * given slot (±90 min window — bookings carry no duration, so we treat
   * anything within an hour and a half as a soft clash). Tenant-scoped.
   * `excludeId` skips the booking being rescheduled.
   */
  private async findConflict(
    tenantId: string,
    masterId: string,
    scheduledAt: string,
    excludeId: string | null,
  ): Promise<ReturnType<BookingsService['mapRow']> | null> {
    const { rows } = await this.pool.query(
      `${this.SELECT_BOOKING}
        WHERE b.tenant_id = $1
          AND b.master_id = $2
          AND b.status = 'scheduled'
          AND ($4::uuid IS NULL OR b.id <> $4)
          AND b.scheduled_at BETWEEN ($3::timestamptz - interval '90 minutes')
                                 AND ($3::timestamptz + interval '90 minutes')
        ORDER BY b.scheduled_at ASC
        LIMIT 1`,
      [tenantId, masterId, scheduledAt, excludeId],
    );
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  // ─── Update (reschedule / comment / reassign) ──────────────────────
  async update(user: JwtPayload, id: string, dto: UpdateBookingDto) {
    const tenantId = user.tenantID;
    const row = await this.getOwnedRow(id, tenantId);

    // Ownership: master may edit only own.
    if (!isOwnerClass(user) && row.master_id !== user.userID) {
      throw new ForbiddenException({ message: 'Можно изменять только свои записи' });
    }

    // Resolve reassignment. A master can never reassign to someone else or null.
    let masterId: string | null = row.master_id;
    if (dto.masterId !== undefined) {
      if (!isOwnerClass(user)) {
        if (dto.masterId && dto.masterId !== user.userID) {
          throw new ForbiddenException({ message: 'Мастер не может переназначить запись на другого' });
        }
        masterId = user.userID;
      } else {
        masterId = dto.masterId ?? null;
        if (masterId) {
          const { rows: masterRows } = await this.pool.query(
            `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'master'`,
            [masterId, tenantId],
          );
          if (masterRows.length === 0) throw new BadRequestException({ message: 'Мастер не найден' });
        }
      }
    }

    // Validate a car reassignment against the booking's client.
    if (dto.carId !== undefined && dto.carId !== null) {
      const { rows: carRows } = await this.pool.query(
        `SELECT id FROM cars WHERE id = $1 AND tenant_id = $2 AND client_id = $3`,
        [dto.carId, tenantId, row.client_id],
      );
      if (carRows.length === 0) throw new BadRequestException({ message: 'Автомобиль не найден у этого клиента' });
    }

    const scheduledAt = dto.scheduledAt ?? row.scheduled_at;
    const comment = dto.comment !== undefined ? dto.comment : row.comment;
    const carId = dto.carId !== undefined ? dto.carId : row.car_id;

    // Only a still-`scheduled` booking can be rescheduled/edited — never a
    // converted (linked to a real check) or cancelled one (would resurrect it
    // into Предстоящие). UI gates this; the server is the contract boundary.
    const { rowCount } = await this.pool.query(
      `UPDATE bookings
          SET scheduled_at = $1, comment = $2, master_id = $3, car_id = $4
        WHERE id = $5 AND tenant_id = $6 AND status = 'scheduled'`,
      [scheduledAt, comment, masterId, carId, id, tenantId],
    );
    if (rowCount === 0) {
      throw new BadRequestException({ message: 'Нельзя изменить — запись уже проведена или отменена' });
    }

    // Recompute the soft conflict for the (possibly new) master/time.
    let conflictWarning: ReturnType<BookingsService['mapRow']> | null = null;
    if (masterId) {
      conflictWarning = await this.findConflict(tenantId, masterId, scheduledAt, id);
    }

    const updated = this.mapRow(await this.getOwnedRow(id, tenantId));
    return { ...updated, conflictWarning };
  }

  // ─── Cancel ────────────────────────────────────────────────────────
  async cancel(user: JwtPayload, id: string) {
    const tenantId = user.tenantID;
    const row = await this.getOwnedRow(id, tenantId);

    // Server-enforced ownership: a master cancelling another's booking → 403.
    if (!isOwnerClass(user) && row.master_id !== user.userID) {
      throw new ForbiddenException({ message: 'Можно отменять только свои записи' });
    }

    // Only a still-`scheduled` booking can be cancelled — never re-cancel a
    // cancelled one or cancel a converted booking (which has a real linked
    // check; flipping it to cancelled would leave check_id dangling + a lying
    // status).
    const { rowCount } = await this.pool.query(
      `UPDATE bookings
          SET status = 'cancelled', cancelled_at = now(), cancelled_by = $1
        WHERE id = $2 AND tenant_id = $3 AND status = 'scheduled'`,
      [user.userID, id, tenantId],
    );
    if (rowCount === 0) {
      throw new BadRequestException({ message: 'Нельзя отменить — запись уже проведена или отменена' });
    }

    return this.mapRow(await this.getOwnedRow(id, tenantId));
  }

  // ─── Convert (link a saved check) ──────────────────────────────────
  async convert(user: JwtPayload, id: string, checkId: string) {
    const tenantId = user.tenantID;
    const row = await this.getOwnedRow(id, tenantId);

    // A master may convert only own; owner-class any.
    if (!isOwnerClass(user) && row.master_id !== user.userID) {
      throw new ForbiddenException({ message: 'Можно проводить только свои записи' });
    }

    // The check must belong to this tenant and not be in the trash (106).
    const { rows: checkRows } = await this.pool.query(
      `SELECT id FROM checks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [checkId, tenantId],
    );
    if (checkRows.length === 0) throw new BadRequestException({ message: 'Чек не найден' });

    // Atomic, status-gated claim: only a still-`scheduled` booking with NO
    // linked check converts. Guards against double-convert (the convert-on-save
    // call is best-effort + retried after the tolerated network blip, or two
    // staff devices racing) overwriting check_id and orphaning the first check,
    // and against resurrecting a cancelled booking.
    const { rowCount } = await this.pool.query(
      `UPDATE bookings SET status = 'converted', check_id = $1
        WHERE id = $2 AND tenant_id = $3 AND status = 'scheduled' AND check_id IS NULL`,
      [checkId, id, tenantId],
    );
    if (rowCount === 0) {
      throw new BadRequestException({ message: 'Запись уже проведена или отменена' });
    }

    return this.mapRow(await this.getOwnedRow(id, tenantId));
  }

  // ─── Settings (lazy-create defaults) ───────────────────────────────
  async getSettings(tenantId: string) {
    // Tenant-less caller (superadmin, nil-UUID sentinel): return the column
    // defaults WITHOUT seeding — the lazy-create below would FK-violate
    // booking_settings_tenant_id_fkey (no such tenant) → 500 on GET
    // /bookings/settings. Shape mirrors a fresh row (076 defaults).
    if (isTenantLess(tenantId)) {
      return { notifyClientOnCreate: true, reminderEnabled: true, reminderHours: 2, channel: 'auto' };
    }
    const { rows } = await this.pool.query(
      `SELECT notify_client_on_create, reminder_enabled, reminder_hours, channel
         FROM booking_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    if (rows.length === 0) {
      await this.pool.query(`INSERT INTO booking_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [
        tenantId,
      ]);
      const { rows: created } = await this.pool.query(
        `SELECT notify_client_on_create, reminder_enabled, reminder_hours, channel
           FROM booking_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      return this.mapSettings(created[0]);
    }
    return this.mapSettings(rows[0]);
  }

  async updateSettings(tenantId: string, dto: UpdateBookingSettingsDto) {
    await this.pool.query(
      `INSERT INTO booking_settings (tenant_id, notify_client_on_create, reminder_enabled, reminder_hours, channel)
       VALUES ($1, COALESCE($2, true), COALESCE($3, true), COALESCE($4, 2), COALESCE($5, 'auto'))
       ON CONFLICT (tenant_id) DO UPDATE SET
         notify_client_on_create = COALESCE($2, booking_settings.notify_client_on_create),
         reminder_enabled = COALESCE($3, booking_settings.reminder_enabled),
         reminder_hours = COALESCE($4, booking_settings.reminder_hours),
         channel = COALESCE($5, booking_settings.channel),
         updated_at = now()`,
      [
        tenantId,
        dto.notifyClientOnCreate ?? null,
        dto.reminderEnabled ?? null,
        dto.reminderHours ?? null,
        dto.channel ?? null,
      ],
    );
    return this.getSettings(tenantId);
  }

  private mapSettings(r: any) {
    return {
      notifyClientOnCreate: r.notify_client_on_create,
      reminderEnabled: r.reminder_enabled,
      reminderHours: r.reminder_hours,
      channel: r.channel,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────
  /** Human-friendly RU date+time for client messages, in Moscow time. */
  private formatWhen(iso: string): string {
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      });
    } catch {
      return iso;
    }
  }
}
