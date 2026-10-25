/** Keep homepage aggregates fresh when an existing destination is invalidated.
 * A small structural interface keeps shared independent of platform installs. */
export const DASHBOARD_AGGREGATE_KEYS = ['dashboard-attention', 'salary-today-earnings'] as const;
const sources = new Set([
  'checks',
  'checks-infinite',
  'salary',
  'salary-my',
  'salary-employee-month',
  'salary-premiums',
  'salary-penalties',
  'premiums',
  'penalties',
  'motivation',
  'products',
  'stock-movements',
  'purchase-orders',
  'bookings',
  'installments',
  'returns',
]);
interface CacheEvent {
  type: string;
  action?: { type: string };
  query?: { queryKey: readonly unknown[] };
}
interface DashboardClient {
  invalidateQueries(filters: { queryKey: readonly string[] }): Promise<unknown>;
  getQueryCache(): { subscribe(callback: (event: CacheEvent) => void): () => void };
  getMutationCache(): { subscribe(callback: (event: { type: string; action?: { type: string } }) => void): () => void };
}
export function attachDashboardRefresh(client: DashboardClient): () => void {
  let queued = false;
  let active = true;
  const refresh = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (active) for (const key of DASHBOARD_AGGREGATE_KEYS) void client.invalidateQueries({ queryKey: [key] });
    });
  };
  const query = client.getQueryCache().subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.action?.type === 'invalidate' &&
      sources.has(String(event.query?.queryKey[0]))
    )
      refresh();
  });
  const mutation = client.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action?.type === 'success') refresh();
  });
  return () => {
    active = false;
    query();
    mutation();
  };
}
