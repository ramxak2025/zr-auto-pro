const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const axios = require('axios');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
require.extensions['.ts'] = require.extensions['.tsx'] = () => {};
const root = path.resolve(__dirname, '..');
const repository = path.resolve(root, '..');
const user = (id) => ({ id, fullName: id, role: 'master', permissions: {}, tenantId: 'fixture-tenant' });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const html = (status, contentType = 'text/html') => ({
  status,
  data: '<!DOCTYPE html><html><body>Proxy access denied</body></html>',
  headers: { 'content-type': contentType },
});
const json = (status, data) => ({ status, data, headers: { 'content-type': 'application/json' } });
const flush = () =>
  Renderer.act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });

async function harness(responder) {
  const storage = new Map([['token', 'token-A']]);
  const browserEvents = new Map();
  const timers = [];
  const effects = { cache: 0, queue: 0, persist: 0, requests: [], notices: [] };
  const browserStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  global.localStorage = browserStorage;
  global.sessionStorage = {
    getItem: () => null,
    setItem(key, value) {
      effects.notices.push({ key, value });
    },
    removeItem() {},
  };
  global.window = {
    location: { pathname: '/dashboard', href: '/dashboard' },
    addEventListener: (name, fn) => {
      if (!browserEvents.has(name)) browserEvents.set(name, new Set());
      browserEvents.get(name).add(fn);
    },
    removeEventListener: (name, fn) => browserEvents.get(name)?.delete(fn),
  };
  const cache = new Map();
  const queryClient = { cancelQueries: async () => {}, clear() {}, prefetchQuery: async () => {} };
  const mocks = {
    '../utils/persistentCache': {
      clearPersistentCache: async () => {
        effects.persist++;
      },
    },
    '../utils/swCache': {
      purgeApiCache: async () => {
        effects.cache++;
      },
      purgeOfflineQueues: async () => {
        effects.queue++;
      },
      readOfflineQueueState: async () => ({ pending: 0 }),
    },
    '@tanstack/react-query': { useQueryClient: () => queryClient },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const instance = new Module(filename, module);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, instance);
    instance.require = (name) => {
      if (mocks[name]) return mocks[name];
      const resolved = Module._resolveFilename(name, instance);
      if (
        (resolved.startsWith(path.join(root, 'src')) || resolved.startsWith(path.join(repository, 'shared'))) &&
        /\.(?:tsx?|js)$/.test(resolved)
      )
        return load(resolved);
      return Module.createRequire(filename)(name);
    };
    const source = fs
      .readFileSync(filename, 'utf8')
      .replace(/import\.meta\.env\.VITE_API_URL/g, "'/api'")
      .replace(/import\.meta\.env\.VITE_API_FALLBACK_URL/g, "'https://reserve.fixture/api'");
    instance._compile(
      ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      filename,
    );
    return instance.exports;
  }
  const api = load(path.join(root, 'src/api/axios.ts')).default;
  api.defaults.adapter = async (config) => {
    effects.requests.push(config);
    const output = await responder(config);
    if (output instanceof Error) throw Object.assign(output, { config });
    const response = {
      status: output.status ?? 200,
      statusText: '',
      headers: output.headers ?? {},
      data: output.data,
      config,
    };
    if (response.status >= 400)
      throw new axios.AxiosError('fixture HTTP failure', 'ERR_BAD_REQUEST', config, {}, response);
    return response;
  };
  const auth = load(path.join(root, 'src/contexts/AuthContext.tsx'));
  let current;
  let tree;
  function Probe() {
    current = auth.useAuth();
    return null;
  }
  // Production code uses setTimeout only for its delayed auth redirect. Keep
  // it observable without navigating a browser or slowing every regression.
  const previousTimer = global.setTimeout;
  global.setTimeout = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  const previousWarn = console.warn;
  const previousError = console.error;
  console.warn = () => {};
  console.error = () => {};
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(auth.AuthProvider, {}, React.createElement(Probe)));
    await new Promise((resolve) => setImmediate(resolve));
  });
  return {
    api,
    storage,
    effects,
    timers,
    resolveSwitchPointFailure: load(path.join(root, 'src/utils/switchPointFailure.ts')).resolveSwitchPointFailure,
    get current() {
      return current;
    },
    pendingApp(publicPath = false) {
      const filename = path.join(root, 'src/App.tsx');
      const source = fs.readFileSync(filename, 'utf8');
      const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const functions = parsed.statements.filter(
        (node) => ts.isFunctionDeclaration(node) && ['App', 'isSubscriptionExpired'].includes(node.name?.text),
      );
      assert.equal(functions.length, 2);
      const compiled = ts.transpileModule(functions.map((fn) => fn.getFullText(parsed)).join('\n'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
      const Loading = load(path.join(root, 'src/components/LoadingSpinner.tsx')).default;
      const bindings = {};
      for (const node of parsed.statements) {
        if (ts.isImportDeclaration(node) && node.importClause) {
          if (node.importClause.name) bindings[node.importClause.name.text] = node.importClause.name.text;
          for (const item of node.importClause.namedBindings?.elements ?? []) bindings[item.name.text] = item.name.text;
        }
        if (ts.isVariableStatement(node))
          for (const declaration of node.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) bindings[declaration.name.text] = declaration.name.text;
          }
      }
      Object.assign(bindings, {
        useAuth: () => current,
        useQuery: () => ({}),
        useLocation: () => ({ pathname: global.window.location.pathname }),
        LoadingSpinner: Loading,
        UserRole: {},
      });
      const renderPredicatePath = path.join(root, 'src/utils/sessionRestoreRoute.ts');
      if (fs.existsSync(renderPredicatePath))
        bindings.canRenderWithoutSessionProfile = load(renderPredicatePath).canRenderWithoutSessionProfile;
      const entry = new Function(
        'require',
        'exports',
        ...Object.keys(bindings),
        compiled + '\nreturn exports.default;',
      )(require, {}, ...Object.values(bindings));
      const element = entry();
      if (publicPath) assert.notEqual(element.type, Loading, 'public contracts must render without a staff profile');
      else assert.equal(element.type, Loading, 'pending profile renders recovery shell, not anonymous/login routes');
      return element;
    },
    fire: (name) => {
      for (const fn of browserEvents.get(name) ?? []) fn();
    },
    async destroy() {
      Renderer.act(() => tree.unmount());
      global.setTimeout = previousTimer;
      console.warn = previousWarn;
      console.error = previousError;
    },
  };
}

for (const status of [200, 401, 403])
  test(`actual Axios + provider treat HTML HTTP ${status} as pending connection, retaining credentials and rejecting false profile success`, async () => {
    const h = await harness(() => html(status));
    try {
      assert.equal(h.storage.get('token'), 'token-A');
      assert.equal(h.current.token, 'token-A');
      assert.equal(h.current.user, null);
      assert.ok(h.current.sessionRestoreError);
      assert.equal(h.effects.requests.length, 2, 'only one safe reserve retry');
      assert.equal(h.effects.cache + h.effects.queue + h.effects.persist, 0);
    } finally {
      await h.destroy();
    }
  });

test('HTML body under JSON content-type is still a route failure; JSON permission403 preserves session', async () => {
  for (const response of [html(401, 'application/json'), json(403, { message: 'Нет права на ресурс' })]) {
    const h = await harness(() => response);
    try {
      assert.equal(h.storage.get('token'), 'token-A');
      assert.equal(h.current.user, null);
      assert.ok(h.current.sessionRestoreError);
    } finally {
      await h.destroy();
    }
  }
});

test('real API JSON401 from the exact session endpoint expires the current token', async () => {
  const h = await harness(() => json(401, { message: 'Токен отозван' }));
  try {
    assert.equal(h.storage.has('token'), false);
    assert.equal(h.current.token, null);
    assert.equal(h.current.user, null);
    assert.equal(h.current.sessionRestoreError ?? null, null);
  } finally {
    await h.destroy();
  }
});

test('pending profile retry restores access without login; online/focus retries are bounded while in flight', async () => {
  let mode = 'route';
  const pending = deferred();
  const h = await harness(() => (mode === 'route' ? html(403) : pending.promise));
  try {
    assert.ok(h.current.sessionRestoreError);
    mode = 'pending';
    await Renderer.act(async () => {
      h.fire('online');
      h.fire('focus');
      h.fire('online');
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(h.effects.requests.length, 3);
    pending.resolve(json(200, user('A')));
    await flush();
    assert.equal(h.current.user.id, 'A');
    assert.equal(h.current.token, 'token-A');
    assert.equal(h.current.sessionRestoreError, null);
    await Renderer.act(async () => {
      h.fire('online');
      h.fire('focus');
    });
    assert.equal(h.effects.requests.length, 3, 'no background restore calls after success');
  } finally {
    await h.destroy();
  }
});

test('a false successful HTML mutation is rejected once without replay or lost credentials', async () => {
  const h = await harness((config) => (config.url === '/auth/me' ? json(200, user('A')) : html(200)));
  try {
    const before = h.effects.requests.length;
    await assert.rejects(h.api.post('/checks', { fixture: true }));
    assert.equal(h.effects.requests.length, before + 1);
    assert.equal(h.storage.get('token'), 'token-A');
    assert.equal(h.current.user.id, 'A');
  } finally {
    await h.destroy();
  }
});

test('late bootstrap A JSON401 cannot clear or replace the succeeding B session', async () => {
  const old = deferred();
  const h = await harness((config) =>
    config.url === '/auth/login'
      ? json(200, { token: 'token-B', user: user('B') })
      : config.headers.get('Authorization') === 'Bearer token-A'
        ? old.promise
        : json(200, user('B')),
  );
  try {
    await Renderer.act(async () => {
      await h.current.login('fixture', 'fixture');
    });
    await flush();
    old.resolve(json(401, { message: 'Токен отозван' }));
    await flush();
    assert.equal(h.storage.get('token'), 'token-B');
    assert.equal(h.current.token, 'token-B');
    assert.equal(h.current.user.id, 'B');
    assert.equal(h.timers.length, 0);
  } finally {
    await h.destroy();
  }
});

test('an unrelated auth/metadata401 is not a session-endpoint response; permission403 is not expiry', async () => {
  const h = await harness((config) =>
    config.url === '/auth/me'
      ? json(200, user('A'))
      : json(config.url === '/auth/metadata' ? 401 : 403, { message: 'Нет права на ресурс' }),
  );
  try {
    await assert.rejects(h.api.get('/auth/metadata'));
    await assert.rejects(h.api.get('/products'));
    assert.equal(h.storage.get('token'), 'token-A');
    assert.equal(h.current.user.id, 'A');
    assert.equal(h.timers.length, 0);
  } finally {
    await h.destroy();
  }
});

test('a delayed logout redirect cannot navigate a newly committed session back to login', async () => {
  let expired = false;
  const h = await harness((config) =>
    config.url === '/auth/login'
      ? json(200, { token: 'token-B', user: user('B') })
      : expired && config.headers.get('Authorization') === 'Bearer token-A'
        ? json(401, { message: 'Токен отозван' })
        : json(200, user('B')),
  );
  try {
    expired = true;
    await assert.rejects(h.api.get('/auth/me'));
    await Renderer.act(async () => {
      await h.current.login('fixture', 'fixture');
    });
    await flush();
    for (const callback of h.timers) callback();
    assert.equal(global.window.location.href, '/dashboard');
    assert.equal(h.storage.get('token'), 'token-B');
  } finally {
    await h.destroy();
  }
});

test('the actual App pending-profile branch renders recovery and its button retries the real provider chain', async () => {
  let connected = false;
  const h = await harness(() => (connected ? json(200, user('A')) : html(401)));
  let view;
  try {
    Renderer.act(() => {
      view = Renderer.create(h.pendingApp());
    });
    assert.ok(JSON.stringify(view.toJSON()).includes('Не удалось подключиться'));
    connected = true;
    await Renderer.act(async () => {
      view.root.findByType('button').props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(h.current.user.id, 'A');
    assert.equal(h.storage.get('token'), 'token-A');
  } finally {
    if (view) Renderer.act(() => view.unmount());
    await h.destroy();
  }
});

test('transport errors and JSON503 stay recoverable without clearing the current credentials', async () => {
  for (const output of [
    new Error('fixture disconnected'),
    json(503, { message: 'Проверка авторизации временно недоступна' }),
  ]) {
    const h = await harness(() => output);
    try {
      assert.ok(h.current.sessionRestoreError);
      assert.equal(h.current.user, null);
      assert.equal(h.storage.get('token'), 'token-A');
    } finally {
      await h.destroy();
    }
  }
});

test('real JSON point/password revocation on a data route keeps the existing logout and notice contract', async () => {
  const message = 'Пароль изменён — войдите заново';
  const h = await harness((config) => (config.url === '/auth/me' ? json(200, user('A')) : json(401, { message })));
  try {
    await assert.rejects(h.api.get('/checks'));
    assert.equal(h.storage.has('token'), false);
    assert.ok(h.effects.notices.some((notice) => notice.value === message));
  } finally {
    await h.destroy();
  }
});

test('a genuine JSON401 on the reserve still expires the session after primary HTML failure', async () => {
  const h = await harness((config) =>
    config.baseURL === '/api' ? html(401) : json(401, { message: 'Нет токена авторизации' }),
  );
  try {
    assert.equal(h.storage.has('token'), false);
    assert.equal(h.current.token, null);
    assert.equal(h.current.user, null);
    assert.equal(h.current.sessionRestoreError, null);
  } finally {
    await h.destroy();
  }
});

test('late bootstrap success or captive HTML from A cannot overwrite B or replay under its new bearer', async () => {
  for (const response of [json(200, user('A')), html(401)]) {
    const old = deferred();
    const h = await harness((config) =>
      config.url === '/auth/login'
        ? json(200, { token: 'token-B', user: user('B') })
        : config.headers.get('Authorization') === 'Bearer token-A'
          ? old.promise
          : json(200, user('B')),
    );
    try {
      await Renderer.act(async () => {
        await h.current.login('fixture', 'fixture');
      });
      await flush();
      const before = h.effects.requests.length;
      old.resolve(response);
      await flush();
      assert.equal(h.effects.requests.length, before);
      assert.equal(h.storage.get('token'), 'token-B');
      assert.equal(h.current.user.id, 'B');
      assert.equal(h.current.sessionRestoreError, null);
    } finally {
      await h.destroy();
    }
  }
});

test('non-HTML text export remains a successful response', async () => {
  const h = await harness((config) =>
    config.url === '/auth/me'
      ? json(200, user('A'))
      : { status: 200, headers: { 'content-type': 'text/csv' }, data: 'name,phone\nfixture,0000000000' },
  );
  try {
    const response = await h.api.get('/clients/export-csv', { responseType: 'text' });
    assert.equal(response.data, 'name,phone\nfixture,0000000000');
    assert.equal(h.storage.get('token'), 'token-A');
  } finally {
    await h.destroy();
  }
});

test('late refreshUser A success cannot replace a newly committed B profile', async () => {
  const old = deferred();
  let originalRequests = 0;
  const h = await harness((config) => {
    if (config.url === '/auth/login') return json(200, { token: 'token-B', user: user('B') });
    if (config.headers.get('Authorization') === 'Bearer token-A')
      return ++originalRequests === 1 ? json(200, user('A')) : old.promise;
    return json(200, user('B'));
  });
  try {
    let refresh;
    Renderer.act(() => {
      refresh = h.current.refreshUser();
    });
    await flush();
    await Renderer.act(async () => {
      await h.current.login('fixture', 'fixture');
    });
    await flush();
    await Renderer.act(async () => {
      old.resolve(json(200, user('A')));
      await refresh;
    });
    assert.equal(h.current.user.id, 'B');
    assert.equal(h.current.token, 'token-B');
    assert.equal(h.storage.get('token'), 'token-B');
  } finally {
    await h.destroy();
  }
});

test('public contracts remain reachable during pending staff restore, while private and unknown routes stay recovering', async () => {
  const h = await harness(() => html(401));
  try {
    for (const pathname of [
      '/privacy',
      '/terms',
      '/',
      '/f/sklad',
      '/tarify',
      '/voprosy',
      '/review/fixture',
      '/book/fixture',
      '/nfc/attendance',
      '/login',
      '/register',
    ]) {
      global.window.location.pathname = pathname;
      const element = h.pendingApp(true);
      const collect = (node) =>
        !React.isValidElement(node)
          ? []
          : [node.props.path, ...React.Children.toArray(node.props.children).flatMap(collect)];
      assert.ok(
        collect(element).includes(
          pathname === '/f/sklad'
            ? '/f/:slug'
            : pathname === '/review/fixture'
              ? '/review/:token'
              : pathname === '/book/fixture'
                ? '/book/:slug'
                : pathname,
        ),
        pathname,
      );
    }
    for (const pathname of ['/motivation', '/dashboard', '/company-settings', '/unknown-private-route']) {
      global.window.location.pathname = pathname;
      h.pendingApp();
    }
    assert.equal(h.storage.get('token'), 'token-A');
  } finally {
    await h.destroy();
  }
});

for (const [label, body] of [
  ['empty object', {}],
  ['null body', null],
  ['array', []],
  ['string body', 'Unauthorized'],
  ['empty body', ''],
  ['numeric body', 401],
  ['error-only object', { error: 'Unauthorized' }],
  ['array message', { message: ['Unauthorized'] }],
  ['null message', { message: null }],
  ['numeric message', { message: 401 }],
]) {
  test(`non-authoritative JSON401 (${label}) stays a bounded route recovery without deleting credentials`, async () => {
    const h = await harness(() => json(401, body));
    try {
      assert.equal(h.storage.get('token'), 'token-A');
      assert.equal(h.current.token, 'token-A');
      assert.equal(h.current.user, null);
      assert.ok(h.current.sessionRestoreError);
      assert.equal(h.effects.requests.length, 2, 'one reserve retry only, no automatic recovery loop');
      assert.equal(h.effects.cache + h.effects.queue + h.effects.persist, 0);
      assert.equal(h.timers.length, 0);
      h.pendingApp();
    } finally {
      await h.destroy();
    }
  });
}

test('a malformed401 mutation cannot reach the switch-point consumer as an authoritative logout and is never replayed', async () => {
  const h = await harness((config) => (config.url === '/auth/me' ? json(200, user('A')) : json(401, {})));
  try {
    const before = h.effects.requests.length;
    let failure;
    try {
      await h.current.switchPoint('fixture-point');
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.response, undefined);
    assert.equal(h.resolveSwitchPointFailure(failure).action, 'stay');
    assert.equal(h.effects.requests.length, before + 1);
    assert.equal(h.storage.get('token'), 'token-A');
    assert.equal(h.current.user.id, 'A');
  } finally {
    await h.destroy();
  }
});
