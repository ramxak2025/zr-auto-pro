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

/** Shape returned by JwtStrategy.validate and attached to the request user. */
export interface ValidatedUser {
  userID: string;
  tenantID: string;
  role: string;
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
