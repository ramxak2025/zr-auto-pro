import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId } from '../common/point-scope';
import { runWithTenant } from '../common/tenant-context';
import { normalizePhone, phoneSearchKey } from '../common/normalize-phone';
import { userHasPermission } from '../common/guards/permissions.guard';
import { mergeEffectivePermissions } from '../common/role-matrix';
import { MarketingService } from '../marketing/marketing.service';
import { PushService } from '../push/push.service';
import {
  bookingActor,
  bookingFingerprint,
  bookingHash,
  bookingOwner,
  bookingTransaction,
  bookingUuid,
  lockBookingResources,
  replayBooking,
  saveBookingReplay,
  slotUnavailable,
} from './booking-reservations';
import {
  ApprovePublicBookingDto,
  BookingOperationDto,
  PublicBookingSettingsDto,
  PublicBookingSubmitDto,
  validatedBookingDto,
} from './dto/public-booking.dto';
import {
  BookingPageRow,
  bookingDate,
  bookingSettings,
  dateForBooking,
  pageAvailability,
  pageResources,
  resourceAvailable,
} from './public-booking-calendar';
import { buildPublicBookingLegalDocuments, type BookingLegalTenant } from './public-booking-legal';

export interface SelectedService {
  serviceId: string;
  name: string;
  durationMinutes: number;
}
interface PublicTenantProfile extends BookingLegalTenant {}
interface RequestRow {
  id: string;
  tenant_id: string;
  point_id: string | null;
  page_id: string;
  request_id: string;
  capability_hash: string;
  contact_name: string;
  contact_phone: string;
  comment: string;
  selected_services: SelectedService[];
  duration_minutes: number;
  starts_at: Date;
  resource_id: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  consent_version: string;
  created_at: Date;
  booking_id?: string | null;
  booking_status?: string | null;
  booking_start?: Date | null;
  booking_duration?: number | null;
  client_id?: string | null;
}
export interface PublicBookingReceipt {
  requestId: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  startsAt: string;
  endsAt: string;
  services: SelectedService[];
}
const requestSelect = `SELECT r.*,b.id AS booking_id,b.status AS booking_status,b.client_id,
  b.scheduled_at AS booking_start,b.duration_minutes AS booking_duration FROM public_booking_requests r
  LEFT JOIN bookings b ON b.public_request_id=r.id AND b.tenant_id=r.tenant_id`;
const unavailable = () =>
  new NotFoundException({
    code: 'BOOKING_DISABLED',
    message: 'Онлайн-запись сейчас недоступна. Свяжитесь с автосервисом.',
  });

@Injectable()
export class PublicBookingsService {
  private readonly logger = new Logger(PublicBookingsService.name);
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly marketing: MarketingService,
    private readonly push: PushService,
  ) {}

  private async pageForActor(client: Pick<PoolClient, 'query'>, actor: JwtPayload) {
    return (
      await client.query<BookingPageRow>(
        'SELECT * FROM public_booking_pages WHERE tenant_id=$1 AND point_id IS NOT DISTINCT FROM $2::uuid',
        [actor.tenantID, actorPointId(actor)],
      )
    ).rows[0];
  }
  private async settingsResponse(client: Pick<PoolClient, 'query'>, page: BookingPageRow) {
    const [services, resources, legal] = await Promise.all([
      client.query<{ service_id: string; duration_minutes: number }>(
        'SELECT service_id,duration_minutes FROM public_booking_services WHERE tenant_id=$1 AND page_id=$2 ORDER BY service_id',
        [page.tenant_id, page.id],
      ),
      client.query<{ user_id: string }>(
        'SELECT user_id FROM public_booking_resources WHERE tenant_id=$1 AND page_id=$2 ORDER BY user_id',
        [page.tenant_id, page.id],
      ),
      this.legalDocuments(client, page),
    ]);
    return {
      id: page.id,
      pointId: page.point_id,
      slug: page.slug,
      publicCode: page.public_code,
      publicUrl: `https://autexa.pw/${page.public_code}`,
      published: page.published,
      revision: page.revision,
      ...page.settings,
      ...legal,
      services: services.rows.map((s) => ({ serviceId: s.service_id, durationMinutes: s.duration_minutes })),
      resourceIds: resources.rows.map((r) => r.user_id),
    };
  }
  private async legalDocuments(
    client: Pick<PoolClient, 'query'>,
    page: Pick<BookingPageRow, 'tenant_id' | 'settings'>,
  ) {
    const { rows } = await client.query<PublicTenantProfile>(
      'SELECT name,legal_name,inn,address,phone,email FROM tenants WHERE id=$1',
      [page.tenant_id],
    );
    if (!rows[0]) throw unavailable();
    return buildPublicBookingLegalDocuments({
      tenant: rows[0],
      pageAddress: page.settings.address,
      pageContacts: page.settings.contacts,
      links: page.settings.links,
    });
  }
  async getSettings(actor: JwtPayload) {
    await bookingActor(this.pool, actor, 'company_manage');
    const page = await this.pageForActor(this.pool, actor);
    return page ? this.settingsResponse(this.pool, page) : null;
  }
  async resources(actor: JwtPayload) {
    await bookingActor(this.pool, actor, 'company_manage');
    const { rows } = await this.pool.query<{ id: string; full_name: string; role: string }>(
      `SELECT id,full_name,role FROM users WHERE tenant_id=$1
      AND is_active AND dismissed_at IS NULL AND purged_at IS NULL AND role NOT IN ('manager','superadmin')
      AND ($2::uuid IS NULL OR autexa_point_is_allowed(tenant_id,id,$2::uuid)) ORDER BY full_name,id`,
      [actor.tenantID, actorPointId(actor)],
    );
    return rows.map((r) => ({ id: r.id, name: r.full_name, role: r.role }));
  }
  async publicServices(actor: JwtPayload, query: { page?: unknown; limit?: unknown } = {}) {
    await bookingActor(this.pool, actor, 'company_manage');
    const parsePositiveInteger = (value: unknown, fallback: number, field: string) => {
      if (value === undefined) return fallback;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw new BadRequestException({ message: `Параметр ${field} должен быть положительным целым числом` });
      return parsed;
    };
    const page = parsePositiveInteger(query.page, 1, 'page');
    const limit = Math.min(500, parsePositiveInteger(query.limit, 100, 'limit'));
    const [{ rows: countRows }, { rows }] = await Promise.all([
      this.pool.query<{ total: string }>('SELECT COUNT(*) AS total FROM services WHERE tenant_id=$1', [actor.tenantID]),
      this.pool.query<{ id: string; name: string; category: string | null }>(
        `SELECT id,name,category FROM services WHERE tenant_id=$1 ORDER BY name,id LIMIT $2 OFFSET $3`,
        [actor.tenantID, limit, (page - 1) * limit],
      ),
    ]);
    return { data: rows, total: Number(countRows[0]?.total ?? 0), page, limit };
  }
  async putSettings(actor: JwtPayload, input: PublicBookingSettingsDto) {
    const dto = validatedBookingDto(PublicBookingSettingsDto, input),
      settings = bookingSettings(dto);
    const fingerprint = bookingFingerprint({
      operation: 'settings',
      actor: actor.userID,
      point: actorPointId(actor),
      dto,
    });
    return bookingTransaction(this.pool, actor.tenantID, async (client) => {
      await bookingActor(client, actor, 'company_manage');
      const replay = await replayBooking<Awaited<ReturnType<PublicBookingsService['settingsResponse']>>>(
        client,
        actor.tenantID,
        dto.requestId,
        fingerprint,
      );
      if (replay !== undefined) return replay;
      const previous = await this.pageForActor(client, actor);
      if (dto.revision !== (previous?.revision ?? 0))
        throw new ConflictException({ code: 'SETTINGS_CHANGED', message: 'Настройки изменились. Обновите страницу.' });
      if (previous && dto.slug !== undefined && previous.slug !== dto.slug)
        throw new BadRequestException({ message: 'Адрес созданной страницы сохраняется для восстановления заявок' });
      const slug = previous?.slug ?? dto.slug ?? `booking-${randomBytes(8).toString('hex')}`;
      const legal = await this.legalDocuments(client, { tenant_id: actor.tenantID, settings });
      const persistedSettings = { ...settings, ...legal };
      const resourceIds = [...new Set(dto.resourceIds)].sort();
      const existingResources = previous
        ? await client.query<{ user_id: string; resource_key: string }>(
            'SELECT user_id,resource_key FROM public_booking_resources WHERE tenant_id=$1 AND page_id=$2 ORDER BY user_id',
            [actor.tenantID, previous.id],
          )
        : { rows: [] as Array<{ user_id: string; resource_key: string }> };
      await lockBookingResources(client, actor.tenantID, [
        ...existingResources.rows.map((resource) => resource.user_id),
        ...resourceIds,
      ]);
      const available = (
        await client.query<{ id: string }>(
          `SELECT id FROM users WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND is_active
        AND dismissed_at IS NULL AND purged_at IS NULL AND role NOT IN ('manager','superadmin')
        AND ($3::uuid IS NULL OR autexa_point_is_allowed(tenant_id,id,$3::uuid))`,
          [actor.tenantID, resourceIds, actorPointId(actor)],
        )
      ).rows;
      if (available.length !== resourceIds.length)
        throw new BadRequestException({
          code: 'RESOURCE_UNAVAILABLE',
          message: 'Один из сотрудников недоступен в текущем филиале',
        });
      const serviceIds = dto.services.map((s) => s.serviceId);
      if (new Set(serviceIds).size !== serviceIds.length)
        throw new BadRequestException({ message: 'Услуга выбрана повторно' });
      const services = (
        await client.query('SELECT id FROM services WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [
          actor.tenantID,
          serviceIds,
        ])
      ).rows;
      if (services.length !== serviceIds.length) throw new BadRequestException({ message: 'Услуга не найдена' });
      if (previous?.published) this.assertPublishable(persistedSettings, resourceIds.length, serviceIds.length);
      const version = legal.consentVersion;
      const { rows } = previous
        ? await client.query<BookingPageRow>(
            `UPDATE public_booking_pages SET settings=$1::jsonb,consent_version=$2,
            revision=revision+1,updated_at=now() WHERE id=$3 AND tenant_id=$4 RETURNING *`,
            [JSON.stringify(persistedSettings), version, previous.id, actor.tenantID],
          )
        : await client.query<BookingPageRow>(
            `INSERT INTO public_booking_pages(tenant_id,point_id,slug,public_code,settings,consent_version)
            VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(slug) DO NOTHING RETURNING *`,
            [
              actor.tenantID,
              actorPointId(actor),
              slug,
              randomBytes(16).toString('hex'),
              JSON.stringify(persistedSettings),
              version,
            ],
          );
      const page = rows[0];
      if (!page) throw new ConflictException({ code: 'SLUG_TAKEN', message: 'Этот адрес уже занят' });
      await client.query('DELETE FROM public_booking_services WHERE tenant_id=$1 AND page_id=$2', [
        actor.tenantID,
        page.id,
      ]);
      await client.query(
        'DELETE FROM public_booking_resources WHERE tenant_id=$1 AND page_id=$2 AND NOT (user_id=ANY($3::uuid[]))',
        [actor.tenantID, page.id, resourceIds],
      );
      for (const s of dto.services)
        await client.query(
          'INSERT INTO public_booking_services(tenant_id,page_id,service_id,duration_minutes) VALUES($1,$2,$3,$4)',
          [actor.tenantID, page.id, s.serviceId, s.durationMinutes ?? 90],
        );
      const existingResourceIds = new Set(existingResources.rows.map((resource) => resource.user_id));
      for (const id of resourceIds) {
        if (existingResourceIds.has(id)) continue;
        await client.query(
          'INSERT INTO public_booking_resources(tenant_id,page_id,user_id,resource_key) VALUES($1,$2,$3,$4)',
          [actor.tenantID, page.id, id, randomBytes(16).toString('hex')],
        );
      }
      const response = await this.settingsResponse(client, page);
      await saveBookingReplay(
        client,
        actor.tenantID,
        actorPointId(actor),
        actor.userID,
        dto.requestId,
        fingerprint,
        response,
      );
      return response;
    });
  }
  private assertPublishable(settings: BookingPageRow['settings'], resources: number, services: number) {
    if (
      !settings.displayName ||
      !settings.address ||
      !settings.contacts ||
      !settings.operator.name ||
      !settings.operator.requisites ||
      !settings.operator.contact ||
      !settings.policyText ||
      !settings.consentText ||
      !resources ||
      !services ||
      !Object.values(settings.openingHours).some(Boolean)
    )
      throw new BadRequestException({
        code: 'PUBLICATION_INCOMPLETE',
        message:
          'Для публикации заполните контакты, данные оператора, политику, отдельное согласие, услуги, сотрудников и часы работы',
      });
  }
  async publish(actor: JwtPayload, input: BookingOperationDto, published: boolean) {
    const dto = validatedBookingDto(BookingOperationDto, input),
      fingerprint = bookingFingerprint({
        operation: published ? 'publish' : 'unpublish',
        actor: actor.userID,
        point: actorPointId(actor),
        dto,
      });
    return bookingTransaction(this.pool, actor.tenantID, async (client) => {
      await bookingActor(client, actor, 'company_manage');
      const replay = await replayBooking<Awaited<ReturnType<PublicBookingsService['settingsResponse']>>>(
        client,
        actor.tenantID,
        dto.requestId,
        fingerprint,
      );
      if (replay !== undefined) return replay;
      const page = await this.pageForActor(client, actor);
      if (!page) throw new NotFoundException({ message: 'Сначала сохраните настройки' });
      const resources = await pageResources(client, page);
      await lockBookingResources(
        client,
        actor.tenantID,
        resources.map((r) => r.id),
      );
      const current = await pageResources(client, page),
        settings = await this.settingsResponse(client, page);
      const legal = await this.legalDocuments(client, page);
      if (published) this.assertPublishable({ ...page.settings, ...legal }, current.length, settings.services.length);
      const { rows } = await client.query<BookingPageRow>(
        'UPDATE public_booking_pages SET published=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING *',
        [published, page.id, actor.tenantID],
      );
      const response = await this.settingsResponse(client, rows[0]);
      await saveBookingReplay(
        client,
        actor.tenantID,
        actorPointId(actor),
        actor.userID,
        dto.requestId,
        fingerprint,
        response,
      );
      return response;
    });
  }
  /** The only unscoped read is this bounded public routing locator. All page,
   * client, calendar and request access runs in the resolved tenant's RLS pool. */
  private async locate(slug: string): Promise<{ id: string; tenant_id: string }> {
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) throw unavailable();
    return runWithTenant('', async () => {
      const { rows } = await this.pool.query<{ id: string; tenant_id: string }>(
        'SELECT id,tenant_id FROM public_booking_pages WHERE slug=$1',
        [slug],
      );
      if (!rows[0]) throw unavailable();
      return rows[0];
    });
  }
  private async locateByCode(code: string): Promise<{ id: string; tenant_id: string; slug: string }> {
    if (!/^[a-f0-9]{32}$/.test(code)) throw unavailable();
    return runWithTenant('', async () => {
      const { rows } = await this.pool.query<{ id: string; tenant_id: string; slug: string }>(
        'SELECT id,tenant_id,slug FROM public_booking_pages WHERE public_code=$1',
        [code],
      );
      if (!rows[0]) throw unavailable();
      return rows[0];
    });
  }
  private async readPage(client: Pick<PoolClient, 'query'>, tenant: string, id: string, lock = false) {
    const { rows } = await client.query<BookingPageRow & { enabled: boolean; timezone: string; server_at: Date }>(
      `SELECT p.*,t.timezone,clock_timestamp() AS server_at,t.is_active AND (t.subscription_end IS NULL OR t.subscription_end>clock_timestamp())
      AND (CASE WHEN p.point_id IS NULL THEN NOT EXISTS(SELECT 1 FROM tenant_points tp WHERE tp.tenant_id=p.tenant_id AND tp.is_active)
        ELSE EXISTS(SELECT 1 FROM tenant_points tp WHERE tp.id=p.point_id AND tp.tenant_id=p.tenant_id AND tp.is_active) END) AS enabled
      FROM public_booking_pages p JOIN tenants t ON t.id=p.tenant_id WHERE p.id=$1 AND p.tenant_id=$2 ${lock ? 'FOR SHARE OF p,t' : ''}`,
      [id, tenant],
    );
    if (!rows[0] || !rows[0].enabled || !rows[0].published) throw unavailable();
    if (lock && rows[0].point_id) {
      const point = await client.query(
        'SELECT id FROM tenant_points WHERE id=$1 AND tenant_id=$2 AND is_active FOR SHARE',
        [rows[0].point_id, tenant],
      );
      if (!point.rows[0]) throw unavailable();
    }
    return rows[0];
  }
  async landing(slug: string) {
    const locator = await this.locate(slug);
    return runWithTenant(locator.tenant_id, async () => {
      const page = await this.readPage(this.pool, locator.tenant_id, locator.id),
        s = page.settings;
      const { rows } = await this.pool.query<{
        id: string;
        name: string;
        category: string | null;
        default_price: string;
        price_type: 'fixed' | 'range';
        min_price: string | null;
        max_price: string | null;
        duration_minutes: number;
      }>(
        `SELECT s.id,s.name,s.category,s.default_price,s.price_type,s.min_price,s.max_price,ps.duration_minutes
        FROM public_booking_services ps JOIN services s ON s.id=ps.service_id AND s.tenant_id=ps.tenant_id WHERE ps.page_id=$1 AND ps.tenant_id=$2 ORDER BY s.name,s.id`,
        [page.id, page.tenant_id],
      );
      const [resources, legal] = await Promise.all([
        pageResources(this.pool, page),
        this.legalDocuments(this.pool, page),
      ]);
      // Explicit projection: no internal settings, resource IDs or stale cached
      // price-bearing response can enter this public shape.
      return {
        slug: page.slug,
        timezone: page.timezone,
        serverAt: page.server_at.toISOString(),
        displayName: s.displayName,
        address: s.address,
        contacts: s.contacts,
        links: s.links,
        resources: resources.map((resource) => ({ resourceKey: resource.resource_key, name: resource.full_name })),
        mode: s.mode,
        showPrices: s.showPrices,
        operator: legal.operator,
        policyText: legal.policyText,
        consentText: legal.consentText,
        consentVersion: legal.consentVersion,
        services: rows.map((r) => ({
          id: r.id,
          name: r.name,
          ...(r.category ? { category: r.category } : {}),
          durationMinutes: r.duration_minutes,
          ...(s.showPrices
            ? r.price_type === 'range'
              ? {
                  priceType: 'range' as const,
                  ...(r.min_price !== null ? { minPrice: Number(r.min_price) } : {}),
                  ...(r.max_price !== null ? { maxPrice: Number(r.max_price) } : {}),
                }
              : { priceType: 'fixed' as const, price: Number(r.default_price) }
            : {}),
        })),
      };
    });
  }
  /** Resolve only the immutable routing identity. Landing/availability gates
   * are evaluated on the canonical slug route, while historical recovery keeps
   * working after publication is withdrawn or a subscription expires. */
  async landingByCode(code: string) {
    const locator = await this.locateByCode(code);
    return { slug: locator.slug };
  }
  private async selected(client: PoolClient, page: BookingPageRow, ids: string[], lock = false) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
      throw new BadRequestException({ message: 'Выберите услуги' });
    ids.forEach(bookingUuid);
    const { rows } = await client.query<{ service_id: string; name: string; duration_minutes: number }>(
      `SELECT ps.service_id,s.name,ps.duration_minutes FROM public_booking_services ps
      JOIN services s ON s.id=ps.service_id AND s.tenant_id=ps.tenant_id WHERE ps.page_id=$1 AND ps.tenant_id=$2 AND ps.service_id=ANY($3::uuid[]) ORDER BY ps.service_id ${lock ? 'FOR SHARE OF s' : ''}`,
      [page.id, page.tenant_id, ids],
    );
    if (rows.length !== ids.length)
      throw new ConflictException({ code: 'SERVICES_CHANGED', message: 'Список услуг изменился. Обновите страницу.' });
    const duration = rows.reduce((sum, r) => sum + r.duration_minutes, 0);
    if (duration > 1440) throw new BadRequestException({ message: 'Общая длительность не может превышать сутки' });
    return {
      duration,
      services: rows.map((r) => ({ serviceId: r.service_id, name: r.name, durationMinutes: r.duration_minutes })),
    };
  }
  async slots(
    slug: string,
    query: { from?: string; to?: string; serviceIds?: string; after?: string; resourceKey?: string },
  ) {
    const from = bookingDate(query.from),
      to = bookingDate(query.to);
    if (
      typeof query.serviceIds !== 'string' ||
      (query.after !== undefined && typeof query.after !== 'string') ||
      (query.resourceKey !== undefined &&
        (typeof query.resourceKey !== 'string' || !/^[a-f0-9]{32}$/.test(query.resourceKey)))
    )
      throw new BadRequestException({ message: 'Некорректные параметры времени и услуг' });
    if (from > to || Date.parse(to) - Date.parse(from) > 30 * 86400000)
      throw new BadRequestException({ message: 'Выберите диапазон до31 дней' });
    const locator = await this.locate(slug);
    return runWithTenant(locator.tenant_id, async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const page = await this.readPage(client, locator.tenant_id, locator.id),
          selection = await this.selected(client, page, (query.serviceIds ?? '').split(',')),
          allResources = await pageResources(client, page);
        const requestedResource = query.resourceKey
          ? allResources.find((resource) => resource.resource_key === query.resourceKey)
          : undefined;
        if (query.resourceKey && !requestedResource)
          throw new ConflictException({ code: 'RESOURCE_UNAVAILABLE', message: 'Выбранный мастер недоступен' });
        const resources = requestedResource ? [requestedResource] : allResources;
        const availability = await pageAvailability(client, page, resources, from, to);
        const after = query.after ? Date.parse(query.after) : Number.NEGATIVE_INFINITY;
        if (Number.isNaN(after)) throw new BadRequestException({ message: 'Некорректный курсор времени' });
        const times = new Set<number>(),
          step = page.settings.slotStepMinutes * 60000;
        for (const window of availability.windows) {
          for (
            let start = window.gridStart + Math.ceil((window.start - window.gridStart) / step) * step;
            start + selection.duration * 60000 <= window.end;
            start += step
          ) {
            const date = dateForBooking(new Date(start), availability.timezone);
            if (
              date < from ||
              date > to ||
              start <= after ||
              !resourceAvailable(availability, page, window.resourceId, start, selection.duration)
            )
              continue;
            times.add(start);
          }
        }
        const sorted = [...times].sort((a, b) => a - b),
          limited = sorted.slice(0, 1000);
        await client.query('COMMIT');
        return {
          timezone: availability.timezone,
          serverAt: availability.now.toISOString(),
          slots: limited.map((start) => ({
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(start + selection.duration * 60000).toISOString(),
          })),
          nextAfter: sorted.length > 1000 ? new Date(limited[limited.length - 1]).toISOString() : null,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }
  private async chooseResource(
    client: PoolClient,
    page: BookingPageRow,
    start: Date,
    duration: number,
    requested?: string,
  ) {
    const candidates = await pageResources(client, page);
    await lockBookingResources(
      client,
      page.tenant_id,
      candidates.map((r) => r.id),
    );
    const resources = await pageResources(client, page);
    await this.readPage(client, page.tenant_id, page.id, true); // Subscription clock and point state after any resource wait.
    const {
      rows: [{ timezone }],
    } = await client.query<{ timezone: string }>('SELECT timezone FROM tenants WHERE id=$1', [page.tenant_id]);
    const date = dateForBooking(start, timezone),
      availability = await pageAvailability(client, page, resources, date, date, true);
    const resource = resources.find(
      (r) =>
        (!requested || r.id === requested) && resourceAvailable(availability, page, r.id, start.getTime(), duration),
    );
    if (!resource) throw slotUnavailable();
    return resource.id;
  }
  private receipt(row: RequestRow): PublicBookingReceipt {
    const start = row.booking_start ?? row.starts_at,
      duration = row.booking_duration ?? row.duration_minutes;
    return {
      requestId: row.request_id,
      status:
        row.booking_status === 'cancelled' || (row.status === 'confirmed' && row.booking_id === null)
          ? 'cancelled'
          : row.status,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + duration * 60000).toISOString(),
      services: row.selected_services,
    };
  }
  /** Never call ClientsService.create here: its staff-only duplicate response
   * can disclose an existing card. A cross-point duplicate stays unlinked. */
  private async resolveClient(client: PoolClient, row: RequestRow): Promise<string | null> {
    const key = phoneSearchKey(row.contact_phone);
    const find = () =>
      client.query<{ id: string; point_id: string | null; shared: boolean }>(
        `SELECT c.id,c.point_id,t.points_shared_clients AS shared FROM clients c JOIN tenants t ON t.id=c.tenant_id
      WHERE c.tenant_id=$1 AND right(regexp_replace(c.phone,'[^0-9]','','g'),10)=$2 ORDER BY c.created_at,c.id LIMIT 1`,
        [row.tenant_id, key],
      );
    let match = (await find()).rows[0];
    if (!match) {
      await client.query(
        `INSERT INTO clients(tenant_id,point_id,full_name,phone,source) SELECT id,
        CASE WHEN points_shared_clients=false THEN $2::uuid ELSE NULL END,$3,$4,'public-booking' FROM tenants WHERE id=$1 ON CONFLICT DO NOTHING`,
        [row.tenant_id, row.point_id, row.contact_name, row.contact_phone],
      );
      match = (await find()).rows[0];
    }
    if (!match)
      throw new ConflictException({ message: 'Не удалось сохранить контакт. Повторите запрос с прежним UUID.' });
    return match.shared === false && row.point_id !== null && match.point_id !== null && match.point_id !== row.point_id
      ? null
      : match.id;
  }
  private async reserve(client: PoolClient, row: RequestRow, actorId: string | null) {
    const clientId = await this.resolveClient(client, row);
    await client.query(
      `INSERT INTO bookings(tenant_id,point_id,client_id,master_id,created_by,scheduled_at,duration_minutes,comment,public_request_id,notify_on_create)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [
        row.tenant_id,
        row.point_id,
        clientId,
        row.resource_id,
        actorId,
        row.starts_at,
        row.duration_minutes,
        row.comment,
        row.id,
      ],
    );
  }
  async submit(slug: string, input: PublicBookingSubmitDto) {
    const dto = validatedBookingDto(PublicBookingSubmitDto, input),
      phone = normalizePhone(dto.phone),
      name = dto.name.trim(),
      start = new Date(dto.startsAt);
    if (
      !name ||
      !/^\+\d{10,15}$/.test(phone) ||
      !Number.isFinite(start.getTime()) ||
      !/(?:Z|[+-]\d\d:\d\d)$/.test(dto.startsAt)
    )
      throw new BadRequestException({ code: 'INVALID_REQUEST', message: 'Проверьте имя, телефон и время' });
    const locator = await this.locate(slug),
      capability = bookingHash(dto.recoveryToken);
    const fingerprint = bookingFingerprint({
      operation: 'public-submit',
      slug,
      dto: { ...dto, recoveryToken: capability },
    });
    return runWithTenant(locator.tenant_id, async () => {
      const result = await bookingTransaction(this.pool, locator.tenant_id, async (client) => {
        // Replay is historical acknowledgement, not a fresh reservation. It
        // remains recoverable after unpublish/consent changes and has no prices.
        const replay = await replayBooking<PublicBookingReceipt>(client, locator.tenant_id, dto.requestId, fingerprint);
        if (replay !== undefined) return { response: replay, effect: null };
        const page = await this.readPage(client, locator.tenant_id, locator.id, true);
        const legal = await this.legalDocuments(client, page);
        if (dto.consentVersion !== legal.consentVersion)
          throw new ConflictException({
            code: 'CONSENT_CHANGED',
            message: 'Документы согласия изменились. Прочитайте текущую версию.',
          });
        const selection = await this.selected(client, page, dto.serviceIds, true);
        const publicResources = await pageResources(client, page);
        const requested = dto.resourceKey
          ? publicResources.find((resource) => resource.resource_key === dto.resourceKey)
          : undefined;
        if (dto.resourceKey && !requested)
          throw new ConflictException({ code: 'RESOURCE_UNAVAILABLE', message: 'Выбранный мастер недоступен' });
        const resource = await this.chooseResource(client, page, start, selection.duration, requested?.id);
        const { rows } = await client.query<RequestRow>(
          `INSERT INTO public_booking_requests(tenant_id,point_id,page_id,request_id,capability_hash,contact_name,contact_phone,comment,
          selected_services,duration_minutes,starts_at,resource_id,status,consent_version,consent_proof)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,
            jsonb_build_object('version',$14::uuid,'acceptedAt',clock_timestamp(),'operator',$15::jsonb,'policyText',$16::text,'consentText',$17::text)) RETURNING *`,
          [
            page.tenant_id,
            page.point_id,
            page.id,
            dto.requestId,
            capability,
            name,
            phone,
            dto.comment?.trim() ?? '',
            JSON.stringify(selection.services),
            selection.duration,
            start,
            resource,
            page.settings.mode === 'instant' ? 'confirmed' : 'pending',
            legal.consentVersion,
            JSON.stringify(legal.operator),
            legal.policyText,
            legal.consentText,
          ],
        );
        const row = rows[0];
        if (row.status === 'confirmed') await this.reserve(client, row, null);
        const response = this.receipt(row);
        await saveBookingReplay(client, page.tenant_id, page.point_id, null, dto.requestId, fingerprint, response);
        return { response, effect: row };
      });
      if (result.effect)
        void this.afterCommit(result.effect).catch(() => this.logger.warn('Public booking notification failed'));
      return result.response;
    });
  }
  async status(slug: string, requestId: string, capability: unknown) {
    bookingUuid(requestId);
    if (typeof capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(capability))
      return { status: 'unknown' as const };
    const locator = await this.locate(slug);
    return runWithTenant(locator.tenant_id, async () => {
      const { rows } = await this.pool.query<RequestRow>(
        `${requestSelect} WHERE r.tenant_id=$1 AND r.page_id=$2 AND r.request_id=$3 AND r.capability_hash=$4`,
        [locator.tenant_id, locator.id, requestId, bookingHash(capability)],
      );
      return rows[0] ? { status: 'completed' as const, result: this.receipt(rows[0]) } : { status: 'unknown' as const };
    });
  }
  private staffRequest(row: RequestRow) {
    return {
      id: row.id,
      requestId: row.request_id,
      pointId: row.point_id,
      status:
        row.booking_status === 'cancelled' || (row.status === 'confirmed' && row.booking_id === null)
          ? 'cancelled'
          : row.status,
      name: row.contact_name,
      phone: row.contact_phone,
      comment: row.comment,
      services: row.selected_services,
      startsAt: (row.booking_start ?? row.starts_at).toISOString(),
      durationMinutes: row.booking_duration ?? row.duration_minutes,
      resourceId: row.resource_id,
      bookingId: row.booking_id ?? null,
      clientId: row.client_id ?? null,
      needsClientLink: !!row.booking_id && !row.client_id,
      createdAt: row.created_at.toISOString(),
    };
  }
  async requests(actor: JwtPayload, query: { status?: string } = {}) {
    const fresh = await bookingActor(this.pool, actor),
      point = actorPointId(actor);
    if (query.status && !['pending', 'confirmed', 'rejected', 'cancelled'].includes(query.status))
      throw new BadRequestException({ message: 'Неизвестный статус' });
    const { rows } = await this.pool.query<RequestRow>(
      `${requestSelect} WHERE r.tenant_id=$1 AND r.point_id IS NOT DISTINCT FROM $2::uuid
      AND ($3::boolean OR r.resource_id=$4) AND ($5::text IS NULL OR CASE WHEN b.status='cancelled' THEN 'cancelled' ELSE r.status END=$5)
      ORDER BY r.created_at DESC,r.id LIMIT 200`,
      [actor.tenantID, point, bookingOwner(fresh), actor.userID, query.status ?? null],
    );
    return rows.map((r) => this.staffRequest(r));
  }
  async decide(actor: JwtPayload, id: string, input: ApprovePublicBookingDto, approve: boolean) {
    bookingUuid(id);
    const dto = validatedBookingDto(approve ? ApprovePublicBookingDto : BookingOperationDto, input),
      fingerprint = bookingFingerprint({
        operation: approve ? 'approve' : 'reject',
        actor: actor.userID,
        point: actorPointId(actor),
        id,
        dto,
      });
    const result = await bookingTransaction(this.pool, actor.tenantID, async (client) => {
      const fresh = await bookingActor(client, actor),
        { rows } = await client.query<RequestRow>(
          `${requestSelect} WHERE r.tenant_id=$1 AND r.id=$2 AND r.point_id IS NOT DISTINCT FROM $3::uuid`,
          [actor.tenantID, id, actorPointId(actor)],
        );
      let row = rows[0];
      if (!row) throw new NotFoundException({ message: 'Заявка не найдена' });
      if (!bookingOwner(fresh) && row.resource_id !== actor.userID)
        throw new ForbiddenException({ message: 'Можно обрабатывать только свои заявки' });
      const replay = await replayBooking<ReturnType<PublicBookingsService['staffRequest']>>(
        client,
        actor.tenantID,
        dto.requestId,
        fingerprint,
      );
      if (replay !== undefined) return { response: replay, effect: null };
      if (row.status !== 'pending')
        throw new ConflictException({ code: 'REQUEST_DECIDED', message: 'Заявка уже обработана' });
      let resource = row.resource_id;
      if (approve) {
        const page = await this.readPage(client, actor.tenantID, row.page_id, true);
        const legal = await this.legalDocuments(client, page);
        if (row.consent_version !== legal.consentVersion)
          throw new ConflictException({
            code: 'CONSENT_CHANGED',
            message: 'Согласие изменилось. Клиенту нужно отправить новую заявку.',
          });
        const selected = await this.selected(
          client,
          page,
          row.selected_services.map((s) => s.serviceId),
          true,
        );
        resource = (dto as ApprovePublicBookingDto).resourceId ?? row.resource_id;
        if (!bookingOwner(fresh) && resource !== actor.userID)
          throw new ForbiddenException({ message: 'Нельзя назначить другого сотрудника' });
        if (!resource) throw slotUnavailable();
        await this.chooseResource(client, page, row.starts_at, selected.duration, resource);
        row = {
          ...row,
          resource_id: resource,
          duration_minutes: selected.duration,
          selected_services: selected.services,
        };
        await this.reserve(client, row, actor.userID);
      }
      await client.query(
        `UPDATE public_booking_requests SET status=$1,resource_id=$2,selected_services=$3::jsonb,duration_minutes=$4,decided_at=clock_timestamp(),decided_by=$5 WHERE id=$6 AND tenant_id=$7`,
        [
          approve ? 'confirmed' : 'rejected',
          resource,
          JSON.stringify(row.selected_services),
          row.duration_minutes,
          actor.userID,
          id,
          actor.tenantID,
        ],
      );
      row = (await client.query<RequestRow>(`${requestSelect} WHERE r.id=$1 AND r.tenant_id=$2`, [id, actor.tenantID]))
        .rows[0];
      const response = this.staffRequest(row);
      await saveBookingReplay(
        client,
        actor.tenantID,
        actorPointId(actor),
        actor.userID,
        dto.requestId,
        fingerprint,
        response,
      );
      return { response, effect: row };
    });
    if (result.effect)
      void this.afterCommit(result.effect).catch(() => this.logger.warn('Public booking notification failed'));
    return result.response;
  }
  /** Exactly one invocation per committed transition; duplicate keys return
   * before this effect. Messaging additionally retains its existing DB claim. */
  private async afterCommit(row: RequestRow) {
    if (row.status === 'confirmed') {
      const { rows } = await this.pool.query<{
        id: string;
        client_id: string | null;
        enabled: boolean;
        timezone: string;
      }>(
        `SELECT b.id,b.client_id,bs.notify_client_on_create AS enabled,t.timezone FROM bookings b
        JOIN tenants t ON t.id=b.tenant_id LEFT JOIN booking_settings bs ON bs.tenant_id=b.tenant_id WHERE b.public_request_id=$1 AND b.tenant_id=$2`,
        [row.id, row.tenant_id],
      );
      const booking = rows[0];
      if (booking?.enabled)
        await this.marketing.sendClientMessage(
          row.tenant_id,
          row.contact_phone,
          `Вы записаны на ${row.starts_at.toLocaleString('ru-RU', { timeZone: booking.timezone })}. Ждём вас!`,
          { clientId: booking.client_id, messageType: 'booking', dedupKey: `booking_confirm:${booking.id}` },
        );
    }
    const { rows } = await this.pool.query<{ id: string; role: string; matrix: unknown }>(
      `SELECT u.id,u.role,r.matrix FROM users u LEFT JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id
      WHERE u.tenant_id=$1 AND u.is_active AND u.dismissed_at IS NULL AND u.purged_at IS NULL
      AND ($2::uuid IS NULL OR autexa_point_is_allowed(u.tenant_id,u.id,$2::uuid))`,
      [row.tenant_id, row.point_id],
    );
    await Promise.all(
      rows
        .filter(
          (u) =>
            userHasPermission({ role: u.role, permissions: mergeEffectivePermissions(u.matrix) }, 'bookings_access') &&
            (bookingOwner({ role: u.role } as JwtPayload) || u.id === row.resource_id),
        )
        .map((u) =>
          this.push.sendToUserInTenant(
            u.id,
            row.tenant_id,
            'booking_reminder',
            row.status === 'pending' ? 'Новая заявка на запись' : 'Запись обновлена',
            row.status === 'pending' ? 'Заявка ожидает подтверждения сотрудником.' : 'Проверьте раздел записей.',
            {
              type: row.status === 'pending' ? 'booking-request-pending' : 'booking-updated',
              requestId: row.id,
              pointId: row.point_id,
            },
          ),
        ),
    );
  }
}
