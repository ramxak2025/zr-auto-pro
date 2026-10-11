const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    filename,
  );
const { templateProductCost, templateProductsCost } = require('../../shared/utils/templateProducts');
const { expandServiceQuantities, toCheckTemplateServiceInput } = require('../../shared/utils/checkLines');
const { createCheckTemplatesApi } = require('../../shared/api/createServices');
const file = path.join(__dirname, '../src/pages/CheckCreatePage.tsx');
const source = ts.createSourceFile(
  file,
  fs.readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function expression(name, context) {
  let found;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      (name !== 'products' || node.initializer.getText(source).startsWith('productLines.map'))
    )
      found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `actual ${name} callback exists`);
  const js = ts.transpileModule(`const result = ${found.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(...Object.keys(context), `${js}\nreturn result;`)(...Object.values(context));
}
test('web template apply, edited check input and SaveTemplate retain each server cost source', () => {
  const refs = [
    { templateId: 'a', productIndex: 0, version: '12' },
    { templateId: 'b', productIndex: 4, version: '13' },
  ];
  let productLines = [];
  const context = {
    user: { id: 'staff' },
    allProducts: [],
    DEFAULT_UNIT: 'шт',
    expandServiceQuantities,
    toCheckTemplateServiceInput,
    legacyQuantity: () => undefined,
    setServiceLines() {},
    setShowTemplatesPicker() {},
    setProductLines: (lines) => {
      productLines = lines;
    },
    toast: { success() {} },
  };
  expression(
    'applyTemplate',
    context,
  )({
    name: 'Manual',
    services: [],
    products: refs.map((sourceTemplateProduct) => ({
      name: 'Расходник',
      sellPrice: 100,
      quantity: 2,
      sourceTemplateProduct,
    })),
  });
  productLines[0] = { ...productLines[0], quantity: 1.5, sellPrice: 200 };
  const payload = expression('products', { productLines });
  assert.deepEqual(
    payload.map((line) => line.sourceTemplateProduct),
    refs,
  );
  assert.equal(payload[0].quantity, 1.5);
  const copy = expression('templateProducts', { productLines, useMemo: (fn) => fn() });
  assert.equal(copy.length, 2, 'manual source lines must not be filtered out');
  assert.deepEqual(
    JSON.parse(JSON.stringify(copy)).map((line) => line.sourceTemplateProduct),
    refs,
  );
});
test('template cost uses exact check line rounding and distinguishes unknown from explicit zero', () => {
  const lines = [
    { costPrice: 10.01, quantity: 1.5 },
    { costPrice: 10.01, quantity: 1.5 },
  ];
  assert.equal(templateProductCost(lines[0]), 15.02);
  assert.equal(templateProductsCost(lines), 30.04);
  assert.equal(templateProductsCost([{ quantity: 2 }]), undefined);
  assert.equal(templateProductsCost([{ costPrice: 0, quantity: 2 }]), 0);
});

test('the shared mobile/web template API always advertises source support', async () => {
  let requested;
  const api = createCheckTemplatesApi({
    get: async (url, options) => {
      requested = { url, options };
      return { data: [] };
    },
  });
  await api.list();
  assert.deepEqual(requested, { url: '/check-templates', options: { params: { sourceAware: '1' } } });
});
