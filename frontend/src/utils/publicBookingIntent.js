const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const CORRECTABLE = new Set([
  'SLOT_UNAVAILABLE',
  'CONSENT_CHANGED',
  'SERVICES_CHANGED',
  'INVALID_REQUEST',
  'BOOKING_DISABLED',
  'RESOURCE_UNAVAILABLE',
  'PUBLICATION_INCOMPLETE',
]);

export function validatePublicBookingDto(body) {
  if (
    body?.resourceKey !== undefined &&
    (typeof body.resourceKey !== 'string' || !/^[a-f0-9]{32}$/.test(body.resourceKey))
  )
    return 'Выбранный мастер недоступен. Обновите страницу и выберите мастера ещё раз.';
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 100 || /[<>\p{Cc}]/u.test(body.name))
    return 'Укажите имя длиной до 100 символов без знаков < и >.';
  if (typeof body?.phone !== 'string' || !/^[+()\d\s-]{10,32}$/.test(body.phone))
    return 'Проверьте номер телефона: используйте от 10 до 32 цифр, пробелы и символы + ( ) -.';
  if (
    body.comment !== undefined &&
    (typeof body.comment !== 'string' || body.comment.length > 1000 || /[<>]/.test(body.comment))
  )
    return 'Комментарий должен быть не длиннее 1000 символов и не содержать знаки < и >.';
  return null;
}

export class PublicBookingIntentError extends Error {
  constructor(code, message, definitiveRejected = false) {
    super(message);
    this.name = 'PublicBookingIntentError';
    this.code = code;
    this.definitiveRejected = definitiveRejected;
  }
}

function unavailable() {
  return new PublicBookingIntentError(
    'STORAGE_UNAVAILABLE',
    'Не удалось безопасно сохранить заявку. Включите хранилище и Web Locks в браузере; запрос не отправлен.',
  );
}

function isBody(value, requestId, recoveryToken) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value)
    .filter((key) => key !== 'resourceKey')
    .sort()
    .join(',');
  if (
    keys !== 'comment,consentAccepted,consentVersion,name,phone,recoveryToken,requestId,serviceIds,startsAt' &&
    keys !== 'consentAccepted,consentVersion,name,phone,recoveryToken,requestId,serviceIds,startsAt'
  )
    return false;
  return (
    value.requestId === requestId &&
    value.recoveryToken === recoveryToken &&
    (value.resourceKey === undefined ||
      (typeof value.resourceKey === 'string' && /^[a-f0-9]{32}$/.test(value.resourceKey))) &&
    UUID_V4.test(value.requestId) &&
    CAPABILITY.test(value.recoveryToken) &&
    Array.isArray(value.serviceIds) &&
    value.serviceIds.length > 0 &&
    value.serviceIds.length <= 20 &&
    value.serviceIds.every((id) => typeof id === 'string' && UUID_V4.test(id)) &&
    typeof value.startsAt === 'string' &&
    /(?:Z|[+-]\d\d:\d\d)$/.test(value.startsAt) &&
    Number.isFinite(Date.parse(value.startsAt)) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 120 &&
    typeof value.phone === 'string' &&
    value.phone.trim().length > 0 &&
    value.phone.length <= 40 &&
    (value.comment === undefined || (typeof value.comment === 'string' && value.comment.length <= 1000)) &&
    typeof value.consentVersion === 'string' &&
    value.consentVersion.length > 0 &&
    value.consentAccepted === true
  );
}

export function parsePublicBookingIntent(raw, slug) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
    const recordKeys = Object.keys(value).sort().join(',');
    if (
      ![
        'body,recoveryToken,requestId,slug',
        'body,slug',
        'body,dispatches,recoveryToken,requestId,slug,version',
      ].includes(recordKeys)
    )
      throw unavailable();
    const body = value.body;
    const requestId = value.requestId ?? body?.requestId;
    const recoveryToken = value.recoveryToken ?? body?.recoveryToken;
    if (value.slug !== slug || !UUID_V4.test(requestId) || !CAPABILITY.test(recoveryToken)) {
      throw unavailable();
    }
    if (body !== null && !isBody(body, requestId, recoveryToken)) throw unavailable();
    // Migrate earlier v1 records conservatively: an existing body may already
    // have reached the server, so it cannot qualify for first-attempt cleanup.
    const dispatches =
      Number.isSafeInteger(value.dispatches) && value.dispatches >= 0 ? value.dispatches : body ? 1 : 0;
    if (value.version !== undefined && value.version !== 1) throw unavailable();
    return { version: 1, slug, requestId, recoveryToken, body, dispatches };
  } catch (error) {
    if (error instanceof PublicBookingIntentError) throw error;
    throw unavailable();
  }
}

function environment(storage, locks, key, run, isCurrent = () => true) {
  if (!storage || !locks || typeof locks.request !== 'function') throw unavailable();
  return locks.request(key, { mode: 'exclusive' }, async (lock) => {
    if (!lock) throw unavailable();
    if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
    return run();
  });
}

async function readChecked(storage, key, slug, isCurrent = () => true) {
  if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
  let raw;
  try {
    raw = await storage.getItem(key);
  } catch {
    throw unavailable();
  }
  if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
  return raw === null ? null : parsePublicBookingIntent(raw, slug);
}

async function writeChecked(storage, key, record, isCurrent = () => true) {
  if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
  const raw = JSON.stringify(record);
  try {
    await storage.setItem(key, raw);
    if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
    if ((await storage.getItem(key)) !== raw) throw unavailable();
  } catch {
    if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
    throw unavailable();
  }
  if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
}

function responseStatus(errorOrResponse) {
  return Number(errorOrResponse?.status ?? errorOrResponse?.response?.status);
}

function responseCode(error) {
  return error?.response?.data?.code;
}

function isValidationPipeRejection(error) {
  const data = error?.response?.data;
  return (
    responseStatus(error) === 400 &&
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Object.keys(data).length === 1 &&
    typeof data.message === 'string' &&
    data.message.length > 0
  );
}

function isFirstDefinitiveRejection(error) {
  const status = responseStatus(error);
  const code = responseCode(error);
  if (status === 400) return code === 'INVALID_REQUEST' || isValidationPipeRejection(error);
  if (status === 404) return code === 'BOOKING_DISABLED';
  return status === 409 && CORRECTABLE.has(code);
}

/** Claims one slug-scoped immutable intent under Web Locks, writes and reads it
 * back before dispatch, and keeps the lock through the request. */
export async function dispatchPublicBookingIntent(options) {
  const { slug, key, storage, locks, body, saved, parseReceipt, send, onPersisted, isCurrent = () => true } = options;
  if (!slug || !key || typeof parseReceipt !== 'function' || typeof send !== 'function') throw unavailable();
  const inputError = validatePublicBookingDto(body);
  if (inputError) throw new PublicBookingIntentError('INVALID_REQUEST', inputError);
  return environment(
    storage,
    locks,
    key,
    async () => {
      const existing = await readChecked(storage, key, slug, isCurrent);
      let record;
      let firstDispatch = false;
      if (saved) {
        if (
          !existing ||
          existing.requestId !== saved.requestId ||
          existing.recoveryToken !== saved.recoveryToken ||
          !existing.body ||
          JSON.stringify(existing.body) !== JSON.stringify(body)
        ) {
          throw new PublicBookingIntentError(
            'INTENT_CHANGED',
            'Сохранённая заявка изменилась. Сначала проверьте её статус.',
          );
        }
        record = { ...existing, dispatches: existing.dispatches + 1 };
        await writeChecked(storage, key, record, isCurrent);
      } else {
        if (existing)
          throw new PublicBookingIntentError(
            'PENDING_EXISTS',
            'Для этой страницы уже есть сохранённая заявка. Сначала проверьте её статус.',
          );
        if (!isBody(body, body?.requestId, body?.recoveryToken)) throw unavailable();
        record = {
          version: 1,
          slug,
          requestId: body.requestId,
          recoveryToken: body.recoveryToken,
          body,
          dispatches: 1,
        };
        await writeChecked(storage, key, record, isCurrent);
        firstDispatch = true;
        onPersisted?.(record);
      }

      try {
        if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
        const response = await send(body);
        if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
        const result = parseReceipt(response, record.requestId);
        if (!result) return { kind: 'ambiguous', record };
        const latest = await readChecked(storage, key, slug, isCurrent);
        if (latest?.requestId === record.requestId) {
          await writeChecked(storage, key, { ...latest, body: null }, isCurrent);
        }
        return { kind: 'confirmed', record: { ...record, body: null }, result };
      } catch (error) {
        const canClear = firstDispatch && isFirstDefinitiveRejection(error);
        if (canClear) {
          const latest = await readChecked(storage, key, slug, isCurrent);
          if (latest?.requestId === record.requestId && latest.dispatches === 1) {
            try {
              await storage.removeItem(key);
            } catch {
              throw unavailable();
            }
          }
          throw new PublicBookingIntentError(
            responseCode(error) ?? 'INVALID_REQUEST',
            error?.message || 'Проверьте данные заявки и попробуйте ещё раз.',
            true,
          );
        }
        throw error;
      }
    },
    options.isCurrent,
  );
}

/** Shared submit/retry handler: a successful POST is only an acknowledgement.
 * Always read capability state before presenting a receipt as current. */
export async function dispatchAndReadCurrentPublicBooking(options) {
  const { dispatch, readCurrent, onAcknowledged, isCurrent = () => true } = options;
  const dispatched = await dispatch();
  if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
  if (dispatched.kind !== 'confirmed') return dispatched;

  onAcknowledged?.(dispatched.record);
  try {
    const current = await readCurrent(dispatched.record);
    if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
    if (current?.status === 'completed') {
      return { kind: 'current', record: dispatched.record, result: current.result };
    }
    return { kind: 'unverified', record: dispatched.record };
  } catch (error) {
    if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
    return { kind: 'unverified', record: dispatched.record, error };
  }
}

/** Minimize completed-recovery persistence without changing the recovery key. */
export async function minimizePublicBookingIntent({ slug, key, storage, locks, requestId, isCurrent = () => true }) {
  return environment(
    storage,
    locks,
    key,
    async () => {
      const current = await readChecked(storage, key, slug, isCurrent);
      if (current?.requestId === requestId && current.body !== null) {
        await writeChecked(storage, key, { ...current, body: null }, isCurrent);
      }
    },
    isCurrent,
  );
}

export async function clearPublicBookingIntent({ slug, key, storage, locks, requestId, isCurrent = () => true }) {
  return environment(
    storage,
    locks,
    key,
    async () => {
      const current = await readChecked(storage, key, slug, isCurrent);
      if (current?.requestId === requestId) {
        if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
        try {
          await storage.removeItem(key);
        } catch {
          throw unavailable();
        }
      }
    },
    isCurrent,
  );
}

/** The public recovery path is deliberately independent of landing settings;
 * a disabled or unpublished page must not hide a saved historical result. */
export async function recoverPublicBookingIntent({
  slug,
  key,
  storage,
  locks,
  requestId,
  recoveryToken,
  recover,
  parseRecovery,
  isCurrent = () => true,
}) {
  if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
  const response = await recover(slug, requestId, recoveryToken);
  if (!isCurrent()) throw new PublicBookingIntentError('LEASE_CHANGED', 'Откройте страницу записи снова.');
  const result = parseRecovery(response, requestId);
  if (result?.status === 'completed') {
    await minimizePublicBookingIntent({ slug, key, storage, locks, requestId, isCurrent });
  }
  return result;
}
