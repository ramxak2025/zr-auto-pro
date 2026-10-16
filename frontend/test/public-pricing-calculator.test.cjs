const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
function load(filename, mocks = {}) {
  const m = new Module(filename, module);
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
const helper = load(path.resolve(__dirname, '../../shared/utils/subscriptionPricing.ts'));
const textUtils = load(path.resolve(__dirname, '../src/utils/subscriptionPricingText.ts'), {
  '../../../shared/utils/subscriptionPricing': helper,
});
const calculatorSource =
  process.env.AUTEXA_CALCULATOR_SOURCE ||
  path.resolve(__dirname, '../src/pages/landing/sections/PricingCalculator.tsx');
const { PricingCalculator } = load(calculatorSource, {
  '../../../../../shared/utils/subscriptionPricing': helper,
  '../../../utils/subscriptionPricingText': textUtils,
});
function mount(period) {
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(PricingCalculator, { period }));
  });
  return tree;
}
const total = (tree) =>
  tree.root.findByProps({ 'data-testid': 'subscription-total' }).children.join('').replace(/\s/g, '');
const choose = (tree, name) =>
  Renderer.act(() =>
    tree.root
      .findAllByType('button')
      .find((n) => n.children.join('') === name)
      .props.onClick(),
  );
const fill = (tree, label, value) =>
  Renderer.act(() => tree.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }));

test('public calculator: annual BAZA/PRO/MAX and extra branches use full composition through real controls', () => {
  const tree = mount('yearly');
  assert.equal(total(tree), '≈4158,33₽');
  fill(tree, 'Всего сотрудников', '6');
  assert.equal(total(tree), '4575₽');
  choose(tree, 'BAZA');
  fill(tree, 'Всего сотрудников', '2');
  assert.equal(total(tree), '1650₽');
  choose(tree, 'MAX');
  fill(tree, 'Всего сотрудников', '51');
  fill(tree, 'Всего филиалов', '2');
  assert.equal(total(tree), '≈17083,33₽');
  Renderer.act(() => tree.update(React.createElement(PricingCalculator, { period: 'monthly' })));
  assert.equal(total(tree), '20500₽');
  Renderer.act(() => tree.unmount());
});
test('public calculator: invalid and unsafe input never exposes an old payable total', () => {
  const tree = mount('monthly');
  for (const invalid of ['', '0', '-1', '1.5', '1e3', '9007199254740992']) {
    fill(tree, 'Всего сотрудников', invalid);
    assert.equal(tree.root.findAllByProps({ 'data-testid': 'subscription-total' }).length, 0, invalid);
    assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props['aria-invalid'], true);
  }
  fill(tree, 'Всего сотрудников', '1');
  assert.equal(total(tree), '4990₽');
  Renderer.act(() => tree.unmount());
});

const text = (tree) => JSON.stringify(tree.toJSON()).replace(/\s/g, '');
test('annual headline is monthly equivalent and invoice below remains exact', () => {
  const tree = mount('yearly');
  assert.equal(total(tree), '≈4158,33₽');
  assert.ok(text(tree).includes('Коплатесразуза12месяцев:'));
  assert.ok(text(tree).includes('49900'));
  Renderer.act(() => tree.unmount());
});
test('untouched plan presets follow 1/5/50; explicit counts and branches survive plan and period comparisons', () => {
  const tree = mount('monthly');
  choose(tree, 'BAZA');
  assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props.value, '1');
  assert.equal(total(tree), '990₽');
  choose(tree, 'MAX');
  assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props.value, '50');
  assert.equal(total(tree), '15000₽');
  choose(tree, 'PRO');
  assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props.value, '5');
  fill(tree, 'Всего сотрудников', '2');
  choose(tree, 'MAX');
  assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props.value, '2');
  fill(tree, 'Всего филиалов', '2');
  choose(tree, 'BAZA');
  assert.equal(tree.root.findAllByProps({ 'data-testid': 'subscription-total' }).length, 0);
  assert.ok(text(tree).includes('выберитеMAX'));
  assert.equal(tree.root.findByProps({ 'aria-label': 'Всего филиалов' }).props.value, '2');
  Renderer.act(() => tree.update(React.createElement(PricingCalculator, { period: 'yearly' })));
  assert.equal(tree.root.findByProps({ 'aria-label': 'Всего филиалов' }).props.value, '2');
  choose(tree, 'MAX');
  assert.equal(total(tree), '≈16666,67₽');
  Renderer.act(() => tree.unmount());
});

test('approved monthly/yearly examples retain exact invoice and monthly equivalent', () => {
  const cases = [
    ['BAZA', '1', '1', '990₽', '825₽', '9900'],
    ['BAZA', '2', '1', '1980₽', '1650₽', '19800'],
    ['PRO', '5', '1', '4990₽', '≈4158,33₽', '49900'],
    ['PRO', '6', '1', '5490₽', '4575₽', '54900'],
    ['MAX', '50', '1', '15000₽', '12500₽', '150000'],
    ['MAX', '51', '2', '20500₽', '≈17083,33₽', '205000'],
  ];
  for (const [plan, employees, points, monthly, yearly, invoice] of cases) {
    const tree = mount('monthly');
    choose(tree, plan);
    fill(tree, 'Всего сотрудников', employees);
    fill(tree, 'Всего филиалов', points);
    assert.equal(total(tree), monthly, `${plan} monthly`);
    Renderer.act(() => tree.update(React.createElement(PricingCalculator, { period: 'yearly' })));
    assert.equal(total(tree), yearly, `${plan} yearly equivalent`);
    assert.ok(text(tree).includes(invoice), `${plan} exact invoice`);
    Renderer.act(() => tree.unmount());
  }
});
test('invalid branches and payment overflow hide price without resetting entered composition', () => {
  const tree = mount('yearly');
  choose(tree, 'MAX');
  for (const invalid of ['', '0', '-1', '1.5', '9007199254740992', '99999999']) {
    fill(tree, 'Всего филиалов', invalid);
    assert.equal(tree.root.findAllByProps({ 'data-testid': 'subscription-total' }).length, 0, invalid);
    assert.equal(tree.root.findByProps({ 'aria-label': 'Всего филиалов' }).props.value, invalid);
  }
  Renderer.act(() => tree.unmount());
});

const { PlanCard } = load(path.resolve(__dirname, '../src/pages/landing/sections/pricingShared.tsx'), {
  'react-router-dom': { Link: (props) => React.createElement('a', props, props.children) },
  '../gsap': { gsap: {}, useGSAP() {}, EASE: {} },
  '../content': { pricing: {} },
  './PricingCalculator': { formatPlanMoney: textUtils.formatSubscriptionMoney },
  '../../../utils/subscriptionPricingText': textUtils,
  '../config': {},
});
test('annual public plan cards use monthly equivalent and label add-on monthly rates', () => {
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(PlanCard, {
        plan: {
          ...helper.SUBSCRIPTION_PLAN_PRICING.pro,
          key: 'pro',
          employees: '5 сотрудников включено',
          includes: [],
        },
        period: 'yearly',
      }),
    );
  });
  const content = text(tree);
  assert.ok(content.includes('≈4'));
  assert.ok(content.includes('158,33'));
  assert.ok(content.includes('Коплатесразуза12месяцев:'));
  assert.ok(content.includes('49900'));
  assert.ok(content.includes('500'));
  assert.ok(!content.includes('5000'));
  Renderer.act(() => tree.unmount());
});
