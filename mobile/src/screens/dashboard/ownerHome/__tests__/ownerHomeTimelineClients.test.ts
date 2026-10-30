import type { OwnerHomeVisits } from '../../../../../../shared/types/ownerHome';
const mockStates: unknown[] = [],
  mockRefs: { current: unknown }[] = [],
  mockEffects: { deps: unknown[]; cleanup?: () => void }[] = [];
let mockStateIndex = 0,
  mockRefIndex = 0,
  mockEffectIndex = 0;
const mockQuery = jest.fn(),
  mockApi = jest.fn(),
  mockRefetch = jest.fn();
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockStateIndex++;
    if (!(index in mockStates)) mockStates[index] = initial;
    return [
      mockStates[index],
      (value: unknown) => {
        mockStates[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockRefIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = mockEffectIndex++,
      old = mockEffects[index];
    if (!old || old.deps.some((value, i) => value !== deps[i])) {
      old?.cleanup?.();
      mockEffects[index] = { deps, cleanup: effect() };
    }
  },
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => mockQuery(options) }));
jest.mock('../../../../api/services', () => ({
  reportsApi: { ownerHomeVisits: (...args: unknown[]) => mockApi(...args) },
}));
import {
  ownerTimelineClientsCount,
  ownerTimelineClientsTarget,
  useOwnerTimelineClients,
} from '../ownerHomeTimelineClients';
import { ownerTimelineModel, type OwnerTimelinePoint } from '../ownerHomeTimelineModel';
import { timelineFixture } from '../__fixtures__/timeline';
import type { OwnerHomeScope } from '../ownerHomeState';

const scopeKey = ['account-A', 'tenant-A', 'user-A', 'point-A', 1, 7, 'Europe/Moscow'];
let current = true;
const scope: OwnerHomeScope = { key: scopeKey, isCurrent: () => current };
const visits = (from: string, to = from, servedClients = 12): OwnerHomeVisits => ({
  period: { from, to },
  timezone: 'Europe/Moscow',
  pointId: 'point-A',
  generatedAt: '2026-10-29T11:20:00Z',
  basis: 'first_recorded_service_visit',
  historyScope: 'tenant',
  servedClients,
  newClients: servedClients,
  returningClients: 0,
  visitCount: 20,
  vehicleCount: 1,
  rapidReturnVehicleCount: 0,
  rapidReturnVisitCount: 0,
  rapidReturnWindowDays: 30,
  rapidReturnRule: 'any_same_vehicle_visit',
});
function Harness(
  data = timelineFixture('week'),
  point: OwnerTimelinePoint | null = null,
  active = true,
  ownerScope = scope,
) {
  mockStateIndex = 0;
  mockRefIndex = 0;
  mockEffectIndex = 0;
  return useOwnerTimelineClients(data, point, ownerScope, active);
}
function options() {
  return mockQuery.mock.calls.at(-1)![0] as {
    queryKey: unknown[];
    queryFn: () => Promise<OwnerHomeVisits>;
    enabled: boolean;
    staleTime: number;
  };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockStates.length = 0;
  mockRefs.length = 0;
  mockEffects.length = 0;
  current = true;
  mockQuery.mockReturnValue({
    data: undefined,
    isError: false,
    isPending: true,
    isFetching: false,
    refetch: mockRefetch,
  });
});
afterEach(() => {
  mockEffects.forEach((effect) => effect.cleanup?.());
  jest.useRealTimers();
});

test('civil queries match day, week/day and year/month intervals without including exclusive midnight', () => {
  const day = timelineFixture();
  const hourly = ownerTimelineModel(day, 'day')!.points[0];
  expect(ownerTimelineClientsTarget(day, hourly)).toMatchObject({
    range: { from: '2026-10-29', to: '2026-10-29' },
    label: 'Клиенты за день',
  });
  const week = timelineFixture('week');
  expect(ownerTimelineClientsTarget(week, ownerTimelineModel(week, 'week')!.points[0])).toMatchObject({
    range: { from: '2026-10-26', to: '2026-10-26' },
    label: 'Клиенты',
  });
  const year = timelineFixture('year'),
    points = ownerTimelineModel(year, 'year')!.points;
  expect(ownerTimelineClientsTarget(year, points[0])!.range).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  expect(ownerTimelineClientsTarget(year, points.at(-1)!)!.range).toEqual({ from: '2026-10-01', to: '2026-10-29' });
  expect(ownerTimelineClientsTarget(year, null)!.range).toEqual(year.visitsRange);
});

test('an exact-midnight allocation remains on the new tenant day and reversed or invalid intervals are rejected', () => {
  const data = timelineFixture(),
    point = ownerTimelineModel(data, 'day')!.points[0];
  expect(ownerTimelineClientsTarget(data, { ...point, untilExclusive: point.at })!.range).toEqual({
    from: '2026-10-29',
    to: '2026-10-29',
  });
  expect(
    ownerTimelineClientsTarget(data, { ...point, untilExclusive: new Date(Date.parse(point.at) - 1).toISOString() }),
  ).toBeNull();
  expect(ownerTimelineClientsTarget(data, { ...point, at: 'invalid' })).toBeNull();
});

test.each([
  { period: { from: '2026-10-28', to: '2026-10-29' } },
  { timezone: 'UTC' },
  { pointId: 'point-B' },
  { servedClients: -1 },
  { servedClients: 1.5 },
  { servedClients: NaN },
  { newClients: -1 },
  { returningClients: 1 },
])('wrong scope, range or client totals are unknown instead of zero: %j', (patch) => {
  const target = ownerTimelineClientsTarget(timelineFixture(), null);
  expect(ownerTimelineClientsCount({ ...visits('2026-10-29'), ...patch }, target)).toBeNull();
});

test('zero is a real count and served clients may exceed distinct vehicles', () => {
  const target = ownerTimelineClientsTarget(timelineFixture(), null);
  expect(ownerTimelineClientsCount(visits('2026-10-29', '2026-10-29', 0), target)).toBe(0);
  expect(ownerTimelineClientsCount(visits('2026-10-29'), target)).toBe(12);
});

test('period totals and hourly selection share the parent cache without their own fetch', () => {
  const data = timelineFixture(),
    point = ownerTimelineModel(data, 'day')!.points[0];
  mockQuery.mockReturnValue({ data: visits('2026-10-29'), isError: false, isPending: false, refetch: mockRefetch });
  expect(Harness(data)).toMatchObject({ count: 12, status: 'ready', label: 'Клиенты' });
  expect(options().queryKey).toEqual(['owner-home', ...scopeKey, 'visits', '2026-10-29', '2026-10-29']);
  expect(options().enabled).toBe(false);
  expect(Harness(data, point)).toMatchObject({ count: 12, status: 'ready', label: 'Клиенты за день' });
  expect(options().enabled).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  expect(mockApi).not.toHaveBeenCalled();
});

test('a scrub requests only the settled civil range after 180 ms', () => {
  const data = timelineFixture('week'),
    points = ownerTimelineModel(data, 'week')!.points;
  expect(Harness(data, points[0]).count).toBeNull();
  jest.advanceTimersByTime(90);
  Harness(data, points[1]);
  jest.advanceTimersByTime(179);
  Harness(data, points[1]);
  expect(options().enabled).toBe(false);
  jest.advanceTimersByTime(1);
  Harness(data, points[1]);
  expect(options().enabled).toBe(true);
  expect(options().queryKey).toEqual(['owner-home', ...scopeKey, 'visits', '2026-10-27', '2026-10-27']);
  expect(mockQuery.mock.calls.filter(([query]) => query.enabled)).toHaveLength(1);
});

test('late cached data never appears below a new date while its own request settles', () => {
  const data = timelineFixture('week'),
    points = ownerTimelineModel(data, 'week')!.points;
  Harness(data, points[0]);
  jest.advanceTimersByTime(180);
  mockQuery.mockReturnValue({ data: visits('2026-10-26'), isError: false, isPending: false, refetch: mockRefetch });
  expect(Harness(data, points[0]).count).toBe(12);
  expect(Harness(data, points[1])).toMatchObject({ count: null, status: 'loading' });
  jest.advanceTimersByTime(180);
  expect(Harness(data, points[1])).toMatchObject({ count: null, status: 'error' });
});

test('the existing query key reuses fresh interval data and separates account generations', async () => {
  const { QueryClient } = jest.requireActual('@tanstack/react-query') as typeof import('@tanstack/react-query');
  const client = new QueryClient();
  const data = timelineFixture('week'),
    point = ownerTimelineModel(data, 'week')!.points[0];
  mockApi.mockResolvedValue({ data: visits('2026-10-26') });
  Harness(data, point);
  jest.advanceTimersByTime(180);
  Harness(data, point);
  const first = options();
  await client.fetchQuery(first);
  await client.fetchQuery(first);
  expect(mockApi).toHaveBeenCalledTimes(1);
  const nextScope = { ...scope, key: [...scopeKey, 'new-generation'] };
  Harness(data, point, true, nextScope);
  jest.advanceTimersByTime(180);
  Harness(data, point, true, nextScope);
  await client.fetchQuery(options());
  expect(mockApi).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(first.queryKey)).toEqual(visits('2026-10-26'));
  client.clear();
});

test('a changed session rejects an in-flight count before it can enter the cache', async () => {
  const { QueryClient } = jest.requireActual('@tanstack/react-query') as typeof import('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const data = timelineFixture('week'),
    point = ownerTimelineModel(data, 'week')!.points[0];
  let finish!: (value: { data: OwnerHomeVisits }) => void;
  mockApi.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  Harness(data, point);
  jest.advanceTimersByTime(180);
  Harness(data, point);
  const query = options();
  const pending = client.fetchQuery(query);
  current = false;
  finish({ data: visits('2026-10-26') });
  await expect(pending).rejects.toThrow('Сессия изменилась');
  expect(client.getQueryData(query.queryKey)).toBeUndefined();
  expect(Harness(data, point)).toMatchObject({ count: null, status: 'unavailable' });
  client.clear();
});

test('stale retry and query callbacks cannot request a different selection or inactive screen', async () => {
  const data = timelineFixture('week'),
    points = ownerTimelineModel(data, 'week')!.points;
  Harness(data, points[0]);
  jest.advanceTimersByTime(180);
  const old = Harness(data, points[0]),
    query = options();
  Harness(data, points[1]);
  old.retry();
  await expect(query.queryFn()).rejects.toThrow('Интервал изменился');
  expect(mockRefetch).not.toHaveBeenCalled();
  expect(mockApi).not.toHaveBeenCalled();
  Harness(data, points[1], false);
  jest.advanceTimersByTime(180);
  expect(Harness(data, points[1], false).status).toBe('unavailable');
  expect(options().enabled).toBe(false);
});

test('a mismatched API response is rejected rather than cached as a successful count', async () => {
  const data = timelineFixture('week'),
    point = ownerTimelineModel(data, 'week')!.points[0];
  mockApi.mockResolvedValue({ data: visits('2026-10-27') });
  Harness(data, point);
  jest.advanceTimersByTime(180);
  Harness(data, point);
  await expect(options().queryFn()).rejects.toThrow('Период клиентов не совпал');
});

test('subscribing to the parent cache does not replace its valid period refresh with a stale selection guard', async () => {
  const data = timelineFixture('week'),
    point = ownerTimelineModel(data, 'week')!.points[0];
  Harness(data);
  const periodQuery = options();
  Harness(data, point);
  mockApi.mockResolvedValue({ data: visits('2026-10-26', '2026-10-29') });
  await expect(periodQuery.queryFn()).resolves.toEqual(visits('2026-10-26', '2026-10-29'));
  expect(mockApi).toHaveBeenCalledWith(data.visitsRange);
});
