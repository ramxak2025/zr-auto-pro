import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId } from '../common/point-scope';
import { mergeEffectivePermissions } from '../common/role-matrix';
import { userHasPermission } from '../common/guards/permissions.guard';
import { lockAttendanceUser } from '../shifts/attendance';

export function bookingUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new BadRequestException({ code: 'INVALID_REQUEST', message: 'Нужен корректный UUID запроса' });
  return value.toLowerCase();
}
export const bookingOwner = (actor: JwtPayload) => ['director', 'superadmin', 'admin'].includes(actor.role ?? '');
export function bookingHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
export const bookingFingerprint = (value: unknown) => bookingHash(JSON.stringify(stable(value)));
export const slotUnavailable = () =>
  new ConflictException({ code: 'SLOT_UNAVAILABLE', message: 'Время уже занято или недоступно. Выберите другое.' });

/** Every occupancy/configuration mutation takes this lock first. The deliberately
 * bounded tenant gate also serializes resource enable/disable against legacy
 * clients. Employee row locks below are shared with manual calendar/NFC paths.
 * No point is part of the resource key: one employee cannot work in two points. */
export async function bookingTransaction<T>(
  pool: Pool,
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`bookings:${tenantId}`]);
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
export async function lockBookingResources(
  client: PoolClient,
  tenantId: string,
  resources: (string | null | undefined)[],
) {
  for (const id of [...new Set(resources.filter((v): v is string => !!v))].sort())
    await lockAttendanceUser(client, tenantId, id);
}
export async function bookingActor(
  client: Pick<PoolClient, 'query'>,
  actor: JwtPayload,
  permission = 'bookings_access',
): Promise<JwtPayload> {
  const point = actorPointId(actor);
  const { rows } = await client.query(
    `SELECT u.role,r.matrix FROM users u JOIN tenants t ON t.id=u.tenant_id
    LEFT JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id
    WHERE u.id=$1 AND u.tenant_id=$2 AND u.is_active AND u.dismissed_at IS NULL AND u.purged_at IS NULL AND t.is_active
    AND (CASE WHEN $3::uuid IS NULL THEN NOT EXISTS(SELECT 1 FROM tenant_points p WHERE p.tenant_id=u.tenant_id AND p.is_active)
      ELSE autexa_point_is_allowed(u.tenant_id,u.id,$3::uuid) END)`,
    [actor.userID, actor.tenantID, point],
  );
  const row = rows[0];
  if (!row) throw new ForbiddenException({ message: 'Сотрудник или филиал недоступны' });
  const fresh = { ...actor, role: row.role as string, permissions: mergeEffectivePermissions(row.matrix) };
  if (!userHasPermission(fresh, permission)) throw new ForbiddenException({ message: 'Недостаточно прав' });
  return fresh;
}
export async function replayBooking<T>(
  client: PoolClient,
  tenant: string,
  key: string | undefined,
  fingerprint: string,
): Promise<T | undefined> {
  if (!key) return undefined;
  bookingUuid(key);
  const { rows } = await client.query<{ fingerprint: string; response: T }>(
    'SELECT fingerprint,response FROM booking_operation_keys WHERE tenant_id=$1 AND request_id=$2',
    [tenant, key],
  );
  if (!rows[0]) return undefined;
  if (rows[0].fingerprint !== fingerprint)
    throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'UUID уже использован с другими данными' });
  return rows[0].response;
}
export async function saveBookingReplay(
  client: PoolClient,
  tenant: string,
  point: string | null,
  actor: string | null,
  key: string | undefined,
  fingerprint: string,
  response: unknown,
) {
  if (key)
    await client.query(
      'INSERT INTO booking_operation_keys(tenant_id,point_id,actor_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [tenant, point, actor, key, fingerprint, JSON.stringify(response)],
    );
}
export async function managedBookingResource(client: PoolClient, tenant: string, id: string | null): Promise<boolean> {
  if (!id) return false;
  const { rows } = await client.query<{ managed: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM public_booking_resources WHERE tenant_id=$1 AND user_id=$2)
    OR EXISTS(SELECT 1 FROM bookings WHERE tenant_id=$1 AND master_id=$2 AND public_request_id IS NOT NULL AND status='scheduled') AS managed`,
    [tenant, id],
  );
  return rows[0].managed;
}
export async function assertBookingEmployee(
  client: PoolClient,
  tenant: string,
  point: string | null,
  id: string,
  managed: boolean,
) {
  const { rows } = await client.query(
    `SELECT id FROM users WHERE tenant_id=$1 AND id=$2
    AND ($4::boolean OR role='master')
    AND (NOT $4::boolean OR (is_active AND dismissed_at IS NULL AND purged_at IS NULL AND role NOT IN ('manager','superadmin')
      AND ($3::uuid IS NULL OR autexa_point_is_allowed(tenant_id,id,$3::uuid))))`,
    [tenant, id, point, managed],
  );
  if (!rows[0])
    throw new BadRequestException({ code: 'RESOURCE_UNAVAILABLE', message: 'Сотрудник недоступен в этом филиале' });
}
export async function assertBookingClient(client: PoolClient, tenant: string, point: string | null, id: string) {
  const { rows } = await client.query(
    `SELECT c.id,c.full_name,c.phone FROM clients c JOIN tenants t ON t.id=c.tenant_id
    WHERE c.tenant_id=$1 AND c.id=$2 AND (t.points_shared_clients IS DISTINCT FROM false OR $3::uuid IS NULL OR c.point_id IS NULL OR c.point_id=$3::uuid)`,
    [tenant, id, point],
  );
  if (!rows[0]) throw new NotFoundException({ message: 'Клиент не найден' });
  return rows[0] as { id: string; full_name: string; phone: string };
}
export async function assertBookingInterval(
  client: PoolClient,
  tenant: string,
  resource: string,
  start: Date | string,
  duration: number,
  exclude: string | null = null,
) {
  const { rows } = await client.query(
    `SELECT id FROM bookings WHERE tenant_id=$1 AND master_id=$2 AND status='scheduled'
    AND ($5::uuid IS NULL OR id<>$5::uuid) AND scheduled_at < $3::timestamptz+($4::int*interval '1 minute')
    AND scheduled_at+(COALESCE(duration_minutes,90)*interval '1 minute') > $3::timestamptz LIMIT 1`,
    [tenant, resource, start, duration, exclude],
  );
  if (rows[0]) throw slotUnavailable();
}
