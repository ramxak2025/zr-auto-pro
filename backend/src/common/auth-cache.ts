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
