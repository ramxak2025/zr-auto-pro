const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    filename,
  );
const selection = require('../src/components/motivation/selection');
const { loadProductCatalog } = require('../../shared/api/productCatalog');
const products = Array.from({ length: 126 }, (_, index) => ({
  id: `p${index}`,
  name: `Товар ${index}`,
  warehouseId: 'w1',
  category: 'Масла / Моторные',
  article: `art${index}`,
}));

test('desktop searches every capped API page and refuses a truncated catalogue', async () => {
  const pages = [];
  const loaded = await loadProductCatalog(async ({ page, limit }) => {
    pages.push({ page, limit });
    return { data: { data: products.slice((page - 1) * 50, page * 50), total: products.length, limit: 50 } };
  });
  assert.equal(loaded.length, 126);
  assert.deepEqual(
    pages.map((p) => p.page),
    [1, 2, 3],
  );
  assert.equal(
    selection.filterMotivationChoices(selection.buildMotivationChoices(loaded, [], 'w1').products, 'art125')[0].target
      .productId,
    'p125',
  );
  await assert.rejects(
    loadProductCatalog(async () => ({ data: { data: products.slice(0, 50), total: 126, limit: 50 } })),
    /не полностью/,
  );
});
test('derived parents, children and direct choices stay independent across warehouses, search and large selection', () => {
  const choices = selection.buildMotivationChoices(products, [], 'w1');
  assert.deepEqual(
    choices.folders.map((c) => c.path),
    ['Масла', 'Масла/Моторные'],
  );
  let picked = [];
  for (const choice of [...choices.folders, ...choices.products])
    picked = selection.toggleMotivationChoice(picked, choice);
  const other = selection.buildMotivationChoices([], [{ id: 'other', path: 'Масла' }], 'w2').folders[0];
  picked = selection.toggleMotivationChoice(picked, other);
  assert.equal(picked.length, 129);
  assert.equal(selection.coversChoice(choices.folders[0], other), false);
  picked = selection.toggleMotivationChoice(picked, choices.folders[0]);
  assert.equal(picked.length, 128);
  assert.ok(picked.some((c) => c.target.productId === 'p125'));
  assert.ok(picked.some((c) => c.path === 'Масла/Моторные' && c.target.kind === 'folder'));
});

function mountComposer() {
  const calls = [];
  const choices = selection.buildMotivationChoices(products.slice(0, 8), [{ id: 'folder', path: 'Масла' }], 'w1');
  const legacy = [
    {
      productId: 'p0',
      productName: 'Первое исключение',
      updatedAt: 'version0',
      percent: 37,
      active: false,
      replacing: false,
    },
    {
      productId: 'p1',
      productName: 'Второе исключение',
      updatedAt: 'version1',
      percent: 20,
      active: true,
      replacing: false,
    },
    {
      productId: 'p2',
      productName: 'Заблокированное',
      updatedAt: 'version2',
      percent: 10,
      active: true,
      replacing: false,
      replacementBlockedReason: 'Сначала восстановите старый чек',
    },
  ];
  let mode = 'normal';
  let saved;
  const api = {
    bulkRules: async (input) => {
      calls.push(structuredClone(input));
      if (!input.dryRun && mode === 'transport') throw new Error('Связь потеряна');
      if (!input.dryRun && mode === 'stale')
        throw { response: { status: 409, data: { message: 'Предпросмотр устарел' } } };
      return {
        data: {
          rules: [],
          requestId: input.requestId,
          coveredProductCount: 8,
          affectedProductCount: 6,
          previewRevision: `preview:${input.percent}:${input.targets.length}`,
          legacyExceptions: legacy,
          dryRun: !!input.dryRun,
        },
      };
    },
  };
  const filename = path.resolve(__dirname, '../src/components/motivation/MotivationBulkComposer.tsx');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const fallbackRequire = loaded.require.bind(loaded);
  loaded.require = (name) => {
    if (name === '@tanstack/react-query')
      return {
        useQuery: (opts) =>
          opts.queryKey[0] === 'warehouses'
            ? { data: [{ id: 'w1', name: 'Основной', kind: 'main' }] }
            : { data: choices },
      };
    if (name === '../../api/services') return { motivationApi: api };
    if (name === '../../ui')
      return {
        Card: (p) => React.createElement('section', p),
        Button: ({ loading, ...p }) => React.createElement('button', { ...p, disabled: loading || p.disabled }),
        Input: ({ rightSlot, leftIcon, ...p }) => React.createElement('input', p),
        Select: (p) => React.createElement('select', p),
        SegmentedControl: ({ value, onChange }) =>
          React.createElement(
            'nav',
            {},
            ['products', 'folders'].map((type) =>
              React.createElement('button', { key: type, onClick: () => onChange(type) }, type),
            ),
          ),
      };
    return fallbackRequire(name);
  };
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    filename,
  );
  let root;
  renderer.act(() => {
    root = renderer.create(
      React.createElement(loaded.exports.default, {
        onSaved: (result) => {
          saved = result;
        },
        onClose: () => {},
      }),
    );
  });
  const button = (text) => root.root.findAllByType('button').find((item) => item.children.join('') === text);
  const click = async (text) => {
    const target = button(text);
    assert.ok(target, `button ${text}`);
    await renderer.act(async () => {
      await target.props.onClick();
    });
  };
  const selectProduct = (index) =>
    renderer.act(() =>
      root.root
        .findAllByType('input')
        .filter((i) => i.props.type === 'checkbox')
        [index].props.onChange(),
    );
  return {
    root,
    calls,
    click,
    button,
    selectProduct,
    setMode: (value) => {
      mode = value;
    },
    getSaved: () => saved,
  };
}

test('desktop composer sends six direct choices and retries a lost apply with identical UUID, token and payload', async () => {
  const ui = mountComposer();
  for (let index = 0; index < 6; index++) ui.selectProduct(index);
  await ui.click('Предварительный просмотр');
  assert.equal(ui.calls[0].targets.length, 6);
  assert.equal(ui.calls[0].dryRun, true);
  ui.setMode('transport');
  await ui.click('Применить правило');
  assert.ok(ui.button('Повторить сохранение'));
  assert.equal(ui.button('Закрыть').props.disabled, true);
  ui.setMode('normal');
  await ui.click('Повторить сохранение');
  assert.deepEqual(ui.calls[1], ui.calls[2]);
  assert.equal(ui.calls[0].requestId, ui.calls[1].requestId);
  assert.equal(ui.calls[1].previewRevision, 'preview:10:6');
  assert.ok(ui.getSaved());
  renderer.act(() => ui.root.unmount());
});
test('legacy replacements remain optional, blocked choices disabled, direct replacement targets enter preview and apply', async () => {
  const ui = mountComposer();
  await ui.click('folders');
  ui.selectProduct(0);
  await ui.click('Предварительный просмотр');
  assert.deepEqual(ui.calls[0].replaceLegacyPromos, []);
  let boxes = ui.root.root.findAllByType('input').filter((i) => i.props.type === 'checkbox');
  assert.equal(boxes.at(-1).props.disabled, true);
  renderer.act(() => boxes[2].props.onChange());
  boxes = ui.root.root.findAllByType('input').filter((i) => i.props.type === 'checkbox');
  renderer.act(() => boxes[3].props.onChange());
  await ui.click('Предварительный просмотр');
  const preview = ui.calls[1];
  assert.equal(preview.targets.length, 3);
  assert.deepEqual(
    preview.targets.filter((t) => t.kind === 'product').map((t) => t.productId),
    ['p0', 'p1'],
  );
  assert.equal(preview.replaceLegacyPromos.length, 2);
  await ui.click('Применить правило');
  assert.deepEqual(ui.calls[2].targets, preview.targets);
  assert.deepEqual(ui.calls[2].replaceLegacyPromos, preview.replaceLegacyPromos);
  renderer.act(() => ui.root.unmount());
});
test('409 invalidates review and never automatically reapplies; renewed preview gets a new UUID', async () => {
  const ui = mountComposer();
  ui.selectProduct(0);
  await ui.click('Предварительный просмотр');
  ui.setMode('stale');
  await ui.click('Применить правило');
  assert.equal(ui.calls.length, 2);
  assert.ok(ui.button('Предварительный просмотр'));
  assert.equal(ui.button('Применить правило'), undefined);
  ui.setMode('normal');
  await ui.click('Предварительный просмотр');
  assert.notEqual(ui.calls[0].requestId, ui.calls[2].requestId);
  assert.equal(ui.calls[2].dryRun, true);
  renderer.act(() => ui.root.unmount());
});

function mountPage(permissions) {
  const queryOptions = [];
  const requests = [];
  const rule = {
    id: 'rule1',
    target: { kind: 'product', productId: 'p0' },
    productName: 'Масло',
    percent: 8,
    active: false,
    revision: 7,
  };
  const promo = {
    id: 'promo1',
    productId: 'p1',
    productName: 'Фильтр',
    percent: 37,
    active: false,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2027-01-01T00:00:00Z',
  };
  const rows = [
    {
      id: 'ledger1',
      productName: 'Масло',
      employeeName: 'Мастер',
      qty: 1,
      scheme: 'revenue_v2',
      calculationBase: 'revenue',
      baseAmount: 100,
      percent: 10,
      shareIndex: 2,
      shareCount: 3,
      totalBonus: 10,
      amount: 3.33,
      accruedAt: '2026-10-20T10:00:00Z',
      checkId: 'check1',
    },
  ];
  const filename = path.resolve(__dirname, '../src/pages/MotivationPage.tsx');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const fallbackRequire = loaded.require.bind(loaded);
  loaded.require = (name) => {
    if (name === '@tanstack/react-query')
      return {
        useQuery: (opts) => {
          queryOptions.push(opts);
          return {
            data:
              opts.queryKey[1] === 'rules'
                ? { rules: [rule], legacyPromos: [promo] }
                : opts.queryKey[1] === 'accruals'
                  ? rows
                  : [],
            isSuccess: true,
          };
        },
        useQueryClient: () => ({ invalidateQueries: () => {} }),
      };
    if (name === '../api/services')
      return {
        motivationApi: {
          patchRule: async (...args) => requests.push(['patch', ...args]),
          setPromo: async (...args) => requests.push(['legacy', ...args]),
          getAccrualsV2: async (params) => {
            requests.push(['ledger', params]);
            return { data: rows };
          },
        },
      };
    if (name === '../contexts/AuthContext')
      return { useAuth: () => ({ hasPermission: (key) => permissions.includes(key) }) };
    if (name === '../hooks/useTenantTimezone')
      return { useTenantCalendar: () => ({ today: '2026-10-20', timeZone: 'Europe/Moscow' }) };
    if (name === 'react-hot-toast') return { default: { success: () => {}, error: () => {} } };
    if (name === 'react-router-dom') return { Link: (p) => React.createElement('a', p) };
    if (name === '../ui')
      return {
        Card: (p) => React.createElement('section', p),
        Button: ({ loading, ...p }) => React.createElement('button', { ...p, disabled: loading || p.disabled }),
        Input: ({ rightSlot, ...p }) => React.createElement('input', p),
        Select: (p) => React.createElement('select', p),
        SegmentedControl: ({ onChange }) =>
          React.createElement(
            'nav',
            {},
            ['rules', 'accruals'].map((type) =>
              React.createElement('button', { key: type, onClick: () => onChange(type) }, type),
            ),
          ),
        PageHeader: (p) => React.createElement('header', {}, p.actions),
        ConfirmDialog: () => null,
      };
    if (name === '../components/motivation/MotivationBulkComposer') return { default: () => null };
    return fallbackRequire(name);
  };
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    filename,
  );
  let root;
  renderer.act(() => {
    root = renderer.create(React.createElement(loaded.exports.default));
  });
  return { root, queryOptions, requests };
}
test('personal ledger cannot request other employees or configuration and shows equal shares with cents', async () => {
  const ui = mountPage(['salary_view']);
  assert.equal(ui.queryOptions.find((q) => q.queryKey[1] === 'rules').enabled, false);
  assert.equal(ui.queryOptions.find((q) => q.queryKey[1] === 'employees').enabled, false);
  await ui.queryOptions.find((q) => q.queryKey[1] === 'accruals').queryFn();
  assert.deepEqual(ui.requests, [['ledger', { dateFrom: '2026-10-01', dateTo: '2026-10-31' }]]);
  assert.equal(ui.root.root.findAllByType('select').length, 0);
  const text = JSON.stringify(ui.root.toJSON());
  assert.ok(text.includes('Доля 1/3'));
  assert.ok(text.includes('3,33'));
  assert.ok(text.includes('Выручка после скидки'));
  renderer.act(() => ui.root.unmount());
});
test('rule editor sends expected revision; legacy editing preserves rate, activity and dates through the old endpoint', async () => {
  const ui = mountPage(['motivation_manage']);
  let edit = ui.root.root.findAllByType('button').filter((b) => b.children.join('') === 'Изменить');
  renderer.act(() => edit[0].props.onClick());
  let save = ui.root.root.findAllByType('button').find((b) => b.children.join('') === 'Сохранить');
  await renderer.act(async () => save.props.onClick());
  assert.deepEqual(ui.requests[0], ['patch', 'rule1', { expectedRevision: 7, percent: 8, active: false }]);
  edit = ui.root.root.findAllByType('button').filter((b) => b.children.join('') === 'Изменить');
  renderer.act(() => edit[1].props.onClick());
  save = ui.root.root.findAllByType('button').find((b) => b.children.join('') === 'Сохранить');
  await renderer.act(async () => save.props.onClick());
  assert.deepEqual(ui.requests[1], [
    'legacy',
    { productId: 'p1', percent: 37, active: false, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' },
  ]);
  renderer.act(() => ui.root.unmount());
});
