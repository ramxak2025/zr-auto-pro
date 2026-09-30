/*
 * Ключи React Query кабинетов менеджеров — в одном месте, чтобы инвалидация после продления,
 * передачи клиента или расчёта не расходилась со страницами. Префиксные ключи (`tenants`, `ledger`)
 * получают хвост с параметрами фильтра, поэтому инвалидируются по префиксу.
 */

/** Кабинет суперадмина: раздел «Менеджеры». */
export const adminManagerKeys = {
  list: ['admin-managers'] as const,
  /** Префикс всех карточек менеджеров. */
  detailAll: ['admin-manager'] as const,
  detail: (id: string) => ['admin-manager', id] as const,
  /** Префикс всех лент расчётов. */
  ledgerAll: ['admin-manager-ledger'] as const,
  ledger: (id: string, months: number) => ['admin-manager-ledger', id, months] as const,
  audit: (id: string) => ['admin-manager-audit', id] as const,
};

/** Кабинет менеджера. */
export const managerKeys = {
  summary: ['manager-summary'] as const,
  /** Префикс списка своих автосервисов (хвост — фильтр статуса). */
  tenantsAll: ['manager-tenants'] as const,
  tenants: (status: string) => ['manager-tenants', status] as const,
  tenant: (id: string) => ['manager-tenant', id] as const,
  cabinet: (id: string) => ['manager-tenant-cabinet', id] as const,
  ledgerAll: ['manager-ledger'] as const,
  ledger: (months: number) => ['manager-ledger', months] as const,
};
