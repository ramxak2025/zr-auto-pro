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
  m.paths = [...Module._nodeModulePaths(path.dirname(filename)), ...module.paths];
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
const content = load(path.resolve(__dirname, '../src/pages/landing/content.ts'), {
  '../../../../shared/utils/subscriptionPricing': helper,
});
const shared = load(path.resolve(__dirname, '../src/pages/landing/sections/pricingShared.tsx'), {
  '../content': content,
  '../config': {},
});
const calculatorSource =
  process.env.AUTEXA_CALCULATOR_SOURCE ||
  path.resolve(__dirname, '../src/pages/landing/sections/PricingCalculator.tsx');
const dependencies = {
  '../../../../../shared/utils/subscriptionPricing': helper,
  '../../../utils/subscriptionPricingText': textUtils,
  'react-router-dom': { Link: (props) => React.createElement('a', props, props.children) },
  '../content': content,
  './pricingShared': shared,
};
const { PricingCalculator } = load(calculatorSource, dependencies);
function mount() {
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(PricingCalculator, process.env.AUTEXA_CALCULATOR_SOURCE ? { period: 'yearly' } : {}),
    );
  });
  return tree;
}
const total = (tree) =>
  tree.root.findByProps({ 'data-testid': 'subscription-total' }).children.join('').replace(/\s/g, '');
const text = (tree) => {
  const extract = (node) =>
    node == null
      ? ''
      : Array.isArray(node)
        ? node.map(extract).join('')
        : typeof node === 'object'
          ? extract(node.children)
          : String(node);
  return extract(tree.toJSON()).replace(/\s/g, '');
};
const choose = (tree, name) =>
  Renderer.act(() =>
    tree.root
      .findAllByType('button')
      .find((node) => node.props['aria-label'] === name || node.children.join('') === name)
      .props.onClick(),
  );
const fill = (tree, label, value) =>
  Renderer.act(() => tree.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }));
const close = (tree) => Renderer.act(() => tree.unmount());

test('default public calculator is BAZA yearly for one employee and one branch: 825 monthly and 9900 upfront', () => {
  const tree = mount();
  try {
    assert.equal(total(tree), '825₽');
    assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props.value, '1');
    assert.equal(tree.root.findByProps({ 'aria-label': 'Всего филиалов' }).props.value, '1');
    assert.ok(text(tree).includes('9900'));
    assert.ok(text(tree).includes('вмесяцприоплатезагод'));
    const invoice = tree.root.findByProps({ 'data-testid': 'subscription-upfront' });
    for (let node = invoice.parent; node; node = node.parent)
      assert.notEqual(node.type, 'details', 'annual invoice must stay visible');
    assert.equal(tree.root.findAllByProps({ 'data-testid': 'subscription-total' }).length, 1);
    const details = tree.root.findAllByType('details');
    assert.equal(details.length, 2);
    for (const node of details) assert.ok(!node.props.open);
    assert.ok(text(tree).includes('Сравнитьвсевозможноститарифов'));
  } finally {
    close(tree);
  }
});
test('employee presets include 1/2/3/5/10; preset two calculates 1650 monthly and 19800 annual invoice', () => {
  const tree = mount();
  try {
    for (const count of [1, 2, 3, 5, 10]) assert.ok(tree.root.findByProps({ 'aria-label': `${count} сотрудников` }));
    choose(tree, '2 сотрудников');
    assert.equal(total(tree), '1650₽');
    assert.ok(text(tree).includes('19800'));
  } finally {
    close(tree);
  }
});
test('plan and period choices preserve untouched and manual counts, including raw invalid entries', () => {
  const tree = mount();
  try {
    choose(tree, 'MAX');
    assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props.value, '1');
    fill(tree, 'Всего сотрудников', '2');
    fill(tree, 'Всего филиалов', '2');
    choose(tree, 'PRO');
    assert.equal(tree.root.findAllByProps({ 'data-testid': 'subscription-total' }).length, 0);
    assert.ok(text(tree).includes('Составкомандысохранён'));
    choose(tree, 'За месяц');
    assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props.value, '2');
    assert.equal(tree.root.findByProps({ 'aria-label': 'Всего филиалов' }).props.value, '2');
    choose(tree, 'Рассчитать MAX');
    assert.equal(total(tree), '18000₽');
    assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props.value, '2');
    fill(tree, 'Всего сотрудников', '1.5');
    choose(tree, 'BAZA');
    choose(tree, 'За год · 12 за 10');
    assert.equal(tree.root.findByProps({ 'aria-label': 'Всего сотрудников' }).props.value, '1.5');
    assert.equal(tree.root.findAllByProps({ 'data-testid': 'subscription-total' }).length, 0);
  } finally {
    close(tree);
  }
});
test('approved monthly/yearly examples use MAX 3000 branch rate and exact invoice', () => {
  for (const [plan, employees, points, monthly, yearly, invoice] of [
    ['BAZA', '1', '1', '990₽', '825₽', '9900'],
    ['BAZA', '2', '1', '1980₽', '1650₽', '19800'],
    ['PRO', '5', '1', '4990₽', '≈4158,33₽', '49900'],
    ['PRO', '6', '1', '5490₽', '4575₽', '54900'],
    ['MAX', '50', '2', '18000₽', '15000₽', '180000'],
    ['MAX', '51', '2', '18500₽', '≈15416,67₽', '185000'],
  ]) {
    const tree = mount();
    try {
      choose(tree, plan);
      fill(tree, 'Всего сотрудников', employees);
      fill(tree, 'Всего филиалов', points);
      choose(tree, 'За месяц');
      assert.equal(total(tree), monthly);
      choose(tree, 'За год · 12 за 10');
      assert.equal(total(tree), yearly);
      assert.ok(text(tree).includes(invoice));
    } finally {
      close(tree);
    }
  }
});
test('invalid counts and payment overflow hide the previous price and keep fields recoverable', () => {
  const tree = mount();
  try {
    for (const label of ['Всего сотрудников', 'Всего филиалов']) {
      for (const invalid of ['', '0', '-1', '1.5', '1e3', '9007199254740992', '99999999']) {
        fill(tree, label, invalid);
        assert.equal(tree.root.findAllByProps({ 'data-testid': 'subscription-total' }).length, 0, invalid);
        assert.equal(tree.root.findByProps({ 'aria-label': label }).props.value, invalid);
      }
      fill(tree, label, '1');
    }
    assert.equal(total(tree), '825₽');
    choose(tree, 'Увеличить: Всего сотрудников');
    assert.equal(total(tree), '1650₽');
    choose(tree, 'Уменьшить: Всего сотрудников');
    assert.equal(total(tree), '825₽');
  } finally {
    close(tree);
  }
});
test('home and tariff route each mount one functioning calculator with one primary price', () => {
  const router = { ...dependencies['react-router-dom'], useNavigationType: () => 'POP' };
  const home = load(path.resolve(__dirname, '../src/pages/landing/sections/Pricing.tsx'), {
    'react-router-dom': router,
    '../content': content,
    './PricingCalculator': { PricingCalculator },
  }).default;
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(home));
  });
  assert.equal(tree.root.findAllByProps({ 'data-testid': 'public-pricing-calculator' }).length, 1);
  assert.equal(tree.root.findAllByProps({ 'data-testid': 'subscription-total' }).length, 1);
  assert.equal(total(tree), '825₽');
  close(tree);
  const previousDocument = global.document,
    previousWindow = global.window;
  global.document = {
    title: 'Test',
    documentElement: { style: { scrollBehavior: '' } },
    body: { style: { backgroundColor: '' } },
    querySelector: () => null,
  };
  global.window = { matchMedia: () => ({ matches: true }), scrollTo() {} };
  try {
    const empty = { __esModule: true, default: () => null };
    const route = load(path.resolve(__dirname, '../src/pages/landing/TarifyPage.tsx'), {
      'react-router-dom': router,
      './sections/PricingCalculator': { PricingCalculator },
      './content': content,
      './gsap': { GsapReveal: (props) => React.createElement('div', null, props.children) },
      './sections/pricingShared': { ImplementationCard: () => null },
      './sections/CtaSection': empty,
      './sections/Footer': empty,
      './sections/GlassTabBar': empty,
    }).default;
    Renderer.act(() => {
      tree = Renderer.create(React.createElement(route));
    });
    assert.equal(tree.root.findAllByProps({ 'data-testid': 'public-pricing-calculator' }).length, 1);
    assert.equal(tree.root.findAllByProps({ 'data-testid': 'subscription-total' }).length, 1);
    assert.equal(total(tree), '825₽');
    close(tree);
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
  }
  assert.ok(!content.pricing.differences.some((row) => row.values.includes('5 000 ₽/мес.')));
  assert.ok(content.pricing.differences.some((row) => row.values.includes('3 000 ₽/мес.')));
});
