import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Route-to-query mapping for prefetching.
 * When the user hovers on a navigation link, we prefetch
 * the most likely queries for that route.
 */
const ROUTE_QUERIES: Record<string, unknown[][]> = {
  '/dashboard': [['dashboard-chart', 'week', '0'], ['schedule-today'], ['employee-ranking']],
  '/checks': [['checks', 1], ['masters']],
  '/clients': [['clients']],
  '/products': [['products', { limit: 1000 }], ['warehouse-categories']],
  '/services': [['services']],
  '/suppliers': [['suppliers']],
  '/salary': [['salary']],
  '/reports': [['financial-report']],
  '/cashflow': [['cashflow']],
  '/expenses': [['expenses'], ['expense-categories']],
  '/users': [['users']],
  '/schedule': [['schedule']],
  '/marketing': [['marketing-dashboard']],
};

/**
 * Returns `onMouseEnter` / `onTouchStart` handlers that trigger
 * React Query prefetch for the given route path.
 *
 * Usage:
 *   const prefetch = useRoutePrefetch();
 *   <NavLink {...prefetch('/dashboard')} to="/dashboard">Dashboard</NavLink>
 */
export function useRoutePrefetch() {
  const queryClient = useQueryClient();

  const prefetch = useCallback(
    (path: string) => {
      const queryKeys = ROUTE_QUERIES[path];
      if (!queryKeys) return {};

      const trigger = () => {
        for (const key of queryKeys) {
          // Only prefetch if the query is not already in cache
          const existing = queryClient.getQueryData(key);
          if (!existing) {
            queryClient.prefetchQuery({
              queryKey: key,
              // We don't provide queryFn here — React Query will use the
              // default queryFn from the component that defines this query.
              // The prefetch just "warms" the cache slot so the real fetch
              // starts as soon as the component mounts.
              staleTime: 2 * 60_000,
            });
          }
        }
      };

      return {
        onMouseEnter: trigger,
        onTouchStart: trigger,
      };
    },
    [queryClient],
  );

  return prefetch;
}
