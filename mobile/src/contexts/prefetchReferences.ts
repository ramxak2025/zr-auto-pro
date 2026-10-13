import { CancelledError, type QueryClient } from '@tanstack/react-query';
import type { createChecksApi, createUsersApi } from '../../../shared/api/createServices';
import { emptyJournalFilters, journalQueryKey } from '../screens/journal/filters';

/** Scoped to one captured login; no promise or user data survives into another session. */
export async function prefetchLoginReferences(
  qc: QueryClient,
  users: Pick<ReturnType<typeof createUsersApi>, 'getAll'>,
  checks: Pick<ReturnType<typeof createChecksApi>, 'getAll'>,
  isCurrent: () => boolean,
): Promise<void> {
  const current = () => {
    if (!isCurrent()) throw new CancelledError({ silent: true });
  };
  let usersRequest: ReturnType<typeof users.getAll> | undefined;
  const readUsers = async () => {
    current();
    usersRequest ??= users.getAll();
    const response = await usersRequest;
    current();
    return response.data.slice();
  };
  await Promise.all([
    ...['all-users', 'users', 'users-for-filter', 'users-all'].map((key) =>
      qc.prefetchQuery({ queryKey: [key], queryFn: readUsers, staleTime: 5 * 60_000 }),
    ),
    qc.prefetchInfiniteQuery({
      queryKey: journalQueryKey('', emptyJournalFilters()),
      initialPageParam: '',
      queryFn: async ({ pageParam = '' }) => {
        current();
        const response = await checks.getAll({ cursor: pageParam, limit: 20 });
        current();
        return response.data;
      },
      getNextPageParam: (page: Awaited<ReturnType<typeof checks.getAll>>['data']) => page.nextCursor ?? undefined,
      staleTime: 60_000,
    }),
  ]);
}
