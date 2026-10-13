import { QueryClient } from '@tanstack/react-query';
import { prefetchLoginReferences } from '../prefetchReferences';
import { emptyJournalFilters, journalQueryKey } from '../../screens/journal/filters';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const people = [{ id: 'qa-user', fullName: 'QA' }];
const page = { data: [{ id: 'qa-check' }], total: 1, page: 1, limit: 20, nextCursor: null };
function apis() {
  const userGet = jest.fn().mockResolvedValue({ data: people });
  const checkGet = jest.fn().mockResolvedValue({ data: page });
  return {
    users: { getAll: userGet } as unknown as Parameters<typeof prefetchLoginReferences>[1],
    checks: { getAll: checkGet } as unknown as Parameters<typeof prefetchLoginReferences>[2],
    userGet,
    checkGet,
  };
}

it('one user request fills existing aliases and an actual journal first-open consumes the warmed cursor page', async () => {
  const qc = client(),
    api = apis();
  await prefetchLoginReferences(qc, api.users, api.checks, () => true);
  expect(api.userGet).toHaveBeenCalledTimes(1);
  for (const key of ['all-users', 'users', 'users-for-filter', 'users-all']) {
    expect(qc.getQueryData([key])).toEqual(people);
  }
  expect(qc.getQueryData(['all-users'])).not.toBe(qc.getQueryData(['users']));
  expect(api.checkGet).toHaveBeenCalledWith({ cursor: '', limit: 20 });
  const firstOpen = jest.fn().mockResolvedValue(page);
  const data = await qc.fetchInfiniteQuery({
    queryKey: journalQueryKey('', emptyJournalFilters()),
    initialPageParam: '',
    queryFn: firstOpen,
    getNextPageParam: () => undefined,
    staleTime: 60_000,
  });
  expect(firstOpen).not.toHaveBeenCalled();
  expect(data.pages).toEqual([page]);
  expect(data.pageParams).toEqual(['']);
  qc.clear();
});

it('a late response cannot seed user or journal data after the captured login is replaced', async () => {
  const qc = client(),
    api = apis();
  let current = true;
  let resolveUsers!: (value: unknown) => void, resolveChecks!: (value: unknown) => void;
  api.userGet.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveUsers = resolve;
      }),
  );
  api.checkGet.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveChecks = resolve;
      }),
  );
  const warming = prefetchLoginReferences(qc, api.users, api.checks, () => current);
  current = false;
  resolveUsers({ data: people });
  resolveChecks({ data: page });
  await warming;
  for (const query of qc.getQueryCache().getAll()) expect(query.state.data).toBeUndefined();
  qc.clear();
});

it('a replaced login sends no new transport requests', async () => {
  const qc = client(),
    api = apis();
  await prefetchLoginReferences(qc, api.users, api.checks, () => false);
  expect(api.userGet).not.toHaveBeenCalled();
  expect(api.checkGet).not.toHaveBeenCalled();
  qc.clear();
});
