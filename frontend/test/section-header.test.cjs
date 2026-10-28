const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const { MemoryRouter, useLocation } = require('react-router-dom');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      filename,
    );
}
require.extensions['.css'] = () => {};
const Header = require('../src/components/PageHeader').default;
const { Tabs } = require('../src/ui/Tabs');
const { SegmentedControl } = require('../src/ui/SegmentedControl');
const h = React.createElement;
const withRouter = (child) =>
  h(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, child);

function render(child) {
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(withRouter(child));
  });
  return tree;
}
const command = (tree) =>
  tree.root.findAll((node) => node.type === 'div' && node.props.className === 'section-command');

test('read-only and denied actions do not create an empty sticky island', () => {
  const tree = render(h(Header, { title: 'Моя зарплата', actions: h(React.Fragment, null, false, null) }));
  assert.equal(command(tree).length, 0);
  assert.equal(tree.root.findByType('header').props['data-section-variant'], 'static');
  assert.equal(tree.root.findByType('h1').children[0], 'Моя зарплата');
  Renderer.act(() => tree.unmount());
});

test('back invokes the original dirty-form guard; route back retains query state', () => {
  let guarded = 0;
  const requestLeave = () => {
    guarded += 1;
  };
  const tree = render(h(Header, { title: 'Касса', backTo: requestLeave }));
  const button = tree.root.findByType('button');
  assert.equal(button.props.onClick, requestLeave);
  Renderer.act(() => button.props.onClick());
  assert.equal(guarded, 1);
  Renderer.act(() => tree.unmount());

  function Probe() {
    return h('output', null, useLocation().pathname + useLocation().search);
  }
  const route = render(
    h(React.Fragment, null, h(Header, { title: 'Клиент', backTo: '/clients?q=oil&page=2' }), h(Probe)),
  );
  Renderer.act(() => route.root.findByType('button').props.onClick());
  assert.equal(route.root.findByType('output').children[0], '/clients?q=oil&page=2');
  Renderer.act(() => route.unmount());
});

for (const composition of ['section', 'navigation']) {
  test(`changing passive context keeps the same live input and pending save guard in ${composition}`, () => {
    let mounts = 0;
    let unmounts = 0;
    function Search() {
      const [value, setValue] = React.useState('');
      React.useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return h('input', { value, onChange: (event) => setValue(event.target.value) });
    }
    const save = () => {};
    const props = {
      composition,
      title: 'Заказ поставщику',
      toolbar: h(Search),
      actions: h('button', { disabled: true, onClick: save }, 'Сохранить'),
    };
    const tree = render(h(Header, props));
    const input = tree.root.findByType('input');
    Renderer.act(() => input.props.onChange({ target: { value: 'масло' } }));
    Renderer.act(() =>
      tree.update(withRouter(h(Header, { ...props, subtitle: 'Новый период', meta: h('span', null, 'Черновик') }))),
    );
    assert.equal(tree.root.findByType('input'), input);
    assert.equal(input.props.value, 'масло');
    assert.equal(mounts, 1);
    assert.equal(unmounts, 0);
    assert.equal(tree.root.findByType('button').props.disabled, true);
    assert.equal(tree.root.findByType('button').props.onClick, save);
    Renderer.act(() => tree.unmount());
    assert.equal(unmounts, 1);
  });
}

for (const [name, Control, role, optionsProp, items, stateAttribute] of [
  [
    'tabs',
    Tabs,
    'tab',
    'items',
    [
      { key: 'a', label: 'А' },
      { key: 'b', label: 'Б', disabled: true },
      { key: 'c', label: 'В' },
    ],
    'aria-selected',
  ],
  [
    'segments',
    SegmentedControl,
    'radio',
    'options',
    [
      { value: 'a', label: 'А' },
      { value: 'b', label: 'Б', disabled: true },
      { value: 'c', label: 'В' },
    ],
    'aria-checked',
  ],
]) {
  test(`${name} preserve keyboard selection and disabled options inside the header only`, () => {
    const changes = [];
    function App({ dock }) {
      const [value, setValue] = React.useState('a');
      const control = h(Control, {
        [optionsProp]: items,
        value,
        onChange: (next) => {
          changes.push(next);
          setValue(next);
        },
        'aria-label': 'Разделы',
      });
      return dock ? h(Header, { title: 'Раздел', toolbar: control }) : control;
    }
    const tree = render(h(App, { dock: true }));
    const buttons = tree.root.findAllByType('button').filter((node) => node.props.role === role);
    let prevented = false;
    Renderer.act(() =>
      buttons[0].props.onKeyDown({
        key: 'ArrowRight',
        preventDefault: () => {
          prevented = true;
        },
      }),
    );
    assert.equal(prevented, true);
    assert.deepEqual(changes, ['c']);
    assert.equal(buttons[2].props[stateAttribute], true);
    assert.equal(buttons[2].props.tabIndex, 0);
    assert.equal(buttons[1].props.disabled, true);
    assert.equal(tree.root.findAll((node) => node.props['data-selection-backplate'] !== undefined).length, 1);
    Renderer.act(() => tree.unmount());
    const outside = render(h(App, { dock: false }));
    assert.equal(outside.root.findAll((node) => node.props['data-selection-backplate'] !== undefined).length, 0);
    Renderer.act(() => outside.unmount());
  });
}

function loadTsxWithMocks(relativePath, mock) {
  const filename = require('node:path').resolve(__dirname, relativePath);
  const localRequire = require('node:module').createRequire(filename);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (request) => mock(request) ?? localRequire(request),
    module,
    module.exports,
  );
  return module.exports.default;
}

test('dashboard resolves actual quick-link permissions before supplying the action slot', () => {
  let role = 'admin';
  let granted = new Set();
  const Blank = () => null;
  const Dashboard = loadTsxWithMocks('../src/pages/DashboardPage.tsx', (request) => {
    if (request === '../contexts/AuthContext') {
      return {
        useAuth: () => ({
          user: { role, fullName: 'Проверка', tenant: {} },
          hasPermission: (permission) => granted.has(permission),
        }),
      };
    }
    if (request === '../hooks/useTenantTimezone')
      return { useTenantTimezone: () => 'Europe/Moscow', useTenantCalendar: () => ({ today: '2026-10-28' }) };
    if (request === '../components/dashboard/shared') return { dayKeyToDate: (day) => new Date(day + 'T12:00:00') };
    if (request === '../components/dashboard/TodayWidgets') return { AttentionCard: Blank, TodayEarningsCard: Blank };
    if (request.startsWith('../components/dashboard/') || request === '../components/InstallmentsWidget')
      return { __esModule: true, default: Blank };
    return undefined;
  });
  const tree = render(h(Dashboard));
  assert.equal(command(tree).length, 0);
  assert.equal(tree.root.findByType('header').props['data-section-variant'], 'static');
  for (const [permission, destination] of [
    ['clients_view', '/clients'],
    ['checks_view', '/checks'],
    ['financial_reports', '/reports'],
  ]) {
    granted = new Set([permission]);
    Renderer.act(() => tree.update(withRouter(h(Dashboard))));
    assert.equal(command(tree).length, 1);
    assert.deepEqual(
      tree.root.findAllByType('a').map((node) => node.props.href),
      [destination],
    );
  }
  granted = new Set();
  Renderer.act(() => tree.update(withRouter(h(Dashboard))));
  assert.equal(command(tree).length, 0);
  role = 'master';
  granted = new Set(['clients_view', 'checks_view', 'financial_reports']);
  Renderer.act(() => tree.update(withRouter(h(Dashboard))));
  assert.equal(command(tree).length, 0);
  Renderer.act(() => tree.unmount());
});

for (const composition of ['section', 'navigation']) {
  test(`sticky checkout budget measures ${composition} with main height, padding and live font/width changes`, () => {
    const originals = Object.fromEntries(
      ['window', 'getComputedStyle', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [
        key,
        global[key],
      ]),
    );
    const values = new Map();
    const style = { setProperty: (key, value) => values.set(key, value), removeProperty: (key) => values.delete(key) };
    const observed = new Set();
    let onResize;
    let disconnected = false;
    let cancelled = false;
    let topPadding = 24;
    let bottomPadding = 32;
    let dockHeight = 56;
    const listeners = new Set();
    const target = () => ({
      addEventListener: (type, handler) => listeners.add(handler),
      removeEventListener: (type, handler) => listeners.delete(handler),
    });
    const main = { ...target(), clientHeight: 844, getBoundingClientRect: () => ({ top: 56 }) };
    const header = { closest: () => main, parentElement: { style }, style, dataset: {} };
    const heading = { getBoundingClientRect: () => ({ top: 80, height: 80 }) };
    const dock = { getBoundingClientRect: () => ({ height: dockHeight }) };
    const progressValues = [];
    const timeline = {
      to() {
        return this;
      },
      progress(value) {
        progressValues.push(value);
        return this;
      },
      kill() {},
    };
    const MeasuredHeader = loadTsxWithMocks('../src/components/PageHeader.tsx', (request) =>
      request === 'gsap'
        ? {
            __esModule: true,
            default: { context: () => ({ add: (fn) => fn(), revert() {} }), timeline: () => timeline },
          }
        : undefined,
    );
    let tree;
    try {
      global.window = { ...target(), matchMedia: () => ({ ...target(), matches: false }) };
      global.getComputedStyle = (node) =>
        node === main
          ? { paddingTop: `${topPadding}px`, paddingBottom: `${bottomPadding}px`, paddingLeft: '24px' }
          : { paddingBottom: '12px' };
      global.ResizeObserver = class {
        constructor(callback) {
          onResize = callback;
        }
        observe(node) {
          observed.add(node);
        }
        disconnect() {
          disconnected = true;
        }
      };
      global.requestAnimationFrame = () => 1;
      global.cancelAnimationFrame = () => {
        cancelled = true;
      };
      Renderer.act(() => {
        tree = Renderer.create(
          withRouter(h(MeasuredHeader, { composition, title: 'Касса', actions: h('button', null, 'Шаблоны') })),
          {
            createNodeMock: (node) =>
              node.type === 'header'
                ? header
                : node.props.className === 'section-heading'
                  ? heading
                  : node.props.className === 'section-command'
                    ? dock
                    : null,
          },
        );
      });
      assert.equal(values.get('--section-header-sticky-height'), '44px');
      assert.equal(values.get('--section-header-available-height'), '744px');
      assert.deepEqual(observed, new Set(composition === 'navigation' ? [dock, main] : [heading, dock, main]));
      assert.equal(values.get('--section-heading-height'), composition === 'navigation' ? '0px' : '80px');
      if (composition === 'navigation')
        assert.ok(
          progressValues.every((value) => value === 1),
          'navigation material has no disappearing title dependency',
        );
      // A larger shell, increased root font/paddings and a taller command area all
      // consume the actual main viewport; no 100dvh assumption remains.
      main.clientHeight = 788;
      topPadding = 48;
      bottomPadding = 64;
      dockHeight = 112;
      Renderer.act(() => onResize());
      assert.equal(values.get('--section-header-sticky-height'), '76px');
      assert.equal(values.get('--section-header-available-height'), '600px');
      Renderer.act(() => tree.unmount());
      tree = null;
      assert.equal(values.has('--section-header-available-height'), false);
      assert.equal(values.has('--section-header-sticky-height'), false);
      assert.equal(listeners.size, 0);
      assert.equal(disconnected, true);
      assert.equal(cancelled, true);
    } finally {
      if (tree) Renderer.act(() => tree.unmount());
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete global[key];
        else global[key] = value;
      }
    }
  });
}

test('navigation has one identity in the Back/actions row and retains the exact guarded callbacks', () => {
  const back = () => {};
  const save = () => {};
  const tree = render(
    h(Header, {
      composition: 'navigation',
      title: 'Редактирование длинного названия',
      backTo: back,
      actions: h(
        'button',
        { onClick: save, disabled: true, 'aria-label': 'Сохранить все изменения' },
        'Сохранить все изменения',
      ),
      toolbar: h('input', { 'aria-label': 'Период' }),
    }),
  );
  assert.equal(tree.root.findAllByType('h1').length, 1);
  const row = tree.root.find((node) => node.props.className === 'section-navigation-row');
  assert.equal(row.findByType('h1').children[0], 'Редактирование длинного названия');
  assert.equal(row.findAllByType('button').length, 2);
  assert.equal(row.findAllByType('button')[0].props.onClick, back);
  assert.equal(row.findAllByType('button')[1].props.onClick, save);
  assert.equal(row.findAllByType('button')[1].props.disabled, true);
  assert.equal(row.findAllByType('button')[1].props['aria-label'], 'Сохранить все изменения');
  assert.equal(tree.root.findAll((node) => node.props.className === 'section-heading').length, 0);
  assert.equal(tree.root.findAllByType('input').length, 1);
  Renderer.act(() => tree.unmount());
});
