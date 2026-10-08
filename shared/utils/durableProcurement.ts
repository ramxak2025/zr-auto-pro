/** Durable financial intents, never credentials. No expiry: only a proved
 * response may release an intent whose delivery to the server is uncertain. */
export interface ProcurementOwner {
  tenantId: string;
  userId: string;
  pointId: string | null;
}
export type ProcurementOperation = 'po-receive' | 'delivery-create' | 'delivery-return';
export interface ProcurementTarget {
  operation: ProcurementOperation;
  sourceId: string;
  /** Supplier ID for recovery discovery; not sent as a request override. */
  contextId?: string;
}
export interface PendingProcurement {
  version: 1;
  owner: ProcurementOwner;
  target: ProcurementTarget;
  requestId: string;
  /** Exact serialized HTTP body, including requestId. Dates never recomputed. */
  body: string;
  createdAt: string;
  submitted: boolean;
  dispatches: number;
}
export interface ProcurementStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
  exclusive<T>(key: string, run: () => Promise<T>): Promise<T>;
}
export interface ProcurementResponse<T = unknown> {
  status: number;
  data: T;
}
export const PROCUREMENT_PREFIX = 'autexa:procurement:v1:';
const operations = new Set<ProcurementOperation>(['po-receive', 'delivery-create', 'delivery-return']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ProcurementRecoveryError extends Error {
  constructor(
    public readonly code: 'STORAGE_UNAVAILABLE' | 'SESSION_CHANGED' | 'PENDING_REQUEST' | 'RESPONSE_UNCONFIRMED',
    message: string,
  ) {
    super(message);
    this.name = 'ProcurementRecoveryError';
  }
}
const storageError = () =>
  new ProcurementRecoveryError(
    'STORAGE_UNAVAILABLE',
    'Не удалось безопасно сохранить операцию. Проверьте доступ к хранилищу и повторите. Запрос не отправлен.',
  );
const sessionError = () =>
  new ProcurementRecoveryError(
    'SESSION_CHANGED',
    'Аккаунт или филиал изменился. Операция сохранена для прежнего аккаунта.',
  );
function ownerKey(owner: ProcurementOwner): string {
  if (!uuid.test(owner.tenantId) || !uuid.test(owner.userId) || (owner.pointId !== null && !uuid.test(owner.pointId)))
    throw sessionError();
  return `${owner.tenantId}/${owner.userId}/${owner.pointId ?? 'none'}/`;
}
function keyFor(owner: ProcurementOwner, target: ProcurementTarget): string {
  if (!operations.has(target.operation) || !uuid.test(target.sourceId)) throw storageError();
  return `${PROCUREMENT_PREFIX}${ownerKey(owner)}${target.operation}/${target.sourceId}`;
}
export function procurementPath(target: ProcurementTarget): string {
  if (!operations.has(target.operation) || !uuid.test(target.sourceId)) throw storageError();
  if (target.operation === 'po-receive') return `/purchase-orders/${target.sourceId}/receive`;
  if (target.operation === 'delivery-return') return `/suppliers/deliveries/${target.sourceId}/returns`;
  return '/suppliers/deliveries';
}
function cleanPayload(payload: object): Record<string, unknown> {
  const body = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  delete body.requestId;
  // Financial forms have no credential fields. Fail closed if an adapter ever
  // mistakenly supplies a session/config object instead of the HTTP body.
  const forbidden = /^(token|password|authorization|headers|accessToken|refreshToken)$/i;
  const check = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.test(key)) throw storageError();
      check(child);
    }
  };
  check(body);
  return body;
}
function canonical(value: unknown): string {
  const order = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(order)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, order(x)]),
          )
        : v;
  return JSON.stringify(order(value));
}
function readRecord(raw: string, key: string, owner: ProcurementOwner): PendingProcurement {
  try {
    const record = JSON.parse(raw) as PendingProcurement;
    if (
      record.version !== 1 ||
      canonical(record.owner) !== canonical(owner) ||
      keyFor(owner, record.target) !== key ||
      !uuid.test(record.requestId) ||
      typeof record.body !== 'string' ||
      typeof record.submitted !== 'boolean' ||
      typeof record.createdAt !== 'string' ||
      !Number.isSafeInteger(record.dispatches) ||
      record.dispatches < 0
    )
      throw storageError();
    const body = JSON.parse(record.body) as Record<string, unknown>;
    if (body.requestId !== record.requestId) throw storageError();
    cleanPayload(body);
    return record;
  } catch {
    throw storageError();
  }
}
export function confirmedProcurementResponse(target: ProcurementTarget, response: ProcurementResponse): boolean {
  if (response.status < 200 || response.status >= 300 || response.status === 202) return false;
  const data = response.data as {
    queued?: boolean;
    id?: unknown;
    items?: unknown;
    status?: unknown;
    deliveryId?: unknown;
  } | null;
  if (!data || data.queued || typeof data.id !== 'string' || !uuid.test(data.id)) return false;
  if (target.operation === 'po-receive')
    return Array.isArray(data.items) && ['ordered', 'received'].includes(String(data.status));
  if (target.operation === 'delivery-return') return data.deliveryId === target.sourceId && Array.isArray(data.items);
  return true;
}

export function createDurableProcurement(storage: ProcurementStorage, createId: () => string) {
  // Shared by screens on this platform. Cleanup always runs, even on storage or
  // network failure; a rejected promise can never poison a later recovery.
  const inFlight = new Map<string, Promise<ProcurementResponse>>();
  const inFlightInput = new Map<string, string | null>();
  const guard = (isCurrent: () => boolean) => {
    if (!isCurrent()) throw sessionError();
  };
  const write = async (key: string, record: PendingProcurement) => {
    const raw = JSON.stringify(record);
    try {
      await storage.setItem(key, raw);
      if ((await storage.getItem(key)) !== raw) throw storageError();
    } catch {
      throw storageError();
    }
  };
  const list = async (owner: ProcurementOwner, isCurrent: () => boolean): Promise<PendingProcurement[]> => {
    guard(isCurrent);
    const prefix = PROCUREMENT_PREFIX + ownerKey(owner);
    try {
      const keys = (await storage.keys()).filter((key) => key.startsWith(prefix));
      const records: PendingProcurement[] = [];
      for (const key of keys) {
        const raw = await storage.getItem(key);
        if (raw !== null) records.push(readRecord(raw, key, owner));
      }
      guard(isCurrent);
      return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch (error) {
      if (error instanceof ProcurementRecoveryError) throw error;
      throw storageError();
    }
  };
  const execute = async <T>(options: {
    owner: ProcurementOwner;
    target: ProcurementTarget;
    /** Omit ONLY for explicit recovery: never consult refreshed form quantities. */
    payload?: object;
    isCurrent: () => boolean;
    send: (path: string, body: string) => Promise<ProcurementResponse<T>>;
  }): Promise<ProcurementResponse<T>> => {
    const { owner, target, isCurrent, send } = options;
    guard(isCurrent);
    const key = keyFor(owner, target);
    let active = inFlight.get(key);
    const input = options.payload ? canonical(cleanPayload(options.payload)) : null;
    if (active && input !== null && input !== inFlightInput.get(key)) {
      throw new ProcurementRecoveryError(
        'PENDING_REQUEST',
        'Другая версия этой операции уже отправляется. Дождитесь её результата.',
      );
    }
    if (!active) {
      active = (async () => {
        const record = await storage.exclusive(key, async () => {
          guard(isCurrent);
          const raw = await storage.getItem(key);
          // Account removal may have completed while the initial read waited.
          // Reject the stale owner before reserving or persisting a new intent.
          guard(isCurrent);
          if (raw !== null) {
            const saved = readRecord(raw, key, owner);
            if (
              options.payload &&
              canonical(cleanPayload(options.payload)) !== canonical(cleanPayload(JSON.parse(saved.body)))
            ) {
              throw new ProcurementRecoveryError(
                'PENDING_REQUEST',
                'Есть неподтверждённая операция. Сначала восстановите её сохранённый запрос.',
              );
            }
            return saved;
          }
          if (!options.payload)
            throw new ProcurementRecoveryError('PENDING_REQUEST', 'Сохранённый запрос уже завершён. Обновите данные.');
          const requestId = createId();
          if (!uuid.test(requestId)) throw storageError();
          const saved: PendingProcurement = {
            version: 1,
            owner: { ...owner },
            target: { ...target },
            requestId,
            body: JSON.stringify({ ...cleanPayload(options.payload), requestId }),
            createdAt: new Date().toISOString(),
            submitted: false,
            dispatches: 0,
          };
          await write(key, saved);
          return saved;
        });
        guard(isCurrent);
        // Persist uncertainty BEFORE dispatch: termination at any later point
        // requires exact recovery, never a replacement key.
        const updateOwn = async (change: (current: PendingProcurement) => Promise<void>, required = false) =>
          storage.exclusive(key, async () => {
            const raw = await storage.getItem(key);
            if (raw === null) {
              if (required)
                throw new ProcurementRecoveryError(
                  'PENDING_REQUEST',
                  'Сохранённая операция уже завершена. Обновите данные.',
                );
              return;
            }
            const current = readRecord(raw, key, owner);
            // Another tab may have acknowledged this response and started a
            // deliberate NEW intent. An older completion must never erase it.
            if (current.requestId === record.requestId) await change(current);
            else if (required)
              throw new ProcurementRecoveryError(
                'PENDING_REQUEST',
                'Операция уже заменена после подтверждённого отказа. Восстановите текущий запрос.',
              );
          });
        let firstDispatch = false;
        await updateOwn(async (current) => {
          firstDispatch = !current.submitted && current.dispatches === 0;
          await write(key, { ...current, submitted: true, dispatches: current.dispatches + 1 });
        }, true);
        guard(isCurrent);
        let response: ProcurementResponse<T>;
        try {
          response = await send(procurementPath(record.target), record.body);
          if (!confirmedProcurementResponse(record.target, response)) {
            throw new ProcurementRecoveryError(
              'RESPONSE_UNCONFIRMED',
              'Сервер не подтвердил проведение. Сохранённый запрос доступен для восстановления.',
            );
          }
        } catch (error) {
          const status = (error as { response?: { status?: number } })?.response?.status;
          if (firstDispatch && (status === 400 || status === 422)) {
            await updateOwn(async (current) => {
              if (current.dispatches === 1) await storage.removeItem(key);
            });
          }
          throw error;
        }
        // A proved commit belongs to its original owner. Clearing this exact
        // key is safe after account change; displaying its response is not.
        try {
          await updateOwn(() => storage.removeItem(key));
        } catch {
          /* Known committed response remains success; a retained record safely replays it later. */
        }
        return response;
      })();
      inFlight.set(key, active);
      inFlightInput.set(key, input);
      const tracked = active;
      void active
        .finally(() => {
          if (inFlight.get(key) === tracked) {
            inFlight.delete(key);
            inFlightInput.delete(key);
          }
        })
        .catch(() => {
          /* caller owns the rejection */
        });
    }
    const response = await active;
    guard(isCurrent);
    return response as ProcurementResponse<T>;
  };
  return { list, execute };
}

/** Native JS runtime mutex; web adapter uses navigator.locks across tabs. */
export function createProcurementMutex() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    tails.set(key, next);
    void next
      .finally(() => {
        if (tails.get(key) === next) tails.delete(key);
      })
      .catch(() => {
        /* caller owns rejection */
      });
    return next;
  };
}
