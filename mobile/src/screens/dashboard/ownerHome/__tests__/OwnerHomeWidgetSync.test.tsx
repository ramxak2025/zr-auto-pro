import type { DependencyList } from 'react';
const mockNativeWidget = jest.fn();
const mockDashboardV2 = jest.fn();
const mockPlatform = { OS: 'ios' };
const mockAppState = { currentState: 'active' };
const mockConfig = { expoConfig: { extra: { ownerHomePilot: true as unknown } } };
const mockAuth = { user: { id: 'user-a', role: 'director' as string | undefined } };
type Snapshot = {
  data?: unknown;
  isSuccess: boolean;
  isPending: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
  isFetchedAfterMount: boolean;
};
let mockSnapshot: Snapshot;
type Options = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
  enabled: boolean;
  staleTime: number;
  refetchOnMount: unknown;
  placeholderData?: unknown;
  refetchInterval?: unknown;
};
const mockQuery = jest.fn((_options: Options) => mockSnapshot);
type HookInstance = {
  memos: unknown[];
  memoDeps: (DependencyList | undefined)[];
  refs: { current: unknown }[];
  effectDeps: (DependencyList | undefined)[];
  pending: (() => void)[];
  memoIndex: number;
  refIndex: number;
  effectIndex: number;
};
let mockInstance: HookInstance;
const mockSameDeps = (a: DependencyList | undefined, b: DependencyList | undefined) =>
  !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useMemo: (factory: () => unknown, deps: DependencyList) => {
    const index = mockInstance.memoIndex++;
    if (!mockSameDeps(mockInstance.memoDeps[index], deps)) {
      mockInstance.memos[index] = factory();
      mockInstance.memoDeps[index] = deps;
    }
    return mockInstance.memos[index];
  },
  useRef: (initial: unknown) => {
    const index = mockInstance.refIndex++;
    return mockInstance.refs[index] ?? (mockInstance.refs[index] = { current: initial });
  },
  useEffect: (effect: () => void, deps: DependencyList) => {
    const index = mockInstance.effectIndex++;
    if (!mockSameDeps(mockInstance.effectDeps[index], deps)) {
      mockInstance.pending.push(effect);
      mockInstance.effectDeps[index] = deps;
    }
  },
}));
jest.mock('react-native', () => ({
  get Platform() {
    return mockPlatform;
  },
  get AppState() {
    return mockAppState;
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() {
    return mockConfig;
  },
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: Options) => mockQuery(options) }));
jest.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../../../api/services', () => ({
  reportsApi: { dashboardV2: (...args: unknown[]) => mockDashboardV2(...args) },
}));
// Exercise the actual JS bridge and lease checks; replace only the native App Group sink.
jest.mock('../../../../../modules/autexa-liquid-glass/src/index', () => ({
  setWidgetData: (raw: string) => mockNativeWidget(raw),
}));
import { captureDataSession, setDataSession } from '../../../../contexts/dataSession';
import { clearWidgetData } from '../../../../utils/widgetBridge';
import type { OwnerHomeScope } from '../ownerHomeState';
import OwnerHomeWidgetSync from '../OwnerHomeWidgetSync';

const A = { tenantId: 'tenant-a', userId: 'user-a', pointId: 'point-a' };
const B = { tenantId: 'tenant-b', userId: 'user-b', pointId: 'point-b' };
const today = {
  revenueToday: 82750.55,
  netProfitToday: 47999.15,
  checksToday: 12,
  deferredSum: { count: 4, sum: 5000 },
  revenueMonth: 999999,
  netProfitMonth: 888888,
  netProfitAccrual: { today: { netProfit: -77777 }, mtd: { netProfit: 666666 } },
};
const success = (data: unknown, fresh = true): Snapshot => ({
  data,
  isSuccess: true,
  isPending: false,
  isError: false,
  isPlaceholderData: false,
  isFetchedAfterMount: fresh,
});
const freshInstance = (): HookInstance => ({
  memos: [],
  memoDeps: [],
  refs: [],
  effectDeps: [],
  pending: [],
  memoIndex: 0,
  refIndex: 0,
  effectIndex: 0,
});
function scopeNow(): OwnerHomeScope {
  const lease = captureDataSession();
  return { key: [lease.key, lease.generation, 'Europe/Moscow'], isCurrent: lease.isCurrent };
}
function render(instance: HookInstance, scope: OwnerHomeScope, enabled = true) {
  mockInstance = instance;
  instance.memoIndex = 0;
  instance.refIndex = 0;
  instance.effectIndex = 0;
  expect(OwnerHomeWidgetSync({ scope, enabled })).toBeNull();
  return mockQuery.mock.calls.at(-1)![0];
}
const flush = (instance: HookInstance) => instance.pending.splice(0).forEach((effect) => effect());
const payloads = () => mockNativeWidget.mock.calls.map(([raw]) => JSON.parse(raw as string));
beforeEach(() => {
  jest.clearAllMocks();
  setDataSession(A);
  mockAuth.user = { id: A.userId, role: 'director' };
  mockPlatform.OS = 'ios';
  mockAppState.currentState = 'active';
  mockConfig.expoConfig.extra.ownerHomePilot = true;
  mockSnapshot = success(today);
  mockDashboardV2.mockResolvedValue({ data: today });
});

test('fresh today response preserves the legacy widget payload, not accrual or month profit', async () => {
  const instance = freshInstance(),
    scope = scopeNow();
  mockSnapshot = {
    isSuccess: false,
    isPending: true,
    isError: false,
    isPlaceholderData: false,
    isFetchedAfterMount: false,
  };
  const options = render(instance, scope);
  flush(instance);
  expect(mockNativeWidget).not.toHaveBeenCalled();
  const response = await options.queryFn();
  expect(mockDashboardV2).toHaveBeenCalledWith({ period: 'today' });
  expect(options.queryKey).toEqual(['owner-home', ...scope.key, 'native-widget-today']);
  expect(options.staleTime).toBe(60_000);
  expect(options.refetchOnMount).toBe('always');
  expect(options.refetchInterval).toBeUndefined();
  expect(options.placeholderData).toBeUndefined();
  mockSnapshot = success(response);
  render(instance, scope);
  flush(instance);
  expect(payloads()).toEqual([
    {
      role: 'owner',
      revenue: 82750.55,
      profitToday: 47999.15,
      checksCount: 12,
      openOrders: 4,
      updatedAt: expect.any(String),
    },
  ]);
});

test('history rerenders and identical fresh result objects keep a fixed today request without duplicate writes', async () => {
  const instance = freshInstance(),
    scope = scopeNow();
  const first = render(instance, scope);
  flush(instance);
  // Parent history changes leave this child mounted with the same owner scope.
  mockSnapshot = success({
    ...today,
    deferredSum: { ...today.deferredSum },
    netProfitAccrual: { today: { netProfit: -123456 }, mtd: { netProfit: -654321 } },
  });
  const second = render(instance, { ...scope, key: [...scope.key] });
  flush(instance);
  expect(second.queryKey).toEqual(first.queryKey);
  await second.queryFn();
  expect(mockDashboardV2).toHaveBeenLastCalledWith({ period: 'today' });
  expect(mockNativeWidget).toHaveBeenCalledTimes(1);
  mockSnapshot = { ...success(today), isSuccess: false, isError: true };
  render(instance, scope);
  flush(instance);
  mockSnapshot = success({ ...today });
  render(instance, scope);
  flush(instance);
  expect(mockNativeWidget).toHaveBeenCalledTimes(1);
  mockSnapshot = success({ ...today, checksToday: 13 });
  render(instance, scope);
  flush(instance);
  expect(payloads().at(-1).checksCount).toBe(13);
  expect(mockNativeWidget).toHaveBeenCalledTimes(2);
});

test('a cached pre-mount snapshot cannot be re-stamped as today on either activation', () => {
  const scope = scopeNow();
  for (let activation = 0; activation < 2; activation++) {
    const instance = freshInstance();
    mockSnapshot = success(today, false);
    render(instance, scope);
    flush(instance);
    expect(mockNativeWidget).toHaveBeenCalledTimes(activation);
    mockSnapshot = success({ ...today }, true);
    render(instance, scope);
    flush(instance);
    expect(mockNativeWidget).toHaveBeenCalledTimes(activation + 1);
  }
});

test.each(['pending', 'error', 'placeholder', 'cached'] as const)('%s data never writes the widget', (state) => {
  mockSnapshot = success(today);
  if (state === 'pending') mockSnapshot = { ...mockSnapshot, isPending: true, isSuccess: false };
  if (state === 'error') mockSnapshot = { ...mockSnapshot, isError: true, isSuccess: false };
  if (state === 'placeholder') mockSnapshot.isPlaceholderData = true;
  if (state === 'cached') mockSnapshot.isFetchedAfterMount = false;
  const instance = freshInstance();
  render(instance, scopeNow());
  flush(instance);
  expect(mockNativeWidget).not.toHaveBeenCalled();
});

test.each([
  undefined,
  null,
  {},
  { ...today, revenueToday: undefined },
  { ...today, netProfitToday: NaN },
  { ...today, checksToday: undefined },
  { ...today, deferredSum: undefined },
  { ...today, deferredSum: { count: Infinity } },
])('missing or malformed fields never become invented zero values', (data) => {
  mockSnapshot = success(data);
  const instance = freshInstance();
  render(instance, scopeNow());
  flush(instance);
  expect(mockNativeWidget).not.toHaveBeenCalled();
});

test('real successful zeros remain valid widget values', () => {
  mockSnapshot = success({ revenueToday: 0, netProfitToday: 0, checksToday: 0, deferredSum: { count: 0 } });
  const instance = freshInstance();
  render(instance, scopeNow());
  flush(instance);
  expect(payloads()).toEqual([
    { role: 'owner', revenue: 0, profitToday: 0, checksCount: 0, openOrders: 0, updatedAt: expect.any(String) },
  ]);
});

test.each([
  { platform: 'android', role: 'director', flag: true, enabled: true, active: 'active' },
  { platform: 'web', role: 'director', flag: true, enabled: true, active: 'active' },
  { platform: 'ios', role: 'master', flag: true, enabled: true, active: 'active' },
  { platform: 'ios', role: 'admin', flag: true, enabled: true, active: 'active' },
  { platform: 'ios', role: 'superadmin', flag: true, enabled: true, active: 'active' },
  { platform: 'ios', role: 'director', flag: false, enabled: true, active: 'active' },
  { platform: 'ios', role: 'director', flag: 'true', enabled: true, active: 'active' },
  { platform: 'ios', role: 'director', flag: true, enabled: false, active: 'active' },
  { platform: 'ios', role: 'director', flag: true, enabled: true, active: 'background' },
])('disabled platform/role/build/visibility fails closed: %j', ({ platform, role, flag, enabled, active }) => {
  mockPlatform.OS = platform;
  mockAuth.user.role = role;
  mockConfig.expoConfig.extra.ownerHomePilot = flag;
  mockAppState.currentState = active;
  const instance = freshInstance();
  const options = render(instance, scopeNow(), enabled);
  flush(instance);
  expect(options.enabled).toBe(false);
  expect(mockNativeWidget).not.toHaveBeenCalled();
  expect(mockDashboardV2).not.toHaveBeenCalled();
});

test('no data owner means no query or native write', () => {
  setDataSession(null);
  const instance = freshInstance();
  const options = render(instance, scopeNow());
  flush(instance);
  expect(options.enabled).toBe(false);
  expect(mockNativeWidget).not.toHaveBeenCalled();
});

test('late A response is rejected by the actual data-session loader after an account or point switch', async () => {
  const instance = freshInstance(),
    scope = scopeNow();
  let resolve!: (response: { data: typeof today }) => void;
  mockDashboardV2.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const options = render(instance, scope);
  const request = options.queryFn();
  setDataSession(B);
  clearWidgetData();
  resolve({ data: today });
  await expect(request).rejects.toThrow('Сессия изменилась');
  flush(instance);
  expect(payloads()).toEqual([{ role: 'none', updatedAt: expect.any(String) }]);
});

test('queued A widget effects never overwrite B or a later A session through the real widget bridge', () => {
  const oldInstance = freshInstance();
  render(oldInstance, scopeNow());
  const lateA = oldInstance.pending[0];
  setDataSession(B);
  mockAuth.user.id = B.userId;
  clearWidgetData();
  lateA();
  expect(payloads()).toEqual([{ role: 'none', updatedAt: expect.any(String) }]);
  const bInstance = freshInstance();
  mockSnapshot = success({ ...today, revenueToday: 22 });
  render(bInstance, scopeNow());
  flush(bInstance);
  expect(payloads().at(-1).revenue).toBe(22);
  setDataSession(A);
  mockAuth.user.id = A.userId;
  clearWidgetData();
  lateA();
  expect(payloads().at(-1).role).toBe('none');
  const aAgain = freshInstance();
  mockSnapshot = success({ ...today, revenueToday: 33 });
  render(aAgain, scopeNow());
  flush(aAgain);
  expect(payloads().at(-1).revenue).toBe(33);
  expect(mockNativeWidget).toHaveBeenCalledTimes(4);
});

test('native bridge failure remains silent and cannot break the owner screen', () => {
  mockNativeWidget.mockImplementationOnce(() => {
    throw new Error('native module unavailable');
  });
  const instance = freshInstance();
  render(instance, scopeNow());
  expect(() => flush(instance)).not.toThrow();
});
