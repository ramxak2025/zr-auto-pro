import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * CLS-контекст тенанта (этап 2, волна B — RLS).
 *
 * TenantContextInterceptor кладёт tenantID аутентифицированного запроса в
 * AsyncLocalStorage, а TenantAwarePool (common/tenant-pool.ts) читает его на
 * КАЖДОМ обращении к базе и решает, каким пулом идти:
 *   • контекст есть  → app-пул (роль autexa_app под RLS) c GUC app.tenant_id;
 *   • контекста нет  → admin-пул (как раньше): login/register, health,
 *     публичные вебхуки, кроны, superadmin-эндпоинты, миграции.
 *
 * Ни один колл-сайт `this.pool.query(...)` / `this.pool.connect()` при этом
 * не меняется — контекст течёт через async_hooks сквозь await-цепочки.
 */
interface TenantContextStore {
  tenantId: string;
}

const storage = new AsyncLocalStorage<TenantContextStore>();

/** Выполнить fn (и всю её async-цепочку) в контексте тенанта. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return storage.run({ tenantId }, fn);
}

/** tenantId текущего async-контекста или null (безтенантный путь). */
export function getCurrentTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}
