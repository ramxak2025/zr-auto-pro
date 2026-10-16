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
const { TenantsService } = require('../dist/tenants/tenants.service');
const { ManagerCabinetService } = require('../dist/platform-managers/manager-cabinet.service');
const { ValidationPipe } = require('@nestjs/common');
const { SubscriptionQuoteQueryDto, ExtendSubscriptionDto } = require('../dist/tenants/dto/subscription.dto');
const { ManagerExtendDto } = require('../dist/platform-managers/dto/manager-cabinet.dto');

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
  assert.equal(result.monthlyTotal, 22500);
  assert.equal(result.total, 225000);
  assert.equal(result.extraEmployees, 3);
  assert.equal(result.extraPoints, 2);
  assert.equal(result.serviceMonths, 12);
  assert.equal(result.chargedMonths, 10);
});
test('MAX branch rate applies to the whole annual bundle and exact invoice display', () => {
  const exports = {};
  const source = readFileSync(join(__dirname, '../../shared/utils/subscriptionPricing.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
  });
  for (const [employees, points, monthly, annual, displayed, approximate] of [
    [50, 2, 18000, 180000, 15000, false],
    [51, 2, 18500, 185000, 15416.67, true],
    [53, 3, 22500, 225000, 18750, false],
  ]) {
    for (const pricing of [plans.max, exports.SUBSCRIPTION_PLAN_PRICING.max]) {
      assert.equal(quote(pricing, input(employees, points)).quote.total, monthly);
      const yearly = quote(pricing, input(employees, points, 'yearly')).quote;
      assert.equal(yearly.monthlyTotal, monthly);
      assert.equal(yearly.total, annual);
      assert.equal(yearly.serviceMonths, 12);
      assert.equal(yearly.chargedMonths, 10);
      const display = exports.getSubscriptionMonthlyDisplay(yearly);
      assert.equal(display.amount, displayed);
      assert.equal(display.approximate, approximate);
      assert.equal(yearly.total, annual, 'display must preserve the exact invoice');
    }
  }
  assert.equal(quote({ ...plans.max, extraPointMonthlyPrice: 5000 }, input(50, 2)).quote.total, 20000);
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
test('pricing: both billing periods stay inside the existing payable amount ceiling', () => {
  const pricing = { ...plans.max, monthlyPrice: 99999999, extraEmployeeMonthlyPrice: 1 };
  assert.equal(quote(pricing, input(50)).quote.total, 99999999);
  assert.deepEqual(quote(pricing, input(51)), { ok: false, code: 'INVALID_COUNT' });
  assert.deepEqual(quote(pricing, input(1, 1, 'yearly')), { ok: false, code: 'INVALID_COUNT' });
  assert.equal(quote({ ...pricing, monthlyPrice: 9999999.9 }, input(1, 1, 'yearly')).quote.total, 99999999);
});
test('backend distribution and client helper compute identical quotes', () => {
  const exports = {};
  const source = readFileSync(join(__dirname, '../../shared/utils/subscriptionPricing.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
  });
  for (const code of ['baza', 'pro', 'max'])
    for (const employees of [1, 5, 50, 51, 99, 20000, 200000])
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
test('monthly display divides the exact invoice by service months without changing the invoice', () => {
  const exports = {};
  const source = readFileSync(join(__dirname, '../../shared/utils/subscriptionPricing.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
  });
  const display = exports.getSubscriptionMonthlyDisplay;
  for (const [total, serviceMonths, amount, approximate] of [
    [990, 1, 990, false],
    [9900, 12, 825, false],
    [49900, 12, 4158.33, true],
    [150000, 12, 12500, false],
    [265000, 12, 22083.33, true],
    [100.01, 1, 100.01, false],
    [0.1, 12, 0.01, true],
  ]) {
    const invoice = Object.freeze({ total, serviceMonths });
    assert.equal(display(invoice).amount, amount);
    assert.equal(display(invoice).approximate, approximate);
    assert.equal(invoice.total, total);
  }
});

test('HTTP DTO whitelist retains chosen counts; only GET query strings are converted to numbers', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const query = await pipe.transform(
    { employees: '53', points: '3', ignored: 99 },
    {
      type: 'query',
      metatype: SubscriptionQuoteQueryDto,
    },
  );
  assert.equal(query.employees, 53);
  assert.equal(query.points, 3);
  assert.equal(query.ignored, undefined);
  const service = new TenantsService({ query: () => assert.fail('invalid count must not query SQL') });
  for (const metatype of [ExtendSubscriptionDto, ManagerExtendDto]) {
    for (const count of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2', null, true, [2], {}]) {
      const body = await pipe.transform(
        { type: 'paid', amount: 1, period: 'monthly', employees: count, points: 1 },
        {
          type: 'body',
          metatype,
        },
      );
      await assert.rejects(
        () => service.extend('unused', body),
        (e) => e.getStatus?.() === 400 && e.getResponse().code === 'INVALID_COUNT',
      );
    }
  }
  for (const value of ['', ' ', 'NaN', 'Infinity', '1.1', '0', '-1', ['2'], true, null]) {
    const invalid = await pipe.transform({ employees: value }, { type: 'query', metatype: SubscriptionQuoteQueryDto });
    await assert.rejects(
      () => service.getSubscriptionQuote('unused', 'monthly', {}, undefined, invalid),
      (e) => e.getStatus?.() === 400 && e.getResponse().code === 'INVALID_COUNT',
    );
  }
});

test('all quote paths and manager renewal preserve selected counts and tenant scope', async () => {
  const query = { period: 'yearly', employees: 53, points: 3, planId: 'plan' };
  const calls = [];
  const tenants = {
    getSubscriptionQuote: (...args) => calls.push(args),
    extend: async (...args) => calls.push(args),
    getAll: async () => [{ id: 'tenant' }],
  };
  const controller = new TenantsController(tenants);
  controller.getSubscriptionQuote('tenant', query);
  controller.getOwnSubscriptionQuote({ tenantID: 'tenant' }, query);
  const cabinet = new ManagerCabinetService(undefined, tenants, { resolveActorName: async () => 'Manager' });
  const actor = { userId: 'manager', isManager: true, scope: { managerId: 'manager' } };
  cabinet.getSubscriptionQuote(actor, 'tenant', query);
  assert.deepEqual(calls.splice(0), [
    ['tenant', 'yearly', {}, 'plan', query],
    ['tenant', 'yearly', {}, 'plan', query],
    ['tenant', 'yearly', actor.scope, 'plan', query],
  ]);
  await cabinet.extend(actor, 'tenant', {
    type: 'paid',
    amount: 123,
    period: 'yearly',
    quoteToken: 'token',
    requestId: 'request',
    employees: 53,
    points: 3,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].employees, 53);
  assert.equal(calls[0][1].points, 3);
  assert.equal(calls[0][1].quoteToken, 'token');
  assert.deepEqual(calls[0][3], { scope: actor.scope, credit: { managerId: 'manager' } });
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
