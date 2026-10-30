import React from 'react';
import type { PointsListResponse } from '../../../../../../shared/types';

const mockDispatch = jest.fn();
const mockQuery = jest.fn();
const mockDashboard = jest.fn();
const mockPointsList = jest.fn();
const mockCurrent = jest.fn();
const mockOpen = jest.fn();
const mockClose = jest.fn();
const mockCollect = jest.fn();
const mockPaymentsRetry = jest.fn();
const mockBalanceRetry = jest.fn();
let mockRef: { current: any } | undefined;
let mockCleanup: (() => void) | undefined;
let mockFontScale = 1;
let mockWidth = 390;
let mockDark = false;
let mockTimezone = 'Europe/Moscow';
let mockPayments: Record<string, any>;
let mockBalance: Record<string, any>;
let mockPoints: Record<string, any>;
const mockAuth = {
  user: { role: 'director', tenantId: 'tenant-A', currentPointId: 'point-A' as string | null },
  hasPermission: jest.fn(() => true),
};

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useRef: (initial: unknown) => (mockRef ??= { current: initial }),
  useEffect: (effect: () => () => void) => {
    if (!mockCleanup) mockCleanup = effect();
  },
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  useWindowDimensions: () => ({ width: mockWidth, fontScale: mockFontScale }),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: mockDispatch }),
  CommonActions: { navigate: (payload: unknown) => ({ type: 'NAVIGATE', payload }) },
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => mockQuery(options) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../../../contexts/ThemeContext', () => ({ useColors: () => ({ mode: mockDark ? 'dark' : 'light' }) }));
jest.mock('../../../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => mockTimezone }));
jest.mock('../../../../hooks/usePoints', () => ({ POINTS_QUERY_KEY: ['points'] }));
jest.mock('../../../../components/Skeleton', () => ({ Skeleton: 'Skeleton' }));
jest.mock('../../../../api/services', () => ({
  pointsApi: { list: (...args: unknown[]) => mockPointsList(...args) },
  reportsApi: { dashboardV2: (...args: unknown[]) => mockDashboard(...args) },
  cashShiftsApi: {
    current: (...args: unknown[]) => mockCurrent(...args),
    open: (...args: unknown[]) => mockOpen(...args),
    close: (...args: unknown[]) => mockClose(...args),
    collect: (...args: unknown[]) => mockCollect(...args),
  },
}));

import OwnerHomeCash from '../OwnerHomeCash';
import { ownerCashIsToday, ownerCashPayments, ownerCashPoint, ownerCashShift } from '../ownerHomeCashState';
import { ownerMoney, type OwnerHomeScope } from '../ownerHomeState';

const scope: OwnerHomeScope = {
  key: ['account-A', 'tenant-A', 'owner-A', 'point-A', 7, 9, 'Europe/Moscow', '{"financial_reports":true}'],
  isCurrent: () => true,
};
function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    period: 'today',
    revenueToday: 9_900,
    checksToday: 3,
    cashPosition: {
      cash: 1_200.15,
      card: 2_300.27,
      total: 3_500.42,
      warranty: 800,
      warrantyLoss: 310.55,
      installmentDebt: 5_000,
      installmentPaid: 600.3,
      installmentPaidCash: 200.1,
      installmentPaidCard: 400.2,
      ...overrides,
    },
  };
}
function cashReport(overrides: Record<string, unknown> = {}) {
  return {
    shift: {
      id: 'shift-A',
      tenantId: 'tenant-A',
      pointId: 'point-A',
      status: 'open',
      openedAt: '2026-10-30T06:00:00Z',
      closedAt: null,
    },
    // Deliberately different from today's payments: this server balance is
    // opening + cash sales + cash repayments − expenses − returns − collections.
    openingAmount: 500,
    cashSales: 1_200.15,
    installmentCash: 200.1,
    cashExpenses: 450,
    cashReturns: 75,
    collectionsTotal: 1_000,
    expectedAmount: 375.25,
    ...overrides,
  };
}
function pointMetadata(ids = ['point-A'], currentPointId: string | null = 'point-A'): PointsListResponse {
  return {
    currentPointId,
    points: ids.map((id) => ({ id, name: `Сервис ${id}`, sortOrder: 0, isMain: id === 'point-A', isActive: true })),
  };
}
function nodes(node: React.ReactNode): React.ReactElement<any>[] {
  if (!React.isValidElement<any>(node)) return [];
  return [node, ...React.Children.toArray((node.props as { children?: React.ReactNode }).children).flatMap(nodes)];
}
function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  return React.isValidElement<{ children?: React.ReactNode }>(node) ? textContent(node.props.children) : '';
}
function byId(tree: React.ReactNode, id: string) {
  return nodes(tree).find((node) => node.props.testID === id);
}
function render(overrides: Partial<Parameters<typeof OwnerHomeCash>[0]> = {}) {
  return OwnerHomeCash({ scope, enabled: true, todayDate: '2026-10-30', ...overrides });
}
function query(kind: 'payments' | 'balance' | 'points') {
  const key = kind === 'payments' ? 'native-widget-today' : kind === 'balance' ? 'cash-shift-current' : 'points';
  return mockQuery.mock.calls.filter(([options]) => options.queryKey.includes(key)).at(-1)![0];
}
function ready(data: unknown, refetch: () => unknown) {
  return {
    data,
    isPending: false,
    isError: false,
    isFetchedAfterMount: true,
    isPlaceholderData: false,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRef = undefined;
  mockCleanup = undefined;
  mockFontScale = 1;
  mockWidth = 390;
  mockDark = false;
  mockTimezone = 'Europe/Moscow';
  mockAuth.user.role = 'director';
  mockAuth.user.currentPointId = 'point-A';
  mockAuth.hasPermission.mockReturnValue(true);
  mockPayments = ready(dashboard(), mockPaymentsRetry);
  mockBalance = ready(cashReport(), mockBalanceRetry);
  mockPoints = ready(pointMetadata(), jest.fn());
  mockQuery.mockImplementation((options) =>
    options.queryKey.includes('points')
      ? mockPoints
      : options.queryKey.includes('native-widget-today')
        ? mockPayments
        : mockBalance,
  );
  mockDashboard.mockResolvedValue({ data: dashboard() });
  mockPointsList.mockResolvedValue({ data: pointMetadata() });
  mockCurrent.mockResolvedValue({ data: cashReport() });
});

test('passive points observer preserves the full shared query contract without starting a request', async () => {
  render();
  const observer = query('points');
  expect(observer.enabled).toBe(false);
  expect(mockPointsList).not.toHaveBeenCalled();
  const fullMetadata = pointMetadata(['point-A', 'point-B']);
  mockPointsList.mockResolvedValueOnce({ data: fullMetadata });
  await expect(observer.queryFn()).resolves.toEqual(fullMetadata);
  expect(mockPointsList).toHaveBeenCalledTimes(1);
});

test('mixed check payments, later installments and warranty keep distinct server totals', () => {
  const parsed = ownerCashPayments(dashboard());
  expect(parsed).toEqual({
    cash: 1_200.15,
    card: 2_300.27,
    total: 3_500.42,
    warranty: 800,
    warrantyLoss: 310.55,
    installmentPaid: 600.3,
    installmentPaidCash: 200.1,
    installmentPaidCard: 400.2,
  });
  const tree = render();
  expect(textContent(byId(tree, 'owner-home-cash-total'))).toBe(ownerMoney(3_500.42));
  expect(textContent(byId(tree, 'owner-home-cash-installments'))).toBe(ownerMoney(600.3));
  expect(byId(tree, 'owner-home-cash-warranty')).toBeUndefined();
  expect(byId(tree, 'owner-home-cash-warranty-cost')).toBeUndefined();
  expect(textContent(tree)).toContain('Оплаты чеков');
  expect(textContent(tree)).toContain('По дате чеков · с учётом возвратов');
  expect(textContent(tree)).not.toContain('Гарантия');
  expect(textContent(tree)).not.toContain(ownerMoney(4_100.72));
  expect(textContent(tree)).not.toContain(ownerMoney(5_000));
});

test('refund-adjusted legs and installment down payment are never counted twice', () => {
  // Initial cash 400 + card 600 belongs to the check. A 100 cash return has
  // already reduced its leg. A subsequent 200 repayment is a separate row.
  const parsed = ownerCashPayments(
    dashboard({
      cash: 300,
      card: 600,
      total: 900,
      installmentPaid: 200,
      installmentPaidCash: 200,
      installmentPaidCard: 0,
    }),
  );
  expect(parsed?.cash).toBe(300);
  expect(parsed?.total).toBe(900);
  expect(parsed?.installmentPaid).toBe(200);
  expect(ownerCashPayments(dashboard({ cash: -20, card: 0, total: -20 }))?.total).toBe(-20);
});

test.each([
  { cash: Number.NaN },
  { card: Infinity },
  { total: 3_500 },
  { warranty: -1 },
  { warrantyLoss: null },
  { installmentPaid: -1 },
  { installmentPaidCash: undefined },
  { installmentPaid: 999 },
])('unreadable money is unavailable: %p', (change) => {
  expect(ownerCashPayments(dashboard(change))).toBeNull();
});

test('missing optional legacy amounts stay unknown while real zero payments remain zero', () => {
  mockPayments.data = dashboard({
    cash: 0,
    card: 0,
    total: 0,
    warranty: 0,
    warrantyLoss: undefined,
    installmentPaid: undefined,
    installmentPaidCash: undefined,
    installmentPaidCard: undefined,
  });
  const tree = render();
  expect(textContent(byId(tree, 'owner-home-cash-total'))).toBe(ownerMoney(0));
  expect(byId(tree, 'owner-home-cash-warranty-cost')).toBeUndefined();
  expect(byId(tree, 'owner-home-cash-installments')).toBeUndefined();
  expect(ownerCashPayments({ ...dashboard(), period: 'month' })).toBeNull();
});

test('canonical expected cash includes shift movements, allows a negative amount and is never recomputed', () => {
  const point = ownerCashPoint('point-A', pointMetadata());
  expect(ownerCashShift(cashReport(), point, 'tenant-A')).toMatchObject({ kind: 'open', expectedAmount: 375.25 });
  mockBalance.data = cashReport({ expectedAmount: -73.11 });
  expect(textContent(byId(render(), 'owner-home-cash-balance'))).toBe(ownerMoney(-73.11));
  // Changing component figures does not change the canonical balance.
  expect(ownerCashShift(cashReport({ expectedAmount: 42.42, cashSales: 9_999_999 }), point, 'tenant-A')).toMatchObject({
    expectedAmount: 42.42,
  });
});

test('closed, missing, malformed and cross-tenant reports cannot become a zero or current cash balance', () => {
  const point = ownerCashPoint('point-A', pointMetadata());
  expect(ownerCashShift(null, point, 'tenant-A')).toEqual({ kind: 'closed' });
  expect(ownerCashShift('', point, 'tenant-A')).toEqual({ kind: 'closed' });
  expect(ownerCashShift(undefined, point, 'tenant-A')).toBeNull();
  expect(ownerCashShift({}, point, 'tenant-A')).toBeNull();
  expect(ownerCashShift(cashReport({ expectedAmount: Infinity }), point, 'tenant-A')).toBeNull();
  expect(ownerCashShift(cashReport(), point, 'tenant-B')).toBeNull();
  expect(
    ownerCashShift(cashReport({ shift: { ...cashReport().shift, status: 'closed' } }), point, 'tenant-A'),
  ).toBeNull();
  mockBalance.data = null;
  const tree = render();
  expect(textContent(tree)).toContain('Нет открытой кассовой смены');
  expect(byId(tree, 'owner-home-cash-balance')).toBeUndefined();
  byId(tree, 'owner-home-cash-shift')!.props.onPress();
  expect(mockDispatch).toHaveBeenCalledWith({
    type: 'NAVIGATE',
    payload: { name: 'MoreTab', params: { screen: 'CashShift', initial: false } },
  });
});

test('a selected branch must match the shift and cached session metadata', () => {
  expect(
    ownerCashShift(cashReport(), ownerCashPoint('point-B', pointMetadata(['point-B'], 'point-B')), 'tenant-A'),
  ).toBeNull();
  expect(ownerCashPoint('point-A', pointMetadata(['point-A', 'point-B'], 'point-B'))).toEqual({ kind: 'mismatch' });
  mockPoints.data = pointMetadata(['point-A', 'point-B'], 'point-B');
  expect(byId(render(), 'owner-home-cash-balance')).toBeUndefined();
  expect(query('balance').enabled).toBe(false);
});

test('unscoped multi-branch context offers a real point selection and never uses LIMIT 1 as a sum', () => {
  mockAuth.user.currentPointId = null;
  mockPoints.data = pointMetadata(['point-A', 'point-B'], null);
  const tree = render();
  expect(query('balance').enabled).toBe(false);
  expect(byId(tree, 'owner-home-cash-balance')).toBeUndefined();
  expect(textContent(tree)).toContain('Выберите филиал');
  byId(tree, 'owner-home-cash-choose-point')!.props.onPress();
  expect(mockDispatch).toHaveBeenCalledWith({
    type: 'NAVIGATE',
    payload: { name: 'MoreTab', params: { screen: 'Points', initial: false } },
  });
  expect(ownerCashPoint(null, pointMetadata(['point-A'], null))).toEqual({ kind: 'choose' });
  expect(ownerCashPoint(null, undefined)).toEqual({ kind: 'unknown' });
});

test('confirmed tenant without points may read only its unscoped cash box', () => {
  mockAuth.user.currentPointId = null;
  mockPoints.data = pointMetadata([], null);
  const point = ownerCashPoint(null, mockPoints.data);
  expect(ownerCashShift(cashReport(), point, 'tenant-A')).toBeNull();
  mockBalance.data = cashReport({ shift: { ...cashReport().shift, pointId: null } });
  expect(textContent(byId(render(), 'owner-home-cash-balance'))).toBe(ownerMoney(375.25));
  expect(query('balance').enabled).toBe(true);
});

test('failed cached point metadata cannot authorize an unscoped balance', () => {
  mockAuth.user.currentPointId = null;
  mockPoints.data = pointMetadata([], null);
  mockPoints.isError = true;
  mockBalance.data = cashReport({ shift: { ...cashReport().shift, pointId: null } });
  const tree = render();
  expect(query('balance').enabled).toBe(false);
  expect(byId(tree, 'owner-home-cash-balance')).toBeUndefined();
  expect(textContent(tree)).toContain('Не удалось определить кассу');
  expect(
    ownerCashPoint('point-A', { currentPointId: 'point-A', points: null } as unknown as PointsListResponse),
  ).toEqual({ kind: 'unknown' });
});

test.each(['isError', 'isPending', 'isPlaceholderData', 'paused'])(
  'cached money is hidden in the %s state',
  (state) => {
    if (state === 'paused') {
      mockPayments.fetchStatus = 'paused';
      mockBalance.fetchStatus = 'paused';
    } else {
      mockPayments[state] = true;
      mockBalance[state] = true;
    }
    const tree = render();
    expect(byId(tree, 'owner-home-cash-total')).toBeUndefined();
    expect(byId(tree, 'owner-home-cash-balance')).toBeUndefined();
    expect(textContent(tree)).not.toContain(ownerMoney(0));
  },
);

test('an offline first load has an explicit connection state instead of indefinite loading', () => {
  mockPayments = {
    ...mockPayments,
    data: undefined,
    isPending: true,
    isFetchedAfterMount: false,
    fetchStatus: 'paused',
  };
  mockBalance = { ...mockBalance, data: undefined, isPending: true, isFetchedAfterMount: false, fetchStatus: 'paused' };
  const tree = render();
  expect(textContent(tree)).toContain('Нет связи · обновим после подключения');
  expect(nodes(tree).some((node) => node.type === 'Skeleton')).toBe(false);
});

test('the shared today cache stays a full dashboard and historical hints never change its key or request', async () => {
  render();
  const firstKey = query('payments').queryKey;
  const result = await query('payments').queryFn();
  expect(result).toEqual(dashboard());
  expect(firstKey).toEqual(['owner-home', ...scope.key, 'native-widget-today']);
  render({ todayDate: '2020-01-01' });
  expect(query('payments').queryKey).toEqual(firstKey);
  await query('payments').queryFn();
  expect(mockDashboard.mock.calls).toEqual([[{ period: 'today' }], [{ period: 'today' }]]);
  expect(query('points')).toEqual({ queryKey: ['points'], queryFn: expect.any(Function), enabled: false });
});

test('a yesterday or pre-mount payment cache cannot be presented as today', () => {
  mockPayments.dataUpdatedAt = Date.now() - 86_400_000;
  expect(byId(render(), 'owner-home-cash-total')).toBeUndefined();
  mockPayments.dataUpdatedAt = Date.now();
  mockPayments.isFetchedAfterMount = false;
  expect(byId(render(), 'owner-home-cash-total')).toBeUndefined();
  const beforeMidnight = Date.parse('2026-10-30T20:59:59Z');
  expect(ownerCashIsToday(beforeMidnight, 'Europe/Moscow', new Date('2026-10-30T21:00:00Z'))).toBe(false);
  expect(ownerCashIsToday(beforeMidnight, 'UTC', new Date('2026-10-30T21:00:00Z'))).toBe(true);
});

test('only read APIs are invoked; links open real screens without activation or cash mutations', async () => {
  const tree = render();
  await query('payments').queryFn();
  await query('balance').queryFn();
  byId(tree, 'owner-home-cash-flow')!.props.onPress();
  byId(tree, 'owner-home-cash-shift')!.props.onPress();
  expect(mockCurrent).toHaveBeenCalledTimes(1);
  expect(mockCurrent).toHaveBeenCalledWith();
  expect(mockDispatch.mock.calls.map(([action]) => action.payload.params.screen)).toEqual(['CashFlow', 'CashShift']);
  expect(mockOpen).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  expect(mockCollect).not.toHaveBeenCalled();
});

test('financial permission loss hides data and blocks old requests, retry actions, links and poll callbacks', async () => {
  mockPayments.isError = true;
  mockBalance.isError = true;
  const tree = render();
  const oldPayments = query('payments');
  const oldBalance = query('balance');
  mockAuth.hasPermission.mockReturnValue(false);
  expect(render()).toBeNull();
  expect(query('payments').enabled).toBe(false);
  expect(query('balance').enabled).toBe(false);
  expect(oldPayments.refetchInterval()).toBe(false);
  expect(oldBalance.refetchInterval()).toBe(false);
  byId(tree, 'owner-home-cash-payments-retry')!.props.onPress();
  byId(tree, 'owner-home-cash-balance-retry')!.props.onPress();
  byId(tree, 'owner-home-cash-flow')!.props.onPress();
  await expect(oldPayments.queryFn()).rejects.toThrow('Сессия изменилась');
  await expect(oldBalance.queryFn()).rejects.toThrow('Сессия изменилась');
  expect(mockDashboard).not.toHaveBeenCalled();
  expect(mockCurrent).not.toHaveBeenCalled();
  expect(mockPaymentsRetry).not.toHaveBeenCalled();
  expect(mockBalanceRetry).not.toHaveBeenCalled();
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('cash flow navigation respects its permission separately from financial reads', () => {
  mockAuth.hasPermission.mockImplementation((permission?: string) => permission === 'financial_reports');
  const tree = render();
  expect(query('payments').enabled).toBe(true);
  expect(byId(tree, 'owner-home-cash-flow')!.props.disabled).toBe(true);
  byId(tree, 'owner-home-cash-flow')!.props.onPress();
  expect(mockDispatch).not.toHaveBeenCalled();
});

test.each(['blur', 'scope', 'unmount', 'role'])(
  'retired %s callbacks cannot fetch, poll or navigate',
  async (reason) => {
    let current = true;
    const oldScope = { ...scope, isCurrent: () => current };
    const tree = render({ scope: oldScope });
    const oldPayments = query('payments');
    const oldBalance = query('balance');
    if (reason === 'blur') render({ enabled: false, scope: oldScope });
    if (reason === 'scope') {
      current = false;
      render({ scope: { ...scope, key: ['new-account'] } });
    }
    if (reason === 'unmount') mockCleanup!();
    if (reason === 'role') {
      mockAuth.user.role = 'master';
      expect(render()).toBeNull();
    }
    byId(tree, 'owner-home-cash-flow')!.props.onPress();
    byId(tree, 'owner-home-cash-shift')!.props.onPress();
    expect(oldPayments.refetchInterval()).toBe(false);
    expect(oldBalance.refetchInterval()).toBe(false);
    await expect(oldPayments.queryFn()).rejects.toThrow('Сессия изменилась');
    await expect(oldBalance.queryFn()).rejects.toThrow('Сессия изменилась');
    expect(mockDashboard).not.toHaveBeenCalled();
    expect(mockCurrent).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  },
);

test.each(['payments', 'balance'] as const)('late %s responses are rejected after permission changes', async (kind) => {
  let resolve!: (response: unknown) => void;
  (kind === 'payments' ? mockDashboard : mockCurrent).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render();
  const pending = query(kind).queryFn();
  mockAuth.hasPermission.mockReturnValue(false);
  render();
  resolve({ data: kind === 'payments' ? dashboard() : cashReport() });
  await expect(pending).rejects.toThrow('Сессия изменилась');
});

test.each([
  { width: 320, scale: 1, dark: false },
  { width: 390, scale: 1.6, dark: true },
])('narrow and large-text layouts preserve full money and captions: %p', ({ width, scale, dark }) => {
  mockWidth = width;
  mockFontScale = scale;
  mockDark = dark;
  mockPayments.data = dashboard({ cash: 999_999_999.99, card: 0, total: 999_999_999.99 });
  const tree = render();
  expect(textContent(byId(tree, 'owner-home-cash-cash'))).toBe(ownerMoney(999_999_999.99));
  expect(textContent(tree)).toContain('Остаток по учёту');
  expect(
    nodes(tree).some(
      (node) =>
        Array.isArray(node.props.style) && node.props.style.some((style: any) => style?.flexDirection === 'column'),
    ),
  ).toBe(true);
  expect(nodes(tree).some((node) => node.props.numberOfLines || node.props.adjustsFontSizeToFit)).toBe(false);
});
