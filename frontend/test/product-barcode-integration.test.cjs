const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText,
    filename,
  );
const { loadProductBarcodeMatches } = require('../../shared/utils/productBarcodeLookup');
const { loadProductCatalog } = require('../../shared/api/productCatalog');
const { createProductsApi } = require('../../shared/api/createServices');
function actual(file, name, scope, queryKey) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  const visit = (node) => {
    if (!queryKey && ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      expression = node.initializer;
      if (ts.isCallExpression(expression) && expression.expression.getText(source) === 'useCallback')
        expression = expression.arguments[0];
    }
    if (
      queryKey &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'useQuery' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const props = node.arguments[0].properties;
      const key = props.find((p) => p.name?.getText(source) === 'queryKey');
      if (!expression && key?.initializer.getText(source).startsWith(`['${queryKey}'`))
        expression = props.find((p) => p.name?.getText(source) === 'queryFn')?.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(expression, `${file}:${name || queryKey}`);
  const js = ts.transpileModule(`const value=${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(...Object.keys(scope), `${js};return value;`)(...Object.values(scope));
}
const a = {
  id: 'a',
  name: 'Фильтр',
  barcode: 'shared',
  internalBarcode: 'AX00000001',
  warehouseId: 'A',
  stock: 3,
  sellPrice: 100,
  costPrice: 20,
};
const b = { ...a, id: 'b', warehouseId: 'B' };
const response = (matches) => ({
  data: {
    status: matches.length > 1 ? 'ambiguous' : matches.length ? 'found' : 'not_found',
    matches,
    total: matches.length,
    page: 1,
    limit: 100,
  },
});
test('exact shared API lookup pages through all duplicates and preserves explicit context', async () => {
  const items = Array.from({ length: 205 }, (_, i) => ({ ...a, id: `p${i}` }));
  const calls = [];
  const api = createProductsApi({
    get: async (url, { params }) => {
      calls.push({ url, params });
      return {
        data: {
          status: 'ambiguous',
          matches: items.slice((params.page - 1) * 100, params.page * 100),
          total: items.length,
          page: params.page,
          limit: 100,
        },
      };
    },
  });
  const result = await loadProductBarcodeMatches(api.lookupBarcode, { barcode: 'shared', warehouseId: 'A' });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matches.length, 205);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.url === '/products/lookup-barcode' && c.params.warehouseId === 'A'));
  await assert.rejects(
    loadProductBarcodeMatches(
      async (params) => {
        if (params.page === 2) throw Error('offline');
        return { data: { status: 'ambiguous', matches: [a], total: 2, page: 1, limit: 1 } };
      },
      { barcode: 'shared' },
    ),
    /offline/,
  );
});
function picker(matches, bridge = {}) {
  let selected = [],
    shown,
    notice,
    params,
    feedback;
  const session = { warehouseId: 'A', addProduct: (p) => selected.push(p), ...bridge };
  const scope = {
    loadProductBarcodeMatches,
    productsApi: {
      lookupBarcode: async (value) => {
        params = value;
        return response(matches);
      },
    },
    getProductPickerSession: () => session,
    captureDataSession: () => ({ isCurrent: () => true }),
    scanBusy: { current: false },
    scanEpoch: { current: 1 },
    focusedRef: { current: true },
    scanAddCountRef: { current: 0 },
    setScanFeedback: (v) => {
      feedback = v;
    },
    setShowScanner() {},
    setBarcodeMatches: (v) => {
      shown = v;
    },
    setLocalSearch() {},
    setDebouncedSearch() {},
    setCloseNotice: (v) => {
      notice = v;
    },
    debounceRef: { current: null },
    haptic() {},
    navigation: {
      pop: (n) => {
        scope.popped = n;
      },
    },
    depth: 2,
    lastTapRef: { current: new Map() },
    ROW_TAP_DEBOUNCE_MS: 500,
    notifyProcurementDrafts() {},
  };
  return {
    scope,
    session,
    get selected() {
      return selected;
    },
    get shown() {
      return shown;
    },
    get notice() {
      return notice;
    },
    get params() {
      return params;
    },
    get feedback() {
      return feedback;
    },
  };
}
const pickerFile = 'mobile/src/screens/ProductPickerScreen.tsx';
test('actual POS scanner searches all point warehouses; duplicate factory code waits for explicit canonical row selection', async () => {
  const h = picker([a, b], { closeOnSelect: true });
  await actual(pickerFile, 'handleScanned', h.scope)('shared');
  assert.equal(h.params.warehouseId, undefined);
  assert.deepEqual(h.selected, []);
  assert.deepEqual(h.shown, [a, b]);
  actual(pickerFile, 'handleRowPress', h.scope)(b);
  assert.deepEqual(h.selected, [b]);
  assert.equal(h.scope.popped, 3);
  const unique = picker([b], { closeOnSelect: true });
  await actual(pickerFile, 'handleScanned', unique.scope)('AX00000001');
  assert.deepEqual(unique.selected, [b]);
  assert.equal(unique.scope.popped, 3);
});
test('actual receiving scanner keeps warehouse/eligibility and procurement editor instead of direct add', async () => {
  const assembly = { ...a, id: 'kit', assemblyId: 'assembly' };
  const drafts = { active: null, entries: {} };
  const h = picker([a, assembly], {
    filterProduct: (p) => !p.assemblyId,
    purchaseOrder: { drafts, lines: [], updateLine() {} },
  });
  await actual(pickerFile, 'handleScanned', h.scope)('shared');
  assert.equal(h.params.warehouseId, 'A');
  assert.deepEqual(h.shown, [a]);
  assert.deepEqual(h.selected, []);
  actual(pickerFile, 'handleRowPress', h.scope)(a);
  assert.equal(drafts.active, 'a');
  assert.deepEqual(h.selected, []);
});
test('actual scanner ignores cancelled requests and failed lookups without phantom add', async () => {
  const h = picker([a]);
  let resolve;
  h.scope.productsApi.lookupBarcode = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = actual(pickerFile, 'handleScanned', h.scope)('AX00000001');
  h.scope.scanEpoch.current++;
  resolve(response([a]));
  await pending;
  assert.deepEqual(h.selected, []);
  assert.equal(h.shown, undefined);
  h.scope.productsApi.lookupBarcode = async () => {
    throw Error('offline');
  };
  await actual(pickerFile, 'handleScanned', h.scope)('shared');
  assert.deepEqual(h.selected, []);
  assert.match(h.feedback, /Не удалось/);
});
test('actual legacy picker uses exact lookup and does not choose first duplicate in restricted context', async () => {
  let added = 0,
    shown,
    params;
  const scope = {
    loadProductBarcodeMatches,
    productsApi: {
      lookupBarcode: async (value) => {
        params = value;
        return response([a, b]);
      },
    },
    scanBusy: { current: false },
    scanEpoch: { current: 1 },
    captureDataSession: () => ({ isCurrent: () => true }),
    scanCooldownRef: { current: 0 },
    SCAN_COOLDOWN_MS: 1400,
    visibleRef: { current: true },
    lookupWarehouseId: 'A',
    onSelectProduct() {
      added++;
    },
    haptic() {},
    scanAddCountRef: { current: 0 },
    setScanFeedback() {},
    setShowScanner() {},
    setActiveCategory() {},
    setBarcodeMatches: (value) => {
      shown = value;
    },
    setLocalSearch() {},
    setProductSearch() {},
  };
  await actual('mobile/src/components/ProductPickerModal.tsx', 'handleBarCodeScanned', scope)({ data: 'shared' });
  assert.equal(params.warehouseId, 'A');
  assert.equal(added, 0);
  assert.deepEqual(shown, [a, b]);
});
test('web complete catalogue covers beyond10000 and server-ranked search results are never narrowed locally', async () => {
  const items = Array.from({ length: 10007 }, (_, i) => ({
    ...a,
    id: `p${i}`,
    brand: 'Бренд',
    article: `SKU${i}`,
    internalBarcode: `AX${String(i).padStart(8, '0')}`,
  }));
  let requests = 0;
  const context = {
    activeWarehouseId: 'A',
    loadProductCatalog,
    productsApi: {
      getAll: async (params) => {
        requests++;
        const offset = (params.page - 1) * params.limit;
        return {
          data: {
            data: items.slice(offset, offset + params.limit),
            total: items.length,
            page: params.page,
            limit: params.limit,
          },
        };
      },
    },
  };
  const full = await actual('frontend/src/pages/ProductsPage.tsx', null, context, 'products')();
  assert.equal(full.data.length, 10007);
  assert.equal(full.data.at(-1).article, 'SKU10006');
  assert.equal(requests, 11);
  const server = [{ ...b, name: 'Серверный нечёткий результат' }];
  const filtered = actual('frontend/src/pages/ProductsPage.tsx', 'flatResults', {
    barcodeMatches: null,
    searchText: 'опечатка',
    searchQuery: { data: server },
    showingCellFilter: false,
    allProducts: [],
    cellParam: '',
    useMemo: (fn) => fn(),
  });
  assert.deepEqual(filtered, server);
  const fields = fs.readFileSync(path.join(root, 'mobile/src/constants/productFields.ts'), 'utf8');
  for (const field of ['article', 'brand', 'internalBarcode', 'assemblyId']) assert.ok(fields.includes(field));
});
