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
