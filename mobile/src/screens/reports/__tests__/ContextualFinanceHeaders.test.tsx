/** Actual presenter expressions with inert hosts: preserves task actions and
 * caller-owned guards. Device typography/focus/native presentation is separate. */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
type Action = { id: string; disabled?: boolean; loading?: boolean; onSelect?: () => void };
const hosts = Object.fromEntries(
  [
    'ScreenSectionHeader',
    'IosScreenHeader',
    'HeaderIsland',
    'HeaderAction',
    'ScreenHeaderMenu',
    'View',
    'Text',
    'Ionicons',
    'Button',
    'ScrollView',
    'TouchableOpacity',
    'PointIndicator',
  ].map((name) => [name, name]),
);
const styles = new Proxy({}, { get: () => ({}) });
const palette = {
  bg: { muted: '#eee', card: '#fff' },
  text: { primary: '#111', secondary: '#555', tertiary: '#777' },
  border: { subtle: '#ddd' },
  accent: { primary: '#16c', primaryText: '#16c', primarySoft: '#def' },
};
const nodes = (tree: React.ReactNode): Element[] =>
  React.isValidElement(tree)
    ? [
        tree as Element,
        ...['children', 'leading', 'actions', 'trailing', 'context'].flatMap((slot) =>
          React.Children.toArray((tree as Element).props[slot] as React.ReactNode).flatMap(nodes),
        ),
      ]
    : [];
function expression(
  file: string,
  select: (node: ts.Node, source: ts.SourceFile) => ts.Node | undefined,
  bindings: Record<string, unknown>,
) {
  const filename = resolve(__dirname, file);
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let selected: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    const found = select(node, source);
    if (found) selected = found;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!selected) throw new Error(`Presenter expression not found: ${file}`);
  const code = ts.transpileModule(`module.exports = (${selected.getText(source)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const values = { React, ...hosts, styles, palette, headerTouchSize: 44, ...bindings };
  const module = { exports: undefined as unknown };
  new Function(...Object.keys(values), 'module', code)(...Object.values(values), module);
  return module.exports;
}
const variable = (name: string) => (node: ts.Node) =>
  ts.isVariableDeclaration(node) && node.name.getText() === name ? node.initializer : undefined;
const header = (title: string) => (node: ts.Node, source: ts.SourceFile) => {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
  const attr = node.attributes.properties.find(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'title',
  ) as ts.JsxAttribute | undefined;
  if (attr?.initializer?.getText(source) === title) return ts.isJsxOpeningElement(node) ? node.parent : node;
};
const menu = (tree: React.ReactNode, label: string) =>
  nodes(tree).find((node) => node.type === 'ScreenHeaderMenu' && node.props.label === label)!;
const entries = (node: Element) =>
  (node.props.items as Array<Action | false | null | undefined>).filter((entry): entry is Action => Boolean(entry));
const command = (node: Element, id: string) => entries(node).find((entry) => entry.id === id)!;
function report(overrides: Record<string, unknown> = {}) {
  const bindings = {
    section: {},
    def: {
      title: 'Выручка',
      groupByOptions: [
        { value: 'day', label: 'По дням' },
        { value: 'employee', label: 'По сотрудникам' },
      ],
    },
    subtitle: 'Данные: сентябрь',
    result: { period: { from: '2026-09-01', to: '2026-09-30' } },
    reportQuery: { isFetching: false },
    exporting: false,
    navigation: { goBack: jest.fn() },
    handleExport: jest.fn(),
    handlePeriod: jest.fn(),
    handleRun: jest.fn(),
    haptic: jest.fn(),
    period: 'month',
    PERIODS: [
      { key: 'month', label: 'Месяц' },
      { key: 'custom', label: 'Произвольный' },
    ],
    monthCursor: new Date(2026, 9, 1),
    monthTitle: () => 'Октябрь 2026',
    isAtOldestMonth: true,
    isAtCurrentMonth: false,
    setMonthCursor: jest.fn(),
    shiftMonth: jest.fn(),
    startOfMonth: jest.fn(),
    showEntityFilter: true,
    filterLabel: 'Сотрудники',
    filterSummary: 'Все',
    setFilterOpen: jest.fn(),
    groupBy: 'day',
    setGroupBy: jest.fn(),
    selectedIds: [],
    selectedLabels: [],
    setSelectedIds: jest.fn(),
    customRange: { from: '2026-10-01', to: '2026-10-20' },
    setShowPicker: jest.fn(),
    formatReportDate: (value: string) => value,
    draftError: undefined,
    colors: { white: '#fff', amber: { 600: '#b60' } },
    periodLabel: 'Новый черновой период',
    formatPeriodLabel: (_period: string, range: { from: string; to: string }) => `${range.from}—${range.to}`,
    ...overrides,
  };
  return { bindings, tree: expression('../ReportRunScreen.tsx', header('{def.title}'), bindings) as React.ReactNode };
}

it('puts the report period and scope in its header without committing a custom draft', () => {
  const { tree, bindings } = report();
  command(menu(tree, 'Период отчёта'), 'custom').onSelect!();
  expect(bindings.handlePeriod).toHaveBeenCalledWith('custom');
  expect(bindings.handleRun).not.toHaveBeenCalled();
  const scope = nodes(tree).find((node) => node.type === 'HeaderAction' && node.props.label === 'Сотрудники: Все')!;
  (scope.props.onPress as () => void)();
  expect(bindings.setFilterOpen).toHaveBeenCalledWith(true);
  command(menu(tree, 'Группировка отчёта'), 'employee').onSelect!();
  expect(bindings.setGroupBy).toHaveBeenCalledWith('employee');
});
it('preserves month bounds and hides the entity chooser when the caller has no selectable scope', () => {
  const { tree } = report({ showEntityFilter: false, isAtCurrentMonth: true });
  const buttons = nodes(tree).filter((node) => node.type === 'HeaderAction');
  expect(buttons.find((node) => node.props.label === 'Предыдущий месяц')?.props.disabled).toBe(true);
  expect(buttons.find((node) => node.props.label === 'Следующий месяц')?.props.disabled).toBe(true);
  expect(command(menu(tree, 'Период отчёта'), 'current-month').disabled).toBe(true);
  expect(buttons.some((node) => String(node.props.label).startsWith('Сотрудники:'))).toBe(false);
});
it.each([
  { result: undefined, exporting: false },
  { result: {}, exporting: true },
])('keeps PDF unavailable for $exporting / missing result', (state) => {
  const { tree } = report(state);
  expect(command(menu(tree, 'Действия отчёта'), 'pdf').disabled).toBe(true);
});
it('keeps export on its original callback and visible progress on the secondary trigger', () => {
  const { tree, bindings } = report();
  const exportAction = command(menu(tree, 'Действия отчёта'), 'pdf');
  expect(exportAction.onSelect).toBe(bindings.handleExport);
  expect(menu(report({ exporting: true }).tree, 'Действия отчёта').props.loading).toBe(true);
});
it('labels the rendered data period separately from the new unapplied date draft', () => {
  const { bindings } = report();
  const subtitle = expression('../ReportRunScreen.tsx', variable('subtitle'), bindings);
  expect(subtitle).toBe('Данные: 2026-09-01—2026-09-30');
  expect(subtitle).not.toContain('Новый черновой период');
});
it('keeps custom dates and the original guarded Apply action visible in the scrolling content', () => {
  const { bindings } = report({
    period: 'custom',
    draftError: 'Период неверен',
    result: undefined,
    reportQuery: { isFetching: true },
  });
  const tree = expression('../ReportRunScreen.tsx', variable('controls'), bindings) as React.ReactNode;
  const apply = nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'Сформировать')!;
  expect(apply.props).toMatchObject({ onPress: bindings.handleRun, disabled: true, loading: true });
  const start = nodes(tree).find((node) => String(node.props.accessibilityLabel).startsWith('Начало периода:'))!;
  (start.props.onPress as () => void)();
  expect(bindings.setShowPicker).toHaveBeenCalledWith('from');
  expect(nodes(tree).some((node) => node.type === 'ScreenHeaderMenu')).toBe(false);
});

function checkForm(overrides: Record<string, unknown> = {}) {
  const bindings = {
    section: {},
    editId: undefined,
    isStackScreen: true,
    canEditCheckDate: true,
    manualDate: new Date(2026, 9, 28),
    dateStr: '28.10.2026',
    timeStr: '14:00',
    navigation: { goBack: jest.fn() },
    openCheckPicker: jest.fn(),
    setManualDate: jest.fn(),
    ...overrides,
  };
  const tree = expression(
    '../../CheckCreateScreen.tsx',
    header("{editId ? 'Редактирование чека' : 'Касса'}"),
    bindings,
  ) as React.ReactNode;
  return { bindings, tree };
}
it('keeps stack Back and the original date/time/reset handlers while the footer remains the submit owner', () => {
  const { tree, bindings } = checkForm();
  const back = nodes(tree).find((node) => node.type === 'HeaderAction' && node.props.label === 'Назад')!;
  (back.props.onPress as () => void)();
  expect(bindings.navigation.goBack).toHaveBeenCalledTimes(1);
  const dates = menu(tree, 'Дата заказ-наряда');
  command(dates, 'date').onSelect!();
  command(dates, 'time').onSelect!();
  command(dates, 'now').onSelect!();
  expect(bindings.openCheckPicker.mock.calls).toEqual([['date'], ['time']]);
  expect(bindings.setManualDate).toHaveBeenCalledWith(null);
  expect(nodes(tree).some((node) => /Сохранить|Пробить|Оплатить/.test(String(node.props.label)))).toBe(false);
});
it('does not invent Back for the POS tab or date-edit rights for edit/readonly modes', () => {
  expect(nodes(checkForm({ isStackScreen: false }).tree).some((node) => node.props.label === 'Назад')).toBe(false);
  expect(menu(checkForm({ editId: 'existing' }).tree, 'Дата заказ-наряда')).toBeUndefined();
  expect(menu(checkForm({ canEditCheckDate: false }).tree, 'Дата заказ-наряда')).toBeUndefined();
});

it('keeps the actual cash-flow interval and its existing bounded navigation in the compact controls', () => {
  const bindings = {
    period: 'week',
    HEADER_PERIODS: ['day', 'week', 'month', 'year'],
    PERIOD_LABELS: { day: 'День', week: 'Неделя', month: 'Месяц', year: 'Год' },
    periodRangeLabel: () => '14 — 20 сентября 2026',
    anchor: new Date(2026, 8, 14),
    customFrom: '',
    customTo: '',
    handlePickPeriod: jest.fn(),
    handleOpenCustomRange: jest.fn(),
    handleShift: jest.fn(),
    resetAnchor: jest.fn(),
    setDatePickerMode: jest.fn(),
    isAtOldestPeriod: true,
    isAtCurrentPeriod: false,
    canFilterByEmployee: false,
    mode: 'all',
    employeeName: '',
    employeeId: '',
    handlePickMode: jest.fn(),
    handleClearEmployee: jest.fn(),
  };
  const tree = expression('../../CashFlowScreen.tsx', variable('periodSwitcher'), bindings) as React.ReactNode;
  const period = menu(tree, 'Период движения денег');
  expect(period.props.title).toBe('14 — 20 сентября 2026');
  expect(nodes(tree).find((node) => node.props.label === 'Предыдущий период')!.props.disabled).toBe(true);
  (nodes(tree).find((node) => node.props.label === 'Следующий период')!.props.onPress as () => void)();
  expect(bindings.handleShift).toHaveBeenCalledWith(1);
  command(period, 'current-range').onSelect!();
  expect(bindings.resetAnchor).toHaveBeenCalledTimes(1);
  expect(menu(tree, 'Сотрудники в движении денег')).toBeUndefined();
});
