const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');
function load(name) {
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../../shared/utils/', name + '.ts'), 'utf8');
  new Function(
    'exports',
    'module',
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
      .outputText,
  )(mod.exports, mod);
  return mod.exports;
}
const { displayedProfit, displayedWarrantyLoss } = load('checkProfit');
const { accrualBreakdown } = load('accrualBreakdown');
const { financialExpenses } = load('financialExpenses');
const { formatMoney } = load('formatters');
const { costRequestIntent, plannedCostState } = load('planningCosts');

test('check financial display uses saved derived values, including zero and warranty, with legacy fallback', () => {
  assert.equal(displayedProfit({ profit: 2000, profitAfterMotivation: 1600 }), 1600);
  assert.equal(displayedProfit({ profit: 2000, profitAfterMotivation: 0 }), 0);
  assert.equal(displayedProfit({ profit: 2000 }), 2000);
  assert.equal(
    displayedProfit({ profit: 2000, isWarranty: true, warrantyLoss: 500, warrantyLossAfterMotivation: 540 }),
    -540,
  );
  assert.equal(displayedWarrantyLoss({ warrantyLoss: 500, warrantyLossAfterMotivation: 0 }), 0);
  assert.equal(
    displayedProfit({ profit: 0, motivationAmount: 400, profitAfterMotivation: 0 }),
    0,
    'client must not subtract ledger again',
  );
});
test('signed today components reconcile with negative percent, recurring excess, and bonus reversals', () => {
  const period = {
    checkProfit: -200,
    plannedFixedAmortized: 10.55,
    staffFixedAmortized: 0,
    staffPctTurnover: 0,
    staffPctProfit: -40,
    oneOffExpenses: 0,
    recurringExcess: -30,
    salaryExtras: -20,
    motivation: -15,
    perVehicleDayExpense: 500.55,
  };
  const rows = accrualBreakdown(period);
  assert.equal(rows.find((r) => r.label === '% с прибыли').contribution, 40);
  assert.equal(rows.find((r) => r.label === 'Постоянка вне Плана').contribution, 30);
  assert.equal(rows.find((r) => r.label === 'Премии и мотивация').contribution, 20);
  assert.equal(Math.round(rows.reduce((s, r) => s + r.contribution, 0) * 100), -62110);
  assert.equal(
    rows.some((r) => r.label === 'Мотивация'),
    false,
    'motivation is a subset of salary extras',
  );
});
test('financial actual expenses include each server deduction exactly once', () => {
  const report = {
    productCost: 100,
    salaries: 200,
    premiums: 30,
    motivation: 40,
    warrantyLoss: 50,
    otherExpenses: 60,
    perVehicleDayExpense: 500.55,
    netProfit: 19.45,
    revenue: 1000,
  };
  const rows = financialExpenses(report);
  assert.equal(Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100), 98055);
  assert.equal(rows.find((r) => r.name === 'Прочие расходы').amount, 60);
  assert.equal(Math.round((report.revenue - rows.reduce((s, r) => s + r.amount, 0)) * 100), 1945);
});
test('precision is opt-in and request UUID only repeats for identical intent', () => {
  assert.match(formatMoney(500.55, 2), /500,55/);
  assert.equal(formatMoney(500.55), '501 ₽');
  assert.equal(formatMoney(500, 2), '500 ₽');
  let sequence = 0;
  const requestId = costRequestIntent(() => String(++sequence));
  const intent = { id: 'cost', revision: 1, amount: 500.55 };
  assert.equal(requestId(intent), requestId({ ...intent }));
  assert.notEqual(requestId({ ...intent, amount: 501 }), requestId(intent));
  const cost = {
    active: true,
    perVehicleDayAmount: 500,
    pending: { active: false, perVehicleDayAmount: 600, effectiveFrom: '2026-10-29' },
  };
  assert.equal(plannedCostState(cost).perVehicleDayAmount, 600);
  assert.equal(plannedCostState(cost).active, false);
});
