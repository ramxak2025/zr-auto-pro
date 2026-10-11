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
const { expandServiceQuantities, toCheckTemplateServiceInput } = require('../../shared/utils/checkLines');
const { formatTemplateCost, templateProductsCost } = require('../../shared/utils/templateProducts');
function expression(screen, predicate, context) {
  const file = path.join(__dirname, `../src/screens/${screen}.tsx`);
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found;
  function visit(node) {
    if (predicate(node, source)) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, 'actual screen callback exists');
  const js = ts.transpileModule(`const result = ${found.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(...Object.keys(context), `${js}\nreturn result;`)(...Object.values(context));
}
test('mobile applies template and sends provenance in edited check input and copied template', () => {
  const refs = [
    { templateId: 'a', productIndex: 0, version: '12' },
    { templateId: 'b', productIndex: 4, version: '13' },
  ];
  let productLines = [];
  const context = {
    allProducts: [],
    defaultMasterId: 'staff',
    expandServiceQuantities,
    toCheckTemplateServiceInput,
    setServiceLines() {},
    setShowTemplatesPicker() {},
    setProductLines: (lines) => {
      productLines = lines;
    },
  };
  expression(
    'CheckCreateScreen',
    (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'applyTemplate',
    context,
  )({
    services: [],
    products: refs.map((sourceTemplateProduct) => ({
      name: 'Расходник',
      sellPrice: 100,
      quantity: 2,
      sourceTemplateProduct,
    })),
  });
  productLines[0] = { ...productLines[0], quantity: 1.5, sellPrice: 200 };
  const payload = expression(
    'CheckCreateScreen',
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'products' &&
      node.initializer.getText().startsWith('productLines.map'),
    { productLines },
  );
  assert.deepEqual(
    payload.map((line) => line.sourceTemplateProduct),
    refs,
  );
  assert.equal(payload[0].quantity, 1.5);
  const copy = expression(
    'CheckCreateScreen',
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'products' &&
      node.initializer.getText().startsWith('productLines\n'),
    { productLines },
  );
  assert.equal(copy.length, 2, 'manual source lines must not be filtered out');
  assert.deepEqual(
    copy.map((line) => line.sourceTemplateProduct),
    refs,
  );
  const edit = expression(
    'TemplateEditorScreen',
    (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'products',
    { productLines },
  );
  assert.deepEqual(
    edit.map((line) => line.sourceTemplateProduct),
    refs,
  );
});
test('mobile template cost preview preserves kopecks and actual zero', () => {
  assert.equal(
    formatTemplateCost(
      templateProductsCost([
        { costPrice: 10.01, quantity: 1.5 },
        { costPrice: 10.01, quantity: 1.5 },
      ]),
    ),
    '30,04 ₽',
  );
  assert.equal(formatTemplateCost(15.02), '15,02 ₽');
  assert.equal(formatTemplateCost(0), '0 ₽');
});
