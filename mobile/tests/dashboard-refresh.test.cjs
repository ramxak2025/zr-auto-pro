const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, QueryObserver } = require('@tanstack/react-query');
const root = path.join(__dirname, '..');
const src = ts.createSourceFile(
  'DashboardScreen.tsx',
  fs.readFileSync(path.join(root, 'src/screens/DashboardScreen.tsx'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function keys(name) {
  let expression;
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(src) === name) expression = n.initializer;
    ts.forEachChild(n, visit);
  };
  visit(src);
  assert.ok(expression);
  return vm.runInNewContext('(' + expression.getText(src) + ')');
}
const m = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(root, '../shared/utils/dashboardQueries.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { module: m, exports: m.exports, Set, queueMicrotask },
);
const settle = () => new Promise((r) => setTimeout(r, 20));
for (const role of ['ownerKeys', 'masterKeys'])
  for (const ordinary of [false, true])
    test(`${role} actual pull bundle refreshes new-only=${!ordinary} active aggregate observers without loop`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      const detach = m.exports.attachDashboardRefresh(client);
      const counts = {};
      const unsubs = [];
      for (const key of [
        'dashboard-attention',
        'salary-today-earnings',
        ...(ordinary ? ['salary', 'dashboard-chart'] : []),
      ]) {
        counts[key] = 0;
        const observer = new QueryObserver(client, { queryKey: [key], queryFn: async () => ({ n: ++counts[key] }) });
        unsubs.push(observer.subscribe(() => {}));
      }
      await settle();
      await Promise.all(keys(role).map((queryKey) => client.invalidateQueries({ queryKey })));
      await settle();
      for (const key of ['dashboard-attention', 'salary-today-earnings'])
        assert.ok(counts[key] >= 2 && counts[key] <= 3, JSON.stringify(counts));
      console.log(JSON.stringify({ role, newOnly: !ordinary, counts }));
      const stable = JSON.stringify(counts);
      await settle();
      assert.equal(JSON.stringify(counts), stable);
      unsubs.forEach((fn) => fn());
      detach();
      client.clear();
    });
