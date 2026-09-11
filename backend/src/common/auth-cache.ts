import { ttlCache } from './ttl-cache';

/**
 * Short-lived cache of successful JWT validations (see JwtStrategy.validate).
 *
 * Goal: collapse the 2 DB hops (revoked_tokens + users) that every
 * authenticated request otherwise pays into one per (user, token) per TTL.
 *
 * SECURITY: this is auth state, so the TTL is deliberately short (30s) and we
 * invalidate eagerly on the events that must take effect immediately:
 *   • logout / token revoke  → drop the single (user, jti) entry
 *   • user role / permission / active change, or user delete
 *                            → drop ALL of that user's entries (prefix purge)
 *
 * The 30s TTL is the upper bound on how long a stale-but-still-signed token
 * could be honoured if some future code path forgets to invalidate. Only
 * POSITIVE results are ever cached — a revoked/deactivated token throws and
 * the rejection is never stored (TtlCache.wrap only caches resolved values).
 */
export const AUTH_CACHE_TTL_MS = 30_000;

/**
 * Sentinel tenant id for a user that has NO tenant (users.tenant_id IS NULL —
 * i.e. a global `superadmin`).
 *
 * Why a nil-UUID instead of '' or null:
 *   • `tenant_id` columns are `uuid`. Feeding an empty string into any
 *     `WHERE tenant_id = $1` makes Postgres cast '' → uuid and throw 22P02
 *     ("invalid input syntax for type uuid"), which surfaced as a 500 on
 *     EVERY tenant-scoped endpoint the web app-shell fires while a superadmin
 *     browses /admin (users, products, clients, subscription, …).
 *   • `null` would be correct too, but `tenantID` is typed `string` and
 *     threaded through ~40 controllers → services as a non-null `string`;
 *     widening it to `string | null` ripples across the whole protected API.
 *   • The nil-UUID is a valid uuid that no real tenant ever owns (tenants get
 *     random v4 ids), so tenant-scoped filters return an EMPTY set (200 []),
 *     never a crash — the correct answer for a tenant-less user. It also flows
 *     safely through the RLS GUC cast (see TenantContextInterceptor).
 */
export const NO_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * True when a caller has NO real tenant — i.e. a global `superadmin` browsing
 * the /admin cabinet without impersonating any tenant. Their `tenantID` is
 * either falsy (defensive) or the nil-UUID sentinel (`NO_TENANT_ID`), which is
 * a valid uuid that no real `tenants` row ever owns.
 *
 * Why this is the ONE predicate every tenant-scoped write/seed path checks:
 *   • tenant-scoped SELECTs are already safe — the sentinel simply matches no
 *     rows and returns an empty set (see NO_TENANT_ID).
 *   • tenant-scoped WRITES (INSERT/UPSERT, including the "seed a default row on
 *     first access" pattern hidden inside some GET handlers) are NOT safe: an
 *     INSERT with `tenant_id = NO_TENANT_ID` FK-violates
 *     `<table>_tenant_id_fkey` (no such tenant) → an unhandled 500. This helper
 *     lets both the global TenantWriteGuardInterceptor and the per-service
 *     lazy-seed guards short-circuit on exactly the same condition.
 *
 * Accepts either the whole validated user or a bare tenantID string so callers
 * can use whichever they have in hand. A NON-superadmin with a real tenant is
 * never tenant-less; a superadmin acting WITHIN a tenant (real uuid tenantID,
 * e.g. impersonation) is likewise never tenant-less — the guard must not fire.
 */
export function isTenantLess(input: { role?: string; tenantID?: string } | string | null | undefined): boolean {
  if (input == null) return false;
  if (typeof input === 'string') {
    // Bare tenantID: tenant-less iff falsy or the sentinel. (Used by service
    // lazy-seed guards that already know the caller is tenant-scoped.)
    return !input || input === NO_TENANT_ID;
  }
  if (input.role !== 'superadmin') return false;
  const t = input.tenantID;
  return !t || t === NO_TENANT_ID;
}

/** Shape returned by JwtStrategy.validate and attached to the request user. */
export interface ValidatedUser {
  userID: string;
  tenantID: string;
  role: string;
  /**
   * The user's action-permission map (users.permissions JSON). Loaded here so
   * PermissionsGuard can enforce server-side without an extra DB hop. Cached
   * alongside the rest of the validation result; a permission change already
   * purges this user's cache via invalidateAuthUser (UsersService.update), so
   * the 30s TTL is the only staleness window — identical to role/is_active.
   */
  permissions: Record<string, boolean>;
  /**
   * ФИЛИАЛ СЕССИИ (163). Приезжает ИЗ ТОКЕНА (claim `pointId`), а не из строки
   * пользователя: филиал выбирается при входе и живёт ровно столько, сколько
   * живёт сессия. Веб и телефон одного человека могут сидеть в РАЗНЫХ филиалах
   * и не мешают друг другу — раньше обе сессии делили одну колонку
   * users.current_point_id, и переключение на телефоне молча уводило веб.
   *
   * null означает РОВНО ОДНО: у тенанта нет ни одного живого филиала
   * (одноточечный автосервис) — фильтра нет, поведение прежнее. Рабочего
   * режима «все филиалы» больше не существует: он рождал денежные строки без
   * филиала, невидимые ни в одном филиальном срезе.
   *
   * Значение вычисляется тем же SELECT'ом, что роль и матрица (нулевой доп.
   * DB-hop), и живёт в этом же 30-секундном кеше. Там же проверяется, что
   * филиал ЕЩЁ ЖИВ и ЕЩЁ ДОСТУПЕН сотруднику; события, которые это меняют
   * (снятие доступа, архивация филиала), обязаны звать invalidateAuthUser —
   * иначе снятый сотрудник ещё до 30 секунд работал бы там, откуда его убрали.
   */
  currentPointId: string | null;
  jti: string | undefined;
}

const AUTH_CACHE_NAMESPACE = 'auth:jwt:';

/**
 * Key embeds userID first so a single prefix purge drops every cached token
 * for that user (needed on role/permission/active change), and jti second so
 * logout can drop exactly one token.
 */
export function authCacheKey(userID: string, jti: string): string {
  return `${AUTH_CACHE_NAMESPACE}${userID}:${jti}`;
}

/** Drop the cached validation for one specific token (logout / revoke). */
export function invalidateAuthToken(userID: string, jti: string): void {
  ttlCache.invalidate(authCacheKey(userID, jti));
}

/**
 * Drop every cached validation for a user. Call after any change that affects
 * authorization: role, permissions, is_active, or deletion. After this, the
 * user's next request re-reads the live `users` row.
 */
export function invalidateAuthUser(userID: string): void {
  ttlCache.invalidatePrefix(`${AUTH_CACHE_NAMESPACE}${userID}:`);
}
