const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const h = React.createElement;
const originalModule = module;
const compile = (filename) =>
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, filename) => module._compile(compile(filename), filename);
require.extensions['.css'] = () => {};
function load(relative, mocks) {
  const filename = path.resolve(__dirname, relative),
    instance = new Module(filename, originalModule),
    local = Module.createRequire(filename);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = (name) => mocks[name] ?? local(name);
  instance._compile(compile(filename), filename);
  return instance.exports;
}
function reportHarness({ from = '2026-10-01', to = '2026-10-28', optionCount = 2 } = {}) {
  const updates = [],
    queries = [],
    controls = {},
    exports = [];
  let calls = 0,
    menu,
    finishExport;
  const params = new URLSearchParams({ from, to, ids: 'm1', groupBy: 'day', keep: 'yes' });
  const def = {
    id: 'masters',
    title: 'По мастерам',
    description: 'Полное пояснение для чтения в потоке.',
    entityFilter: { kind: 'employees', label: 'Мастера' },
    groupByOptions: [
      { value: 'day', label: 'День' },
      { value: 'month', label: 'Месяц' },
    ],
  };
  const result = { rows: [], columns: [], kpis: [], sections: [], filters: { entityLabels: ['Мастер 1'] }, meta: {} };
  const container = (p) => h('div', null, p.children);
  const stubControl = (name) => (p) => {
    controls[name] = p;
    return h('div', { 'data-control': name });
  };
  const noop = () => null;
  const mocks = {
    'react-router-dom': {
      useParams: () => ({ reportId: 'masters' }),
      useSearchParams: () => [params, (next) => updates.push(next)],
      Link: (p) => h('a', { href: p.to }, p.children),
    },
    '@tanstack/react-query': {
      useQuery: (config) => {
        queries.push(config);
        return config.queryKey[0] === 'report-filter-options'
          ? {
              data: {
                options: Array.from({ length: optionCount }, (_, i) => ({ id: `m${i + 1}`, label: `Мастер ${i + 1}` })),
              },
            }
          : {
              data: result,
              isFetching: false,
              isPlaceholderData: false,
              refetch: () => {
                calls += 1;
              },
            };
      },
    },
    '../../api/services': { reportBuilderApi: {} },
    '../../contexts/AuthContext': { useAuth: () => ({ user: { tenant: { name: 'Тест' } } }) },
    '../../hooks/useTenantTimezone': {
      useTenantCalendar: () => ({ today: '2026-10-28', monthStart: '2026-10-01', timeZone: 'Europe/Moscow' }),
    },
    '../../../../shared/reports/catalog': { isReportId: () => true, getReportDefinition: () => def },
    '../../components/PageHeader': {
      __esModule: true,
      default: (p) => h('header', null, h('h1', null, p.title), p.subtitle, p.actions, p.toolbar),
    },
    '../../ui/DropdownMenu': {
      DropdownMenu: (p) => {
        menu = p;
        return h('div', { 'data-export': true }, p.trigger);
      },
    },
    '../../components/reports/MonthPager': { __esModule: true, default: stubControl('month') },
    '../../components/DatePeriodPicker': { __esModule: true, default: stubControl('dates') },
    '../../components/reports/EntityFilter': {
      __esModule: true,
      default: stubControl('entity'),
      SelectedChips: stubControl('chips'),
    },
    '../../ui/SegmentedControl': { SegmentedControl: stubControl('group') },
    '../../components/reports/ReportKpiGrid': { __esModule: true, default: noop, ReportKpiSkeleton: noop },
    '../../components/reports/ReportTable': { __esModule: true, default: noop, ReportSectionCard: noop },
    '../../components/reports/ReportMethod': { ReportCaption: noop, ReportMethod: noop },
    '../../components/reports/reportIcons': { REPORT_ICONS: { masters: () => null } },
    '../../components/EmptyState': { __esModule: true, default: () => h('p', null, 'Нет данных') },
    '../../ui/Card': { Card: container, CardHeader: noop },
    '../../utils/reportExport': {
      exportReportToExcel: (data, context) => {
        exports.push({ kind: 'excel', data, context });
        return new Promise((resolve) => {
          finishExport = resolve;
        });
      },
      exportReportToPdf: () => {},
    },
  };
  const Page = load('../src/pages/reports/ReportRunPage.tsx', mocks).default;
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(h(Page));
  });
  return {
    tree,
    updates,
    queries,
    controls,
    result,
    exports,
    get calls() {
      return calls;
    },
    get menu() {
      return menu;
    },
    finish() {
      finishExport();
    },
    close() {
      Renderer.act(() => tree.unmount());
    },
  };
}

test('report pins month/run and exact custom range while description and advanced controls remain in flow', () => {
  const ui = reportHarness();
  try {
    const header = ui.tree.root.findByType('header');
    assert.equal(header.findAllByProps({ 'data-control': 'month' }).length, 1);
    for (const name of ['dates', 'entity', 'group']) {
      assert.equal(header.findAllByProps({ 'data-control': name }).length, 0);
      assert.equal(ui.tree.root.findAllByProps({ 'data-control': name }).length, 1);
    }
    assert.equal(
      header.findAll((n) => n.type === 'p' && n.children.includes('Полное пояснение для чтения в потоке.')).length,
      0,
    );
    assert.equal(header.findByProps({ 'aria-label': 'Выбранный период' }).children[0], '01.10.2026 — 28.10.2026');
    assert.equal(ui.controls.month.flexible, true);
    const run = header
      .findAllByType('button')
      .find((n) => n.children.some((c) => typeof c !== 'string' && c.children?.includes('Сформировать')));
    assert.ok(run);
    Renderer.act(() => run.props.onClick());
    assert.equal(ui.calls, 1);
    ui.controls.month.onChange('2026-09-01', '2026-09-30');
    assert.equal(ui.updates.at(-1).get('from'), '2026-09-01');
    assert.equal(ui.updates.at(-1).get('keep'), 'yes');
    ui.controls.dates.onChange('2026-10-03', '2026-10-18');
    assert.equal(ui.updates.at(-1).get('to'), '2026-10-18');
    ui.controls.entity.onChange(['m2']);
    assert.equal(ui.updates.at(-1).get('ids'), 'm2');
    ui.controls.group.onChange('month');
    assert.equal(ui.updates.at(-1).get('groupBy'), 'month');
  } finally {
    ui.close();
  }
});

test('report keeps export busy guard and does not treat hidden one-option filter as active', async () => {
  const ui = reportHarness({ from: '2026-10-01', to: '2026-10-31', optionCount: 1 });
  try {
    assert.equal(ui.tree.root.findAllByProps({ 'aria-label': 'Выбранный период' }).length, 0);
    assert.equal(ui.tree.root.findAllByProps({ 'data-control': 'entity' }).length, 0);
    assert.equal(ui.tree.root.findAllByProps({ 'data-control': 'chips' }).length, 0);
    assert.equal(ui.queries.find((q) => q.queryKey[0] === 'report-builder').queryKey[4], '');
    let promise;
    Renderer.act(() => {
      promise = ui.menu.items[0].onSelect();
    });
    assert.equal(ui.menu.items[0].loading, true);
    assert.equal(ui.menu.items[1].disabled, true);
    assert.equal(ui.exports.length, 1);
    assert.deepEqual(ui.exports[0].data.filters.entityLabels, []);
    await Renderer.act(async () => {
      ui.finish();
      await promise;
    });
    assert.equal(ui.menu.items[0].loading, false);
  } finally {
    ui.close();
  }
});

test('flexible MonthPager preserves month navigation, current-month action and future guard', () => {
  const MonthPager = require('../src/components/reports/MonthPager').default;
  for (const flexible of [false, true]) {
    const changes = [];
    let tree;
    Renderer.act(() => {
      tree = Renderer.create(
        h(MonthPager, {
          flexible,
          from: '2026-10-01',
          to: '2026-10-28',
          todayKey: '2026-10-28',
          onChange: (from, to) => changes.push([from, to]),
        }),
      );
    });
    const buttons = tree.root.findAllByType('button');
    assert.equal(buttons[2].props.disabled, true);
    Renderer.act(() => buttons[0].props.onClick());
    assert.deepEqual(changes.at(-1), ['2026-09-01', '2026-09-30']);
    Renderer.act(() => buttons[1].props.onClick());
    assert.deepEqual(changes.at(-1), ['2026-10-01', '2026-10-31']);
    Renderer.act(() => tree.unmount());
  }
});
