const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { ForbiddenException, BadRequestException, ConflictException } = require('@nestjs/common');
const { UsersService } = require('../dist/users/users.service');
const { TenantWriteGuardInterceptor } = require('../dist/common/interceptors/tenant-write-guard.interceptor');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DIRECTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makePool(handler = () => undefined) {
  const log = [];
  const query = async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    log.push({ sql: text, params: Array.isArray(params) ? params.slice() : params });
    return (await handler(text, params)) || { rows: [] };
  };
  return {
    log,
    query,
    connect: async () => ({ query, release() {} }),
  };
}

function service(pool) {
  return new UsersService(pool, { sendDataToTenant: async () => undefined });
}

const owner = (role = 'director', tenantID = TENANT_A) => ({ userID: USER_ID, role, tenantID, permissions: {} });

test('migration and direction API are tenant-bound; cross-tenant assignment is rejected before update', async () => {
  const migration = readFileSync(join(__dirname, '..', 'migrations', '177_employee_directions.sql'), 'utf8');
  assert.match(migration, /FOREIGN KEY \(tenant_id, direction_id\)\s+REFERENCES employee_directions \(tenant_id, id\)/);
  assert.match(migration, /ON employee_directions \(tenant_id, lower\(name\)\)/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);

  const pool = makePool((sql) => {
    if (sql.includes('FROM users u') && sql.includes('AS direction_name')) {
      return { rows: [{ id: USER_ID, tenant_id: TENANT_A, direction_id: DIRECTION_ID, direction_name: 'Мотористы', full_name: 'Иван', role: 'master' }] };
    }
    if (sql.includes('SELECT role,') && sql.includes('FROM users WHERE id=$1')) return { rows: [{ role: 'master', salary_percent: '0', product_salary_percent: '0', permissions: {}, direction_id: null, direction_name: null }] };
    if (sql.includes('SELECT name FROM employee_directions')) return { rows: [] };
    return undefined;
  });
  const users = service(pool);

  await assert.rejects(users.listDirections(owner('superadmin', '00000000-0000-0000-0000-000000000000')), (err) => {
    assert.equal(err.getStatus(), 403);
    assert.equal(err.getResponse().message, 'Выберите автосервис');
    return true;
  });
  await assert.rejects(users.update(USER_ID, TENANT_A, 'director', USER_ID, { directionId: DIRECTION_ID }), (err) => {
    assert.ok(err instanceof BadRequestException);
    return true;
  });
  assert.equal(pool.log.some((q) => q.sql.startsWith('UPDATE users SET')), false);
});

test('tenantless superadmin direction writes keep the systemic 409; direct service list rejects with 403', () => {
  const interceptor = new TenantWriteGuardInterceptor({ getAllAndOverride: () => undefined });
  const context = {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ method: 'POST', path: '/users/directions', user: owner('superadmin', '00000000-0000-0000-0000-000000000000') }) }),
  };
  assert.throws(() => interceptor.intercept(context, { handle: () => ({}) }), (err) => {
    assert.ok(err instanceof ConflictException);
    assert.equal(err.getStatus(), 409);
    assert.equal(err.getResponse().code, 'NO_TENANT_CONTEXT');
    return true;
  });
});

test('direction CRUD is owner-only, rename leaves user assignments alone, delete clears assignments transactionally', async () => {
  const pool = makePool((sql) => {
    if (sql.includes('SELECT id FROM employee_directions') && sql.includes('FOR UPDATE')) return { rows: [{ id: DIRECTION_ID }] };
    if (sql.startsWith('INSERT INTO employee_directions')) return { rows: [{ id: DIRECTION_ID, tenant_id: TENANT_A, name: 'Мотористы', sort_order: 0 }] };
    if (sql.startsWith('UPDATE employee_directions')) return { rows: [{ id: DIRECTION_ID, tenant_id: TENANT_A, name: 'Ходовики', sort_order: 0 }] };
    return undefined;
  });
  const users = service(pool);

  await assert.rejects(users.createDirection(owner('admin'), { name: 'Мотористы' }), (err) => err instanceof ForbiddenException);
  assert.equal(pool.log.length, 0, 'unauthorized direction management must not reach SQL');
  await users.createDirection(owner(), { name: ' Мотористы ' });
  await users.updateDirection(owner(), DIRECTION_ID, { name: 'Ходовики' });
  assert.equal(pool.log.some((q) => q.sql.startsWith('UPDATE users SET')), false, 'rename preserves direction ids/assignments');

  await users.deleteDirection(owner(), DIRECTION_ID);
  const clearIndex = pool.log.findIndex((q) => q.sql.startsWith('UPDATE users SET direction_id=NULL'));
  const deleteIndex = pool.log.findIndex((q) => q.sql.startsWith('DELETE FROM employee_directions'));
  assert.ok(clearIndex >= 0 && deleteIndex > clearIndex, 'assignments clear before tenant-scoped delete');
  assert.ok(pool.log.some((q) => q.sql === 'BEGIN'));
  assert.ok(pool.log.some((q) => q.sql === 'COMMIT'));
});

test('user list maps direction id and name without changing its tenant/point filters', async () => {
  const pool = makePool((sql) => sql.includes('FROM users u') ? {
    rows: [{ id: USER_ID, tenant_id: TENANT_A, direction_id: DIRECTION_ID, direction_name: 'Мотористы', full_name: 'Иван', role: 'master', is_active: true }],
  } : undefined);
  const rows = await service(pool).getAll(owner(), null);
  assert.equal(rows[0].directionId, DIRECTION_ID);
  assert.equal(rows[0].directionName, 'Мотористы');
  assert.match(pool.log[0].sql, /LEFT JOIN employee_directions ed ON ed.id=u.direction_id AND ed.tenant_id=u.tenant_id/);
  assert.match(pool.log[0].sql, /u\.tenant_id = \$1/);
});

test('owner can clear an assignment with null; non-owner cannot change even to unassigned', async () => {
  const pool = makePool((sql) => {
    if (sql.startsWith('SELECT role,')) return { rows: [{ role: 'master', salary_percent: '0', product_salary_percent: '0', permissions: {}, direction_id: DIRECTION_ID, direction_name: 'Мотористы' }] };
    if (sql.startsWith('UPDATE users SET')) return { rows: [{ id: USER_ID, tenant_id: TENANT_A, direction_id: null, full_name: 'Иван', role: 'master' }] };
    return undefined;
  });
  const users = service(pool);
  await assert.rejects(users.update(USER_ID, TENANT_A, 'admin', 'manager', { directionId: null }), (err) => err instanceof ForbiddenException);
  assert.equal(pool.log.some((q) => q.sql.startsWith('UPDATE users SET')), false);

  const result = await users.update(USER_ID, TENANT_A, 'director', 'boss', { directionId: null });
  assert.equal(result.directionId, null);
  const update = pool.log.find((q) => q.sql.startsWith('UPDATE users SET'));
  assert.match(update.sql, /direction_id=\$1/);
  assert.equal(update.params[0], null);
});
