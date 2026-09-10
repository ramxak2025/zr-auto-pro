import { ttlCache } from './ttl-cache';

/**
 * Single source of truth for purging cached report aggregates after a write.
 *
 * Report cache keys are shaped `reports:<kind>:<tenantID>[:...]` — the tenant
 * id sits in the 3rd segment, so a flat `reports:<tenant>` prefix would NOT
 * match. Instead we purge each known family scoped to the tenant, which leaves
 * other tenants' caches untouched.
 *
 * ФИЛИАЛЫ (156/160): агрегаты кешируются ОТДЕЛЬНО НА КАЖДУЮ ТОЧКУ, и сегмент
 * точки стоит СРАЗУ ПОСЛЕ tenantID — `reports:<kind>:<tenant>:<point|all>:…`.
 * Порядок сегментов не косметика: префикс ниже обрывается на тенанте, поэтому
 * точка ПЕРЕД ним увела бы ключ из-под инвалидации, и филиал ещё 30 секунд
 * показывал бы дореализационные цифры. Новый вид ключа добавлять сюда же.
 *
 * Keep this list in sync with every `ttlCache.wrap('reports:...')` key:
 *   - reports:dashboard-v2:<tenant>:<point>:<period>    (reports.service)
 *   - reports:alerts:<tenant>:<point>                   (reports.service)
 *   - reports:dashboard-chart:<tenant>:<point>:<...>    (checks.service)
 *   - reports:ranking:<tenant>:<point>                  (checks.service)
 *   - reports:points-summary:<tenant>                   (points.service)
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
  ttlCache.invalidatePrefix(`reports:points-summary:${tenantID}`);
}
