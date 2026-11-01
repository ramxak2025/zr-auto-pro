const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText,
    filename,
  );
const labels = require('../../shared/utils/productLabels');
const web = require('../src/utils/productLabelPrint');
// Execute the native adapter with this package's declared JsBarcode dependency.
// Frontend checks must also run when mobile/node_modules is absent.
const nativeModule = { exports: {} };
const nativeSource = fs.readFileSync(
  require('node:path').join(__dirname, '../../mobile/src/utils/productLabelPrint.ts'),
  'utf8',
);
const nativeJs = ts.transpileModule(nativeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const nativeRequire = (name) => (name === '../../../shared/utils/productLabels' ? labels : require(name));
new Function('require', 'module', 'exports', nativeJs)(nativeRequire, nativeModule, nativeModule.exports);
const native = nativeModule.exports;
const product = {
  id: 'one',
  name: 'Масло моторное синтетическое «Зима & Лето» <проверка> очень длинное название',
  sellPrice: 0,
  barcode: '4601234567893',
  internalBarcode: 'AX12345678',
  costPrice: 98765,
  supplier: 'PRIVATE_SUPPLIER',
  stock: 42,
};
const settings = { paper: { widthMm: 40, heightMm: 30 }, showPrice: false };
const document = (options = {}) =>
  labels.prepareProductLabels([product], {}, { ...settings, ...options }, web.encodeProductLabelCode);

test('real client-local JsBarcode encoders agree; internal AX+8 fits40mm without compressing two-dot modules', () => {
  assert.equal(
    web.encodeProductLabelCode(product.internalBarcode),
    native.encodeProductLabelCode(product.internalBarcode),
  );
  const result = labels.prepareProductLabels(
    [product],
    { one: { copies: 2, source: 'internal' } },
    settings,
    web.encodeProductLabelCode,
  );
  assert.equal(result.count, 2);
  assert.equal(result.previews[0].code, 'AX12345678');
  assert.match(result.html, /@page\{size:40mm 30mm;margin:0\}/);
  assert.equal((result.html.match(/class="label"/g) || []).length, 2);
  const widths = [...result.previews[0].svg.matchAll(/<rect x="[^"]+" y="10" width="([^"]+)"/g)].map((match) =>
    Number(match[1]),
  );
  assert.ok(widths.length > 10);
  assert.ok(Math.min(...widths) >= labels.LABEL_MODULE_MM - 0.00001);
});
test('factory barcode is default, price is opt-in including zero, HTML escaped, all private fields omitted', () => {
  const result = document();
  assert.equal(result.previews[0].code, product.barcode);
  assert.equal(product.barcode, '4601234567893');
  assert.equal(result.html.includes('₽'), false);
  assert.equal(result.html.includes('98765'), false);
  assert.equal(result.html.includes('PRIVATE_SUPPLIER'), false);
  assert.equal(result.html.includes('costPrice'), false);
  assert.equal(result.html.includes('<проверка>'), false);
  assert.ok(result.html.includes('&amp;'));
  assert.ok(result.warnings.length);
  assert.ok(document({ showPrice: true }).html.includes('0 ₽'));
});
test('invalid Unicode, missing codes, too-narrow paper and excessive copies fail honestly', () => {
  assert.throws(
    () => labels.prepareProductLabels([{ ...product, barcode: 'КОД-123' }], {}, settings, web.encodeProductLabelCode),
    /не подходит для Code 128/,
  );
  assert.throws(
    () =>
      labels.prepareProductLabels(
        [{ ...product, barcode: 'ABCDEFGHIJKLMNOPQRSTUVWX' }],
        {},
        settings,
        web.encodeProductLabelCode,
      ),
    /нужна ширина/,
  );
  assert.throws(
    () =>
      labels.prepareProductLabels(
        [{ ...product, barcode: null, internalBarcode: null }],
        {},
        settings,
        web.encodeProductLabelCode,
      ),
    /сначала создайте/,
  );
  assert.throws(
    () =>
      labels.prepareProductLabels(
        [product],
        { one: { copies: 101, source: 'factory' } },
        settings,
        web.encodeProductLabelCode,
      ),
    /от 0 до 100/,
  );
  assert.throws(
    () =>
      labels.prepareProductLabels(
        [product, { ...product, id: 'two' }, { ...product, id: 'three' }],
        {
          one: { copies: 100, source: 'factory' },
          two: { copies: 100, source: 'factory' },
          three: { copies: 1, source: 'factory' },
        },
        settings,
        web.encodeProductLabelCode,
      ),
    /не больше 200/,
  );
  assert.throws(() => document({ paper: { widthMm: 0, heightMm: 30 } }), /Размер этикетки/);
});
test('58x40 and custom pages retain physical geometry; 200 labels stay bounded, zero copies excluded', () => {
  const result = labels.prepareProductLabels(
    [product, { ...product, id: 'two' }],
    { one: { copies: 100, source: 'internal' }, two: { copies: 100, source: 'factory' } },
    { paper: { widthMm: 58, heightMm: 40 }, showPrice: true },
    web.encodeProductLabelCode,
  );
  assert.equal(result.count, 200);
  assert.match(result.html, /size:58mm 40mm/);
  assert.ok(result.html.length < 5_000_000);
  const custom = document({ paper: { widthMm: 63.5, heightMm: 38.1 } });
  assert.match(custom.html, /size:63.5mm 38.1mm/);
  const skipped = labels.prepareProductLabels(
    [product, { ...product, id: 'two', barcode: 'НЕПОДДЕРЖИВАЕМЫЙ' }],
    { two: { copies: 0, source: 'factory' } },
    settings,
    web.encodeProductLabelCode,
  );
  assert.equal(skipped.count, 1);
});
test('native export uses label-sized real PDF and share; printing passes generated PDF URI, never unconfirmed success', async () => {
  const result = document();
  let options, shared, printed;
  const deps = {
    platform: 'android',
    print: {
      printToFileAsync: async (value) => {
        options = value;
        return { uri: 'file:///labels.pdf', numberOfPages: 1 };
      },
      printAsync: async (value) => {
        printed = value;
      },
    },
    sharing: {
      isAvailableAsync: async () => true,
      shareAsync: async (...args) => {
        shared = args;
      },
    },
  };
  assert.deepEqual(await native.exportProductLabelsPdf(result, deps), { uri: 'file:///labels.pdf', shared: true });
  assert.equal(options.width, 114);
  assert.equal(options.height, 86);
  assert.deepEqual(options.margins, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(shared[1].mimeType, 'application/pdf');
  const ios = native.productLabelPdfOptions(result, 'ios');
  assert.ok(Math.abs((ios.width * 25.4) / 72 - 40) < 1e-8);
  assert.ok(Math.abs((ios.height * 25.4) / 72 - 30) < 1e-8);
  await native.printProductLabelsNative(result, deps);
  assert.deepEqual(printed, { uri: 'file:///labels.pdf' });
  deps.print.printToFileAsync = async () => {
    throw Error('native failure');
  };
  await assert.rejects(native.exportProductLabelsPdf(result, deps), /native failure/);
});
test('browser printing creates an isolated document and retains cleanup for cancel/afterprint', async () => {
  const result = document();
  let appended,
    printed = false,
    removed = false,
    cleanup;
  const frame = {
    style: {},
    setAttribute() {},
    remove() {
      removed = true;
    },
    contentDocument: { fonts: { ready: Promise.resolve() } },
    contentWindow: {
      focus() {},
      print() {
        printed = true;
      },
      addEventListener(event, callback) {
        assert.equal(event, 'afterprint');
        cleanup = callback;
      },
    },
  };
  const host = {
    createElement(tag) {
      assert.equal(tag, 'iframe');
      return frame;
    },
    body: {
      appendChild(value) {
        appended = value;
        queueMicrotask(() => frame.onload());
      },
    },
  };
  const oldTimer = global.setTimeout;
  global.setTimeout = () => 0;
  try {
    await web.printProductLabelsBrowser(result, host);
  } finally {
    global.setTimeout = oldTimer;
  }
  assert.equal(appended, frame);
  assert.equal(frame.srcdoc, result.html);
  assert.equal(printed, true);
  cleanup();
  assert.equal(removed, true);
});

test('actual web/native generation callbacks send only selected IDs, preserve factory data, and keep state on server failure', async () => {
  for (const file of [
    '../src/components/products/ProductLabelPrint.tsx',
    '../../mobile/src/components/products/ProductLabelPrint.tsx',
  ]) {
    const path = require('node:path').join(__dirname, file);
    const source = ts.createSourceFile(
      path,
      fs.readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let expression;
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'generate') expression = node.initializer;
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(expression);
    let items = [{ ...product, internalBarcode: null }],
      choices = {},
      sent,
      fail = true;
    const scope = {
      busy: false,
      MAX_LABELS: 200,
      onGenerateInternal: async (ids) => {
        sent = ids;
        if (fail) throw Error('offline');
        return [{ id: 'one', internalBarcode: 'AX00000001' }];
      },
      setBusy() {},
      setItems: (update) => {
        items = update(items);
      },
      setChoice: (id, choice) => {
        choices[id] = choice;
      },
      toast: { error() {} },
      Alert: { alert() {} },
    };
    const js = ts.transpileModule(`const callback=${expression.getText(source)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const callback = new Function(...Object.keys(scope), `${js};return callback;`)(...Object.values(scope));
    await callback(['one']);
    assert.deepEqual(sent, ['one']);
    assert.equal(items[0].internalBarcode, null);
    assert.deepEqual(choices, {});
    fail = false;
    await callback(['one']);
    assert.equal(items[0].internalBarcode, 'AX00000001');
    assert.equal(items[0].barcode, product.barcode);
    assert.deepEqual(choices.one, { source: 'internal' });
  }
});
