import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { zonedDateKey } from '../common/timezone';
import { validTime } from '../schedule/work-mode';
import { BookingHours, PublicBookingSettingsDto } from './dto/public-booking.dto';

export interface BookingContactLinks {
  phone?: string;
  instagram?: string;
  whatsapp?: string;
  vk?: string;
  telegram?: string;
}

export interface BookingPageSettings {
  displayName: string;
  address: string;
  contacts: string;
  links?: BookingContactLinks;
  showPrices: boolean;
  mode: 'instant' | 'approval';
  slotStepMinutes: number;
  openingHours: BookingHours;
  operator: { name: string; requisites: string; contact: string };
  policyText: string;
  consentText: string;
}
export interface BookingPageRow {
  id: string;
  tenant_id: string;
  point_id: string | null;
  slug: string;
  public_code: string;
  published: boolean;
  revision: number;
  settings: BookingPageSettings;
  consent_version: string;
}
export interface BookingResource {
  id: string;
  resource_key: string;
  full_name: string;
  days_off: number[];
}
interface PlannedDay {
  user_id: string;
  date: string;
  point_id: string | null;
  shift_start: string | null;
  shift_end: string | null;
  is_day_off: boolean;
  note: string | null;
  late_status: string | null;
}
interface Occupied {
  master_id: string;
  scheduled_at: Date;
  duration_minutes: number | null;
}
export interface BookingWindow {
  resourceId: string;
  start: number;
  end: number;
  gridStart: number;
}
export interface Availability {
  windows: BookingWindow[];
  occupied: Occupied[];
  now: Date;
  timezone: string;
}
export const defaultBookingHours = (): BookingHours =>
  Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), { start: '09:00', end: '18:00' }]));

const SOCIAL_HOSTS = {
  instagram: new Set(['instagram.com', 'www.instagram.com']),
  whatsapp: new Set(['wa.me', 'api.whatsapp.com', 'whatsapp.com', 'www.whatsapp.com']),
  vk: new Set(['vk.com', 'www.vk.com', 'm.vk.com']),
  telegram: new Set(['t.me', 'telegram.me', 'www.telegram.me']),
} as const;

function normalizeBookingLinks(input: PublicBookingSettingsDto['links']): BookingContactLinks | undefined {
  if (!input) return undefined;
  const phone = input.phone?.trim();
  const links: BookingContactLinks = phone ? { phone } : {};
  for (const kind of ['instagram', 'whatsapp', 'vk', 'telegram'] as const) {
    const value = input[kind]?.trim();
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException({ message: 'Ссылки на соцсети должны начинаться с https://' });
    }
    if (
      url.protocol !== 'https:' ||
      !!url.username ||
      !!url.password ||
      url.port !== '' ||
      !SOCIAL_HOSTS[kind].has(url.hostname.toLowerCase())
    )
      throw new BadRequestException({ message: `Укажите действующую HTTPS-ссылку ${kind}` });
    links[kind] = url.toString();
  }
  return Object.keys(links).length > 0 ? links : undefined;
}

export function bookingSettings(dto: PublicBookingSettingsDto): BookingPageSettings {
  const hours = dto.openingHours ?? defaultBookingHours();
  if (Object.keys(hours).length > 7) throw new BadRequestException({ message: 'Не более семи дней недели' });
  for (const [day, times] of Object.entries(hours)) {
    if (
      !/^[0-6]$/.test(day) ||
      (times !== null &&
        (!times ||
          typeof times !== 'object' ||
          Object.keys(times).some((k) => k !== 'start' && k !== 'end') ||
          !validTime(times.start) ||
          !validTime(times.end) ||
          times.start === times.end))
    )
      throw new BadRequestException({
        message: 'Укажите часы работы по дням недели; одинаковое начало и конец недопустимы',
      });
  }
  return {
    displayName: dto.displayName.trim(),
    address: dto.address.trim(),
    contacts: dto.contacts.trim(),
    links: normalizeBookingLinks(dto.links),
    showPrices: dto.showPrices,
    mode: dto.mode,
    slotStepMinutes: dto.slotStepMinutes ?? 15,
    openingHours: hours,
    operator: {
      name: dto.operator?.name.trim() ?? '',
      requisites: dto.operator?.requisites.trim() ?? '',
      contact: dto.operator?.contact.trim() ?? '',
    },
    policyText: dto.policyText?.trim() ?? '',
    consentText: dto.consentText?.trim() ?? '',
  };
}
export function bookingDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-') ||
    !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException({ message: 'Дата должна быть в формате ГГГГ-ММ-ДД' });
  return value;
}
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
/** The explicit configuration includes the working owner. Point membership is
 * the application's canonical convention, not a new role=master restriction. */
export async function pageResources(
  client: Pick<PoolClient, 'query'>,
  page: BookingPageRow,
): Promise<BookingResource[]> {
  const { rows } = await client.query<BookingResource>(
    `SELECT u.id,r.resource_key,u.full_name,COALESCE(u.days_off,'[]'::jsonb) AS days_off
    FROM public_booking_resources r JOIN users u ON u.id=r.user_id AND u.tenant_id=r.tenant_id
    WHERE r.page_id=$1 AND r.tenant_id=$2 AND u.is_active AND u.dismissed_at IS NULL AND u.purged_at IS NULL
    AND u.role NOT IN ('manager','superadmin') AND ($3::uuid IS NULL OR autexa_point_is_allowed(u.tenant_id,u.id,$3::uuid)) ORDER BY u.id`,
    [page.id, page.tenant_id, page.point_id],
  );
  return rows;
}
export async function pageAvailability(
  client: PoolClient,
  page: BookingPageRow,
  resources: BookingResource[],
  from: string,
  to: string,
  lockCalendar = false,
): Promise<Availability> {
  const tenant = await client.query<{ timezone: string; now: Date }>(
    'SELECT timezone,clock_timestamp() AS now FROM tenants WHERE id=$1',
    [page.tenant_id],
  );
  const { timezone, now } = tenant.rows[0];
  const first = shiftDate(from, -1),
    ids = resources.map((r) => r.id);
  const { rows: entries } = await client.query<PlannedDay>(
    `SELECT user_id,date::text,point_id,shift_start,shift_end,is_day_off,note,late_status FROM schedule_entries
    WHERE tenant_id=$1 AND user_id=ANY($2::uuid[]) AND date BETWEEN $3::date AND $4::date ORDER BY user_id,date ${lockCalendar ? 'FOR SHARE' : ''}`,
    [page.tenant_id, ids, first, to],
  );
  // The bound covers overnight slots and historical null-duration bookings.
  const { rows: occupied } = await client.query<Occupied>(
    `SELECT master_id,scheduled_at,duration_minutes FROM bookings
    WHERE tenant_id=$1 AND master_id=ANY($2::uuid[]) AND status='scheduled'
    AND scheduled_at >= (($3::date-1)::timestamp AT TIME ZONE $5) AND scheduled_at < (($4::date+2)::timestamp AT TIME ZONE $5)
    ORDER BY scheduled_at LIMIT 10001`,
    [page.tenant_id, ids, first, to, timezone],
  );
  if (occupied.length > 10000)
    throw new BadRequestException({ message: 'Слишком большой диапазон записей. Выберите меньше дней.' });
  const raw: Array<{
    resourceId: string;
    date: string;
    start: string;
    end: string;
    pageStart: string;
    pageEnd: string;
  }> = [];
  const byDay = new Map(entries.map((e) => [e.user_id + ':' + e.date, e]));
  for (let date = first; date <= to; date = shiftDate(date, 1)) {
    const day = new Date(date + 'T00:00:00Z').getUTCDay(),
      hours = page.settings.openingHours[String(day)];
    if (!hours) continue;
    for (const resource of resources) {
      const entry = byDay.get(resource.id + ':' + date);
      if (
        entry &&
        (entry.point_id !== page.point_id ||
          entry.is_day_off ||
          entry.late_status === 'sick' ||
          entry.note === 'Больничный' ||
          entry.note === 'Прогул')
      )
        continue;
      if (!entry && (resource.days_off ?? []).includes(day)) continue;
      raw.push({
        resourceId: resource.id,
        date,
        start: entry?.shift_start?.slice(0, 5) ?? hours.start,
        end: entry?.shift_end?.slice(0, 5) ?? hours.end,
        pageStart: hours.start,
        pageEnd: hours.end,
      });
    }
  }
  // PostgreSQL converts wall-clock windows in the tenant's IANA zone, including
  // overnight work and DST. Subsequent stepping is over real UTC instants.
  const { rows: windows } = await client.query<{ resource_id: string; start: Date; end: Date; grid_start: Date }>(
    `SELECT x->>'resourceId' AS resource_id,
    GREATEST(((x->>'date')::date+(x->>'start')::time) AT TIME ZONE $2,((x->>'date')::date+(x->>'pageStart')::time) AT TIME ZONE $2) AS start,
    LEAST((((x->>'date')::date+CASE WHEN x->>'end' <= x->>'start' THEN 1 ELSE 0 END)+(x->>'end')::time) AT TIME ZONE $2,
      (((x->>'date')::date+CASE WHEN x->>'pageEnd' <= x->>'pageStart' THEN 1 ELSE 0 END)+(x->>'pageEnd')::time) AT TIME ZONE $2) AS end,
    ((x->>'date')::date+(x->>'pageStart')::time) AT TIME ZONE $2 AS grid_start
    FROM jsonb_array_elements($1::jsonb) x`,
    [JSON.stringify(raw), timezone],
  );
  return {
    windows: windows
      .filter((w) => w.end > w.start)
      .map((w) => ({
        resourceId: w.resource_id,
        start: w.start.getTime(),
        end: w.end.getTime(),
        gridStart: w.grid_start.getTime(),
      })),
    occupied,
    now,
    timezone,
  };
}
export function resourceAvailable(
  availability: Availability,
  page: BookingPageRow,
  resourceId: string,
  start: number,
  duration: number,
): boolean {
  const end = start + duration * 60000,
    step = page.settings.slotStepMinutes * 60000;
  return (
    start > availability.now.getTime() &&
    availability.windows.some(
      (w) => w.resourceId === resourceId && start >= w.start && end <= w.end && (start - w.gridStart) % step === 0,
    ) &&
    !availability.occupied.some(
      (b) =>
        b.master_id === resourceId &&
        b.scheduled_at.getTime() < end &&
        b.scheduled_at.getTime() + (b.duration_minutes ?? 90) * 60000 > start,
    )
  );
}
export const dateForBooking = (instant: Date, timezone: string) => zonedDateKey(instant, timezone);
