const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');
function shared(name) {
  const mod = { exports: {} };
  new Function(
    'exports',
    'module',
    ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../shared/utils/' + name + '.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
  )(mod.exports, mod);
  return mod.exports;
}
const source = fs.readFileSync(path.join(__dirname, '../src/screens/ReportsScreen.tsx'), 'utf8');
const start = source.indexOf('function buildReportHtml('),
  end = source.indexOf('// ─────────────────', start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const financialExpenses = shared('financialExpenses').financialExpenses;
const formatMoney = (v) => shared('formatters').formatMoney(v, 2);
const { buildReportHtml, buildTableHtml } = new Function(
  'financialExpenses',
  'formatMoney',
  'pctOf',
  'pdfBaseCss',
  'pdfBrandBar',
  'escapeHtml',
  code + ';return {buildReportHtml,buildTableHtml};',
)(
  financialExpenses,
  formatMoney,
  (v, r) => (r ? ((v / r) * 100).toFixed(1) : '0'),
  () => '',
  () => '',
  (v) => String(v),
);
test('native PDF and table contain every actual server deduction once, preserve kopeks and net profit', () => {
  const report = {
    revenue: 1000,
    productCost: 100,
    grossProfit: 900,
    salaries: 200,
    premiums: 30,
    motivation: 40,
    warrantyLoss: 50,
    otherExpenses: 60,
    perVehicleDayExpense: 500.55,
    netProfit: 19.45,
    checkCount: 2,
  };
  const args = {
    title: 'Report',
    companyName: 'QA',
    periodLabel: 'October',
    range: { from: '2026-10-01', to: '2026-10-28' },
    report,
    expenses: [],
  };
  for (const html of [buildReportHtml(args), buildTableHtml(args)]) {
    for (const label of [
      'Премии деньгами',
      'Мотивация',
      'За автомобиль в день',
      'Убыток по гарантии',
      'Прочие расходы',
    ])
      assert.equal(html.split(label).length - 1, 1, label + ' exactly once');
    assert.ok(html.includes('500,55 ₽'));
    assert.ok(html.includes('19,45 ₽'));
  }
});

test('report subtitle identifies rendered result dates while a new date draft remains unapplied', () => {
  const filename = path.join(__dirname, '../src/screens/reports/ReportRunScreen.tsx');
  const file = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let subtitle;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'subtitle') subtitle = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(subtitle);
  const evaluate = new Function(
    'result',
    'reportQuery',
    'periodLabel',
    'formatPeriodLabel',
    `return (${subtitle.getText(file)});`,
  );
  const result = { period: { from: '2026-09-01', to: '2026-09-30' } };
  const formatPeriodLabel = (_period, range) => `${range.from}—${range.to}`;
  for (const isFetching of [false, true]) {
    const label = evaluate(result, { isFetching }, 'Новый черновой период', formatPeriodLabel);
    assert.equal(label, `Данные: 2026-09-01—2026-09-30${isFetching ? ' · обновляется…' : ''}`);
    assert.ok(!label.includes('Новый черновой период'));
  }
  assert.equal(
    evaluate(undefined, { isFetching: false }, 'Новый черновой период', formatPeriodLabel),
    'Новый черновой период',
  );
});
