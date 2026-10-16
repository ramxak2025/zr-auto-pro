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
  return m.exports;
}
const helper = load('../../shared/utils/subscriptionPricing.ts');
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
const pricing = {
  ...helper.SUBSCRIPTION_PLAN_PRICING.pro,
  monthlyPrice: 7000,
  extraEmployeeMonthlyPrice: 600,
  name: 'PRO особый',
};
const plans = [
  { id: 'current', name: 'PRO особый', isActive: false, features: [], monthlyPrice: 7000, maxUsers: 5, pricing },
  {
    id: 'max',
    name: 'MAX',
    isActive: true,
    features: [],
    monthlyPrice: 15000,
    maxUsers: 50,
    pricing: helper.SUBSCRIPTION_PLAN_PRICING.max,
  },
  { id: 'legacy', name: 'Прежний', isActive: true, features: [], monthlyPrice: 1234, maxUsers: 3 },
];
let calls = [],
  hideCurrent = false;
const usage = { employees: 2, activePoints: 1, billablePoints: 1 };
const get = async () => ({
  data: {
    tenantName: 'Сервис',
    planId: 'current',
    planName: 'PRO особый',
    status: 'active',
    monthlyPrice: 7000,
    currentUsers: 2,
    maxUsers: 5,
    features: [],
    usage,
    plans: hideCurrent ? plans.slice(1) : plans,
  },
});
const quote = async (params) => {
  calls.push(params);
  const plan = plans.find((p) => p.id === params.planId);
  if (!plan.pricing) throw { response: { status: 400, data: { code: 'LEGACY_PLAN' } } };
  const result = helper.calculateSubscriptionQuote(plan.pricing, {
    period: params.period,
    employees: params.employees,
    points: params.points,
  });
  if (!result.ok) throw { response: { status: 400, data: { code: result.code } } };
  return { data: { planId: plan.id, pricing: plan.pricing, usage, quote: result.quote, quoteToken: 'token' } };
};
const Page = load('../src/pages/TariffPage.tsx', {
  '../contexts/AuthContext': { useAuth: () => ({ token: 'session' }) },
  '../../../shared/api/createServices': { createSubscriptionApi: () => ({ get, quote }) },
  '../api/axios': { createSessionBoundClient: () => ({}) },
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
    cn: () => '',
  },
  '../components/dashboard/shared': { MiniStat: host('MiniStat') },
  '../utils/featureGroups': { FEATURE_GROUPS: [] },
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
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(Query.QueryClientProvider, { client }, React.createElement(Page)));
  });
  return {
    tree,
    close() {
      Renderer.act(() => tree.unmount());
      client.clear();
    },
  };
}
const input = (tree, label) =>
  label === 'Тариф для расчёта'
    ? tree.root.findByType('select')
    : tree.root.findAllByType('Input').find((node) => node.props['aria-label'] === label);
const fill = (tree, label, value) => Renderer.act(() => input(tree, label).props.onChange({ target: { value } }));
const contents = (tree) => {
  const text = (node) =>
    node == null
      ? ''
      : Array.isArray(node)
        ? node.map(text).join('')
        : typeof node === 'object'
          ? text(node.children)
          : String(node);
  return text(tree.toJSON()).replace(/\s/g, '');
};
test.beforeEach(() => {
  calls = [];
  hideCurrent = false;
});
test('tenant forecast uses server pricing, inactive current plan, selected counts and informational API only', async () => {
  const form = mount();
  try {
    await settle(() => contents(form.tree).includes('7000'));
    assert.equal(input(form.tree, 'Всего сотрудников')?.props.value, '5');
    fill(form.tree, 'Всего сотрудников', '6');
    await settle(() => calls.at(-1)?.employees === 6 && contents(form.tree).includes('7600'));
    assert.ok(contents(form.tree).includes('Сейчассотрудников:2'));
    assert.ok(contents(form.tree).includes('Врасчётесотрудников:6'));
    assert.ok(contents(form.tree).includes('архивный'));
    const yearly = form.tree.root.findAllByType('button').find((n) => n.children.join('') === 'Год · 12 за 10');
    Renderer.act(() => yearly.props.onClick());
    await settle(() => contents(form.tree).includes('≈6333,33') && contents(form.tree).includes('76000'));
    fill(form.tree, 'Тариф для расчёта', 'max');
    await settle(() => calls.at(-1)?.planId === 'max');
    assert.equal(input(form.tree, 'Всего сотрудников')?.props.value, '6');
    fill(form.tree, 'Всего филиалов', '2');
    await settle(() => calls.at(-1)?.points === 2);
    fill(form.tree, 'Тариф для расчёта', 'current');
    await settle(() => !form.tree.root.findAllByProps({ 'data-testid': 'subscription-monthly-display' }).length);
    assert.equal(input(form.tree, 'Всего филиалов')?.props.value, '2');
    for (const invalid of ['', '-1', '1.5', '9007199254740992', '1']) {
      fill(form.tree, 'Всего сотрудников', invalid);
      assert.equal(form.tree.root.findAllByProps({ 'data-testid': 'subscription-monthly-display' }).length, 0);
    }
  } finally {
    form.close();
  }
});
test('current plan missing from active list receives its included default from server quote metadata', async () => {
  hideCurrent = true;
  const form = mount();
  try {
    await settle(() => input(form.tree, 'Всего сотрудников')?.props.value === '5');
    assert.ok(contents(form.tree).includes('PROособый'));
    assert.equal(calls.at(-1).employees, 5);
  } finally {
    form.close();
  }
});
test('legacy plan selection retains manual terms without an annual discount quote', async () => {
  const form = mount();
  try {
    await settle(() => calls.length > 0);
    fill(form.tree, 'Тариф для расчёта', 'legacy');
    await settle(() => contents(form.tree).includes('годоваяскидкакнимавтоматическинеприменяется'));
    assert.equal(form.tree.root.findAllByProps({ 'data-testid': 'subscription-monthly-display' }).length, 0);
  } finally {
    form.close();
  }
});
