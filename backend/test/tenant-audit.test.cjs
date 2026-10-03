const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const { AuditService } = require('../dist/tenants/audit.service');
const { ManagerCabinetService } = require('../dist/platform-managers/manager-cabinet.service');
const { ManagerCabinetController } = require('../dist/platform-managers/manager-cabinet.controller');
const { TenantsController } = require('../dist/tenants/tenants.controller');
const { RolesGuard } = require('../dist/common/guards/roles.guard');
const { Reflector } = require('@nestjs/core');

const tenantId = '11111111-1111-4111-8111-111111111111';
const managerId = '22222222-2222-4222-8222-222222222222';

function fixture(rows) {
  const calls = [];
  return {
    calls,
    service: new AuditService({
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows };
      },
    }),
  };
}

test('tenant journal distinguishes an empty accessible tenant from a missing/foreign tenant', async () => {
  assert.deepEqual(await fixture([{ id: null }]).service.listForTenant(tenantId, managerId), []);
  await assert.rejects(fixture([]).service.listForTenant(tenantId, managerId), (err) => err.getStatus() === 404);
  // Pagination past the last row still means an empty journal, not a missing tenant.
  assert.deepEqual(await fixture([{ id: null }]).service.listForTenant(tenantId, managerId, 50, 100), []);
});

test('access and log selection share one snapshot; selected tenant scopes BOTH target and detail entries', async () => {
  const { calls, service } = fixture([{ id: 'log-1', action: 'impersonate', detail: '{"tenantId":"one"}' }]);
  const result = await service.listForTenant(tenantId, managerId, '25', '10');
  assert.equal(calls.length, 1, 'no check-then-read window during tenant transfer');
  assert.deepEqual(calls[0].params, [tenantId, managerId, 25, 10]);
  const sql = calls[0].sql.replace(/\s+/g, ' ');
  assert.match(sql, /FROM tenants t LEFT JOIN LATERAL/);
  assert.match(sql, /target_type = 'tenant' AND target_id = t\.id::text/);
  assert.match(sql, /OR detail->>'tenantId' = t\.id::text/);
  assert.match(sql, /WHERE t\.id = \$1::uuid AND \(\$2::uuid IS NULL OR t\.manager_id = \$2::uuid\)/);
  assert.doesNotMatch(sql, /actor_user_id =/, 'actor alone is not a tenant boundary');
  assert.equal(result[0].actorName, null);
  assert.deepEqual(result[0].detail, { tenantId: 'one' });
});

test('audit pagination is bounded and parameterized even for malicious input', async () => {
  const { service, calls } = fixture([{ id: null }]);
  await service.listForTenant(tenantId, null, '50; DROP TABLE users', '-10');
  await service.listForTenant(tenantId, managerId, 999999, Infinity);
  assert.deepEqual(
    calls.map((c) => c.params),
    [
      [tenantId, null, 50, 0],
      [tenantId, managerId, 200, 0],
    ],
  );
});

test('manager controller passes the JWT actor scope; superadmin is the only unscoped actor', async () => {
  const calls = [];
  const cabinet = new ManagerCabinetService(
    null,
    null,
    {
      listForTenant: async (...args) => {
        calls.push(args);
        return [];
      },
    },
    null,
    null,
  );
  const controller = new ManagerCabinetController(cabinet);
  await controller.tenantAuditLog({ userID: managerId, role: 'manager' }, tenantId, '15', '30');
  await controller.tenantAuditLog({ userID: managerId, role: 'superadmin' }, tenantId);
  assert.deepEqual(calls, [
    [tenantId, managerId, '15', '30'],
    [tenantId, null, undefined, undefined],
  ]);
  assert.throws(
    () => controller.tenantAuditLog({ userID: managerId, role: 'master' }, tenantId),
    (err) => err.getStatus() === 403,
  );
});

test('tenant journal routes retain role guards, including the new superadmin endpoint', () => {
  const guard = new RolesGuard(new Reflector());
  for (const Controller of [TenantsController, ManagerCabinetController]) {
    for (const role of ['master', 'admin', 'director', 'manager', 'superadmin']) {
      const context = {
        getClass: () => Controller,
        getHandler: () => Controller.prototype.tenantAuditLog,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      };
      const expected = role === 'superadmin' || (Controller === ManagerCabinetController && role === 'manager');
      assert.equal(guard.canActivate(context), expected, `${Controller.name}: ${role}`);
    }
  }
});

test('a revoked assignment does not fall back to the manager global journal', async () => {
  const cabinet = new ManagerCabinetService(null, null, fixture([]).service, null, null);
  const controller = new ManagerCabinetController(cabinet);
  await assert.rejects(
    controller.tenantAuditLog({ userID: managerId, role: 'manager' }, tenantId),
    (err) => err.getStatus() === 404,
  );
});
