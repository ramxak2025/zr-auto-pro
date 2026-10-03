const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const axios = require('axios');

/** Run the actual axios interceptors with a fake transport and tab storage. */
function fixture() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  function load(relative, imports = {}) {
    const file = path.resolve(__dirname, '..', relative);
    const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env', '({})');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(
      compiled,
      {
        module,
        exports: module.exports,
        require: (name) => {
          if (name === 'axios') return axios;
          if (Object.hasOwn(imports, name)) return imports[name];
          throw new Error(`Unexpected dependency: ${name}`);
        },
        localStorage: storage,
        window: {
          location: {
            assign: () => {
              throw new Error('Unexpected logout');
            },
          },
        },
        console,
        Date,
        Promise,
      },
      { filename: file },
    );
    return module.exports;
  }
  const session = load('src/utils/sessionToken.ts');
  const mod = load('src/api/axios.ts', {
    '../utils/sessionToken': session,
    '../utils/persistentCache': { clearPersistentCache: async () => {} },
    '../utils/swCache': { purgeApiCache: async () => {}, purgeOfflineQueues: async () => {} },
    '../utils/sessionNotice': { rememberSessionEndedNotice: () => {} },
    '../../../shared/utils/apiError': { sessionPointLostMessage: () => null },
  });
  const calls = [];
  mod.default.defaults.adapter = async (config) => {
    calls.push(config);
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  return { ...mod, session, calls };
}

test('key rotation created by A cannot become a mutation of B before interceptors run', async () => {
  const f = fixture();
  f.session.writeSessionToken('test-A');
  const bound = f.createSessionBoundClient('test-A');
  const pending = bound.post('/one-c/connection/rotate-key');
  f.session.writeSessionToken('test-B');
  await assert.rejects(pending, { code: 'AUTEXA_SESSION_TAKEOVER' });
  await assert.rejects(bound.patch('/one-c/connection', { status: 'active' }), { code: 'AUTEXA_SESSION_TAKEOVER' });
  assert.equal(f.calls.length, 0);
});

test('current owner keeps the captured bearer; logout cancels later work', async () => {
  const f = fixture();
  f.session.writeSessionToken('test-A');
  const bound = f.createSessionBoundClient('test-A');
  await bound.post('/one-c/connection/rotate-key');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer test-A');
  f.session.clearOwnSessionToken();
  await assert.rejects(bound.get('/one-c/connection'), { code: 'AUTEXA_SESSION_TAKEOVER' });
  assert.equal(f.calls.length, 1);
});

test('GET reserve failover keeps its original owner and cannot adopt login B', async () => {
  const f = fixture();
  f.session.writeSessionToken('test-A');
  let attempts = 0;
  f.default.defaults.adapter = async (config) => {
    attempts++;
    f.session.writeSessionToken('test-B');
    throw new axios.AxiosError('Simulated network failure', 'ERR_NETWORK', config);
  };
  // The existing reserve handler wraps its failure in a user-facing network error.
  await assert.rejects(f.createSessionBoundClient('test-A').get('/one-c/connection'));
  assert.equal(attempts, 1, 'no request reaches the reserve with the next account bearer');
});
