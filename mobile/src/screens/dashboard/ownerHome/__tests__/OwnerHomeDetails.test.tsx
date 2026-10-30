import React from 'react';
import type { OwnerHomeRapidReturnRow } from '../../../../../../shared/types/ownerHome';
const mockPermission = jest.fn(() => true);
const mockDispatch = jest.fn();
const mockStates: unknown[] = [];
let mockStateIndex = 0;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (value: unknown) => {
    const index = mockStateIndex++;
    if (!(index in mockStates)) mockStates[index] = value;
    return [
      mockStates[index],
      (next: unknown) => {
        mockStates[index] = typeof next === 'function' ? next(mockStates[index]) : next;
      },
    ];
  },
  useEffect: jest.fn(),
  useRef: (value: unknown) => ({ current: value }),
}));
jest.mock('../../../../components/TabBarScrollable', () => ({ TabBarScrollView: 'ScrollView' }));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { ownerHomePilot: true } } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock('@tanstack/react-query', () => ({ useInfiniteQuery: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'director' }, hasPermission: mockPermission }),
}));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555' },
    border: { subtle: '#ddd' },
    accent: { primary: '#2563eb', primaryText: '#1d4ed8' },
  }),
}));
jest.mock('../../../../api/services', () => ({ reportsApi: {} }));
jest.mock('../OwnerHomeOperational', () => ({ OwnerHomeRetry: 'OwnerHomeRetry' }));
import OwnerHomeDetails, { ReturnVehicle, type OwnerHomeDetail } from '../OwnerHomeDetails';
import { accrualFixture, footerFixture, timelineFixture } from '../__fixtures__/timeline';
import { formatMoney } from '../../../../../../shared/utils/formatters';
import { ownerRangeLabel } from '../ownerHomeState';

const fixture: OwnerHomeRapidReturnRow = {
  carId: 'car',
  plateNumber: 'А123АА',
  makeModel: 'Toyota Camry',
  clientId: 'client',
  clientName: 'Клиент',
  latestVisitDate: '2026-10-29',
  previousVisitDate: '2026-10-16',
  gapDays: 13,
  returnVisitCount: 1,
  currentChecks: [{ id: 'current', number: 111 }],
  currentCheckCount: 1,
  previousChecks: [{ id: 'previous', number: 999 }],
  previousCheckCount: 1,
  previousWorks: ['Доступная работа текущего филиала'],
  previousWorkCount: 1,
  previousDetailsRestricted: false,
  canOpenCarHistory: true,
};
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
function text(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!React.isValidElement<Record<string, unknown>>(node)) return '';
  return React.Children.toArray(node.props.children as React.ReactNode)
    .map(text)
    .join('');
}
beforeEach(() => {
  mockPermission.mockReturnValue(true);
  mockDispatch.mockClear();
  mockStates.length = 0;
  mockStateIndex = 0;
});

function resolveFinancial(node: React.ReactNode): React.ReactNode {
  if (!React.isValidElement<Record<string, unknown>>(node)) return node;
  if (typeof node.type === 'function') {
    return resolveFinancial((node.type as (props: Record<string, unknown>) => React.ReactNode)(node.props));
  }
  return React.cloneElement(
    node,
    {},
    ...React.Children.toArray(node.props.children as React.ReactNode).map(resolveFinancial),
  );
}
function financialTree(detail: Extract<OwnerHomeDetail, { kind: 'timeline' | 'timeline-info' | 'profit' | 'basis' }>) {
  mockStateIndex = 0;
  return resolveFinancial(
    OwnerHomeDetails({ detail, scope: { key: ['account'], isCurrent: () => true }, onClose: jest.fn() }),
  );
}
function disclosure(tree: React.ReactNode) {
  return nodes(tree).find((node) => node.props.accessibilityLabel === 'Как считаем')!;
}

test.each(['day', 'week', 'month', 'year'] as const)(
  '%s puts the selected period and exact calculation before accounting notes',
  (period) => {
    const data = timelineFixture(period);
    const copy = text(financialTree({ kind: 'timeline', timeline: data }));
    expect(copy).toContain(ownerRangeLabel(data.range.from, data.range.through));
    expect(copy).toContain('Текущий филиал · до 14:20');
    expect(copy).toContain('Europe/Moscow');
    expect(copy).toContain(`Оборот${formatMoney(data.totals.revenue, 2)}`);
    expect(copy).toContain(`Прибыль по чекам+${formatMoney(data.totals.checkProfit, 2)}`);
    expect(copy).toContain(`Постоянные расходы−${formatMoney(3000, 2)}`);
    expect(copy).toContain(`Чистая прибыль${formatMoney(data.totals.netProfit, 2)}`);
    expect(copy.indexOf('Чистая прибыль')).toBeLessThan(copy.indexOf('По текущему плану'));
    expect(copy).not.toContain(data.basisDetail);
    expect(copy).not.toMatch(/график|первый час|Над ним/);
  },
);

test('calculation keeps expense reversals positive and does not deduct the motivation subset twice', () => {
  const data = {
    ...timelineFixture(),
    totals: {
      revenue: 25000.75,
      checkProfit: 9000.25,
      plannedFixedAmortized: 2000,
      staffFixedAmortized: 1000,
      staffPctTurnover: 200,
      staffPctProfit: 100,
      oneOffExpenses: 300,
      recurringExcess: -100.5,
      salaryExtras: 700,
      motivation: 300,
      perVehicleDayExpense: 50,
      netProfit: 4750.75,
    },
  };
  const copy = text(financialTree({ kind: 'timeline', timeline: data }));
  expect(copy).toContain(`Премии и мотивация−${formatMoney(700, 2)}`);
  expect(copy).toContain(`Постоянка вне Плана+${formatMoney(100.5, 2)}`);
  expect(copy).toContain(`За автомобиль в день−${formatMoney(50, 2)}`);
  expect(copy).toContain(`Чистая прибыль${formatMoney(4750.75, 2)}`);
  expect(copy).not.toContain(`Мотивация−${formatMoney(300, 2)}`);
});

test.each(['timeline', 'timeline-info'] as const)(
  '%s reveals and collapses source accounting rules without changing the calculation',
  (kind) => {
    const data = {
      ...timelineFixture(),
      basisDetail: 'Исторические результаты пересчитаны по текущему плану. Это не архивный снимок.',
    };
    const detail = { kind, timeline: data };
    const collapsed = financialTree(detail);
    expect(disclosure(collapsed).props.accessibilityState).toEqual({ expanded: false });
    expect(text(collapsed)).not.toContain(data.basisDetail);
    expect(text(collapsed)).not.toContain(data.allocationDetail);
    (disclosure(collapsed).props.onPress as () => void)();
    const expanded = financialTree(detail);
    expect(disclosure(expanded).props.accessibilityState).toEqual({ expanded: true });
    expect(text(expanded)).toContain(data.basisDetail);
    expect(text(expanded)).toContain(data.allocationDetail);
    expect(text(expanded)).toContain('Выплаты и остаток кассы считаются отдельно');
    expect(text(expanded)).toContain(`Чистая прибыль${formatMoney(data.totals.netProfit, 2)}`);
    (disclosure(expanded).props.onPress as () => void)();
    expect(text(financialTree(detail))).toBe(text(collapsed));
    expect(mockDispatch).not.toHaveBeenCalled();
  },
);

test('info starts with a compact net-profit formula and explicit comparable month dates', () => {
  const data = timelineFixture('year');
  const copy = text(financialTree({ kind: 'timeline-info', timeline: data }));
  expect(copy).toContain('Как считаем прибыль');
  expect(copy).toContain('Прибыль по чекам− Расходы и начисления');
  expect(copy).toContain(`Чистая прибыль${formatMoney(data.totals.netProfit, 2)}`);
  expect(copy).toContain('Себестоимость и сдельная оплата уже в прибыли по чекам');
  expect(copy).toContain('Мотивация включена в премии один раз');
  expect(copy).toContain(
    `Месяц: ${ownerRangeLabel(data.footer.current.period.from, data.footer.current.period.through)}`,
  );
  expect(copy).toContain(
    `Сравнение: ${ownerRangeLabel(data.footer.comparison.period.from, data.footer.comparison.period.through)}, до 14:20`,
  );
  expect(copy).not.toContain('Постоянные расходы');
  expect(copy).not.toContain(data.basisDetail);
});

test('monthly details retain the actual MTD comparison rather than the current day', () => {
  const copy = text(financialTree({ kind: 'profit', period: 'month', profit: footerFixture }));
  expect(copy).toContain(`Чистая прибыль${formatMoney(footerFixture.current.mtd.netProfit, 2)}`);
  expect(copy).toContain(`${ownerRangeLabel('2026-09-01', '2026-09-29')} · до 14:20`);
  expect(copy).toContain(`Было${formatMoney(footerFixture.comparison.mtd.netProfit, 2)}`);
  expect(copy).toContain(`Изменение+${formatMoney(81100, 2)} · +17%`);
  expect(copy).not.toContain(formatMoney(footerFixture.current.day.netProfit, 2));
  expect(copy).not.toContain(footerFixture.basisDetail);
});

test.each([0, -200])(
  'monthly comparison with baseline %s preserves money change and explains the missing percent on demand',
  (baseline) => {
    const profit = {
      ...footerFixture,
      comparison: {
        ...footerFixture.comparison,
        mtd: accrualFixture(baseline),
        mtdDelta: { amount: 750.25, percent: 999 },
      },
    };
    const detail = { kind: 'profit' as const, period: 'month' as const, profit };
    const tree = financialTree(detail);
    expect(text(tree)).toContain(`Изменение+${formatMoney(750.25, 2)}`);
    expect(text(tree)).not.toContain('%');
    (disclosure(tree).props.onPress as () => void)();
    expect(text(financialTree(detail))).toContain('При нулевой или отрицательной базе показываем изменение в рублях');
  },
);

test('all-point completed periods keep their scope, date and timezone', () => {
  const source = timelineFixture('month');
  const data = {
    ...source,
    pointId: null,
    range: { ...source.range, from: '2025-12-01', through: '2025-12-31', partialDay: false },
  };
  const copy = text(financialTree({ kind: 'timeline', timeline: data }));
  expect(copy).toContain(ownerRangeLabel('2025-12-01', '2025-12-31'));
  expect(copy).toContain('Все филиалы · по конец дня');
  expect(copy).toContain('Europe/Moscow');
  expect(copy).not.toContain('до 14:20');
});

test('a real detail open waits for native dismissal and addresses CheckDetail inside the Checks tab', () => {
  const onClose = jest.fn();
  const tree = OwnerHomeDetails({
    detail: { kind: 'returns', range: { from: '2026-10-29', to: '2026-10-29' }, timezone: 'Europe/Moscow' },
    scope: { key: ['account'], isCurrent: () => true },
    onClose,
  });
  const list = nodes(tree).find((node) => typeof node.type === 'function' && node.type.name === 'ReturnList')!;
  expect(nodes(tree).find((node) => node.type === 'ScrollView')?.props.reserveBottomNavigation).toBe(false);
  (list.props.open as (name: 'CheckDetail', params: { id: string }) => void)('CheckDetail', {
    id: 'current',
  });
  expect(mockDispatch).not.toHaveBeenCalled();
  (tree.props.onDismiss as () => void)();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenCalledWith({
    type: 'NAVIGATE',
    payload: {
      name: 'Checks',
      params: { screen: 'CheckDetail', initial: false, params: { id: 'current' } },
    },
  });
});

test('a session change while the detail modal is dismissing cancels the queued navigation', () => {
  let current = true;
  const tree = OwnerHomeDetails({
    detail: { kind: 'returns', range: { from: '2026-10-29', to: '2026-10-29' }, timezone: 'Europe/Moscow' },
    scope: { key: ['account'], isCurrent: () => current },
    onClose: jest.fn(),
  });
  const list = nodes(tree).find((node) => typeof node.type === 'function' && node.type.name === 'ReturnList')!;
  (list.props.open as (name: 'CheckDetail', params: { id: string }) => void)('CheckDetail', { id: 'current' });
  current = false;
  (tree.props.onDismiss as () => void)();
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('a mixed previous visit keeps permitted details while warning about restricted history', () => {
  const open = jest.fn();
  const tree = ReturnVehicle({ row: { ...fixture, previousDetailsRestricted: true, canOpenCarHistory: false }, open });
  const serialized = JSON.stringify(tree);
  expect(serialized).toContain('Доступная работа текущего филиала');
  expect(serialized).toContain('999');
  expect(serialized).toContain('111');
  expect(serialized).toContain('Часть истории предыдущего визита недоступна');
  const buttons = nodes(tree).filter((node) => node.props.accessibilityRole === 'button');
  expect(buttons[0].props.disabled).toBe(true);
  for (const button of buttons) (button.props.onPress as () => void)();
  expect(open).not.toHaveBeenCalledWith('CarDetail', expect.anything());
  expect(open).toHaveBeenCalledWith('CheckDetail', { id: 'previous' });
});

test('car history flag and check permission independently gate real navigation', () => {
  const open = jest.fn();
  mockPermission.mockReturnValue(false);
  const denied = ReturnVehicle({ row: { ...fixture, canOpenCarHistory: false }, open });
  const deniedButtons = nodes(denied).filter((node) => node.props.accessibilityRole === 'button');
  expect(deniedButtons).toHaveLength(1);
  expect(deniedButtons[0].props.disabled).toBe(true);
  (deniedButtons[0].props.onPress as () => void)();
  expect(open).not.toHaveBeenCalled();
  mockPermission.mockReturnValue(true);
  const permitted = ReturnVehicle({ row: fixture, open });
  const buttons = nodes(permitted).filter((node) => node.props.accessibilityRole === 'button');
  for (const button of buttons) (button.props.onPress as () => void)();
  expect(open).toHaveBeenCalledWith('CarDetail', expect.objectContaining({ carId: 'car' }));
  expect(open).toHaveBeenCalledWith('CheckDetail', { id: 'previous' });
  expect(open).toHaveBeenCalledWith('CheckDetail', { id: 'current' });
});

function actualReturnDetail(row: OwnerHomeRapidReturnRow) {
  const dialog = OwnerHomeDetails({
    detail: { kind: 'returns', range: { from: '2026-10-29', to: '2026-10-29' }, timezone: 'Europe/Moscow' },
    scope: { key: ['account'], isCurrent: () => true },
    onClose: jest.fn(),
  });
  const list = nodes(dialog).find((node) => typeof node.type === 'function' && node.type.name === 'ReturnList')!;
  const vehicle = ReturnVehicle({ row, open: list.props.open as React.ComponentProps<typeof ReturnVehicle>['open'] });
  return { dialog, vehicle };
}

test.each([
  {
    scenario: 'previous check belongs to a different client',
    currentClient: 'latest-client-B',
    checkId: 'previous-client-A-check',
    previous: true,
    canOpenCarHistory: true,
  },
  {
    scenario: 'historical client is hidden but the own-point check is allowed',
    currentClient: 'hidden-historical-client',
    checkId: 'allowed-own-point-check',
    previous: false,
    canOpenCarHistory: false,
  },
])(
  '$scenario: vetted check link uses the regular id route after dismissal',
  ({ currentClient, checkId, previous, canOpenCarHistory }) => {
    const row = {
      ...fixture,
      clientId: currentClient,
      canOpenCarHistory,
      previousChecks: [{ id: checkId, number: 999 }],
      currentChecks: [{ id: checkId, number: 111 }],
    };
    const { dialog, vehicle } = actualReturnDetail(row);
    const link = nodes(vehicle).find(
      (node) =>
        node.props.accessibilityLabel ===
        (previous ? 'Открыть предыдущий заказ-наряд 999' : 'Открыть повторный заказ-наряд 111'),
    )!;
    expect(link).toBeDefined();
    (link.props.onPress as () => void)();
    expect(mockDispatch).not.toHaveBeenCalled();
    (dialog.props.onDismiss as () => void)();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'NAVIGATE',
      payload: { name: 'Checks', params: { screen: 'CheckDetail', initial: false, params: { id: checkId } } },
    });
    // CheckDetail's real loader selects clientHistoryCheck whenever clientId is supplied.
    // An absent hint keeps the regular getById permission scope for this vetted id.
    const routeParams = mockDispatch.mock.calls[0][0].payload.params.params;
    expect(routeParams).not.toHaveProperty('clientId');
    const car = nodes(vehicle).find(
      (node) => node.props.accessibilityState && 'disabled' in (node.props.accessibilityState as object),
    )!;
    expect(car.props.disabled).toBe(!canOpenCarHistory);
  },
);

test('a transferred car opens its permitted history without labeling the historical client as current owner', () => {
  const { dialog, vehicle } = actualReturnDetail({
    ...fixture,
    clientId: 'hidden-previous-owner',
    clientName: 'Прежний владелец',
    canOpenCarHistory: true,
  });
  const car = nodes(vehicle).find((node) => node.props.accessibilityRole === 'button')!;
  (car.props.onPress as () => void)();
  expect(mockDispatch).not.toHaveBeenCalled();
  (dialog.props.onDismiss as () => void)();
  expect(mockDispatch).toHaveBeenCalledWith({
    type: 'NAVIGATE',
    payload: {
      name: 'CarDetail',
      params: { carId: 'car', makeModel: 'Toyota Camry', plateNumber: 'А123АА', noPlate: false },
    },
  });
  expect(mockDispatch.mock.calls[0][0].payload.params).not.toHaveProperty('clientId');
  expect(mockDispatch.mock.calls[0][0].payload.params).not.toHaveProperty('clientName');
});
