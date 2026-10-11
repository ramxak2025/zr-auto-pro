import type { CheckTemplate } from '../types';
/** Reopening a mounted picker must fetch, even if a previous response is cached. */
export function templatePickerQueryOptions(read: () => Promise<CheckTemplate[]>, open: boolean) {
  return {
    queryKey: ['check-templates'],
    queryFn: read,
    enabled: open,
    staleTime: 0,
    refetchOnMount: 'always' as const,
    refetchInterval: open ? 15_000 : (false as const),
  };
}
export function canApplyTemplateSnapshot(state: {
  isFetching: boolean;
  isError: boolean;
  isPaused?: boolean;
  fetchStatus?: string;
}): boolean {
  return !state.isFetching && !state.isError && !state.isPaused && state.fetchStatus !== 'paused';
}
