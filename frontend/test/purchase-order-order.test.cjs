const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const vm = require('node:vm');
const path = require('node:path');
for (const extension of ['.ts', '.tsx'])
  require.extensions[extension] = (module, filename) =>
    module._compile(
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

const React = require('react');
const Renderer = require('react-test-renderer');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const ORDER = 'b47fa84f-9795-4a1b-8068-b807c44e4c7e';
const product = { id: 'product', name: 'Масло', costPrice: 12.5 };
const draft = {
  id: ORDER,
  status: 'draft',
  supplierId: 'supplier',
  note: 'Сохранить комментарий',
  items: [{ productId: product.id, name: product.name, quantity: 2, costPrice: 12.5, receivedQuantity: 0 }],
};
let routeId, saved, saveError, orderedResponse;
const requests = [],
  errors = [],
  successes = [],
  navigations = [];
const http = {
  get: async (url) => ({
    data:
      url === '/suppliers'
        ? { data: [{ id: 'supplier', name: 'Поставщик' }] }
        : url === '/products'
          ? [product]
          : url === '/warehouses'
            ? []
            : draft,
  }),
  post: async (url, body) => {
    requests.push({ method: 'POST', url, body });
    if (saveError) throw saveError;
    return { data: url.endsWith('/order') ? orderedResponse : saved };
  },
  patch: async (url, body) => {
    requests.push({ method: 'PATCH', url, body });
    if (saveError) throw saveError;
    return { data: saved };
  },
};
const container = (p) => React.createElement('div', {}, p.children);
const ui = {
  Button: (p) => React.createElement('button', { onClick: p.onClick, disabled: p.disabled }, p.children),
  PageHeader: (p) => React.createElement('header', {}, p.actions),
  Card: container,
  CardBody: container,
  Field: container,
  CardHeader: (p) => React.createElement('div', {}, p.actions),
  Input: (p) => React.createElement('input', p),
  Textarea: (p) => React.createElement('textarea', p),
  Select: (p) =>
    React.createElement(
      'select',
      { id: p.id, value: p.value, onChange: p.onChange },
      p.options.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label)),
    ),
  DataTable: ({ rows, columns }) =>
    React.createElement(
      'div',
      {},
      rows.map((row, i) =>
        React.createElement(
          'div',
          { key: row.productId },
          columns.map((c) => React.createElement('div', { key: c.key }, c.render?.(row, i))),
        ),
      ),
    ),
  IconButton: () => null,
  EmptyState: () => null,
  SkeletonCard: () => null,
  Modal: () => null,
  QueryState: container,
};
const originalLoad = Module._load;
Module._load = function (name, parent, main) {
  if (name === './axios' && parent.filename.endsWith('/api/services.ts')) return { __esModule: true, default: http };
  if (name === '../ui') return ui;
  if (name === 'react-router-dom') return { useParams: () => ({ id: routeId }), useNavigate: () => navigate };
  if (name === '../contexts/AuthContext') return { useAuth: () => ({ hasPermission: can }) };
  if (name === 'react-hot-toast')
    return {
      __esModule: true,
      default: Object.assign(() => {}, {
        error: (message) => errors.push(message),
        success: (message) => successes.push(message),
      }),
    };
  if (name === '../components/checks/ProductPickerDrawer')
    return {
      __esModule: true,
      default: (p) => React.createElement('button', { onClick: () => p.onSelectProduct(product) }, 'Выбрать товар'),
    };
  return originalLoad.call(this, name, parent, main);
};
const can = () => true;
const navigate = (url) => navigations.push(url);
const Page = require('../src/pages/PurchaseOrderEditPage').default;
// This is the real web API wrapper, with only the HTTP transport replaced.
const { purchaseOrdersApi } = require('../src/api/services');
const { PurchaseOrderIdentityError } = require('../src/utils/purchaseOrderIdentity');
Module._load = originalLoad;

const text = (node) => (node.children ?? []).map((v) => (typeof v === 'string' ? v : text(v))).join('');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    await Renderer.act(flush);
    if (check()) return;
  }
  assert.fail('Component did not settle');
}
async function click(tree, label) {
  const button = tree.root.findAllByType('button').find((b) => text(b) === label);
  assert.ok(button, label);
  await Renderer.act(async () => button.props.onClick());
}
async function mount(id, response) {
  routeId = id;
  saved = arguments.length > 1 ? response : draft;
  saveError = null;
  orderedResponse = { ...draft, status: 'ordered' };
  for (const log of [requests, errors, successes, navigations]) log.length = 0;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(QueryClientProvider, { client }, React.createElement(Page)));
  });
  await until(() => tree.root.findAllByType('select').length > 0);
  if (!id) {
    await Renderer.act(async () => tree.root.findByType('select').props.onChange({ target: { value: 'supplier' } }));
    await click(tree, 'Выбрать товар');
  } else
    await until(() =>
      tree.root.findAllByType('input').some((n) => n.props['aria-label'] === `Количество — ${product.name}`),
    );
  return {
    tree,
    close() {
      Renderer.act(() => tree.unmount());
      client.clear();
    },
  };
}
const orderRequests = () => requests.filter((r) => r.url.endsWith('/order'));
const identityMessage = new PurchaseOrderIdentityError().message;

test('malformed create/update responses stop ordering, show a useful error and keep the form', async (t) => {
  const broken = [
    undefined,
    null,
    {},
    { data: draft },
    '',
    '<html>proxy</html>',
    { queued: true },
    ...[undefined, null, '', 'undefined', 'null', 'bad-id', 42, {}, ` ${ORDER}`, `${ORDER} `].map((id) => ({
      ...draft,
      id,
    })),
  ];
  for (const mode of ['create', 'update'])
    await t.test(mode, async () => {
      for (const response of broken) {
        const page = await mount(mode === 'create' ? undefined : ORDER, response);
        try {
          await click(page.tree, 'Оформить заказ');
          await until(() => errors.length > 0);
          assert.deepEqual(errors, [identityMessage], JSON.stringify(response));
          assert.equal(requests.length, 1, 'only the save request is sent');
          assert.equal(orderRequests().length, 0);
          assert.deepEqual(successes, []);
          assert.deepEqual(navigations, []);
          assert.equal(
            page.tree.root.findAllByType('input').find((n) => n.props['aria-label'] === `Количество — ${product.name}`)
              .props.value,
            mode === 'create' ? '1' : '2',
            'line remains editable',
          );
        } finally {
          page.close();
        }
      }
    });
});

test('valid new and existing drafts save before ordering and navigate to the returned ID', async () => {
  for (const id of [undefined, ORDER]) {
    const page = await mount(id);
    try {
      await click(page.tree, 'Оформить заказ');
      await until(() => successes.length > 0);
      assert.deepEqual(
        requests.map(({ method, url }) => ({ method, url })),
        [
          { method: id ? 'PATCH' : 'POST', url: id ? `/purchase-orders/${ORDER}` : '/purchase-orders' },
          { method: 'POST', url: `/purchase-orders/${ORDER}/order` },
        ],
      );
      assert.deepEqual(requests[0].body.items, [{ productId: product.id, quantity: id ? 2 : 1, costPrice: 12.5 }]);
      assert.deepEqual(successes, ['Заказ оформлен']);
      assert.deepEqual(navigations, [`/purchase-orders/${ORDER}`]);
      assert.deepEqual(errors, []);
    } finally {
      page.close();
    }
  }
});

test('a malformed route ID cannot update or order an existing draft', async () => {
  const page = await mount('undefined');
  try {
    await click(page.tree, 'Оформить заказ');
    await until(() => errors.length > 0);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, [identityMessage]);
  } finally {
    page.close();
  }
});

test('draft save validates identity before a success toast or navigation', async () => {
  for (const response of [{}, draft]) {
    const page = await mount(undefined, response);
    try {
      await click(page.tree, 'Сохранить черновик');
      await until(() => errors.length + successes.length > 0);
      assert.equal(orderRequests().length, 0);
      assert.deepEqual(errors, response.id ? [] : [identityMessage]);
      assert.deepEqual(successes, response.id ? ['Черновик сохранён'] : []);
      assert.deepEqual(navigations, response.id ? [`/purchase-orders/${ORDER}`] : []);
    } finally {
      page.close();
    }
  }
});

test('a save failure does not send order and retains the existing generic error', async () => {
  const page = await mount(ORDER);
  try {
    saveError = new Error('fixture unavailable');
    await click(page.tree, 'Оформить заказ');
    await until(() => errors.length > 0);
    assert.equal(orderRequests().length, 0);
    assert.deepEqual(errors, ['Не удалось оформить заказ']);
    assert.deepEqual(navigations, []);
  } finally {
    page.close();
  }
});

test('the web API also blocks invalid IDs for callers outside the edit page', async () => {
  requests.length = 0;
  saveError = null;
  for (const id of [undefined, null, '', 'undefined', 'null', 'bad-id', 42, {}, `${ORDER} `])
    await assert.rejects(purchaseOrdersApi.order(id), PurchaseOrderIdentityError);
  assert.deepEqual(requests, []);
  await purchaseOrdersApi.order(ORDER.toUpperCase());
  assert.equal(requests[0].url, `/purchase-orders/${ORDER.toUpperCase()}/order`);
});

test('the actual service worker queued 202 is never treated as a saved or ordered purchase order', async () => {
  const listeners = new Map(),
    queued = [];
  const sandbox = {
    URL,
    Request,
    Response,
    console,
    setTimeout,
    clearTimeout,
    self: {
      location: { origin: 'https://autexa-cloud.ru' },
      addEventListener: (type, handler) => listeners.set(type, handler),
    },
    fetch: async () => {
      throw new TypeError('fixture offline');
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), sandbox);
  // Replace only persistence/notifications; dispatch and response handling are real SW code.
  sandbox.queueMutation = async (request) => queued.push({ method: request.method, url: request.url });
  sandbox.notifyClients = () => {};
  for (const stage of ['create', 'update', 'order']) {
    const method = stage === 'update' ? 'PATCH' : 'POST';
    const url = `https://autexa-cloud.ru/api/purchase-orders${stage === 'create' ? '' : `/${ORDER}`}${stage === 'order' ? '/order' : ''}`;
    let reply;
    listeners.get('fetch')({
      request: new Request(url, { method }),
      respondWith: (promise) => {
        reply = promise;
      },
    });
    assert.ok(reply, 'the service worker handles this purchase order mutation');
    const response = await reply;
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.queued, true);
    assert.equal(body.id, undefined);
    const page = await mount(stage === 'create' ? undefined : ORDER, stage === 'order' ? draft : body);
    try {
      if (stage === 'order') orderedResponse = body;
      await click(page.tree, 'Оформить заказ');
      await until(() => errors.length > 0);
      assert.deepEqual(errors, [identityMessage]);
      assert.deepEqual(navigations, []);
      assert.deepEqual(successes, []);
      assert.equal(orderRequests().length, stage === 'order' ? 1 : 0);
      assert.equal(
        requests.some((r) => r.url.includes('undefined')),
        false,
      );
    } finally {
      page.close();
    }
  }
  assert.equal(queued.length, 3);
});
