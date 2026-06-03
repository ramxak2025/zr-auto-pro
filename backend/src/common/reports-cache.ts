import { ttlCache } from './ttl-cache';

/**
 * Single source of truth for purging cached report aggregates after a write.
 *
 * Report cache keys are shaped `reports:<kind>:<tenantID>[:...]` — the tenant
 * id sits in the 3rd segment, so a flat `reports:<tenant>` prefix would NOT
 * match. Instead we purge each known family scoped to the tenant, which leaves
 * other tenants' caches untouched.
 *
 * Keep this list in sync with every `ttlCache.wrap('reports:...')` key:
 *   - reports:dashboard-v2:<tenant>:<period>   (reports.service)
 *   - reports:alerts:<tenant>                  (reports.service)
 *   - reports:dashboard-chart:<tenant>:<...>   (checks.service)
 *   - reports:ranking:<tenant>                 (checks.service)
 *
 * Callers: ChecksService (check create/update/delete) and ExpensesService
 * (expense create/approve/reject/delete) — anything that moves revenue,
 * profit, cash-position or the alert set.
 */
export function invalidateReportsForTenant(tenantID: string): void {
  ttlCache.invalidatePrefix(`reports:dashboard-v2:${tenantID}`);
  ttlCache.invalidatePrefix(`reports:dashboard-chart:${tenantID}`);
  ttlCache.invalidatePrefix(`reports:ranking:${tenantID}`);
  ttlCache.invalidatePrefix(`reports:alerts:${tenantID}`);
}
