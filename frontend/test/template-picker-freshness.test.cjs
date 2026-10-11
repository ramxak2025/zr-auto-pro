const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, QueryObserver, onlineManager } = require('@tanstack/react-query');
const source = readFileSync(join(__dirname, '../../shared/utils/templatePickerQuery.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const { templatePickerQueryOptions, canApplyTemplateSnapshot } = sandbox.exports;
const settle = async (observer, condition) => {
  if (condition(observer.getCurrentResult())) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('query did not settle'));
    }, 2000);
    const off = observer.subscribe((result) => {
      if (condition(result)) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
};
test('mounted picker reopens with new prices and cannot apply cached data during failed refresh', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let price = 10,
    calls = 0,
    fail = false,
    release;
  const read = async () => {
    calls++;
    if (fail) throw new Error('offline');
    await new Promise((r) => {
      release = r;
    });
    return [{ id: 'template', services: [{ price }], products: [] }];
  };
  const observer = new QueryObserver(client, templatePickerQueryOptions(read, false));
  const off = observer.subscribe(() => {});
  try {
    assert.equal(calls, 0);
    observer.setOptions(templatePickerQueryOptions(read, true));
    assert.equal(canApplyTemplateSnapshot(observer.getCurrentResult()), false);
    release();
    await settle(observer, (r) => r.isSuccess && !r.isFetching);
    assert.equal(observer.getCurrentResult().data[0].services[0].price, 10);
    observer.setOptions(templatePickerQueryOptions(read, false));
    price = 20;
    observer.setOptions(templatePickerQueryOptions(read, true));
    assert.equal(canApplyTemplateSnapshot(observer.getCurrentResult()), false);
    release();
    await settle(observer, (r) => r.isSuccess && !r.isFetching);
    assert.equal(calls, 2);
    assert.equal(observer.getCurrentResult().data[0].services[0].price, 20);
    observer.setOptions(templatePickerQueryOptions(read, false));
    fail = true;
    observer.setOptions(templatePickerQueryOptions(read, true));
    await settle(observer, (r) => r.isError && !r.isFetching);
    assert.equal(observer.getCurrentResult().data[0].services[0].price, 20);
    assert.equal(canApplyTemplateSnapshot(observer.getCurrentResult()), false);
  } finally {
    off();
    client.clear();
  }
});

test('offline reopening pauses refresh and never treats cached prices as current', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let calls = 0;
  const read = async () => {
    calls++;
    return [{ id: 'template', services: [{ price: 200 }], products: [] }];
  };
  client.setQueryData(['check-templates'], [{ id: 'template', services: [{ price: 100 }], products: [] }]);
  const observer = new QueryObserver(client, templatePickerQueryOptions(read, false));
  const off = observer.subscribe(() => {});
  try {
    onlineManager.setOnline(false);
    observer.setOptions(templatePickerQueryOptions(read, true));
    const state = observer.getCurrentResult();
    assert.equal(state.fetchStatus, 'paused');
    assert.equal(state.isFetching, false);
    assert.equal(state.isError, false);
    assert.equal(state.data[0].services[0].price, 100);
    assert.equal(canApplyTemplateSnapshot(state), false);
    assert.equal(calls, 0);
  } finally {
    off();
    client.clear();
    onlineManager.setOnline(true);
  }
});
