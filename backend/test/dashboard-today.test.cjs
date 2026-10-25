const test = require('node:test');
const assert = require('node:assert/strict');
const { SalaryService } = require('../dist/salary/salary.service');

test('today earnings is a bounded read independent of payments and preserves cents/negative earnings', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('FROM tenants')) return { rows: [{ timezone: 'Europe/Moscow' }] };
      return {
        rows: [
          { id: 'one', name: 'Мастер', avatar: null, earned_amount: '5000.03', total: '4999.98' },
          { id: 'two', name: 'Штраф', avatar: null, earned_amount: '-0.05', total: '4999.98' },
        ],
      };
    },
  };
  const result = await new SalaryService(pool).getTodayEarnings('today-test-tenant', 'point');
  assert.equal(result.employees[0].earnedAmount, 5000.03);
  assert.equal(result.employees[1].earnedAmount, -0.05);
  assert.equal(result.total, 4999.98);
  assert.equal(calls.length, 2);
  assert.equal(result.pointId, 'point');
});

const { DashboardService } = require('../dist/dashboard/dashboard.service');
const { SalaryController } = require('../dist/salary/salary.controller');
const { PermissionsGuard } = require('../dist/common/guards/permissions.guard');
const { Reflector } = require('@nestjs/core');
const { randomUUID } = require('node:crypto');

test('salary team endpoint requires salary_view_all independently of financial_reports', () => {
  const guard = new PermissionsGuard(new Reflector());
  const context = (permissions) => ({
    getHandler: () => SalaryController.prototype.getTodayEarnings,
    getClass: () => SalaryController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role: 'master', permissions } }) }),
  });
  assert.throws(() =>
    guard.canActivate(context({ salary_view: true, financial_reports: true, salary_view_all: false })),
  );
  assert.equal(guard.canActivate(context({ salary_view_all: true, financial_reports: false })), true);
});

test('attention omits denied sources without querying them, distinguishes error and truezero, exactcounts uncapped', async () => {
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('FROM tenants')) return { rows: [{ timezone: 'Asia/Vladivostok' }] };
      if (sql.includes('FROM purchase_orders')) throw new Error('source unavailable');
      return { rows: [{ count: sql.includes('FROM products') ? '0' : '900' }] };
    },
  };
  const actor = {
    tenantID: randomUUID(),
    userID: 'self',
    role: 'master',
    permissions: {
      bookings_access: false,
      checks_view: false,
      suppliers_access: false,
      warehouse_access: false,
      debts_manage: false,
    },
  };
  const service = new DashboardService(pool);
  assert.deepEqual((await service.attention(actor)).buckets, []);
  assert.equal(calls.length, 1);
  Object.assign(actor.permissions, { checks_view: true, suppliers_access: true, warehouse_access: true });
  const buckets = (await service.attention(actor)).buckets;
  assert.deepEqual(buckets, [
    { id: 'deferred', count: 900 },
    { id: 'purchase-orders', count: null, error: true },
    { id: 'low-stock', count: 0 },
  ]);
  assert.equal(calls.length, 4);
});
