const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const {
  calculateSubscriptionQuote: quote,
  SUBSCRIPTION_PLAN_PRICING: plans,
} = require('../dist/plans/subscription-pricing');
const { pricingFromPlanRow } = require('../dist/plans/plan-pricing-row');
const { PlansService } = require('../dist/plans/plans.service');
const { TenantsController } = require('../dist/tenants/tenants.controller');
const { ManagerCabinetController } = require('../dist/platform-managers/manager-cabinet.controller');
const { ROLES_KEY } = require('../dist/common/guards/roles.guard');

const input = (employees, points = 1, period = 'monthly') => ({ employees, points, period });
test('pricing: base, included boundaries, extras and annual entire composition', () => {
  for (const [code, base, included, extra] of [
    ['baza', 990, 1, 990],
    ['pro', 4990, 5, 500],
    ['max', 15000, 50, 500],
  ]) {
    assert.equal(quote(plans[code], input(1)).quote.total, base);
    assert.equal(quote(plans[code], input(included)).quote.total, base);
    assert.equal(quote(plans[code], input(included + 1)).quote.total, base + extra);
    assert.equal(quote(plans[code], input(included + 1, 1, 'yearly')).quote.total, (base + extra) * 10);
  }
  const result = quote(plans.max, input(53, 3, 'yearly')).quote;
  assert.equal(result.monthlyTotal, 26500);
  assert.equal(result.total, 265000);
  assert.equal(result.extraEmployees, 3);
  assert.equal(result.extraPoints, 2);
  assert.equal(result.serviceMonths, 12);
  assert.equal(result.chargedMonths, 10);
});
test('pricing: undefined branches never become free; invalid runtime inputs never produce payable totals', () => {
  for (const code of ['baza', 'pro']) {
    assert.equal(plans[code].includedPoints, null);
    assert.deepEqual(quote(plans[code], input(1, 2)), { ok: false, code: 'UNPRICED_POINTS' });
  }
  for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    assert.deepEqual(quote(plans.max, input(count)), { ok: false, code: 'INVALID_COUNT' });
    assert.deepEqual(quote(plans.max, input(1, count)), { ok: false, code: 'INVALID_COUNT' });
  }
  assert.equal(quote(plans.max, input(Number.MAX_SAFE_INTEGER)).ok, false);
  assert.equal(quote(plans.max, input(1, 1, 'quarter')).ok, false);
  assert.equal(quote({ ...plans.max, monthlyPrice: Infinity }, input(1)).ok, false);
});
test('backend distribution and client helper compute identical quotes', () => {
  const exports = {};
  const source = readFileSync(join(__dirname, '../../shared/utils/subscriptionPricing.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
  });
  for (const code of ['baza', 'pro', 'max'])
    for (const employees of [1, 5, 50, 51, 99])
      for (const points of [1, 2, 5])
        for (const period of ['monthly', 'yearly']) {
          assert.equal(
            JSON.stringify(
              exports.calculateSubscriptionQuote(exports.SUBSCRIPTION_PLAN_PRICING[code], {
                employees,
                points,
                period,
              }),
            ),
            JSON.stringify(quote(plans[code], { employees, points, period })),
          );
        }
});
test('legacy/custom names cannot opt into pricing; malformed plan rows fail closed', () => {
  assert.equal(pricingFromPlanRow({ name: 'MAX' }), null);
  assert.equal(pricingFromPlanRow({ code: 'max', monthly_price: '15000', included_employees: null }), null);
});
test('owner-only included count can be saved; no two-person floor remains', async () => {
  let values;
  const service = new PlansService({
    query: async (sql, params) => {
      values = params;
      return { rows: [{ id: 'p', name: 'Owner', max_users: params[4] }] };
    },
  });
  const plan = await service.create({ name: 'Owner', maxUsers: 1 });
  assert.equal(plan.maxUsers, 1);
  assert.equal(values[4], 1);
});
test('quote controller role guards retain manager and superadmin boundaries', () => {
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, TenantsController.prototype.getSubscriptionQuote), ['superadmin']);
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, ManagerCabinetController.prototype.getSubscriptionQuote), [
    'manager',
    'superadmin',
  ]);
});
