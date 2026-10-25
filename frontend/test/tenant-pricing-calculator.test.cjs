const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const Query = require('@tanstack/react-query');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative),
    m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (id in mocks ? mocks[id] : original(id));
  m._compile(
    ts.transpileModule(
      fs.readFileSync(
        process.env.SUBSCRIPTION_BASELINE_PAGE && relative.endsWith('/TariffPage.tsx')
          ? process.env.SUBSCRIPTION_BASELINE_PAGE
          : filename,
        'utf8',
      ),
      {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      },
    ).outputText,
    filename,
  );
  return m.exports;
}
const helper = load('../../shared/utils/subscriptionPricing.ts');
const presentation = load('../../shared/utils/subscriptionPresentation.ts');
const textUtils = load('../src/utils/subscriptionPricingText.ts', {
  '../../../shared/utils/subscriptionPricing': helper,
});
const host = (name) => (props) => React.createElement(name, props, props.children);
const Composition = load('../src/components/SubscriptionCompositionFields.tsx', {
  '../ui/Field': { Field: host('Field') },
  '../ui/Input': { Input: host('Input') },
  '../utils/subscriptionPricingText': textUtils,
});
const Breakdown = load('../src/components/SubscriptionQuoteBreakdown.tsx', {
  '../utils/subscriptionPricingText': textUtils,
});
const plans = Object.values(helper.SUBSCRIPTION_PLAN_PRICING).map((pricing) => ({
  id: pricing.code,
  name: pricing.name,
  pricing,
  isActive: true,
  features: ['catalog-feature'],
  monthlyPrice: pricing.monthlyPrice,
  maxUsers: pricing.includedEmployees,
}));
let calls, current, allow, token, quoteMode, releaseQuote;
const usage = { employees: 2, activePoints: 1, billablePoints: 1 };
const fixture = () => ({
  tenantName: 'Сервис',
  planId: 'old-pro',
  planName: 'PRO',
  currentPlan: { ...plans[1], id: 'old-pro', isActive: false },
  status: 'active',
  monthlyPrice: 0,
  subscriptionEnd: null,
  currentUsers: 2,
  maxUsers: 7,
  features: ['actual-feature'],
  usage,
  plans,
});
const get = async () => ({ data: current });
const quote = async (params) => {
  calls.push(params);
  if (quoteMode === 'deferred')
    await new Promise((resolve) => {
      releaseQuote = resolve;
    });
  if (quoteMode === 'error') throw { response: { status: 503, data: {} } };
  const plan = plans.find((p) => p.id === params.planId);
  if (!plan?.pricing) throw { response: { status: 400, data: { code: 'LEGACY_PLAN' } } };
  const result = helper.calculateSubscriptionQuote(plan.pricing, params);
  if (!result.ok) throw { response: { status: 400, data: { code: result.code } } };
  return { data: { planId: plan.id, pricing: plan.pricing, usage, quote: result.quote, quoteToken: 'token' } };
};
const Page = load('../src/pages/TariffPage.tsx', {
  '../contexts/AuthContext': { useAuth: () => ({ token, hasPermission: () => allow }) },
  '../../../shared/api/createServices': { createSubscriptionApi: () => ({ get, quote }) },
  '../api/axios': { createSessionBoundClient: () => ({}) },
  '../../../shared/utils/subscriptionPresentation': presentation,
  '../utils/subscriptionPricingText': textUtils,
  '../components/SubscriptionCompositionFields': Composition,
  '../components/SubscriptionQuoteBreakdown': Breakdown,
  '../ui': {
    ...Object.fromEntries(
      ['Badge', 'Card', 'CardBody', 'CardHeader', 'Money', 'PageHeader', 'QueryState', 'SkeletonCard'].map((n) => [
        n,
        host(n),
      ]),
    ),
    buttonClasses: () => '',
  },
  '../components/dashboard/shared': { MiniStat: host('MiniStat') },
  '../utils/featureGroups': { FEATURE_GROUPS: [{ items: [{ key: 'actual-feature', label: 'Текущая возможность' }] }] },
  '../config/contacts': { getWhatsAppChatUrl: (text) => 'https://wa.me/?text=' + encodeURIComponent(text) },
}).default;
const settle = async (condition) => {
  for (let i = 0; i < 100 && !condition(); i++)
    await Renderer.act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  assert.ok(condition(), 'page did not settle');
};
function mount() {
  const client = new Query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree;
  const render = () => React.createElement(Query.QueryClientProvider, { client }, React.createElement(Page));
  Renderer.act(() => {
    tree = Renderer.create(render());
  });
  return {
    tree,
    client,
    rerender: () => Renderer.act(() => tree.update(render())),
    close() {
      Renderer.act(() => tree.unmount());
      client.clear();
    },
  };
}
const input = (tree, label) => tree.root.findAllByType('Input').find((node) => node.props['aria-label'] === label);
const fill = (tree, label, value) => Renderer.act(() => input(tree, label).props.onChange({ target: { value } }));
const select = (tree, id) =>
  Renderer.act(() =>
    tree.root
      .findAllByType('input')
      .find((node) => node.props.value === id)
      .props.onChange(),
  );
const button = (tree, label) => tree.root.findAllByType('button').find((node) => node.children.join('') === label);
const text = (node) =>
  node == null
    ? ''
    : Array.isArray(node)
      ? node.map(text).join('')
      : typeof node === 'object'
        ? text(node.children)
        : String(node);
const contents = (tree) => text(tree.toJSON()).replace(/\s/g, '');
const price = (tree) => tree.root.findAllByProps({ 'data-testid': 'subscription-monthly-display' });
const currentCard = (tree) =>
  tree.root.findAllByType('Card').find((node) => node.props['aria-label'] === 'Текущая подписка');
test.beforeEach(() => {
  calls = [];
  current = fixture();
  allow = true;
  token = 'ownerA';
  quoteMode = 'success';
  releaseQuote = undefined;
});
test('assigned archived PRO is explicit; current zero rate, null end, limits/features stay immutable during new comparison', async () => {
  const f = mount();
  try {
    await settle(() => !!input(f.tree, 'Всего сотрудников'));
    assert.ok(contents(f.tree).includes('Архивныйтариф'), 'assigned inactive plan needs explicit archive label');
    assert.equal(calls.length, 0);
    assert.equal(price(f.tree).length, 0);
    const before = text(currentCard(f.tree));
    assert.ok(contents(f.tree).includes('Безограничениясрока'));
    assert.ok(contents(f.tree).includes('Месячнаяставка0₽'));
    assert.ok(contents(f.tree).includes('2·лимит7'));
    assert.ok(contents(f.tree).includes('Текущаявозможность'));
    select(f.tree, 'pro');
    await settle(() => price(f.tree).length > 0);
    assert.equal(input(f.tree, 'Всего сотрудников').props.value, '5');
    fill(f.tree, 'Всего сотрудников', '6');
    await settle(() => contents(f.tree).includes('5490'));
    Renderer.act(() => button(f.tree, 'Год · 12 за 10').props.onClick());
    await settle(() => contents(f.tree).includes('54900'));
    assert.ok(contents(f.tree).includes('Архивныйтариф'));
    assert.equal(f.client.getQueryData(['subscription']).planId, 'old-pro');
    assert.ok(contents(f.tree).includes('Месячнаяставка0₽'));
    assert.ok(contents(f.tree).includes('2·лимит7'));
    const link = f.tree.root.findByType('a');
    assert.ok(decodeURIComponent(link.props.href).includes('54'));
    assert.equal(text(currentCard(f.tree)), before);
  } finally {
    f.close();
  }
});
test('untouched capacity defaults follow plan; raw manually entered composition and period survive plan changes', async () => {
  current = { ...fixture(), planId: 'pro', currentPlan: plans[1] };
  const f = mount();
  try {
    await settle(() => calls.at(-1)?.employees === 5);
    select(f.tree, 'max');
    await settle(() => calls.at(-1)?.employees === 50);
    fill(f.tree, 'Всего сотрудников', '006');
    fill(f.tree, 'Всего филиалов', '02');
    select(f.tree, 'baza');
    await settle(() => contents(f.tree).includes('Длянесколькихфилиалов'));
    assert.equal(input(f.tree, 'Всего сотрудников').props.value, '006');
    assert.equal(input(f.tree, 'Всего филиалов').props.value, '02');
    Renderer.act(() => button(f.tree, 'Год · 12 за 10').props.onClick());
    await settle(() => !!button(f.tree, 'Рассчитать MAX'));
    Renderer.act(() => button(f.tree, 'Рассчитать MAX').props.onClick());
    await settle(() => calls.at(-1)?.planId === 'max' && contents(f.tree).includes('180000'));
    assert.deepEqual(calls.at(-1), { period: 'yearly', planId: 'max', employees: 6, points: 2 });
    assert.equal(input(f.tree, 'Всего сотрудников').props.value, '006');
  } finally {
    f.close();
  }
});
test('catalogue absence and active custom without pricing never become archive; unassigned can explicitly calculate', async () => {
  for (const variant of [
    { currentPlan: undefined },
    { currentPlan: { ...plans[1], id: 'old-pro', pricing: null, isActive: true } },
    { currentPlan: null, planId: null, planName: null },
  ]) {
    current = { ...fixture(), ...variant };
    calls = [];
    const f = mount();
    try {
      await settle(() => !!input(f.tree, 'Всего сотрудников'));
      assert.ok(!contents(f.tree).includes('Архивныйтариф'));
      assert.equal(calls.length, 0);
      select(f.tree, 'max');
      await settle(() => calls.at(-1)?.planId === 'max');
      assert.equal(input(f.tree, 'Всего сотрудников').props.value, '50');
    } finally {
      f.close();
    }
  }
});
test('old payload explicit false fallback works; active same-name catalogue row cannot hide assigned archive', async () => {
  current.currentPlan = undefined;
  current.plans = [{ ...plans[1], id: 'old-pro', isActive: false }, ...plans];
  const f = mount();
  try {
    await settle(() => !!input(f.tree, 'Всего сотрудников'));
    assert.ok(contents(f.tree).includes('Архивныйтариф'));
    assert.equal(calls.length, 0);
  } finally {
    f.close();
  }
});
test('invalid, pending and failed quotes never expose old money or an enabled contact; retry recovers', async () => {
  const f = mount();
  try {
    await settle(() => !!input(f.tree, 'Всего сотрудников'));
    select(f.tree, 'pro');
    await settle(() => price(f.tree).length > 0);
    for (const value of ['', '-1', '1.5', '9007199254740992', '1']) {
      fill(f.tree, 'Всего сотрудников', value);
      assert.equal(price(f.tree).length, 0);
      assert.equal(f.tree.root.findAllByType('a').length, 0);
    }
    quoteMode = 'deferred';
    fill(f.tree, 'Всего сотрудников', '6');
    await settle(() => !!releaseQuote);
    assert.equal(price(f.tree).length, 0);
    assert.equal(f.tree.root.findAllByType('a').length, 0);
    quoteMode = 'error';
    releaseQuote();
    await settle(() => !!button(f.tree, 'Повторить расчёт'));
    assert.equal(price(f.tree).length, 0);
    assert.equal(f.tree.root.findAllByType('a').length, 0);
    quoteMode = 'success';
    Renderer.act(() => button(f.tree, 'Повторить расчёт').props.onClick());
    await settle(() => price(f.tree).length > 0);
  } finally {
    f.close();
  }
});
test('session change clears manual draft; missing end differs from null and permission denies controls', async () => {
  current = { ...fixture(), planId: 'pro', currentPlan: plans[1], subscriptionEnd: undefined };
  const f = mount();
  try {
    await settle(() => calls.at(-1)?.employees === 5);
    assert.ok(contents(f.tree).includes('Срокнеуказан'));
    fill(f.tree, 'Всего сотрудников', '9');
    token = 'ownerB';
    f.rerender();
    assert.equal(input(f.tree, 'Всего сотрудников').props.value, '5');
    allow = false;
    f.rerender();
    assert.equal(f.tree.root.findAllByType('input').length, 0);
    assert.equal(f.tree.root.findByType('PageHeader').props.subtitle, 'Нет доступа к настройкам компании.');
  } finally {
    f.close();
  }
});
