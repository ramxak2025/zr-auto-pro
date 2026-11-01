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
