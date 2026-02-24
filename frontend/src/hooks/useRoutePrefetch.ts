import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Route-to-query mapping for prefetching.
 * When the user hovers on a navigation link, we invalidate stale queries
 * for that route so they start refetching when the component mounts.
 *
 * NOTE: prefetchQuery requires a queryFn to actually fetch data. Since we
 * don't have access to the API functions here, we instead use
 * invalidateQueries to mark cached data as stale. When the user navigates,
 * the component's useQuery will trigger an immediate background refetch.
 */
const ROUTE_QUERIES: Record<string, unknown[][]> = {
  '/dashboard': [['dashboard-chart'], ['schedule-today'], ['employee-ranking']],
  '/checks': [['checks'], ['masters']],
  '/clients': [['clients']],
  '/products': [['products'], ['warehouse-categories']],
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
 * Returns `onMouseEnter` / `onTouchStart` handlers that mark queries as stale
 * for the given route, so data starts refetching as soon as the user navigates.
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
          // Invalidate the query so it refetches when the page component mounts.
          // This is more reliable than prefetchQuery without a queryFn.
          queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
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
