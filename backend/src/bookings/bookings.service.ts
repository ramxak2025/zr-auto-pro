import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { isTenantLess } from '../common/auth-cache';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { MarketingService } from '../marketing/marketing.service';
import { PushService } from '../push/push.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { UpdateBookingSettingsDto } from './dto/update-booking-settings.dto';
import { getTenantTimezone } from '../common/timezone';
import { actorPointId, assertRowPointForWrite } from '../common/point-scope';
import {
  bookingActor,
  bookingFingerprint,
  bookingTransaction,
  lockBookingResources,
  replayBooking,
  saveBookingReplay,
  managedBookingResource,
  assertBookingEmployee,
  assertBookingClient,
  assertBookingInterval,
} from './booking-reservations';
import { LinkBookingClientDto, validatedBookingDto } from './dto/public-booking.dto';

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
      clientId: r.client_id ?? null,
      publicRequestId: r.public_request_id ?? null,
      needsClientLink: !!r.public_request_id && !r.client_id,
      durationMinutes: r.duration_minutes ?? null,
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
      // 167 — филиал записи (null только у тенантов без филиалов).
      pointId: r.point_id ?? null,
    };
  }

  // Shared SELECT with the joins the list/detail responses need. Every query
  // that uses it MUST keep `b.tenant_id = $1` as the leading predicate.
  private readonly SELECT_BOOKING = `
    SELECT b.*,
           CASE WHEN pr.id IS NOT NULL THEN pr.contact_name ELSE cl.full_name END AS client_name,
           CASE WHEN pr.id IS NOT NULL THEN pr.contact_phone ELSE cl.phone END AS client_phone,
           ca.plate_number AS car_plate, ca.make_model AS car_make_model,
           u.full_name AS master_name,
           ch.number AS check_number
      FROM bookings b
      LEFT JOIN clients cl ON cl.id = b.client_id AND cl.tenant_id=b.tenant_id
      LEFT JOIN public_booking_requests pr ON pr.id=b.public_request_id AND pr.tenant_id=b.tenant_id
      LEFT JOIN cars ca ON ca.id = b.car_id
      LEFT JOIN users u ON u.id = b.master_id
      LEFT JOIN checks ch ON ch.id = b.check_id`;

  // ─── List ──────────────────────────────────────────────────────────
  /**
   * 167 — ЗАПИСИ ФИЛИАЛА: у записи есть СВОЙ point_id (штамп филиала сессии
   * при создании), список филиала — строгое равенство, как у денег
   * (common/point-scope). Раньше (161) филиал резолвился через назначения
   * мастера (user_points), а запись без мастера была видна ВЕЗДЕ: у тенанта,
   * не расставившего людей по филиалам, оба автосервиса показывали один и
   * тот же список записей. Историю без филиала миграция 167 отдала филиалу
   * чека (проведённые), живому назначению мастера, иначе основному сервису.
   */
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

    // Точка — всегда плейсхолдером; локальный idx общий с фильтрами ниже,
    // поэтому кладём вручную, а не через pointFilterSql (он нумерует по
    // params.length и разошёлся бы с idx).
    const bookingPointId = actorPointId(user);
    if (bookingPointId) {
      params.push(bookingPointId);
      sql += ` AND b.point_id = $${idx++}`;
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
  private async getOwnedRow(id: string, tenantId: string, client: Pick<PoolClient, 'query'> = this.pool): Promise<any> {
    const { rows } = await client.query(`${this.SELECT_BOOKING} WHERE b.tenant_id = $1 AND b.id = $2`, [tenantId, id]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Запись не найдена' });
    return rows[0];
  }

  // ─── Create ────────────────────────────────────────────────────────
  async create(user: JwtPayload, dto: CreateBookingDto) {
    const tenantId = user.tenantID,
      point = actorPointId(user);
    const fingerprint = bookingFingerprint({ operation: 'internal-create', actor: user.userID, point, dto });
    const result = await bookingTransaction(this.pool, tenantId, async (client) => {
      const fresh = await bookingActor(client, user);
      const replay = await replayBooking<
        ReturnType<BookingsService['mapRow']> & { conflictWarning: ReturnType<BookingsService['mapRow']> | null }
      >(client, tenantId, dto.requestId, fingerprint);
      if (replay !== undefined) return { response: replay, phone: null };
      const contact = await assertBookingClient(client, tenantId, point, dto.clientId);
      if (dto.carId) {
        const { rows } = await client.query('SELECT id FROM cars WHERE id=$1 AND tenant_id=$2 AND client_id=$3', [
          dto.carId,
          tenantId,
          dto.clientId,
        ]);
        if (!rows[0]) throw new BadRequestException({ message: 'Автомобиль не найден у этого клиента' });
      }
      if (!isOwnerClass(fresh) && dto.masterId && dto.masterId !== user.userID)
        throw new ForbiddenException({ message: 'Мастер может создавать запись только на себя' });
      const masterId = isOwnerClass(fresh) ? (dto.masterId ?? null) : user.userID;
      await lockBookingResources(client, tenantId, [masterId]);
      const managed = await managedBookingResource(client, tenantId, masterId);
      if (masterId) await assertBookingEmployee(client, tenantId, point, masterId, managed || !isOwnerClass(fresh));
      if (masterId && managed)
        await assertBookingInterval(client, tenantId, masterId, dto.scheduledAt, dto.durationMinutes ?? 90);
      const conflictWarning =
        masterId && !managed ? await this.findConflict(tenantId, masterId, dto.scheduledAt, null, client) : null;
      const { rows } = await client.query(
        `INSERT INTO bookings (tenant_id, client_id, car_id, master_id, created_by, scheduled_at, comment, notify_on_create, point_id,duration_minutes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          tenantId,
          dto.clientId,
          dto.carId ?? null,
          masterId,
          user.userID,
          dto.scheduledAt,
          dto.comment ?? null,
          dto.notifyOnCreate ?? true,
          actorPointId(user),
          dto.durationMinutes ?? (managed ? 90 : null),
        ],
      );
      const response = { ...this.mapRow(await this.getOwnedRow(rows[0].id, tenantId, client)), conflictWarning };
      await saveBookingReplay(client, tenantId, point, user.userID, dto.requestId, fingerprint, response);
      return { response, phone: contact.phone };
    });
    if (result.phone !== null) {
      if (dto.notifyOnCreate !== false && (await this.getSettings(tenantId)).notifyClientOnCreate) {
        const message = `Вы записаны на ${this.formatWhen(dto.scheduledAt, await getTenantTimezone(this.pool, tenantId))}. Ждём вас!`;
        void this.marketingService
          .sendClientMessage(tenantId, result.phone, message, {
            clientId: dto.clientId,
            messageType: 'booking',
            dedupKey: `booking_confirm:${result.response.id}`,
          })
          .catch(() => this.logger.warn('Booking confirmation send failed'));
      }
      void this.pushService
        .sendDataToTenant(tenantId, user.userID, { type: 'booking-created', tenantId })
        .catch(() => undefined);
    }
    return result.response;
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
    client: Pick<PoolClient, 'query'> = this.pool,
  ): Promise<ReturnType<BookingsService['mapRow']> | null> {
    const { rows } = await client.query(
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
  /** Гейт записи по филиалу (167): запись чужого филиала правится как несуществующая. */

  async update(user: JwtPayload, id: string, dto: UpdateBookingDto) {
    const tenantId = user.tenantID,
      point = actorPointId(user),
      fingerprint = bookingFingerprint({ operation: 'internal-update', actor: user.userID, point, id, dto });
    return bookingTransaction(this.pool, tenantId, async (client) => {
      const fresh = await bookingActor(client, user);
      await assertRowPointForWrite(client, 'bookings', id, tenantId, point, 'Запись не найдена');
      const row = await this.getOwnedRow(id, tenantId, client);
      if (!isOwnerClass(fresh) && row.master_id !== user.userID)
        throw new ForbiddenException({ message: 'Можно изменять только свои записи' });
      const replay = await replayBooking<
        ReturnType<BookingsService['mapRow']> & { conflictWarning: ReturnType<BookingsService['mapRow']> | null }
      >(client, tenantId, dto.requestId, fingerprint);
      if (replay !== undefined) return replay;
      if (row.status !== 'scheduled')
        throw new BadRequestException({ message: 'Нельзя изменить — запись уже проведена или отменена' });
      let masterId: string | null = row.master_id;
      if (dto.masterId !== undefined) {
        if (!isOwnerClass(fresh) && dto.masterId && dto.masterId !== user.userID)
          throw new ForbiddenException({ message: 'Мастер не может переназначить запись на другого' });
        masterId = isOwnerClass(fresh) ? dto.masterId : user.userID;
      }
      if (row.public_request_id && !masterId)
        throw new BadRequestException({ message: 'Публичная бронь должна иметь исполнителя' });
      await lockBookingResources(client, tenantId, [row.master_id, masterId]);
      const managed = !!row.public_request_id || (await managedBookingResource(client, tenantId, masterId)),
        scheduledAt = dto.scheduledAt ?? row.scheduled_at;
      const duration = dto.durationMinutes ?? row.duration_minutes ?? 90;
      if (
        masterId &&
        (dto.masterId !== undefined || dto.scheduledAt !== undefined || dto.durationMinutes !== undefined)
      )
        await assertBookingEmployee(client, tenantId, point, masterId, managed);
      if (masterId && managed) await assertBookingInterval(client, tenantId, masterId, scheduledAt, duration, id);
      const carId = dto.carId !== undefined ? dto.carId : row.car_id;
      if (carId) {
        const { rows } = await client.query('SELECT id FROM cars WHERE id=$1 AND tenant_id=$2 AND client_id=$3', [
          carId,
          tenantId,
          row.client_id,
        ]);
        if (!rows[0]) throw new BadRequestException({ message: 'Автомобиль не найден у этого клиента' });
      }
      await client.query(
        `UPDATE bookings SET scheduled_at=$1,comment=$2,master_id=$3,car_id=$4,duration_minutes=$5
        WHERE id=$6 AND tenant_id=$7 AND status='scheduled'`,
        [
          scheduledAt,
          dto.comment ?? row.comment,
          masterId,
          carId,
          dto.durationMinutes ?? row.duration_minutes ?? (managed ? 90 : null),
          id,
          tenantId,
        ],
      );
      if (row.public_request_id)
        await client.query('UPDATE public_booking_requests SET resource_id=$1 WHERE id=$2 AND tenant_id=$3', [
          masterId,
          row.public_request_id,
          tenantId,
        ]);
      const conflictWarning =
        masterId && !managed ? await this.findConflict(tenantId, masterId, scheduledAt, id, client) : null;
      const response = { ...this.mapRow(await this.getOwnedRow(id, tenantId, client)), conflictWarning };
      await saveBookingReplay(client, tenantId, point, user.userID, dto.requestId, fingerprint, response);
      return response;
    });
  }

  async cancel(user: JwtPayload, id: string, requestId?: string) {
    return this.finishBooking(user, id, 'cancel', requestId);
  }
  async convert(user: JwtPayload, id: string, checkId: string, requestId?: string) {
    return this.finishBooking(user, id, 'convert', requestId, checkId);
  }
  private async finishBooking(
    user: JwtPayload,
    id: string,
    operation: 'cancel' | 'convert',
    requestId?: string,
    checkId?: string,
  ) {
    const tenantId = user.tenantID,
      point = actorPointId(user),
      fingerprint = bookingFingerprint({ operation, actor: user.userID, point, id, checkId });
    return bookingTransaction(this.pool, tenantId, async (client) => {
      const fresh = await bookingActor(client, user);
      await assertRowPointForWrite(client, 'bookings', id, tenantId, point, 'Запись не найдена');
      const row = await this.getOwnedRow(id, tenantId, client);
      if (!isOwnerClass(fresh) && row.master_id !== user.userID)
        throw new ForbiddenException({ message: 'Можно изменять только свои записи' });
      const replay = await replayBooking<ReturnType<BookingsService['mapRow']>>(
        client,
        tenantId,
        requestId,
        fingerprint,
      );
      if (replay !== undefined) return replay;
      await lockBookingResources(client, tenantId, [row.master_id]);
      if (row.status !== 'scheduled') throw new BadRequestException({ message: 'Запись уже проведена или отменена' });
      if (operation === 'convert') {
        if (!row.client_id)
          throw new ConflictException({
            code: 'BOOKING_CLIENT_LINK_REQUIRED',
            message: 'Сначала свяжите запись с доступной карточкой клиента',
          });
        await assertBookingClient(client, tenantId, point, row.client_id);
        const { rows } = await client.query(
          `SELECT id FROM checks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL
          AND point_id IS NOT DISTINCT FROM $3::uuid AND client_id=$4`,
          [checkId, tenantId, point, row.client_id],
        );
        if (!rows[0]) throw new BadRequestException({ message: 'Чек этого клиента не найден в текущем филиале' });
        await client.query(
          "UPDATE bookings SET status='converted',check_id=$1 WHERE id=$2 AND tenant_id=$3 AND status='scheduled' AND check_id IS NULL",
          [checkId, id, tenantId],
        );
      } else
        await client.query(
          "UPDATE bookings SET status='cancelled',cancelled_at=now(),cancelled_by=$1 WHERE id=$2 AND tenant_id=$3 AND status='scheduled'",
          [user.userID, id, tenantId],
        );
      const response = this.mapRow(await this.getOwnedRow(id, tenantId, client));
      await saveBookingReplay(client, tenantId, point, user.userID, requestId, fingerprint, response);
      return response;
    });
  }
  async linkClient(user: JwtPayload, id: string, input: LinkBookingClientDto) {
    const dto = validatedBookingDto(LinkBookingClientDto, input),
      tenant = user.tenantID,
      point = actorPointId(user);
    const fingerprint = bookingFingerprint({ operation: 'link-client', actor: user.userID, point, id, dto });
    return bookingTransaction(this.pool, tenant, async (client) => {
      const fresh = await bookingActor(client, user);
      await assertRowPointForWrite(client, 'bookings', id, tenant, point, 'Запись не найдена');
      const row = await this.getOwnedRow(id, tenant, client);
      if (!isOwnerClass(fresh) && row.master_id !== user.userID)
        throw new ForbiddenException({ message: 'Можно изменять только свои записи' });
      const replay = await replayBooking<ReturnType<BookingsService['mapRow']>>(
        client,
        tenant,
        dto.requestId,
        fingerprint,
      );
      if (replay !== undefined) return replay;
      if (!row.public_request_id || row.client_id || row.status !== 'scheduled')
        throw new ConflictException({
          code: 'BOOKING_CLIENT_LINK_UNAVAILABLE',
          message: 'Связь уже определена или запись обработана',
        });
      await assertBookingClient(client, tenant, point, dto.clientId);
      await client.query('UPDATE bookings SET client_id=$1 WHERE id=$2 AND tenant_id=$3', [dto.clientId, id, tenant]);
      const response = this.mapRow(await this.getOwnedRow(id, tenant, client));
      await saveBookingReplay(client, tenant, point, user.userID, dto.requestId, fingerprint, response);
      return response;
    });
  }

  // ─── Settings (lazy-create defaults) ───────────────────────────────
  async getSettings(tenantId: string) {
    // Tenant-less caller (superadmin, nil-UUID sentinel): return the column
    // defaults WITHOUT seeding — the lazy-create below would FK-violate
    // booking_settings_tenant_id_fkey (no such tenant) → 500 on GET
    // /bookings/settings. Shape mirrors a fresh row (076 defaults; безопасные
    // дефолты false с миграции 141 — новый тенант не шлёт SMS, пока не включил).
    if (isTenantLess(tenantId)) {
      return { notifyClientOnCreate: false, reminderEnabled: false, reminderHours: 2, channel: 'auto' };
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
       VALUES ($1, COALESCE($2, false), COALESCE($3, false), COALESCE($4, 2), COALESCE($5, 'auto'))
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
  /**
   * Дата+время записи для SMS клиенту — в поясе АВТОСЕРВИСА. Клиент приезжает
   * по местным часам, и раньше жителю Владивостока приходило «запись на 05:00»
   * вместо 12:00.
   */
  private formatWhen(iso: string, tz: string): string {
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: tz,
      });
    } catch {
      return iso;
    }
  }
}
