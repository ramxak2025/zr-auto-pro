import {
  AUTH_SESSION_ENVELOPE_KEY,
  LEGACY_IMPERSONATING_KEY,
  LEGACY_TOKEN_KEY,
  LEGACY_USER_KEY,
  parseAuthSessionEnvelope,
} from './authSessionStorage';

export const ACCOUNT_REGISTRY_KEY = 'autexa.auth.accounts.v1';
export const MAX_SAVED_ACCOUNTS = 3;
export interface AccountIdentity {
  userId: string;
  tenantId: string | null;
}
export interface AccountProfile {
  id: string;
  tenantId?: string;
  fullName?: string;
  role?: string;
  currentPointId?: string | null;
}
export interface AccountDataScope extends AccountIdentity {
  pointId: string | null;
}
export interface AccountSession<U> {
  token: string;
  user: U | null;
  impersonating: boolean;
}
export interface SavedAccount<U> {
  id: string;
  identity: AccountIdentity;
  displayName: string;
  role: string | null;
  needsReauth: boolean;
  session: AccountSession<U> | null;
  scopes: AccountDataScope[];
}
export interface AccountRegistry<U> {
  v: 1;
  revision: number;
  /** Changes on a logical session boundary, not on a profile-cache update. */
  generation: number;
  activeId: string | null;
  accounts: SavedAccount<U>[];
  /** Encrypted migration journal, removed only after conditional cleanup. */
  legacyCleanup?: [string, string][];
}
export type SavedAccountSummary = Omit<SavedAccount<never>, 'session' | 'scopes'> & { active: boolean };
export interface AccountKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}
export class AccountRegistryError extends Error {
  constructor(
    public readonly code:
      | 'STORAGE_UNAVAILABLE'
      | 'SESSION_CHANGED'
      | 'ACCOUNT_LIMIT'
      | 'REAUTH_REQUIRED'
      | 'ACCOUNT_MISMATCH'
      | 'UNRESOLVED_INTENTS',
    message: string,
  ) {
    super(message);
    this.name = 'AccountRegistryError';
  }
}
const changed = () =>
  new AccountRegistryError('SESSION_CHANGED', 'Сессия изменилась. Повторите действие из текущего аккаунта.');
const storageError = () =>
  new AccountRegistryError(
    'STORAGE_UNAVAILABLE',
    'Не удалось безопасно сохранить аккаунт. Повторите после восстановления хранилища.',
  );
export const accountId = (identity: AccountIdentity): string => JSON.stringify([identity.tenantId, identity.userId]);
export const accountIdentity = (user: AccountProfile): AccountIdentity => ({
  userId: user.id,
  tenantId: user.tenantId || null,
});
const empty = <U>(): AccountRegistry<U> => ({ v: 1, revision: 0, generation: 0, activeId: null, accounts: [] });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function rememberScope<U extends AccountProfile>(account: SavedAccount<U>, user: U | null) {
  if (!user || (user.tenantId && user.currentPointId === undefined)) return;
  const scope = { ...accountIdentity(user), pointId: user.currentPointId ?? null };
  if (!account.scopes.some((s) => JSON.stringify(s) === JSON.stringify(scope))) account.scopes.push(scope);
}

/** Local ownership validation only. JWT signature/authorisation still belongs to the server. */
export function tokenIdentity(token: string): {
  identity: AccountIdentity;
  impersonatedBy: string | null;
  expiresAt: number | null;
  pointId: string | null;
} | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4))) as Record<string, unknown>;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return {
      identity: { userId: payload.sub, tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null },
      impersonatedBy: typeof payload.impersonatedBy === 'string' ? payload.impersonatedBy : null,
      expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : null,
      pointId: typeof payload.pointId === 'string' ? payload.pointId : null,
    };
  } catch {
    return null;
  }
}

/** One encrypted, atomic native value is authoritative. No token ever goes to
 * AsyncStorage. The serial tail never releases a still-running native write:
 * callers may cancel their ownership, but A cannot physically overwrite B.
 * A process death during setItem leaves either complete registry version.
 */
export function createAccountRegistry<U extends AccountProfile>(
  secure: AccountKeyValueStorage,
  legacy: AccountKeyValueStorage,
  isUser: (value: unknown) => value is U,
) {
  let tail: Promise<unknown> = Promise.resolve();
  let current: AccountRegistry<U> | null = null;
  let publishedRaw: string | null = null;
  const listeners = new Set<() => void>();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.catch(() => {}).then(work);
    tail = run.catch(() => {});
    return run;
  };
  const publish = (value: AccountRegistry<U>) => {
    const raw = JSON.stringify(value);
    if (publishedRaw === raw) return;
    publishedRaw = raw;
    current = clone(value);
    for (const listener of listeners) listener();
  };
  const validateSession = (session: AccountSession<U>): AccountIdentity => {
    const decoded = tokenIdentity(session.token);
    if (
      !decoded ||
      (session.user &&
        (!isUser(session.user) || accountId(accountIdentity(session.user)) !== accountId(decoded.identity)))
    )
      throw new AccountRegistryError('ACCOUNT_MISMATCH', 'Ответ входа не соответствует аккаунту.');
    if (!!decoded.impersonatedBy !== session.impersonating)
      throw new AccountRegistryError('ACCOUNT_MISMATCH', 'Некорректный тип сессии.');
    // Legacy/impersonation tokens omit the point; the server resolves their
    // default point. An explicit token point may never inherit another cache.
    if (
      decoded.pointId &&
      session.user?.currentPointId !== undefined &&
      session.user.currentPointId !== decoded.pointId
    )
      throw new AccountRegistryError('ACCOUNT_MISMATCH', 'Профиль не соответствует филиалу сессии.');
    return decoded.identity;
  };
  const parse = (raw: string): AccountRegistry<U> => {
    try {
      const value = JSON.parse(raw) as AccountRegistry<U>;
      if (
        value.v !== 1 ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        !Number.isSafeInteger(value.generation) ||
        value.generation < 0 ||
        !Array.isArray(value.accounts) ||
        value.accounts.length > MAX_SAVED_ACCOUNTS
      )
        throw storageError();
      const ids = new Set<string>();
      for (const a of value.accounts) {
        if (
          !a.identity ||
          typeof a.identity.userId !== 'string' ||
          !a.identity.userId ||
          (a.identity.tenantId !== null && typeof a.identity.tenantId !== 'string') ||
          a.id !== accountId(a.identity) ||
          ids.has(a.id) ||
          typeof a.displayName !== 'string' ||
          (a.role !== null && typeof a.role !== 'string') ||
          typeof a.needsReauth !== 'boolean' ||
          a.needsReauth !== (a.session === null)
        )
          throw storageError();
        ids.add(a.id);
        if (
          !Array.isArray(a.scopes) ||
          a.scopes.some(
            (s) =>
              !s ||
              typeof s.userId !== 'string' ||
              (s.tenantId !== null && typeof s.tenantId !== 'string') ||
              (s.pointId !== null && typeof s.pointId !== 'string'),
          )
        )
          throw storageError();
        if (a.session) {
          const identity = validateSession(a.session);
          const original = tokenIdentity(a.session.token)?.impersonatedBy;
          if (original ? a.identity.userId !== original || a.identity.tenantId !== null : accountId(identity) !== a.id)
            throw storageError();
        }
      }
      if (
        value.activeId !== null &&
        !value.accounts.some((a) => a.id === value.activeId && a.session && !a.needsReauth)
      )
        throw storageError();
      if (
        value.legacyCleanup !== undefined &&
        (!Array.isArray(value.legacyCleanup) ||
          value.legacyCleanup.some(
            (p) =>
              !Array.isArray(p) ||
              p.length !== 2 ||
              ![AUTH_SESSION_ENVELOPE_KEY, LEGACY_TOKEN_KEY, LEGACY_USER_KEY, LEGACY_IMPERSONATING_KEY].includes(
                p[0],
              ) ||
              typeof p[1] !== 'string',
          ))
      )
        throw storageError();
      return value;
    } catch {
      throw storageError();
    }
  };
  const persist = async (next: AccountRegistry<U>): Promise<AccountRegistry<U>> => {
    const raw = JSON.stringify(next);
    try {
      await secure.setItem(ACCOUNT_REGISTRY_KEY, raw);
      if ((await secure.getItem(ACCOUNT_REGISTRY_KEY)) !== raw) throw storageError();
    } catch {
      current = null;
      publishedRaw = null;
      throw storageError();
    }
    publish(next);
    return clone(next);
  };
  const readLegacy = async () => {
    const keys = [AUTH_SESSION_ENVELOPE_KEY, LEGACY_TOKEN_KEY, LEGACY_USER_KEY, LEGACY_IMPERSONATING_KEY];
    const pairs = await Promise.all(keys.map(async (key) => [key, await legacy.getItem(key)] as const));
    const map = Object.fromEntries(pairs);
    const envelope = parseAuthSessionEnvelope(map[AUTH_SESSION_ENVELOPE_KEY]);
    let user: U | null = null;
    if (envelope) user = isUser(envelope.user) ? envelope.user : null;
    else {
      try {
        const parsed: unknown = JSON.parse(map[LEGACY_USER_KEY] ?? 'null');
        if (isUser(parsed)) user = parsed;
      } catch {
        /* No cached profile: restore only after /auth/me. */
      }
    }
    const token = envelope ? envelope.token : map[LEGACY_TOKEN_KEY];
    const session = token
      ? { token, user, impersonating: envelope ? envelope.impersonating : map[LEGACY_IMPERSONATING_KEY] === '1' }
      : null;
    return { pairs, session };
  };
  const finishMigration = async (registry: AccountRegistry<U>): Promise<AccountRegistry<U>> => {
    if (!registry.legacyCleanup) return registry;
    try {
      for (const [key, value] of registry.legacyCleanup) {
        if ((await legacy.getItem(key)) === value) await legacy.removeItem(key);
      }
    } catch {
      return registry; /* Proof survives restart; no credential loss. */
    }
    const next = clone(registry);
    delete next.legacyCleanup;
    next.revision += 1;
    return persist(next);
  };
  const load = async (): Promise<AccountRegistry<U>> => {
    // Always read the authoritative key. A rejected write may nevertheless
    // have reached native storage; no stale in-memory snapshot may overwrite it.
    let raw: string | null;
    try {
      raw = await secure.getItem(ACCOUNT_REGISTRY_KEY);
    } catch {
      throw storageError();
    }
    if (raw !== null) {
      const next = parse(raw);
      publish(next);
      return finishMigration(next);
    }
    let old: Awaited<ReturnType<typeof readLegacy>>;
    try {
      old = await readLegacy();
    } catch {
      throw storageError();
    }
    const next = empty<U>();
    if (old.session) {
      const effective = validateSession(old.session);
      const original = tokenIdentity(old.session.token)?.impersonatedBy;
      const identity = original ? { userId: original, tenantId: null } : effective;
      const id = accountId(identity);
      next.accounts.push({
        id,
        identity,
        displayName: original ? 'Исходный аккаунт' : (old.session.user?.fullName ?? 'Аккаунт'),
        role: original ? null : (old.session.user?.role ?? null),
        needsReauth: false,
        session: old.session,
        scopes: [],
      });
      rememberScope(next.accounts[0], old.session.user);
      next.activeId = id;
    }
    next.revision = 1;
    next.legacyCleanup = old.pairs
      .filter((pair): pair is readonly [string, string] => pair[1] !== null)
      .map(([key, value]) => [key, value]);
    await persist(next);
    // Secure commit + readback is complete. Delete only exact values observed
    // during this migration; a newer writer/old build's token is never removed.
    return finishMigration(next);
  };
  const mutate = <T>(
    expectedGeneration: number,
    operation: (next: AccountRegistry<U>) => T,
    isCurrent: () => boolean = () => true,
  ) =>
    serial(async () => {
      const previous = await load();
      if (!isCurrent() || previous.generation !== expectedGeneration) throw changed();
      const next = clone(previous);
      const result = operation(next);
      if (!isCurrent()) throw changed();
      next.revision += 1;
      const saved = await persist(next);
      return { registry: saved, result };
    });
  return {
    read: () => serial(async () => clone(await load())),
    snapshot: () => (current ? clone(current) : null),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    install: (
      session: AccountSession<U>,
      expectedGeneration: number,
      options: { originalAccountId?: string; reauthAccountId?: string; isCurrent?: () => boolean } = {},
    ) =>
      mutate(
        expectedGeneration,
        (next) => {
          const effective = validateSession(session);
          const id = options.originalAccountId ?? accountId(effective);
          if (options.reauthAccountId && options.reauthAccountId !== id)
            throw new AccountRegistryError('ACCOUNT_MISMATCH', 'Войдите именно в выбранный аккаунт.');
          let slot = next.accounts.find((a) => a.id === id);
          if (options.originalAccountId && !slot) throw changed();
          if (slot && options.originalAccountId) {
            const original = tokenIdentity(session.token)?.impersonatedBy;
            if (
              original
                ? original !== slot.identity.userId || slot.identity.tenantId !== null
                : accountId(effective) !== slot.id
            )
              throw new AccountRegistryError('ACCOUNT_MISMATCH', 'Сессия принадлежит другому аккаунту.');
          }
          if (!slot) {
            if (session.impersonating)
              throw new AccountRegistryError('ACCOUNT_MISMATCH', 'Имперсонация требует исходный аккаунт.');
            if (next.accounts.length >= MAX_SAVED_ACCOUNTS)
              throw new AccountRegistryError('ACCOUNT_LIMIT', 'Можно сохранить не более трёх аккаунтов.');
            slot = {
              id,
              identity: effective,
              displayName: session.user?.fullName ?? 'Аккаунт',
              role: session.user?.role ?? null,
              needsReauth: false,
              session,
              scopes: [],
            };
            next.accounts.push(slot);
          }
          slot.session = clone(session);
          slot.needsReauth = false;
          rememberScope(slot, session.user);
          if (!session.impersonating) {
            slot.displayName = session.user?.fullName ?? slot.displayName;
            slot.role = session.user?.role ?? slot.role;
          }
          next.activeId = id;
          next.generation += 1;
          return id;
        },
        options.isCurrent,
      ),
    activate: (id: string, generation: number, isCurrent?: () => boolean) =>
      mutate(
        generation,
        (next) => {
          const account = next.accounts.find((a) => a.id === id);
          if (!account?.session || account.needsReauth)
            throw new AccountRegistryError('REAUTH_REQUIRED', 'Войдите в этот аккаунт снова.');
          const expiresAt = tokenIdentity(account.session.token)?.expiresAt;
          if (expiresAt != null && expiresAt <= Date.now()) {
            account.session = null;
            account.needsReauth = true;
            if (next.activeId === id) {
              next.activeId = null;
              next.generation += 1;
            }
            return false;
          }
          next.activeId = id;
          next.generation += 1;
          return true;
        },
        isCurrent,
      ),
    update: (session: AccountSession<U>, generation: number, isCurrent?: () => boolean) =>
      mutate(
        generation,
        (next) => {
          const slot = next.accounts.find((a) => a.id === next.activeId);
          if (!slot?.session) throw changed();
          const identity = validateSession(session);
          if (
            accountId(identity) !== accountId(validateSession(slot.session)) ||
            session.impersonating !== slot.session.impersonating
          )
            throw changed();
          slot.session = clone(session);
          rememberScope(slot, session.user);
        },
        isCurrent,
      ),
    expire: (generation: number, isCurrent?: () => boolean) =>
      mutate(
        generation,
        (next) => {
          const slot = next.accounts.find((a) => a.id === next.activeId);
          if (slot) {
            slot.session = null;
            slot.needsReauth = true;
          }
          next.activeId = null;
          next.generation += 1;
        },
        isCurrent,
      ),
    /** A synchronous logout/401 can overtake a pending native install. Once
     * that older write settles, clear only the account that owned the logout;
     * an authenticated but canceled Add may remain saved, never active. */
    deactivate: (id: string | null, isCurrent: () => boolean) =>
      serial(async () => {
        const next = clone(await load());
        if (!isCurrent()) throw changed();
        const slot = next.accounts.find((a) => a.id === id);
        if (slot) {
          slot.session = null;
          slot.needsReauth = true;
        }
        next.activeId = null;
        next.generation += 1;
        next.revision += 1;
        return persist(next);
      }),
    remove: (id: string, generation: number, isCurrent?: () => boolean) =>
      mutate(
        generation,
        (next) => {
          const previous = next.accounts.find((a) => a.id === id);
          next.accounts = next.accounts.filter((a) => a.id !== id);
          if (next.activeId === id) {
            for (const account of next.accounts) {
              const expiresAt = account.session ? tokenIdentity(account.session.token)?.expiresAt : null;
              if (expiresAt != null && expiresAt <= Date.now()) {
                account.session = null;
                account.needsReauth = true;
              }
            }
            next.activeId = next.accounts.find((a) => a.session && !a.needsReauth)?.id ?? null;
          }
          next.generation += 1;
          return previous ?? null;
        },
        isCurrent,
      ),
  };
}

export function activeAccount<U>(registry: AccountRegistry<U> | null): SavedAccount<U> | null {
  return registry?.accounts.find((a) => a.id === registry.activeId) ?? null;
}
export function accountSummaries<U>(registry: AccountRegistry<U> | null): SavedAccountSummary[] {
  return (
    registry?.accounts.map(({ session: _session, scopes: _scopes, ...account }) => ({
      ...account,
      active: account.id === registry.activeId,
    })) ?? []
  );
}
