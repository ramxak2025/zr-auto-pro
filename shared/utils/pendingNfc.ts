import type { AttendanceNfcRequestResult, AttendanceNfcScanResult } from '../types';
import type { ProcurementOwner, ProcurementStorage } from './durableProcurement';
import { ownsProcurementOutcome, runOwnedProcurement } from './procurementSession';

export type NfcOwner = ProcurementOwner;
export type NfcPendingStorage = Pick<ProcurementStorage, 'getItem' | 'setItem' | 'removeItem' | 'exclusive'>;
export interface PendingNfcScan {
  version: 1;
  owner: NfcOwner;
  requestId: string;
  /** SHA-256 hex only. The static tag bearer is NEVER persisted. */
  tokenHash: string;
  createdAt: string;
  submitted: boolean;
  dispatches: number;
}
export type NfcRecoveryOutcome =
  | { status: 'idle' }
  | { status: 'needs_tag'; pending: PendingNfcScan }
  | { status: 'completed'; result: AttendanceNfcScanResult; currentRefreshFailed?: true };
export interface NfcSession {
  owner: NfcOwner;
  /** A new opaque object for every authenticated tenant/user/point session. */
  lease: object;
  isCurrent(): boolean;
  /** Refetch current workshifts after a completed historical result, never
   * populate current state from that old snapshot. This must itself be scoped. */
  refreshCurrent(): Promise<void>;
}
export class NfcRecoveryError extends Error {
  constructor(
    public readonly code: 'STORAGE_UNAVAILABLE' | 'SESSION_CHANGED' | 'PENDING_SCAN' | 'UNCONFIRMED',
    message: string,
  ) {
    super(message);
    this.name = 'NfcRecoveryError';
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const storageError = () =>
  new NfcRecoveryError(
    'STORAGE_UNAVAILABLE',
    'Не удалось безопасно сохранить сканирование. Проверьте хранилище и повторите.',
  );
const pendingError = () =>
  new NfcRecoveryError('PENDING_SCAN', 'Сначала восстановите предыдущее сканирование: приложите ту же метку.');
const guard = (session: Pick<NfcSession, 'isCurrent'>) => {
  if (!session.isCurrent())
    throw new NfcRecoveryError(
      'SESSION_CHANGED',
      'Сессия изменилась. Сканирование сохранено для прежнего аккаунта и филиала.',
    );
};
const sameOwner = (a: NfcOwner, b: NfcOwner) =>
  a.tenantId === b.tenantId && a.userId === b.userId && a.pointId === b.pointId;
function key(owner: NfcOwner): string {
  if (!uuid.test(owner.tenantId) || !uuid.test(owner.userId) || (owner.pointId !== null && !uuid.test(owner.pointId)))
    throw storageError();
  return `autexa:nfc:v1:${owner.tenantId}/${owner.userId}/${owner.pointId ?? 'none'}`;
}
function parse(raw: string, owner: NfcOwner): PendingNfcScan {
  try {
    const value = JSON.parse(raw) as PendingNfcScan;
    if (
      Object.keys(value).sort().join(',') !== 'createdAt,dispatches,owner,requestId,submitted,tokenHash,version' ||
      value.version !== 1 ||
      !sameOwner(value.owner, owner) ||
      !uuid.test(value.requestId) ||
      !hash.test(value.tokenHash) ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !Number.isSafeInteger(value.dispatches) ||
      value.dispatches < 0 ||
      value.submitted !== value.dispatches > 0
    )
      throw storageError();
    return value;
  } catch {
    throw storageError();
  }
}
function confirmed(value: unknown, owner: NfcOwner): value is AttendanceNfcScanResult {
  const result = value as AttendanceNfcScanResult | null;
  return (
    !!result &&
    !(value as { queued?: boolean }).queued &&
    ['opened', 'confirmed', 'closed', 'unchanged'].includes(result.action) &&
    typeof result.shift?.id === 'string' &&
    uuid.test(result.shift.id) &&
    result.shift.tenantId === owner.tenantId &&
    result.shift.userId === owner.userId &&
    typeof result.serverAt === 'string' &&
    Number.isFinite(Date.parse(result.serverAt))
  );
}
/** Same outcome lease rule as financial recovery: latest React Query callbacks
 * cannot adopt another account's earlier response or error. */
export const ownsNfcOutcome = ownsProcurementOutcome;

/** Native owns only the storage/UUID/SHA-256 adapters and session-bound HTTP.
 * Neither this core nor its adapter may enqueue a scan for offline replay. */
export function createPendingNfc(
  storage: NfcPendingStorage,
  createId: () => string,
  sha256: (token: string) => Promise<string>,
) {
  const flights = new Map<string, { tokenHash: string; lease: object; promise: Promise<NfcRecoveryOutcome> }>();
  const read = async (owner: NfcOwner): Promise<PendingNfcScan | null> => {
    try {
      const raw = await storage.getItem(key(owner));
      return raw === null ? null : parse(raw, owner);
    } catch {
      throw storageError();
    }
  };
  const save = async (record: PendingNfcScan) => {
    const raw = JSON.stringify(record),
      recordKey = key(record.owner);
    try {
      await storage.setItem(recordKey, raw);
      if ((await storage.getItem(recordKey)) !== raw) throw storageError();
    } catch {
      throw storageError();
    }
  };
  const clear = async (record: PendingNfcScan) => {
    await storage.exclusive(key(record.owner), async () => {
      const current = await read(record.owner);
      if (current?.requestId === record.requestId) await storage.removeItem(key(record.owner));
    });
  };
  const pending = async (session: Pick<NfcSession, 'owner' | 'isCurrent'>) => {
    guard(session);
    const record = await read(session.owner);
    guard(session);
    return record;
  };
  const owned = (session: NfcSession, dispatch: () => Promise<NfcRecoveryOutcome>) => {
    let completed: Extract<NfcRecoveryOutcome, { status: 'completed' }> | null = null;
    return runOwnedProcurement({
      lease: session.lease,
      isCurrent: session.isCurrent,
      dispatch: async () => {
        const outcome = await dispatch();
        completed = outcome.status === 'completed' ? outcome : null;
        return outcome;
      },
      refresh: async () => {
        if (completed && session.isCurrent()) {
          try {
            await session.refreshCurrent();
          } catch {
            completed.currentRefreshFailed = true;
          }
        }
      },
    });
  };
  const scan = async (
    options: NfcSession & {
      token: string;
      /** Raw token exists only in this immediate authenticated request. */
      send(body: { token: string; requestId: string }): Promise<{ status: number; data: AttendanceNfcScanResult }>;
    },
  ): Promise<NfcRecoveryOutcome> =>
    owned(options, async () => {
      guard(options);
      if (!/^[A-Za-z0-9_-]{43}$/.test(options.token))
        throw new NfcRecoveryError('UNCONFIRMED', 'Некорректная NFC-метка.');
      const digest = await sha256(options.token);
      guard(options);
      if (!hash.test(digest)) throw storageError();
      const recordKey = key(options.owner),
        active = flights.get(recordKey);
      if (active) {
        if (active.tokenHash !== digest || active.lease !== options.lease) throw pendingError();
        return active.promise;
      }
      const task = (async (): Promise<NfcRecoveryOutcome> => {
        const record = await storage.exclusive(recordKey, async () => {
          guard(options);
          const old = await read(options.owner);
          guard(options);
          if (old) {
            if (old.tokenHash !== digest) throw pendingError();
            return old;
          }
          const requestId = createId();
          if (!uuid.test(requestId)) throw storageError();
          const saved: PendingNfcScan = {
            version: 1,
            owner: { ...options.owner },
            requestId,
            tokenHash: digest,
            createdAt: new Date().toISOString(),
            submitted: false,
            dispatches: 0,
          };
          await save(saved);
          guard(options);
          return saved;
        });
        // Mandatory claim: a delayed handler must never send an already completed
        // or replaced intent. The immutable ID is never regenerated on ambiguity.
        let firstDispatch = false;
        await storage.exclusive(recordKey, async () => {
          guard(options);
          const current = await read(options.owner);
          guard(options);
          if (current?.requestId !== record.requestId || current.tokenHash !== record.tokenHash) throw pendingError();
          firstDispatch = !current.submitted && current.dispatches === 0;
          // Persist uncertainty before the network call, including a restart
          // between this write and actual dispatch.
          await save({ ...current, submitted: true, dispatches: current.dispatches + 1 });
        });
        guard(options);
        let response: { status: number; data: AttendanceNfcScanResult };
        try {
          response = await options.send({ token: options.token, requestId: record.requestId });
        } catch (error) {
          const status = (error as { response?: { status?: number } })?.response?.status;
          if (firstDispatch && status !== undefined && [400, 403, 404, 422].includes(status)) {
            await storage.exclusive(recordKey, async () => {
              const current = await read(options.owner);
              if (current?.requestId === record.requestId && current.dispatches === 1) {
                await storage.removeItem(recordKey);
              }
            });
          }
          throw error;
        }
        guard(options);
        if (
          response.status < 200 ||
          response.status >= 300 ||
          response.status === 202 ||
          !confirmed(response.data, options.owner)
        ) {
          throw new NfcRecoveryError('UNCONFIRMED', 'Сканирование не подтверждено. Восстановите его результат.');
        }
        // If removal fails, retain the intent. A later self-read safely recovers
        // it; the confirmed result still must refresh the current workshifts.
        try {
          await clear(record);
        } catch {
          /* retained completed request is safe */
        }
        return { status: 'completed', result: response.data };
      })();
      flights.set(recordKey, { tokenHash: digest, lease: options.lease, promise: task });
      void task
        .finally(() => {
          if (flights.get(recordKey)?.promise === task) flights.delete(recordKey);
        })
        .catch(() => {
          /* caller owns rejection */
        });
      return task;
    });
  const recover = async (
    options: NfcSession & {
      lookup(requestId: string): Promise<{ status: number; data: AttendanceNfcRequestResult }>;
    },
  ): Promise<NfcRecoveryOutcome> =>
    owned(options, async () => {
      const record = await pending(options);
      if (!record) return { status: 'idle' };
      guard(options);
      const response = await options.lookup(record.requestId);
      guard(options);
      if (response.status < 200 || response.status >= 300 || response.status === 202)
        throw new NfcRecoveryError('UNCONFIRMED', 'Не удалось проверить сканирование. Повторите восстановление.');
      if (response.data.status === 'unknown') return { status: 'needs_tag', pending: record };
      if (response.data.status !== 'completed' || !confirmed(response.data.result, options.owner))
        throw new NfcRecoveryError('UNCONFIRMED', 'Сервер не подтвердил сохранённое сканирование.');
      try {
        await clear(record);
      } catch {
        /* retain for another authenticated historical read */
      }
      return { status: 'completed', result: response.data.result };
    });
  return { pending, scan, recover };
}
