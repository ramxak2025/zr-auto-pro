const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { QueryClient, MutationObserver } = require('../node_modules/@tanstack/react-query');
const moduleScope = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(require('node:path').join(__dirname, '../../shared/utils/dashboardQueries.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText,
  { exports: moduleScope.exports, module: moduleScope, Set, queueMicrotask },
);
const { attachDashboardRefresh } = moduleScope.exports;
test('homepage refresh follows saved mutations and source invalidations without recursive refetch or unrelated queries', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  for (const key of ['dashboard-attention', 'salary-today-earnings', 'checks', 'products', 'unrelated'])
    client.setQueryData([key], {});
  const detach = attachDashboardRefresh(client);
  await client.invalidateQueries({ queryKey: ['unrelated'] });
  assert.equal(client.getQueryState(['dashboard-attention']).isInvalidated, false);
  await client.invalidateQueries({ queryKey: ['checks'] });
  assert.equal(client.getQueryState(['dashboard-attention']).isInvalidated, true);
  assert.equal(client.getQueryState(['salary-today-earnings']).isInvalidated, true);
  client.setQueryData(['dashboard-attention'], {});
  client.setQueryData(['salary-today-earnings'], {});
  await new MutationObserver(client, { mutationFn: async () => ({ saved: true }) }).mutate();
  assert.equal(client.getQueryState(['dashboard-attention']).isInvalidated, true);
  assert.equal(client.getQueryState(['salary-today-earnings']).isInvalidated, true);
  detach();
  client.clear();
});
