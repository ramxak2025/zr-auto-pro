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
const kitCart = require('../../shared/utils/kitCart');
const { checkProductPayload, savedProductLineIds } = require('../../mobile/src/screens/checkCreate/productPayload');
function action(file, name, context) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node;
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) node = n.initializer;
    ts.forEachChild(n, visit);
  };
  visit(ast);
  assert.ok(node, name);
  const js = ts.transpileModule(`const result = ${node.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(...Object.keys(context), `${js}; return result;`)(...Object.values(context));
}
const web = path.join(__dirname, '../src/pages/CheckCreatePage.tsx');
const mobile = path.join(__dirname, '../../mobile/src/screens/CheckCreateScreen.tsx');
const a = { id: 'a', name: 'Фильтр', sellPrice: 100, costPrice: 25, stock: 10 };
const b = { id: 'b', name: 'Масло', sellPrice: 200, costPrice: 80, stock: 10 };
const kit = {
  productId: 'kit',
  revision: 3,
  components: [
    { productId: 'a', name: a.name, quantity: 1, costPrice: 20.12345 },
    { productId: 'b', name: b.name, quantity: 2, costPrice: 70 },
  ],
};
const physical = {
  id: 'kit',
  name: 'Набор',
  assemblyId: 'assembly',
  assemblyExactCost: 160.12345,
  sellPrice: 450,
  costPrice: 160.12,
  isBundle: true,
  bundleItems: kit.components,
};
function cartContext(lines = []) {
  const ctx = {
    ...kitCart,
    productLines: lines,
    allProducts: [a, b, physical],
    useCallback: (fn) => fn,
    roundQty: (n) => n,
    unitLabel: () => 'шт',
    DEFAULT_UNIT: 'шт',
    METERED_UNITS: new Set(),
    toast: { success() {}, error() {} },
  };
  ctx.setProductLines = (updater) => {
    ctx.productLines = typeof updater === 'function' ? updater(ctx.productLines) : updater;
  };
  ctx.updateProductLine = (i, field, value) =>
    ctx.setProductLines((prev) => prev.map((line, j) => (j === i ? { ...line, [field]: value } : line)));
  return ctx;
}
test('actual web and native selection keep physical kits whole and never merge ordinary with captured component', async () => {
  for (const [file, name] of [
    [web, 'handleProductSelected'],
    [mobile, 'addProductLine'],
  ]) {
    const ctx = cartContext();
    await action(file, name, ctx)(physical);
    assert.equal(ctx.productLines.length, 1);
    assert.equal(ctx.productLines[0].sellPrice, 450);
    assert.equal(ctx.productLines[0].costPrice, 160.12345);
    ctx.productLines = kitCart.splitKitCartLine(kit, 2, 'intent', [a, b]).lines;
    await action(file, name, ctx)(a);
    assert.equal(ctx.productLines.length, 3);
    assert.equal(ctx.productLines[0].quantity, 2);
    assert.equal(ctx.productLines[2].kitSource, undefined);
    await action(file, name, ctx)(a);
    assert.equal(ctx.productLines[2].quantity, 2);
    assert.equal(a.stock, 10);
    assert.equal(b.stock, 10);
  }
});
function submitContext(lines, splits) {
  const ctx = {
    ...kitCart,
    requiresKitOnline: true,
    navigator: { onLine: true },
    missingReferencedServiceIds: [],
    serviceLines: [],
    productLines: lines,
    kitSplits: splits,
    savedKitIntentIds: { current: new Set() },
    paymentMethod: 'cash',
    totalRevenue: 900,
    productTotal: 1000,
    cashAmount: 0,
    discount: 100,
    dateTouched: false,
    canEditDate: false,
    selectedClient: null,
    selectedCarId: '',
    isEditMode: false,
    existingCheck: null,
    user: { id: 'master' },
    mileage: '',
    comment: '',
    selectedTags: [],
    assigneesDirty: false,
    assigneeIds: [],
    conveyorMode: false,
    isDeferred: true,
    clientRequestIdRef: { current: null },
    generateClientRequestId: () => 'stable-request',
    checkPerformerPayload: () => ({}),
    toast: { error() {} },
    createMutation: {
      mutate(payload) {
        ctx.sent = JSON.parse(JSON.stringify(payload));
      },
    },
    updateMutation: {
      mutate(payload) {
        ctx.sent = JSON.parse(JSON.stringify(payload));
      },
    },
  };
  ctx.setProductLines = (updater) => {
    ctx.productLines = typeof updater === 'function' ? updater(ctx.productLines) : updater;
  };
  return ctx;
}
test('actual web submit retains quantity-two split, discount, draft round-trip and retry identity; removing/replacing components prunes only new unused intent', () => {
  const split = kitCart.splitKitCartLine(kit, 2, 'intent', [a, b]);
  assert.deepEqual(
    split.lines.map((l) => l.quantity),
    [2, 4],
  );
  const ctx = submitContext(split.lines, [split.intent]);
  action(web, 'doSubmit', ctx)();
  assert.equal(ctx.sent.isDeferred, true);
  assert.equal(ctx.sent.discount, 100);
  assert.deepEqual(ctx.sent.kitSplits, [split.intent]);
  const draft = JSON.parse(JSON.stringify(ctx.sent));
  ctx.productLines = draft.products;
  ctx.kitSplits = draft.kitSplits;
  ctx.isDeferred = false;
  action(web, 'doSubmit', ctx)();
  assert.equal(ctx.sent.clientRequestId, 'stable-request');
  assert.deepEqual(
    ctx.sent.products.map((l) => l.kitSource),
    split.lines.map((l) => l.kitSource),
  );
  action(web, 'removeProductLine', ctx)(0);
  action(web, 'doSubmit', ctx)();
  assert.equal(ctx.sent.kitSplits.length, 1);
  action(web, 'removeProductLine', ctx)(0);
  Object.assign(ctx, {
    allProducts: [a, b, physical],
    useCallback: (fn) => fn,
    roundQty: (n) => n,
    unitLabel: () => 'шт',
    DEFAULT_UNIT: 'шт',
    METERED_UNITS: new Set(),
  });
  action(web, 'handleProductSelected', ctx)(a);
  action(web, 'doSubmit', ctx)();
  assert.deepEqual(ctx.sent.kitSplits, []);
  assert.equal(ctx.sent.products[0].kitSource, undefined);
  assert.equal(
    ctx.sent.products[0].id,
    undefined,
    'same-SKU ordinary replacement never inherits persisted source identity',
  );
  ctx.savedKitIntentIds.current = new Set(['intent']);
  action(web, 'doSubmit', ctx)();
  assert.deepEqual(ctx.sent.kitSplits, [split.intent]);
  ctx.sent = undefined;
  ctx.navigator.onLine = false;
  action(web, 'doSubmit', ctx)();
  assert.equal(ctx.sent, undefined, 'offline save leaves live cart');
});
test('actual split action only reads composition/catalog; failure leaves whole kit and retry works', async () => {
  const line = { productId: 'kit', quantity: 2, name: 'Набор' };
  const ctx = cartContext([line]);
  let fail = true;
  let splits = [];
  Object.assign(ctx, {
    splittingKit: false,
    api: {},
    newUuid: () => 'intent',
    setSplittingKit() {},
    kitSourceQuantityLimits: { current: new Map() },
    createProductKitsApi: () => ({
      get: async () => {
        if (fail) throw Error('revision stale');
        return { data: kit };
      },
    }),
    productsApi: { getById: async (id) => ({ data: [a, b].find((p) => p.id === id) }) },
    setKitSplits: (update) => {
      splits = update(splits);
    },
  });
  await action(web, 'splitProductLine', ctx)(0);
  assert.equal(ctx.productLines[0], line);
  assert.equal(splits.length, 0);
  fail = false;
  await action(web, 'splitProductLine', ctx)(0);
  assert.equal(ctx.productLines.length, 2);
  assert.equal(splits[0].expectedRevision, 3);
  assert.equal(a.stock, 10);
  assert.equal(b.stock, 10);
});
test('native serializer preserves source and saved line identity across deferred/edit JSON round-trip', () => {
  const lines = kitCart
    .splitKitCartLine(kit, 2, 'intent', [a, b])
    .lines.map((line, i) => ({ ...line, id: `saved-${i}` }));
  const original = savedProductLineIds(lines);
  const copy = JSON.parse(JSON.stringify(lines.map((l) => checkProductPayload(l, original))));
  assert.deepEqual(
    copy.map((l) => l.kitSource),
    lines.map((l) => l.kitSource),
  );
  assert.deepEqual(
    copy.map((l) => l.id),
    ['saved-0', 'saved-1'],
  );
});

test('actual row quantity handlers cap captured quantities and address rows independently', () => {
  for (const file of [web, mobile]) {
    const split = kitCart.splitKitCartLine(kit, 2, 'intent', [a, b]);
    const ctx = cartContext([
      ...split.lines,
      { productId: 'a', name: 'ordinary', quantity: 8, sellPrice: 100, costPrice: 25 },
    ]);
    ctx.kitSourceQuantityLimits = {
      current: new Map([
        ['intent:a', 2],
        ['intent:b', 4],
      ]),
    };
    action(file, 'updateProductLine', ctx)(0, 'quantity', 1);
    action(file, 'updateProductLine', ctx)(0, 'quantity', 99);
    assert.equal(ctx.productLines[0].quantity, 2);
    assert.equal(ctx.productLines[2].quantity, 8);
    action(file, 'removeProductLine', ctx)(0);
    assert.equal(ctx.productLines[1].quantity, 8);
  }
});
test('service worker opts physical checkout out of generic mutation queue', () => {
  const vm = require('node:vm');
  let handle;
  const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  const sandbox = {
    self: {
      location: { origin: 'https://app.test' },
      addEventListener: (type, fn) => {
        if (type === 'fetch') handle = fn;
      },
    },
    URL,
    Request,
    Response,
    Headers,
    fetch: async () => new Response('{}', { status: 200 }),
  };
  vm.runInNewContext(sw, sandbox);
  let intercepted = false;
  handle({
    request: new Request('https://app.test/api/checks', {
      method: 'POST',
      headers: { 'X-Autexa-Require-Online': '1' },
      body: '{}',
    }),
    respondWith() {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false, 'browser network handles physical checkout; no synthetic queued success');
  handle({
    request: new Request('https://app.test/api/checks', { method: 'POST', body: '{}' }),
    respondWith() {
      intercepted = true;
    },
  });
  assert.equal(intercepted, true, 'ordinary checkout still uses its existing offline path');
});

test('actual native request builder preserves draft conversion, edit echo and stable create retry', () => {
  const split = kitCart.splitKitCartLine(kit, 2, 'intent', [a, b]);
  let generated = 0;
  const ctx = {
    ...kitCart,
    checkProductPayload,
    editId: undefined,
    clientRequestIdRef: { current: null },
    generateClientRequestId: () => `request-${++generated}`,
    clientId: '',
    carId: '',
    resolvedMasterId: 'master',
    selectedCheckDate: () => undefined,
    manualDate: null,
    canEditCheckDate: false,
    mileage: '',
    comment: '',
    selectedTags: [],
    discountNum: 50,
    effectiveMethod: 'cash',
    finalCash: 950,
    finalCard: 0,
    shouldDefer: true,
    performerPayload: () => ({}),
    assigneesDirty: false,
    assigneeIds: [],
    orderLocationId: null,
    serviceLines: [],
    productLines: split.lines,
    originalProductLineIds: { current: new Set() },
    kitSplits: [split.intent],
    savedKitIntentIds: { current: new Set() },
    locationDirty: false,
  };
  const draft = JSON.parse(JSON.stringify(action(mobile, 'payload', ctx)));
  assert.equal(draft.isDeferred, true);
  assert.deepEqual(draft.kitSplits, [split.intent]);
  ctx.shouldDefer = false;
  const active = action(mobile, 'payload', ctx);
  assert.equal(active.clientRequestId, draft.clientRequestId);
  assert.equal(generated, 1);
  assert.deepEqual(
    active.products.map((l) => l.kitSource),
    split.lines.map((l) => l.kitSource),
  );
  ctx.editId = 'saved-check';
  ctx.productLines = draft.products;
  ctx.kitSplits = draft.kitSplits;
  assert.deepEqual(action(mobile, 'payload', ctx).kitSplits, [split.intent]);
  ctx.productLines = [];
  assert.deepEqual(action(mobile, 'payload', ctx).kitSplits, []);
});

test('old slim bundle caches are refreshed before deciding physical versus legacy; failed lookup leaves cart intact', async () => {
  for (const [file, name] of [
    [web, 'handleProductSelected'],
    [mobile, 'addProductLine'],
  ]) {
    const ctx = cartContext();
    let fail = true;
    let reads = 0;
    Object.assign(ctx, {
      captureDataSession: () => ({ isCurrent: () => true }),
      Alert: { alert() {} },
      productsApi: {
        getById: async () => {
          reads++;
          if (fail) throw Error('offline');
          return { data: physical };
        },
      },
    });
    const slim = { ...physical, assemblyId: undefined };
    await action(file, name, ctx)(slim);
    assert.equal(ctx.productLines.length, 0);
    fail = false;
    await action(file, name, ctx)(slim);
    assert.equal(reads, 2);
    assert.equal(ctx.productLines.length, 1);
    assert.equal(ctx.productLines[0].productId, 'kit');
    assert.equal(ctx.productLines[0].assemblyId, 'assembly');
  }
});

test('actual web/native template application resolves unknown kit metadata, keeps one row at kit price, and failure preserves the old cart', async () => {
  const { expandServiceQuantities, toCheckTemplateServiceInput } = require('../../shared/utils/checkLines');
  for (const file of [web, mobile]) {
    const ctx = cartContext([{ name: 'old', productId: 'old', quantity: 1 }]);
    let fail = true;
    let splits = ['old-intent'];
    Object.assign(ctx, {
      allProducts: [],
      captureDataSession: () => ({ isCurrent: () => true }),
      canApplyTemplateSnapshot: () => true,
      templatesRefreshing: false,
      templatesRefreshFailed: false,
      templatesPaused: false,
      Alert: { alert() {} },
      productsApi: {
        getById: async () => {
          if (fail) throw Error('offline');
          return { data: physical };
        },
      },
      expandServiceQuantities,
      toCheckTemplateServiceInput,
      legacyQuantity: () => undefined,
      user: { id: 'master' },
      defaultMasterId: 'master',
      setKitSplits: (value) => {
        splits = value;
      },
      setServiceLines() {},
      setShowTemplatesPicker() {},
    });
    const template = {
      name: 'kit-template',
      services: [],
      products: [{ productId: 'kit', name: 'Набор', sellPrice: 1, costPrice: 0, quantity: 2 }],
    };
    await action(file, 'applyTemplate', ctx)(template);
    assert.equal(ctx.productLines[0].productId, 'old');
    assert.deepEqual(splits, ['old-intent']);
    fail = false;
    await action(file, 'applyTemplate', ctx)(template);
    assert.equal(ctx.productLines.length, 1);
    assert.equal(ctx.productLines[0].productId, 'kit');
    assert.equal(ctx.productLines[0].quantity, 2);
    assert.equal(ctx.productLines[0].sellPrice, 450);
    assert.equal(ctx.productLines[0].assemblyId, 'assembly');
    assert.deepEqual(splits, []);
  }
});
