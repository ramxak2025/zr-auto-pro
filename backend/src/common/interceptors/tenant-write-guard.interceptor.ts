import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { isTenantLess } from '../auth-cache';
import { ALLOW_NO_TENANT_KEY } from '../decorators/allow-no-tenant.decorator';

/**
 * TenantWriteGuardInterceptor — the ONE systemic mechanism that stops a
 * tenant-less superadmin from 500-ing any tenant-scoped MUTATION.
 *
 * ── The bug class it kills ─────────────────────────────────────────────────
 * A global `superadmin` browsing the /admin cabinet has NO real tenant. In
 * jwt.strategy that becomes the nil-UUID sentinel `NO_TENANT_ID` so tenant-
 * scoped SELECTs safely return empty. WRITES are the remaining hazard: any
 * INSERT/UPSERT with `tenant_id = NO_TENANT_ID` FK-violates
 * `<table>_tenant_id_fkey` (no such tenants row) and surfaces as an unhandled
 * 500. That happened across ~15 endpoints, including several GET handlers that
 * quietly "seed a default row on first access". The per-service guards
 * (warehouses, schedule, products, …) were whack-a-mole; this interceptor is
 * the blanket rule so any NEW mutation is covered by construction.
 *
 * ── Why an interceptor, not an APP_GUARD ───────────────────────────────────
 * JwtAuthGuard is applied PER CONTROLLER in this app (main.ts wires only the
 * global RateLimitGuard). A global APP_GUARD runs BEFORE the controller's
 * JwtAuthGuard, so `request.user` isn't populated yet — same reason
 * TenantContextInterceptor is an interceptor. An interceptor runs AFTER all
 * guards (user is proven and attached). Throwing here — before we subscribe to
 * the handler — short-circuits cleanly through HttpExceptionFilter as a typed
 * 409, never a 500, and the handler (and its INSERT) never runs.
 *
 * ── What it touches (narrow by construction) ───────────────────────────────
 * It fires ONLY when ALL of these hold:
 *   1. HTTP request;
 *   2. method is a MUTATION (POST/PUT/PATCH/DELETE) — GETs are left as-is, the
 *      sentinel already makes their SELECTs empty and the web admin must not
 *      break;
 *   3. `isTenantLess(user)` — i.e. role === 'superadmin' AND tenantID is falsy
 *      or the sentinel. A regular role, a real tenant, or a superadmin acting
 *      WITHIN a tenant (real uuid tenantID, e.g. impersonation) is byte-for-byte
 *      unaffected;
 *   4. the route is NOT opted out via @AllowNoTenant() and NOT under a
 *      global/admin path prefix.
 *
 * ── Exclusions ─────────────────────────────────────────────────────────────
 *   • @AllowNoTenant() on the handler or its controller — the explicit marker
 *     for legit tenant-less writes (account delete, logout, push token, the
 *     superadmin cross-tenant admin controllers).
 *   • A path-prefix safety net for the superadmin GLOBAL surfaces so we never
 *     block them even if a decorator is forgotten: /tenants, /plans, /admin,
 *     /auth, /health, /registration-requests. These operate cross-tenant (by
 *     explicit :id) or are unauthenticated, and never insert under the caller's
 *     own tenant_id.
 *
 * When unsure we fail OPEN for reads (never touched) and only block a clearly
 * tenant-scoped write, so a real user flow can never be broken by this guard.
 */
@Injectable()
export class TenantWriteGuardInterceptor implements NestInterceptor {
  /**
   * Global surfaces a tenant-less superadmin legitimately mutates. Matched
   * against the path AFTER the global `api` prefix is stripped, as a path
   * SEGMENT prefix (so `/tenants` matches `/tenants/:id/extend` but a
   * hypothetical `/tenants-x` would not). Kept in sync with the @AllowNoTenant
   * controllers; the prefix list is the belt to the decorator's braces.
   */
  private static readonly ALLOWED_PREFIXES = ['tenants', 'plans', 'admin', 'auth', 'health', 'registration-requests'];

  private static readonly MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{
      method?: string;
      path?: string;
      url?: string;
      user?: { role?: string; tenantID?: string };
    }>();

    // Only mutations can INSERT under the sentinel — GETs are always safe.
    const method = (request?.method || '').toUpperCase();
    if (!TenantWriteGuardInterceptor.MUTATION_METHODS.has(method)) {
      return next.handle();
    }

    // Only a tenant-less superadmin is at risk. Everyone else is unaffected —
    // this is the invariant that guarantees zero behaviour change for real
    // tenants, regular roles, and a superadmin impersonating a real tenant.
    if (!isTenantLess(request?.user)) {
      return next.handle();
    }

    // Explicit opt-out wins (handler-level narrows, class-level widens).
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return next.handle();
    }

    // Path-prefix safety net for the superadmin's own global/admin surfaces.
    // Prefer `path` (pathname, no query) — matches RateLimitGuard's convention.
    if (this.isAllowedPrefix(request?.path || request?.url)) {
      return next.handle();
    }

    // Reject BEFORE the handler runs — no INSERT with the phantom tenant fires.
    // ConflictException (409) routes through the global HttpExceptionFilter as a
    // typed response, never an unhandled 500.
    throw new ConflictException({
      message: 'Действие недоступно без выбранного автосервиса. Откройте карточку автосервиса.',
      code: 'NO_TENANT_CONTEXT',
    });
  }

  /**
   * True when the request path (after the `api` global prefix, ignoring the
   * query string) starts with one of the allowed segment prefixes.
   */
  private isAllowedPrefix(url: string | undefined): boolean {
    if (!url) return false;
    // Strip query string and the global `api` prefix, then split into segments.
    const path = url.split('?')[0].replace(/^\/+/, '');
    const segments = path.split('/');
    const head = segments[0] === 'api' ? segments[1] : segments[0];
    if (!head) return false;
    return TenantWriteGuardInterceptor.ALLOWED_PREFIXES.includes(head);
  }
}
