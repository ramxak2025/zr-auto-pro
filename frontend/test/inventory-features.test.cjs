const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');

function load(relative, mocks = {}, globals = {}) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs
      .readFileSync(filename, 'utf8')
      .replaceAll('import.meta.env.VITE_API_URL', JSON.stringify('https://api.stage.example/api')),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const localRequire = (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('.')) {
      const candidate = path.resolve(path.dirname(filename), name);
      for (const extension of ['.ts', '.tsx'])
        if (fs.existsSync(candidate + extension))
          return load(path.relative(root, candidate + extension), mocks, globals);
    }
    return require(name);
  };
  Function(
    'require',
    'module',
    'exports',
    ...Object.keys(globals),
    code,
  )(localRequire, module, module.exports, ...Object.values(globals));
  return module.exports;
}

test('public card request omits credentials and projects only exact token-proxy images at the API origin', async () => {
  const token = 'a'.repeat(43);
  let request;
  const { loadPublicProduct } = load(
    'frontend/src/api/publicProducts.ts',
    {},
    {
      window: { location: { origin: 'https://web.stage.example' } },
      fetch: async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          json: async () => ({
            name: 'Фара',
            sellPrice: 123.45,
            costPrice: 10,
            stock: 20,
            tenantId: 'secret',
            photos: [
              `/api/public/products/${token}/images/0`,
              'https://foreign/image.jpg',
              '/api/uploads/company/photo.jpg',
              `/api/public/products/${'b'.repeat(43)}/images/1`,
            ],
          }),
        };
      },
    },
  );
  assert.deepEqual(await loadPublicProduct(token), {
    name: 'Фара',
    sellPrice: 123.45,
    photos: [`https://api.stage.example/api/public/products/${token}/images/0`],
  });
  assert.equal(request.url, `https://api.stage.example/api/public/products/${token}`);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.headers, undefined);
});

test('invalid and revoked public links fail without any authenticated client', async () => {
  let calls = 0;
  const { loadPublicProduct } = load(
    'frontend/src/api/publicProducts.ts',
    {},
    {
      window: { location: { origin: 'https://web.stage.example' } },
      fetch: async () => {
        calls++;
        return { ok: false, status: 404 };
      },
    },
  );
  await assert.rejects(loadPublicProduct('invalid'), /недоступна/);
  assert.equal(calls, 0);
  await assert.rejects(loadPublicProduct('a'.repeat(43)), /отозвана/);
  assert.equal(calls, 1);
});

test('photo editor bounds four slots and exposes removal and explicit cover promotion', () => {
  const Editor = load('frontend/src/components/warehouse/ProductPhotoEditor.tsx', {
    '../ImageUpload': { __esModule: true, default: 'image-upload' },
    '../../ui/Button': { Button: 'button' },
  }).default;
  const photos = ['/a', '/b', '/c', '/d'];
  const changes = [];
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(Editor, { photos, onChange: (value) => changes.push(value) }));
  });
  try {
    const uploads = tree.root.findAllByType('image-upload');
    assert.equal(uploads.length, 4, 'there must be no fifth add slot');
    Renderer.act(() => uploads[1].props.onClear());
    assert.deepEqual(changes.pop(), ['/a', '/c', '/d']);
    Renderer.act(() => tree.root.findAllByType('button')[1].props.onClick());
    assert.deepEqual(changes.pop(), ['/c', '/a', '/b', '/d']);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('web used intake dispatches atomic quantity without stock/bundle fields and retains request ID on retry', async () => {
  const filename = 'frontend/src/pages/ProductsPage.tsx';
  const text = fs.readFileSync(path.join(root, filename), 'utf8');
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'createMutation')
      callback = node.initializer.arguments[0].properties.find(
        (property) => property.name.getText(source) === 'mutationFn',
      ).initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  const code = ts.transpileModule(`const actual = ${callback.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sent = [];
  const usedRequestId = { current: null };
  const api = {
    usedIntake: async (body) => {
      sent.push(body);
      return { data: { product: { id: 'saved' } } };
    },
    create: () => assert.fail('must not use ordinary create'),
  };
  const actual = Function(
    'productsApi',
    'activeWarehouseKind',
    'usedRequestId',
    'newUuid',
    `${code}; return actual;`,
  )(api, 'used', usedRequestId, () => 'request-id');
  const body = {
    name: 'Фара',
    stock: 2.5,
    costPrice: 20.5,
    sellPrice: 50,
    isBundle: false,
    bundleItems: [],
    photos: ['/one'],
  };
  await actual(body);
  await actual(body);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], {
    name: 'Фара',
    quantity: 2.5,
    costPrice: 20.5,
    sellPrice: 50,
    photos: ['/one'],
    requestId: 'request-id',
  });
  assert.equal(sent[1].requestId, sent[0].requestId);
});

test('service worker bypasses capability cards/images, direct used intake and share mutations', () => {
  const listeners = new Map();
  const sandbox = {
    URL,
    Request,
    Response,
    console,
    self: {
      location: { origin: 'https://stage.example' },
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'frontend/public/sw.js'), 'utf8'), sandbox);
  for (const [method, suffix] of [
    ['GET', '/public/products/token'],
    ['GET', '/public/products/token/images/0'],
    ['POST', '/products/used-intake'],
    ['POST', '/products/product/share'],
    ['DELETE', '/products/product/share'],
  ]) {
    let intercepted = false;
    listeners.get('fetch')({
      request: new Request(`https://stage.example/api${suffix}`, { method }),
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, `${method} ${suffix} must go directly to the network`);
  }
});

function reviewHarness() {
  const storage = new Map();
  const logs = {
    deletePage: [],
    review: [],
    manual: [],
    prepare: [],
    upload: [],
    extract: [],
    map: [],
    confirm: [],
    assemble: [],
    recompose: [],
    disassemble: [],
    updateRecipe: [],
    completed: [],
  };
  const product = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Фильтр',
    unit: 'шт',
    warehouseId: 'main',
    costPrice: 10,
    sellPrice: 100,
    stock: 50,
    minStock: 0,
  };
  const warehouses = [
    { id: 'main', name: 'Основной', kind: 'main' },
    { id: 'used', name: 'Б/У', kind: 'used' },
  ];
  const docId = '11111111-1111-4111-8111-111111111111';
  let doc = {
    id: docId,
    supplierId: 'supplier',
    version: 1,
    status: 'draft',
    date: null,
    orderId: null,
    comparison: null,
    pages: [],
    lines: [],
    warnings: [],
    deliveryId: null,
    duplicateOf: null,
    errorCode: null,
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const state = { networkDown: false, failConfirm: false, failManual: false, failDisassemble: false };
  let sequence = 0;
  const api = {
    supplierInvoicesApi: {
      prepare: async (...args) => {
        logs.prepare.push(args);
        return { data: clone(doc) };
      },
      uploadPage: async (...args) => {
        logs.upload.push(args);
        doc = {
          ...doc,
          version: 2,
          pages: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              index: 0,
              url: `/api/supplier-invoices/${docId}/pages/44444444-4444-4444-8444-444444444444`,
            },
          ],
        };
        return { data: clone(doc) };
      },
      deletePage: async (id, pageId, version) => {
        logs.deletePage.push({ id, pageId, version });
        doc = {
          ...doc,
          version: doc.version + 1,
          pages: doc.pages.filter((page) => page.id !== pageId),
          status: 'draft',
          lines: [],
        };
        return { data: clone(doc) };
      },
      extract: async (...args) => {
        logs.extract.push(args);
        doc = {
          ...doc,
          version: 3,
          status: 'review',
          date: '2026-10-25',
          lines: [
            {
              id: 'line',
              name: 'Строка поставщика',
              sku: 'A-1',
              unit: 'уп',
              quantity: 1,
              price: 12.5,
              productId: null,
              suggestedProductId: product.id,
              warnings: [],
            },
          ],
        };
        return { data: clone(doc) };
      },
      get: async () => {
        if (state.networkDown) throw new Error('fixture offline');
        return { data: clone(doc) };
      },
      mapLine: async (id, lineId, body) => {
        logs.map.push({ id, lineId, body });
        doc = {
          ...doc,
          version: doc.version + 1,
          lines: doc.lines.map((line) => (line.id === lineId ? { ...line, productId: body.productId } : line)),
        };
        return { data: clone(doc) };
      },
      setOrder: async () => ({ data: clone(doc) }),
      reviewLine: async (id, lineId, body) => {
        logs.review.push({ id, lineId, body });
        doc = {
          ...doc,
          version: doc.version + 1,
          lines: doc.lines.map((line) => (line.id === lineId ? { ...line, excluded: body.excluded } : line)),
        };
        return { data: clone(doc) };
      },
      addManualLine: async (id, body) => {
        logs.manual.push({ id, body: clone(body) });
        if (state.failManual) {
          state.networkDown = true;
          throw new Error('fixture offline');
        }
        if (!doc.lines.some((line) => line.manualRequestId === body.requestId))
          doc = {
            ...doc,
            status: 'review',
            version: doc.version + 1,
            lines: [
              ...doc.lines,
              {
                id: 'manual-row',
                origin: 'manual',
                excluded: false,
                manualRequestId: body.requestId,
                name: product.name,
                sku: '',
                unit: product.unit,
                productUnit: product.unit,
                unitMismatch: false,
                unitConfirmed: true,
                quantity: body.quantity,
                price: body.price,
                productId: body.productId,
                suggestedProductId: null,
                warnings: [],
              },
            ],
          };
        return { data: clone(doc) };
      },
      confirm: async (id, body) => {
        logs.confirm.push({ id, body: clone(body) });
        if (state.failConfirm) {
          state.networkDown = true;
          throw new Error('fixture offline');
        }
        return { data: { id: 'delivery' } };
      },
    },
    productKitsApi: {
      updateRecipe: async (id, body) => {
        logs.updateRecipe.push({ id, body: clone(body) });
        return { data: { id, version: 2 } };
      },
      recipe: async (id, version) => ({
        data: {
          id,
          version: version ?? 2,
          name: 'Старый состав',
          components: [{ productId: product.id, quantity: 1.5 }],
        },
      }),
      get: async () => ({ data: kit }),
      assemble: async (body) => {
        logs.assemble.push(clone(body));
        return { data: { productId: 'assembled-product' } };
      },
      recompose: async (id, body) => {
        logs.recompose.push({ id, body: clone(body) });
        return { data: { productId: 'new-batch' } };
      },
      disassemble: async (...args) => {
        logs.disassemble.push(args);
        if (state.failDisassemble) {
          kit.quantity = 0;
          throw new Error('fixture offline');
        }
        return { data: {} };
      },
    },
    productsApi: {
      getAll: async () => ({ data: [product] }),
      getById: async () => ({ data: product }),
      create: () => assert.fail('review must not create an ordinary product'),
    },
    warehousesApi: { list: async () => ({ data: warehouses }) },
    purchaseOrdersApi: { list: async () => ({ data: { data: [] } }) },
  };
  const kit = {
    id: 'assembly',
    productId: 'kit-product',
    name: 'Комплект',
    revision: 7,
    quantity: 3,
    assembledQuantity: 3,
    sellPrice: 200,
    warehouseId: 'main',
    components: [{ productId: product.id, name: product.name, quantity: 1, costPrice: 10 }],
  };
  const mocks = {
    '../../api/services': api,
    '../../api/axios': {
      createSessionBoundClient: () => ({ get: async () => ({ data: new Blob(['private'], { type: 'image/jpeg' }) }) }),
    },
    '../../utils/sessionToken': { readStoredToken: () => 'owned-session' },
    '../../utils/uuid': { newUuid: () => `request-${++sequence}` },
    '../../contexts/AuthContext': {
      useAuth: () => ({
        user: { id: 'owner', tenantId: 'tenant', currentPointId: 'point' },
        hasPermission: () => true,
      }),
    },
    '../../hooks/useTenantTimezone': { useTenantTimezone: () => 'Europe/Moscow' },
    '@tanstack/react-query': {
      useQueryClient: () => ({ invalidateQueries: async () => {} }),
      useQuery: ({ queryKey, enabled }) => ({
        data:
          enabled === false
            ? undefined
            : queryKey[0] === 'products'
              ? [
                  product,
                  { ...product, id: 'used-product', warehouseId: 'used' },
                  { ...product, id: 'physical-kit', assemblyId: 'assembly' },
                ]
              : queryKey[0] === 'warehouses'
                ? warehouses
                : queryKey[0] === 'kit-recipe'
                  ? {
                      id: queryKey[1],
                      version: queryKey[2] ?? 2,
                      name: 'Старый состав',
                      components: [{ productId: product.id, quantity: 1.5 }],
                    }
                  : queryKey[0] === 'product-kit'
                    ? kit
                    : [],
        isPending: false,
        isLoading: false,
        isError: false,
        refetch: async () => {},
      }),
    },
    'lucide-react': { AlertTriangle: 'icon', Camera: 'icon', FileText: 'icon', Plus: 'icon', Trash2: 'icon' },
    'react-hot-toast': { __esModule: true, default: { success() {}, error() {} } },
    '../Modal': {
      __esModule: true,
      default: (props) =>
        props.isOpen ? React.createElement('modal', { title: props.title }, props.children, props.footer) : null,
    },
    '../ConfirmDialog': {
      __esModule: true,
      default: (props) =>
        props.isOpen
          ? React.createElement(
              'confirmation',
              {},
              React.createElement('button', { onClick: props.onClose }, 'Отмена удаления'),
              React.createElement(
                'button',
                {
                  onClick: () => {
                    props.onConfirm();
                    props.onClose();
                  },
                },
                props.confirmText,
              ),
            )
          : null,
    },
    '../checks/ProductPickerDrawer': {
      __esModule: true,
      default: (props) => (props.open ? React.createElement('picker', props) : null),
    },
    '../../ui': {
      Button: 'button',
      Input: 'input',
      Select: 'select',
      Badge: 'badge',
      Money: 'money',
      Field: ({ children, label, hint }) => React.createElement('field', {}, label, children, hint),
    },
  };
  const globals = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    window: { setInterval: () => 1, clearInterval() {} },
  };
  return { api, mocks, globals, logs, state, product, kit, storage };
}
const treeText = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(treeText).join(''));
async function uiClick(tree, label) {
  const button = tree.root.findAllByType('button').find((node) => treeText(node) === label);
  assert.ok(button, label);
  await Renderer.act(async () => {
    button.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
}
async function uiValue(tree, label, value) {
  const input = tree.root.findAllByType('input').find((node) => node.props['aria-label'] === label);
  assert.ok(input, label);
  await Renderer.act(async () => input.props.onChange({ target: { value } }));
}
async function uploadAndRecognize(tree) {
  const file = new Blob(['fixture photo'], { type: 'image/jpeg' });
  await Renderer.act(async () => {
    tree.root
      .findAllByType('input')
      .find((node) => node.props.type === 'file')
      .props.onChange({ target: { files: [file], value: 'selected' } });
    await new Promise((resolve) => setImmediate(resolve));
  });
  await uiClick(tree, 'Распознать');
}

test('actual OCR review requires explicit catalog mapping, preserves edited document date and never receives before final confirmation', async () => {
  const h = reviewHarness();
  const Dialog = load('frontend/src/components/supplierInvoices/SupplierInvoiceDialog.tsx', h.mocks, h.globals).default;
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(
      React.createElement(Dialog, {
        isOpen: true,
        supplierId: 'supplier',
        supplierName: 'Поставщик',
        onClose() {},
        onReceived: (id) => h.logs.completed.push(id),
      }),
    );
  });
  try {
    await uploadAndRecognize(tree);
    assert.equal(h.logs.confirm.length, 0);
    await uiClick(tree, 'Проверить и принять');
    assert.match(treeText(tree.root), /Выберите доступный товар/);
    assert.equal(h.logs.confirm.length, 0);
    await uiValue(tree, 'Дата документа', '2026-10-20');
    await uiClick(tree, 'Выбрать товар из каталога');
    const picker = tree.root.findByType('picker');
    assert.deepEqual(
      picker.props.products.map((product) => product.id),
      [h.product.id],
      'used stock and physical kits must not enter receipts',
    );
    await Renderer.act(async () => {
      picker.props.onSelectProduct(h.product);
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(h.logs.map[0].body.remember, false, 'no alias is stored implicitly');
    assert.equal(
      tree.root.findAllByType('input').find((node) => node.props['aria-label'] === 'Дата документа').props.value,
      '2026-10-20',
    );
    await uiClick(tree, 'Запомнить название у поставщика');
    assert.equal(h.logs.map[1].body.remember, true);
    await uiValue(tree, 'Количество — Строка поставщика', '12,5');
    await uiClick(tree, 'Проверить и принять');
    assert.equal(h.logs.confirm.length, 0, 'unit mismatch acknowledgement must block confirmation');
    await Renderer.act(async () =>
      tree.root
        .findAllByType('input')
        .find((node) => node.props['aria-label'] === 'Количество и цены проверены в единицах склада')
        .props.onChange({ target: { checked: true } }),
    );
    await uiClick(tree, 'Проверить и принять');
    assert.equal(h.logs.confirm.length, 0);
    await uiClick(tree, 'Принять в долг');
    assert.equal(h.logs.confirm.length, 1);
    const body = h.logs.confirm[0].body;
    assert.equal(body.date, '2026-10-20');
    assert.equal(body.receivedAt, undefined);
    assert.equal(body.items[0].quantity, 12.5);
    assert.equal(body.items[0].sellPrice, undefined);
    assert.deepEqual(h.logs.completed, ['delivery']);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('actual OCR confirmation persists its exact request for explicit retry after closing an uncertain result', async () => {
  const h = reviewHarness();
  const Dialog = load('frontend/src/components/supplierInvoices/SupplierInvoiceDialog.tsx', h.mocks, h.globals).default;
  const props = {
    isOpen: true,
    supplierId: 'supplier',
    supplierName: 'Поставщик',
    onClose() {},
    onReceived: (id) => h.logs.completed.push(id),
  };
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(Dialog, props));
  });
  try {
    await uploadAndRecognize(tree);
    await uiClick(tree, 'Подтвердить: Фильтр');
    await Renderer.act(async () =>
      tree.root
        .findAllByType('input')
        .find((node) => node.props['aria-label'] === 'Количество и цены проверены в единицах склада')
        .props.onChange({ target: { checked: true } }),
    );
    await uiClick(tree, 'Проверить и принять');
    h.state.failConfirm = true;
    await uiClick(tree, 'Принять в долг');
    const first = h.logs.confirm[0].body;
    Renderer.act(() => tree.unmount());
    h.state.networkDown = false;
    h.state.failConfirm = false;
    await Renderer.act(async () => {
      tree = Renderer.create(React.createElement(Dialog, props));
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(h.logs.confirm.length, 1, 'restoring a draft must not replay the POST');
    await uiClick(tree, 'Повторить приёмку');
    await uiClick(tree, 'Принять в долг');
    assert.equal(h.logs.confirm.length, 2);
    assert.deepEqual(h.logs.confirm[1].body, first);
    assert.deepEqual(h.logs.completed, ['delivery']);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('actual kit composer reuses the cash picker and only mutates after confirmation with exact fractional components', async () => {
  const h = reviewHarness();
  const Composer = load('frontend/src/components/warehouse/ProductKitComposer.tsx', h.mocks, h.globals).default;
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(
      React.createElement(Composer, {
        warehouseId: 'main',
        onClose() {},
        onCompleted: (id) => h.logs.completed.push(id),
      }),
    );
  });
  try {
    await uiValue(tree, 'Название комплекта', 'Комплект ТО');
    await uiValue(tree, 'Количество комплектов', '2');
    await uiValue(tree, 'Цена комплекта', '123,45');
    await uiClick(tree, 'Добавить компонент');
    const picker = tree.root.findByType('picker');
    assert.ok(picker.props.products.every((product) => !product.assemblyId));
    await Renderer.act(async () => picker.props.onSelectProduct(h.product));
    const reviewBeforeLastEdit = tree.root.findAllByType('button').find((node) => treeText(node) === 'Проверить сборку')
      .props.onClick;
    await uiValue(tree, 'Количество компонента — Фильтр', '1,5');
    assert.equal(h.logs.assemble.length, 0);
    await Renderer.act(async () => reviewBeforeLastEdit());
    assert.equal(h.logs.assemble.length, 0);
    await uiClick(tree, 'Подтвердить сборку');
    assert.equal(h.logs.assemble.length, 1);
    assert.deepEqual(h.logs.assemble[0].components, [{ productId: h.product.id, quantity: 1.5 }]);
    assert.equal(h.logs.assemble[0].quantity, 2);
    assert.equal(h.logs.assemble[0].sellPrice, 123.45);
    assert.deepEqual(h.logs.completed, ['assembled-product']);
    assert.equal(h.logs.disassemble.length, 0);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('invoice page deletion is versioned and requires its own explicit confirmation before extraction', async () => {
  const h = reviewHarness();
  const Dialog = load('frontend/src/components/supplierInvoices/SupplierInvoiceDialog.tsx', h.mocks, h.globals).default;
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(
      React.createElement(Dialog, {
        isOpen: true,
        supplierId: 'supplier',
        supplierName: 'Поставщик',
        onClose() {},
        onReceived() {},
      }),
    );
  });
  try {
    const file = new Blob(['fixture photo'], { type: 'image/jpeg' });
    await Renderer.act(async () => {
      tree.root
        .findAllByType('input')
        .find((node) => node.props.type === 'file')
        .props.onChange({ target: { files: [file], value: 'selected' } });
      await new Promise((resolve) => setImmediate(resolve));
    });
    await uiClick(tree, 'Удалить');
    assert.equal(h.logs.deletePage.length, 0);
    await uiClick(tree, 'Отмена удаления');
    assert.equal(h.logs.deletePage.length, 0);
    await uiClick(tree, 'Удалить');
    await uiClick(tree, 'Удалить страницу');
    assert.equal(h.logs.deletePage.length, 1);
    assert.equal(h.logs.deletePage[0].version, 2);
    assert.equal(h.logs.extract.length, 0);
    assert.equal(h.logs.confirm.length, 0);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('OCR noise can be excluded/restored without a fake SKU and an uncertain manual row retries exactly once with no alias learning', async () => {
  const h = reviewHarness();
  const Dialog = load('frontend/src/components/supplierInvoices/SupplierInvoiceDialog.tsx', h.mocks, h.globals).default;
  const props = {
    isOpen: true,
    supplierId: 'supplier',
    supplierName: 'Поставщик',
    onClose() {},
    onReceived: (id) => h.logs.completed.push(id),
  };
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(Dialog, props));
  });
  try {
    await uploadAndRecognize(tree);
    await uiClick(tree, 'Исключить строку');
    assert.equal(h.logs.confirm.length, 0);
    assert.match(treeText(tree.root), /Исключённые строки/);
    await uiClick(tree, 'Вернуть строку');
    assert.match(treeText(tree.root), /Выбрать товар из каталога/);
    await uiClick(tree, 'Исключить строку');
    await uiClick(tree, 'Добавить товар вручную');
    await Renderer.act(async () => tree.root.findByType('picker').props.onSelectProduct(h.product));
    await uiValue(tree, 'Количество добавляемого товара', '2,5');
    await uiValue(tree, 'Цена добавляемого товара', '10,50');
    assert.equal(h.logs.manual.length, 0);
    h.state.failManual = true;
    await uiClick(tree, 'Добавить строку');
    assert.equal(h.logs.manual.length, 1);
    const first = h.logs.manual[0].body;
    Renderer.act(() => tree.unmount());
    h.state.failManual = false;
    h.state.networkDown = false;
    await Renderer.act(async () => {
      tree = Renderer.create(React.createElement(Dialog, props));
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(h.logs.manual.length, 1, 'restoring a draft cannot replay manual addition automatically');
    await uiClick(tree, 'Повторить добавление');
    assert.deepEqual(h.logs.manual[1].body, first);
    assert.equal(h.logs.map.length, 0, 'manual canonical rows must not learn supplier aliases');
    assert.match(treeText(tree.root), /Добавлено вручную/);
    await uiClick(tree, 'Проверить и принять');
    await uiClick(tree, 'Принять в долг');
    assert.equal(h.logs.confirm[0].body.items.length, 1);
    assert.equal(h.logs.confirm[0].body.items[0].lineId, 'manual-row');
    assert.equal(h.logs.confirm[0].body.items[0].quantity, 2.5);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('recomposition submits one versioned new batch without any client-side disassembly', async () => {
  const h = reviewHarness();
  const Composer = load('frontend/src/components/warehouse/ProductKitComposer.tsx', h.mocks, h.globals).default;
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(
      React.createElement(Composer, {
        warehouseId: 'main',
        productId: 'kit-product',
        onClose() {},
        onCompleted: (id) => h.logs.completed.push(id),
      }),
    );
  });
  try {
    await uiValue(tree, 'Количество комплектов', '2');
    await uiValue(tree, 'Количество компонента — Фильтр', '1,5');
    await uiClick(tree, 'Проверить новый состав');
    assert.equal(h.logs.recompose.length, 0);
    await uiClick(tree, 'Подтвердить сборку');
    assert.equal(h.logs.recompose.length, 1);
    assert.equal(h.logs.recompose[0].body.expectedRevision, 7);
    assert.equal(h.logs.recompose[0].body.quantity, 2);
    assert.deepEqual(h.logs.recompose[0].body.components, [{ productId: h.product.id, quantity: 1.5 }]);
    assert.equal(h.logs.disassemble.length, 0);
    assert.deepEqual(h.logs.completed, ['new-batch']);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('an uncertain disassembly retains its exact request across close even if the returned stock is already zero', async () => {
  const h = reviewHarness();
  const Panel = load('frontend/src/components/warehouse/ProductKitPanel.tsx', h.mocks, h.globals).default;
  const props = { product: { ...h.product, id: 'kit-product', assemblyId: 'assembly' }, canManage: true };
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(Panel, props));
  });
  try {
    await uiClick(tree, 'Разобрать комплект');
    await uiValue(tree, 'Количество комплектов к разборке', '2');
    assert.equal(h.logs.disassemble.length, 0);
    h.state.failDisassemble = true;
    await uiClick(tree, 'Подтвердить разборку');
    const first = h.logs.disassemble[0];
    Renderer.act(() => tree.unmount());
    h.state.failDisassemble = false;
    await Renderer.act(async () => {
      tree = Renderer.create(React.createElement(Panel, props));
    });
    const retry = tree.root.findAllByType('button').find((node) => treeText(node) === 'Повторить разборку');
    assert.ok(retry);
    assert.equal(retry.props.disabled, false);
    await uiClick(tree, 'Повторить разборку');
    await uiClick(tree, 'Подтвердить разборку');
    assert.deepEqual(h.logs.disassemble[1], first);
    assert.equal(h.logs.disassemble.length, 2);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('real web product detail opens label settings and generates a server internal code without replacing factory code', async () => {
  const product = {
    id: 'product',
    name: 'Фильтр',
    sellPrice: 100,
    costPrice: 20,
    stock: 3,
    minStock: 0,
    barcode: '4601234567893',
    internalBarcode: null,
    photos: [],
    unit: 'шт',
    warehouseId: 'main',
  };
  const calls = [],
    changes = [];
  const Details = load('frontend/src/components/warehouse/ProductDetailModal.tsx', {
    '@tanstack/react-query': {
      useQueryClient: () => ({ invalidateQueries() {} }),
      useQuery: () => ({ data: [], isPending: false }),
      useInfiniteQuery: () => ({ data: { pages: [{ data: [] }] }, isPending: false }),
    },
    'react-router-dom': { useNavigate: () => () => {} },
    '../../contexts/AuthContext': { useAuth: () => ({ hasPermission: () => true }) },
    '../../api/services': {
      productsApi: {
        internalBarcodes: async (ids) => {
          calls.push(ids);
          return { data: { products: [{ id: 'product', internalBarcode: 'AX00000001' }] } };
        },
      },
      stockMovementsApi: {},
    },
    '../Modal': { __esModule: true, default: 'modal' },
    '../products/ProductLabelPrint': { __esModule: true, default: 'label-print' },
    '../QueryState': { __esModule: true, default: 'query-state' },
    './ProductGallery': { __esModule: true, default: 'gallery' },
    './ProductShareButton': { __esModule: true, default: 'share-button' },
    './ProductKitPanel': { __esModule: true, default: 'kit-panel' },
    './StorageCellBadge': { __esModule: true, default: 'cell-badge' },
    '../../ui/Button': { Button: 'button' },
    '../../ui/Badge': { Badge: 'badge' },
    '../../ui/Money': { Money: 'money' },
    '../../ui/Skeleton': { Skeleton: 'skeleton' },
    '../../ui/Tabs': { Tabs: 'tabs', TabPanel: 'tab-panel' },
    '../../hooks/useTenantTimezone': { useTenantTimezone: () => 'Europe/Moscow' },
  }).default;
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(Details, {
        product,
        canManage: true,
        onClose() {},
        onEdit() {},
        onWriteoff() {},
        onInventory() {},
        onDelete() {},
        onProductChanged: (value) => changes.push(value),
      }),
    );
  });
  try {
    const button = tree.root.findAllByType('button').find((node) => node.children.join('') === 'Этикетки');
    assert.ok(button);
    Renderer.act(() => button.props.onClick());
    const labels = tree.root.findByType('label-print');
    assert.equal(labels.props.open, true);
    assert.equal(labels.props.products[0].id, 'product');
    await Renderer.act(async () => labels.props.onGenerateInternal(['product']));
    assert.deepEqual(calls, [['product']]);
    assert.equal(changes[0].internalBarcode, 'AX00000001');
    assert.equal(changes[0].barcode, '4601234567893');
    assert.equal(product.barcode, '4601234567893');
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('real web barcode lookup passes explicit warehouse, preserves ambiguity and ignores a cancelled result', async () => {
  const matches = [
    { id: 'a', name: 'Фильтр' },
    { id: 'b', name: 'Фильтр' },
  ];
  let respond;
  const calls = [],
    results = [];
  const Lookup = load('frontend/src/components/products/BarcodeLookupButton.tsx', {
    '../../api/services': {
      productsApi: {
        lookupBarcode: (params) => {
          calls.push(params);
          return new Promise((resolve) => {
            respond = () => resolve({ data: { status: 'ambiguous', matches, total: 2, page: 1, limit: 100 } });
          });
        },
      },
    },
    '../../ui/Button': { Button: 'button' },
    '../../ui/Input': { Input: 'input' },
    '../../ui/Field': { Field: 'field' },
  }).default;
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(Lookup, { warehouseId: 'A', onResolved: (result) => results.push(result) }),
    );
  });
  const toggle = () => tree.root.findAllByType('button').find((node) => node.children.join('') === 'Штрихкод');
  const submit = () => tree.root.findByType('form').props.onSubmit({ preventDefault() {}, stopPropagation() {} });
  try {
    Renderer.act(() => toggle().props.onClick());
    Renderer.act(() => tree.root.findByType('input').props.onChange({ target: { value: 'AX00000001' } }));
    Renderer.act(submit);
    assert.equal(calls[0].warehouseId, 'A');
    assert.equal(calls[0].barcode, 'AX00000001');
    Renderer.act(() => toggle().props.onClick());
    await Renderer.act(async () => {
      respond();
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.deepEqual(results, [], 'closing the field cancels its pending lookup continuation');
    Renderer.act(() => toggle().props.onClick());
    Renderer.act(() => tree.root.findByType('input').props.onChange({ target: { value: 'factory' } }));
    Renderer.act(submit);
    await Renderer.act(async () => {
      respond();
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(results[0].status, 'ambiguous');
    assert.deepEqual(results[0].matches, matches);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('actual recipe rebuild pins the old immutable version after newer versions exist and never creates stock before confirmation', async () => {
  const h = reviewHarness();
  const Composer = load('frontend/src/components/warehouse/ProductKitComposer.tsx', h.mocks, h.globals).default;
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(
      React.createElement(Composer, {
        warehouseId: 'main',
        recipeId: 'saved-recipe',
        recipeVersion: 1,
        onClose() {},
        onCompleted() {},
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
  });
  try {
    assert.equal(h.logs.assemble.length, 0);
    const field = tree.root
      .findAllByType('input')
      .find((node) => node.props['aria-label'] === 'Количество компонента — Фильтр');
    assert.equal(field.props.value, '1.5');
    assert.equal(field.props.disabled, true);
    await uiValue(tree, 'Количество комплектов', '3');
    await uiValue(tree, 'Цена комплекта', '222');
    await uiClick(tree, 'Проверить сборку');
    assert.equal(h.logs.assemble.length, 0);
    await uiClick(tree, 'Подтвердить сборку');
    assert.equal(h.logs.assemble.length, 1);
    assert.equal(h.logs.assemble[0].recipeId, 'saved-recipe');
    assert.equal(h.logs.assemble[0].recipeVersion, 1);
    assert.equal(h.logs.assemble[0].quantity, 3);
    assert.deepEqual(h.logs.assemble[0].components, [{ productId: h.product.id, quantity: 1.5 }]);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('actual canonical batch picker refuses partial quantities and submits explicit allocation without truncation', async () => {
  const h = reviewHarness();
  const Picker = load(
    'frontend/src/components/checks/TemplateKitBatchPicker.tsx',
    { ...h.mocks, './ProductPickerDrawer': h.mocks['../checks/ProductPickerDrawer'] },
    h.globals,
  ).default;
  const results = [];
  const products = [
    { ...h.product, id: 'a', assemblyId: 'a', stock: 2, sellPrice: 100 },
    { ...h.product, id: 'b', assemblyId: 'b', stock: 2, sellPrice: 200 },
  ];
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(
      React.createElement(Picker, {
        request: { line: { kind: 'kitRecipe', name: 'ТО', quantity: 3, kitRecipeVersion: 1 }, candidates: products },
        onResolve: (value) => results.push(value),
      }),
    );
  });
  try {
    await uiClick(tree, 'Выбрать через каталог кассы');
    await Renderer.act(async () => tree.root.findByType('picker').props.onSelectProduct(products[0]));
    await uiClick(tree, 'Применить весь шаблон');
    assert.equal(results.length, 0);
    await uiValue(tree, 'Количество партии — a', '3');
    await uiClick(tree, 'Применить весь шаблон');
    assert.equal(results.length, 0, 'must not truncate 3 to stock2');
    await uiValue(tree, 'Количество партии — a', '1');
    await uiClick(tree, 'Выбрать через каталог кассы');
    await Renderer.act(async () => tree.root.findByType('picker').props.onSelectProduct(products[1]));
    await uiValue(tree, 'Количество партии — b', '2');
    await uiClick(tree, 'Применить весь шаблон');
    assert.deepEqual(results, [
      [
        { productId: 'a', quantity: 1 },
        { productId: 'b', quantity: 2 },
      ],
    ]);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('actual physical product form saves metadata with empty projected composition and omits read-only assembly fields', () => {
  const file = path.join(root, 'frontend/src/components/warehouse/ProductFormModal.tsx');
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submit;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleSubmit') submit = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const ctx = {
    product: { id: 'kit', assemblyId: 'assembly', isBundle: true, costPrice: 10, sellPrice: 20 },
    isBundle: true,
    bundleItems: [],
    name: 'Новое имя',
    brand: '',
    article: '',
    packaging: '',
    category: '',
    photos: [],
    costPrice: '0.000001',
    sellPrice: '20',
    stock: '2',
    minStock: '0',
    unit: 'компл',
    barcode: '',
    warrantyDays: '',
    storageCellId: '',
    initialCellId: '',
    defaultWarehouseId: 'main',
    confirmPrices: false,
    usedIntake: false,
    uploadingPhotos: false,
    isLoading: false,
    productPhotoPatch: () => ({ photos: [], photo: null }),
    toNumberOrZero: Number,
  };
  let result;
  const errors = [];
  ctx.onSubmit = (value) => (result = value);
  ctx.toast = { error: (value) => errors.push(value) };
  const code = ts.transpileModule(submit.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const action = new Function(...Object.keys(ctx), `${code};return handleSubmit;`)(...Object.values(ctx));
  action({ preventDefault() {} });
  assert.deepEqual(errors, []);
  assert.equal(result.name, 'Новое имя');
  for (const field of ['stock', 'costPrice', 'isBundle', 'bundleItems']) assert.equal(field in result, false, field);
});

test('actual saved-composition edit creates version2 through CAS without changing packed stock, price, or pinned templates', async () => {
  const h = reviewHarness();
  let saved = 0;
  const Composer = load('frontend/src/components/warehouse/ProductKitComposer.tsx', h.mocks, h.globals).default;
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(
      React.createElement(Composer, {
        warehouseId: 'main',
        recipeId: 'recipe',
        recipeVersion: 1,
        recipeEdit: true,
        onCompleted() {
          assert.fail('recipe edit must not create a batch');
        },
        onRecipeSaved() {
          saved++;
        },
        onClose() {},
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
  });
  try {
    assert.equal(
      tree.root.findAllByType('input').some((node) => node.props['aria-label'] === 'Цена комплекта'),
      false,
    );
    await uiValue(tree, 'Количество компонента — Фильтр', '2,5');
    await uiClick(tree, 'Проверить состав');
    assert.equal(h.logs.updateRecipe.length, 0);
    await uiClick(tree, 'Сохранить новую версию');
    assert.deepEqual(h.logs.updateRecipe, [
      {
        id: 'recipe',
        body: { name: 'Старый состав', expectedVersion: 1, components: [{ productId: h.product.id, quantity: 2.5 }] },
      },
    ]);
    assert.equal(saved, 1);
    assert.equal(h.logs.assemble.length, 0);
    assert.equal(h.logs.recompose.length, 0);
    assert.equal(h.logs.disassemble.length, 0);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('scalar stock forms exclude physical assemblies and keep ordinary zero-stock inventory editable across filters', async () => {
  const kit = { id: 'kit', name: 'Комплект', assemblyId: 'assembly', isBundle: false, stock: 2, costPrice: 20 };
  const zero = { id: 'zero', name: 'Нулевой товар', stock: 0, costPrice: 10 };
  const ordinary = { id: 'ordinary', name: 'Масло', stock: 5, costPrice: 10 };
  const calls = [];
  const mocks = {
    '../VirtualList': {
      __esModule: true,
      default: ({ items, renderItem }) =>
        React.createElement(
          'div',
          null,
          items.map((p) => React.createElement(React.Fragment, { key: p.id }, renderItem(p))),
        ),
    },
    '../SearchInput': {
      __esModule: true,
      default: ({ onChange, ...props }) =>
        React.createElement('input', { ...props, 'aria-label': 'Поиск', onChange: (e) => onChange(e.target.value) }),
    },
    '../../ui/Button': { Button: 'button' },
    '../../ui/Input': { Input: 'input' },
    '../../ui/Field': { Field: 'field' },
    '../../ui/Select': { Select: 'select' },
    '../../ui/Money': { Money: 'money' },
    '../../ui/Badge': { Badge: 'badge' },
  };
  const { GlobalInventoryForm, GlobalWriteoffForm } = load(
    'frontend/src/components/warehouse/GlobalStockForms.tsx',
    mocks,
  );
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(GlobalInventoryForm, {
        products: [kit, zero, ordinary],
        categories: [],
        activePath: [],
        onClose() {},
        onSubmit: (items) => calls.push(items),
      }),
    );
  });
  try {
    assert.match(treeText(tree.root), /Собранные комплекты исключены/);
    assert.equal(
      tree.root.findAllByType('input').some((node) => node.props['aria-label'] === 'Фактический остаток — Комплект'),
      false,
    );
    await uiValue(tree, 'Фактический остаток — Нулевой товар', '1');
    await uiValue(tree, 'Поиск', 'Комплект');
    assert.match(treeText(tree.root), /Товары не найдены/);
    assert.match(treeText(tree.root), /Посчитано: 0 \/ 0 товаров/);
    await uiValue(tree, 'Поиск', 'Нулевой');
    assert.match(treeText(tree.root), /Посчитано: 1 \/ 1 товар/);
    await uiClick(tree, 'Провести инвентаризацию');
    assert.deepEqual(calls, [[{ productId: 'zero', actual: 1, reason: 'Инвентаризация' }]]);
  } finally {
    Renderer.act(() => tree.unmount());
  }
  Renderer.act(() => {
    tree = Renderer.create(
      React.createElement(GlobalWriteoffForm, { products: [kit, ordinary], onSubmit: (items) => calls.push(items) }),
    );
  });
  try {
    assert.equal(
      tree.root.findAllByType('input').some((node) => node.props['aria-label'] === 'Количество к списанию — Комплект'),
      false,
    );
    await uiValue(tree, 'Количество к списанию — Масло', '1');
    await uiClick(tree, 'Списать');
    assert.deepEqual(calls[1], [{ productId: 'ordinary', quantity: 1, reason: 'Списание' }]);
  } finally {
    Renderer.act(() => tree.unmount());
  }
});

test('single physical kit inventory and writeoff show a readonly explanation without mutation controls', () => {
  const { InventoryModal, WriteoffModal } = load('frontend/src/components/warehouse/StockOperationModals.tsx', {
    '../Modal': {
      __esModule: true,
      default: ({ children, footer }) => React.createElement('div', null, children, footer),
    },
    '../../ui/Button': { Button: 'button' },
    '../../ui/Field': { Field: 'field' },
    '../../ui/Input': { Input: 'input' },
    '../../ui/Textarea': { Textarea: 'textarea' },
    '../../ui/RadioGroup': { RadioGroup: 'radio' },
    '../../ui/SegmentedControl': { SegmentedControl: 'segmented' },
    '../../ui/Money': { Money: 'money' },
  });
  for (const Component of [InventoryModal, WriteoffModal]) {
    let tree;
    Renderer.act(() => {
      tree = Renderer.create(
        React.createElement(Component, {
          isOpen: true,
          onClose() {},
          onSubmit() {
            assert.fail('physical kit scalar mutation');
          },
          product: { id: 'kit', assemblyId: 'assembly', name: 'Комплект', stock: 2, costPrice: 20 },
          isLoading: false,
        }),
      );
    });
    try {
      assert.match(treeText(tree.root), /Остаток собранного комплекта меняется через действия комплекта/);
      assert.equal(tree.root.findAllByType('input').length, 0);
      assert.equal(tree.root.findAllByType('form').length, 0);
      assert.equal(treeText(tree.root.findByType('button')), 'Закрыть');
    } finally {
      Renderer.act(() => tree.unmount());
    }
  }
});
