import type { PublicBookingReceipt, PublicBookingRecovery } from '../types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const capability = /^[A-Za-z0-9_-]{43}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(value, k));
const instant = (value: unknown): value is string =>
  typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));

/** Entropy comes ONLY from the platform's cryptographic generator. No fallback
 * to Math.random/date/device IDs. The web caller passes crypto.randomUUID and
 * () => crypto.getRandomValues(new Uint8Array(32)); unavailable => stop before POST. */
export function createPublicBookingIdentity(secure: { randomUUID(): string; randomBytes(): Uint8Array }): {
  requestId: string;
  recoveryToken: string;
} {
  const requestId = secure.randomUUID(),
    bytes = secure.randomBytes();
  if (!uuid.test(requestId) || !(bytes instanceof Uint8Array) || bytes.length !== 32)
    throw new Error('Не удалось безопасно подготовить заявку');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let encoded = '',
    bits = 0,
    accumulator = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      encoded += alphabet[(accumulator >>> bits) & 63];
    }
  }
  if (bits) encoded += alphabet[(accumulator << (6 - bits)) & 63];
  return { requestId, recoveryToken: encoded };
}
export function isPublicBookingIdentity(value: unknown): value is { requestId: string; recoveryToken: string } {
  return (
    object(value) &&
    typeof value.requestId === 'string' &&
    uuid.test(value.requestId) &&
    typeof value.recoveryToken === 'string' &&
    capability.test(value.recoveryToken)
  );
}
function receipt(value: unknown, requestId: string): PublicBookingReceipt | null {
  if (
    !object(value) ||
    !exactKeys(value, ['requestId', 'status', 'startsAt', 'endsAt', 'services']) ||
    value.requestId !== requestId ||
    !uuid.test(requestId) ||
    !['pending', 'confirmed', 'rejected', 'cancelled'].includes(String(value.status)) ||
    !instant(value.startsAt) ||
    !instant(value.endsAt) ||
    Date.parse(value.endsAt) <= Date.parse(value.startsAt) ||
    !Array.isArray(value.services) ||
    value.services.length < 1 ||
    value.services.length > 20
  )
    return null;
  for (const service of value.services) {
    if (
      !object(service) ||
      !exactKeys(service, ['serviceId', 'name', 'durationMinutes']) ||
      typeof service.serviceId !== 'string' ||
      !uuid.test(service.serviceId) ||
      typeof service.name !== 'string' ||
      typeof service.durationMinutes !== 'number' ||
      !Number.isInteger(service.durationMinutes) ||
      service.durationMinutes < 5 ||
      service.durationMinutes > 720
    )
      return null;
  }
  return value as unknown as PublicBookingReceipt;
}
/** Null means ambiguous, never success and never permission to generate a new UUID. */
export function readPublicBookingReceipt(
  response: { status: number; data: unknown },
  requestId: string,
): PublicBookingReceipt | null {
  return response.status === 200 || response.status === 201 ? receipt(response.data, requestId) : null;
}
/** A valid unknown result must KEEP the saved immutable UUID/body/capability.
 * The caller may explicitly retry the exact POST; GET itself never mutates. */
export function readPublicBookingRecovery(
  response: { status: number; data: unknown },
  requestId: string,
): PublicBookingRecovery | null {
  if (response.status !== 200 || !object(response.data)) return null;
  const data = response.data;
  if (data.status === 'unknown' && exactKeys(data, ['status'])) return { status: 'unknown' };
  if (data.status !== 'completed' || !exactKeys(data, ['status', 'result'])) return null;
  const result = receipt(data.result, requestId);
  return result ? { status: 'completed', result } : null;
}
