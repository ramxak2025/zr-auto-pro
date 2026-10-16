const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const Query = require('@tanstack/react-query');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let token = 'session-A',
  finish,
  invalidations = 0,
  successes = 0,
  callerSuccess = 0,
  apiCalls = [];
const deferred = () =>
  new Promise((resolve) => {
    finish = resolve;
  });
let response;
const makeApi = (client) => ({
  extend: async (id, request) => {
    apiCalls.push({ token: client.token, id, request });
    return response;
  },
});
const source = fs.readFileSync(
  process.env.AUTEXA_RENEWAL_ACTIONS_SOURCE ||
    path.resolve(__dirname, '../src/components/admin/useTenantSubscriptionActions.ts'),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const dependencies = {
  react: React,
  '@tanstack/react-query': Query,
  '../../../../shared/api/createServices': { createManagerCabinetApi: makeApi, createTenantsApi: makeApi },
  '../../api/axios': { createSessionBoundClient: (token) => ({ token }) },
  '../../api/services': { managerApi: makeApi({ token: 'unbound' }), tenantsApi: makeApi({ token: 'unbound' }) },
  '../../contexts/AuthContext': { useAuth: () => ({ token, refreshUser: async () => {} }) },
  '../../utils/sessionToken': {
    readStoredToken: () => token,
    writeSessionToken() {},
    sessionTakeoverError: () => new Error('session changed'),
  },
  './apiError': { apiErrorMessage: () => '' },
  './managerQueryKeys': { adminManagerKeys: {}, managerKeys: { tenant: () => [], cabinet: () => [] } },
  'react-hot-toast': { __esModule: true, default: { success: () => successes++, error() {} } },
};
const sandbox = {
  exports: {},
  require: (name) => {
    if (!(name in dependencies)) throw new Error(name);
    return dependencies[name];
  },
};
vm.runInNewContext(output, sandbox);
const { useTenantSubscriptionActions } = sandbox.exports;
function mount(mode = 'superadmin') {
  let state, tree;
  const client = new Query.QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.invalidateQueries = () => {
    invalidations++;
    return Promise.resolve();
  };
  function Form() {
    state = useTenantSubscriptionActions('tenant', mode);
    return null;
  }
  const render = () => React.createElement(Query.QueryClientProvider, { client }, React.createElement(Form));
  Renderer.act(() => {
    tree = Renderer.create(render());
  });
  return {
    state: () => state,
    update: () => Renderer.act(() => tree.update(render())),
    close() {
      Renderer.act(() => tree.unmount());
      client.clear();
    },
  };
}
test.beforeEach(() => {
  token = 'session-A';
  response = deferred();
  invalidations = 0;
  successes = 0;
  callerSuccess = 0;
  apiCalls = [];
});
test('renewal response from a previous account cannot invalidate current caches, toast success or close its form', async () => {
  const form = mount();
  try {
    let result;
    await Renderer.act(async () => {
      result = form
        .state()
        .extend.mutateAsync(
          { type: 'paid', amount: 4990, period: 'monthly', requestId: 'id' },
          { onSuccess: () => callerSuccess++ },
        )
        .then(
          () => null,
          (error) => error,
        );
      await Promise.resolve();
    });
    if (!process.env.AUTEXA_RENEWAL_ACTIONS_SOURCE) assert.equal(apiCalls[0].token, 'session-A');
    token = 'session-B';
    form.update();
    await Renderer.act(async () => {
      finish({ data: { id: 'tenant' } });
      await result;
    });
    assert.equal(invalidations, 0, 'a previous session must not invalidate the new session cache');
    assert.equal((await result)?.message, 'session changed');
    assert.equal(invalidations, 0);
    assert.equal(successes, 0);
    assert.equal(callerSuccess, 0);
  } finally {
    form.close();
  }
});
test('own session renewal completes normally and invalidates its scoped data', async () => {
  const form = mount('manager');
  try {
    let pending;
    await Renderer.act(async () => {
      pending = form.state().extend.mutateAsync({ type: 'paid', amount: 5000 }, { onSuccess: () => callerSuccess++ });
      await Promise.resolve();
    });
    await Renderer.act(async () => {
      finish({ data: { id: 'tenant' } });
      await pending;
    });
    assert.ok(invalidations > 0);
    assert.equal(successes, 1);
    assert.equal(callerSuccess, 1);
    assert.equal(apiCalls[0].token, 'session-A');
  } finally {
    form.close();
  }
});
