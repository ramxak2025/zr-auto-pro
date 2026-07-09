import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key read by TenantWriteGuardInterceptor.
 */
export const ALLOW_NO_TENANT_KEY = 'allowNoTenant';

/**
 * Opt a route (or a whole controller) OUT of the tenant-less write block.
 *
 * Background: TenantWriteGuardInterceptor rejects a MUTATION (POST/PUT/PATCH/
 * DELETE) issued by a tenant-less superadmin (a global `superadmin` with no
 * real tenant — `tenantID` falsy or the `NO_TENANT_ID` nil-UUID sentinel)
 * BEFORE the handler runs, so no INSERT with the phantom sentinel tenant ever
 * fires and FK-violates → 500. See that interceptor for the full rationale.
 *
 * Apply this decorator to the handful of writes that a tenant-less user
 * LEGITIMATELY performs and that do NOT insert a row under the sentinel tenant:
 *   • superadmin cross-tenant admin ops (manage tenants/plans by explicit :id);
 *   • self-service account ops that key off userID, not tenant_id
 *     (account deletion, logout);
 *   • push-token registration (push_tokens has no tenant_id FK — a superadmin
 *     must still receive operator push).
 *
 * Placed on a @Controller it exempts every route of that controller; placed on
 * a single handler it exempts just that route (handler wins — it's read with
 * getAllAndOverride so a class-level allow can't be narrowed, only widened).
 *
 * NOTE: reads (GET) are never touched by the interceptor — the sentinel already
 * makes tenant-scoped SELECTs return empty. This decorator is only about writes.
 */
export const AllowNoTenant = () => SetMetadata(ALLOW_NO_TENANT_KEY, true);
