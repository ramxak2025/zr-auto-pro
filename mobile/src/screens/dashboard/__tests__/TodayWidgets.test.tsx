import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import ts from 'typescript';
import { emptyJournalFilters, journalQueryParams } from '../../journal/filters';
import React from 'react';
const mockNavigate = jest.fn();
const mockQuery = jest.fn();
const mockAuth = {
  user: { id: 'account-A', currentPointId: 'point-A', permissions: {} },
  hasPermission: jest.fn(() => true),
};
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (init: unknown) => [typeof init === 'function' ? init() : init, jest.fn()],
  useEffect: jest.fn(),
  useCallback: (fn: unknown) => fn,
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  AppState: { addEventListener: jest.fn() },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: jest.fn(),
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => mockQuery(options) }));
jest.mock('../../../api/services', () => ({
  dashboardApi: { attention: jest.fn() },
  salaryApi: { getTodayEarnings: jest.fn() },
}));
jest.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => 'Europe/Moscow' }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#444', tertiary: '#666' },
    border: { subtle: '#ccc' },
  }),
}));
jest.mock('../../../components/EmployeeAvatar', () => 'EmployeeAvatar');
jest.mock('../../../components/Skeleton', () => ({ Skeleton: 'Skeleton' }));
import { AttentionCard, TodayEarningsCard } from '../TodayWidgets';
import { applyWidgetOrder, isWidgetVisible } from '../dashboardWidgets';
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.hasPermission.mockReturnValue(true);
});
test('salary_view_all gates request and render without financial_reports', () => {
  mockQuery.mockReturnValue({
    data: {
      date: '2026-10-26',
      employees: [{ id: 'a', name: 'Мастер', avatar: null, earnedAmount: -0.05 }],
      total: -0.05,
    },
    refetch: jest.fn(),
  });
  mockAuth.hasPermission.mockReturnValue(false);
  expect(TodayEarningsCard()).toBeNull();
  expect(mockQuery.mock.calls[0][0].enabled).toBe(false);
  mockAuth.hasPermission.mockReturnValue(true);
  const tree = TodayEarningsCard();
  expect(mockQuery.mock.calls[1][0].enabled).toBe(true);
  expect(mockAuth.hasPermission).toHaveBeenCalledWith('salary_view_all');
  expect(JSON.stringify(tree)).toContain('-0,05');
  expect(JSON.stringify(tree)).toContain('Выплаты и авансы не вычитаются');
});
test('attention opens exactly matching destination filters and keeps zeros/errors distinct', () => {
  mockQuery.mockReturnValue({
    data: {
      date: '2026-10-26',
      buckets: ['bookings', 'deferred', 'purchase-orders', 'low-stock', 'installments'].map((id) => ({ id, count: 3 })),
    },
    refetch: jest.fn(),
  });
  const buttons = nodes(AttentionCard()).filter((n) => n.props.accessibilityRole === 'button');
  for (const button of buttons) (button.props.onPress as () => void)();
  expect(mockNavigate.mock.calls).toEqual([
    ['MoreTab', { screen: 'PublicBookingRequests', params: { pendingOnly: true }, initial: false }],
    ['Checks', { screen: 'ChecksHome', params: { deferredOnly: true }, initial: false }],
    ['MoreTab', { screen: 'PurchaseOrders', params: { status: 'ordered' }, initial: false }],
    ['Products', { screen: 'ProductsHome', params: { lowStock: true }, initial: false }],
    ['MoreTab', { screen: 'Installments', params: { status: 'overdue' }, initial: false }],
  ]);
  mockQuery.mockReturnValue({
    data: {
      date: '2026-10-26',
      buckets: [
        { id: 'deferred', count: 0 },
        { id: 'bookings', count: null, error: true },
      ],
    },
    refetch: jest.fn(),
  });
  const tree = AttentionCard();
  expect(nodes(tree).filter((n) => n.props.accessibilityRole === 'button')).toHaveLength(1);
  expect(JSON.stringify(tree)).not.toContain('Всё под контролем');
});
test('saved widget order and visibility survive addition of new default-visible widgets', () => {
  const Component = () => null;
  const defs = ['existing', 'attention', 'today-earnings'].map((id) => ({ id, label: id, Component }));
  expect(applyWidgetOrder(defs, ['existing']).map((d) => d.id)).toEqual(['existing', 'attention', 'today-earnings']);
  expect(isWidgetVisible({ existing: false }, 'attention')).toBe(true);
  expect(isWidgetVisible({ 'today-earnings': false }, 'today-earnings')).toBe(false);
});

test('own deferred task narrows destination to the author, excluding executor-only checks', () => {
  mockAuth.hasPermission.mockImplementation(() => false);
  mockQuery.mockReturnValue({
    data: { date: '2026-10-26', buckets: [{ id: 'deferred', count: 2 }] },
    refetch: jest.fn(),
  });
  const button = nodes(AttentionCard()).find((n) => n.props.accessibilityRole === 'button');
  (button?.props.onPress as () => void)();
  expect(mockNavigate).toHaveBeenCalledWith('Checks', {
    screen: 'ChecksHome',
    params: { deferredOnly: true, deferredMasterId: 'account-A' },
    initial: false,
  });
});

test('actual ChecksScreen route state feeds its real queryFn masterId and isDeferred API params', async () => {
  const source = ts.createSourceFile(
    'ChecksScreen.tsx',
    readFileSync(join(__dirname, '../../ChecksScreen.tsx'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer: ts.Expression | undefined;
  let queryFn: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements.some((e) => e.getText(source) === 'appliedFilters') &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      initializer = node.initializer.arguments[0];
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === 'queryFn' &&
      node.initializer.getText(source).includes('checksApi.getAll(params)')
    )
      queryFn = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!initializer || !queryFn) throw new Error('Actual journal route state/queryFn not found');
  const execute = (expression: ts.Expression, scope: Record<string, unknown>) =>
    vm.runInNewContext(
      ts.transpileModule(`(${expression.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } })
        .outputText,
      scope,
    );
  const appliedFilters = execute(initializer, {
    route: { params: { deferredOnly: true, deferredMasterId: 'account-A' } },
    emptyJournalFilters,
  })();
  const getAll = jest.fn(async () => ({ data: { data: [], total: 1 } }));
  await execute(queryFn, { limit: 20, search: '', appliedFilters, journalQueryParams, checksApi: { getAll } })({
    pageParam: '',
  });
  expect(getAll).toHaveBeenCalledWith({ cursor: '', limit: 20, masterId: 'account-A', isDeferred: true });
});
