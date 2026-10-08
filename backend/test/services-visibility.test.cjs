const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { BadRequestException, NotFoundException } = require('@nestjs/common');
const { ServicesService } = require('../dist/services/services.service');
const { ServicesController } = require('../dist/services/services.controller');
const { PutServiceVisibilityRuleDto } = require('../dist/services/dto/put-service-visibility-rule.dto');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVICE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROLE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_ROLE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makePool(handler = () => undefined) {
  const log = [];
  const query = async (sql, values) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    log.push({ sql: text, values: Array.isArray(values) ? values.slice() : values });
    return (await handler(text, values)) || { rows: [] };
  };
  return { log, query };
}

const actor = (role = 'master') => ({ userID: USER_ID, tenantID: TENANT_A, role, permissions: {} });
const serviceRow = { id: SERVICE_ID, name: 'Замена масла', category: 'Двигатель/Масло', default_price: '1500', master_percent: null, warranty_days: null, created_at: '2026-10-08' };

test('migration stores exactly one tenant-scoped target; visibility remains separate from service/check authorization', () => {
  const sql = readFileSync(join(__dirname, '..', 'migrations', '178_service_visibility_rules.sql'), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
  assert.match(sql, /service_id IS NOT NULL AND category_path IS NULL/);
  assert.match(sql, /service_id IS NULL AND category_path IS NOT NULL/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, service_id\) REFERENCES services \(tenant_id, id\)/);
  assert.match(sql, /visible_role_ids UUID\[\] NOT NULL DEFAULT '\{\}'/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
});

test('legacy service list stays full; preferred filtering is opt-in, before count and pagination, owner stays full', async () => {
  const pool = makePool((sql) => {
    if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ total: '1' }] };
    if (sql.startsWith('SELECT s.*')) return { rows: [serviceRow] };
    return undefined;
  });
  const service = new ServicesService(pool);

  await service.getAll(TENANT_A, { page: 1, limit: 20 }, actor());
  assert.doesNotMatch(pool.log[0].sql, /service_visibility_rules/);
  assert.doesNotMatch(pool.log[1].sql, /service_visibility_rules/);

  pool.log.length = 0;
  const filtered = await service.getAll(TENANT_A, { page: 2, limit: 20, preferredOnly: 'true', search: 'масло' }, actor());
  assert.equal(filtered.total, 1);
  assert.match(pool.log[0].sql, /SELECT COUNT\(\*\).*LATERAL/);
  assert.match(pool.log[0].sql, /visibility_viewer\.role_id = ANY\(visibility_rule\.visible_role_ids\)/);
  assert.match(pool.log[0].sql, /s\.name ILIKE \$2/);
  assert.match(pool.log[1].sql, /LIMIT \$4 OFFSET \$5/);

  pool.log.length = 0;
  await service.getAll(TENANT_A, { preferredOnly: true }, actor('director'));
  assert.doesNotMatch(pool.log[0].sql, /service_visibility_rules/);
});

test('specific service overrides the closest folder; folder matching is segment-safe for %/_ and sibling prefixes', async () => {
  const pool = makePool((sql) => sql.startsWith('SELECT COUNT(*)') ? { rows: [{ total: '0' }] } : { rows: [] });
  await new ServicesService(pool).getAll(TENANT_A, { preferredOnly: true }, actor());
  const sql = pool.log[0].sql;
  assert.match(sql, /rule\.service_id=s\.id/);
  assert.match(sql, /rule\.service_id IS NULL AND s\.category IS NOT NULL/);
  assert.match(sql, /ORDER BY \(rule\.service_id IS NOT NULL\) DESC, length\(rule\.category_path\) DESC/);
  assert.match(sql, /regexp_replace\(regexp_replace\(regexp_replace\(btrim\(s\.category\)/);
  assert.match(sql, /'\\s\*\/\\s\*'/);
  assert.match(sql, /'\/\+'/);
  assert.match(sql, /left\(regexp_replace\(regexp_replace\(regexp_replace\(btrim\(s\.category\)/);
  assert.doesNotMatch(sql, /\bLIKE\b/);
});

test('rule validation accepts visible system/tenant roles only and normalizes path segments without wildcard semantics', async () => {
  const pool = makePool((sql) => {
    if (sql.includes('FROM roles')) return { rows: [
      { id: ROLE_ID, tenant_id: null, system_key: 'master' },
      { id: OTHER_ROLE_ID, tenant_id: TENANT_B, system_key: null },
    ] };
    if (sql.includes('SELECT id FROM services')) return { rows: [{ id: SERVICE_ID }] };
    if (sql.startsWith('INSERT INTO service_visibility_rules')) return { rows: [{ service_id: null, category_path: 'Двигатель/Масло/%_тест', visible_role_ids: [ROLE_ID] }] };
    return undefined;
  });
  const service = new ServicesService(pool);
  const dto = Object.assign(new PutServiceVisibilityRuleDto(), { categoryPath: ' Двигатель / Масло // %_тест ', visibleRoleIds: [ROLE_ID] });
  const result = await service.putVisibilityRule(TENANT_A, dto);
  assert.equal(result.categoryPath, 'Двигатель/Масло/%_тест');
  const insert = pool.log.find((q) => q.sql.startsWith('INSERT INTO service_visibility_rules'));
  assert.equal(insert.values[2], 'Двигатель/Масло/%_тест');

  const configPool = makePool((sql) => {
    if (sql.includes('SELECT service_id, category_path')) return { rows: [] };
    if (sql.includes('SELECT DISTINCT category')) return { rows: [{ category: ' Двигатель / Масло// Фильтр ' }] };
    if (sql.includes('FROM roles')) return { rows: [] };
    return undefined;
  });
  const config = await new ServicesService(configPool).getVisibilityConfig(TENANT_A);
  assert.deepEqual(config.categoryPaths, ['Двигатель', 'Двигатель/Масло', 'Двигатель/Масло/Фильтр']);

  const foreignRolePool = makePool((sql) => sql.includes('FROM roles') ? { rows: [{ id: ROLE_ID, tenant_id: TENANT_A, system_key: null }] } : undefined);
  const foreignDto = Object.assign(new PutServiceVisibilityRuleDto(), { categoryPath: 'Двигатель', visibleRoleIds: [OTHER_ROLE_ID] });
  await assert.rejects(new ServicesService(foreignRolePool).putVisibilityRule(TENANT_A, foreignDto), (err) => err instanceof BadRequestException);
});

test('service rule requires a tenant-owned service; reset deletes only that service or exact category rule', async () => {
  const pool = makePool((sql) => {
    if (sql.includes('FROM roles')) return { rows: [{ id: ROLE_ID, tenant_id: TENANT_A, system_key: null }] };
    if (sql.includes('SELECT id FROM services')) return { rows: [] };
    return undefined;
  });
  const dto = Object.assign(new PutServiceVisibilityRuleDto(), { serviceId: SERVICE_ID, visibleRoleIds: [ROLE_ID] });
  await assert.rejects(new ServicesService(pool).putVisibilityRule(TENANT_A, dto), (err) => err instanceof NotFoundException);

  const deletions = makePool();
  const service = new ServicesService(deletions);
  await service.deleteVisibilityRule(TENANT_A, { serviceId: SERVICE_ID });
  await service.deleteVisibilityRule(TENANT_A, { categoryPath: 'Двигатель/%_тест' });
  assert.deepEqual(deletions.log.map((q) => q.values), [[TENANT_A, SERVICE_ID], [TENANT_A, 'Двигатель/%_тест']]);
});

test('list preferredOnly is optional and rule mutations remain under services_manage', () => {
  const getAll = ServicesController.prototype.getAll.toString();
  assert.match(getAll, /getAll\(user\.tenantID, query, user\)/);
  const controller = readFileSync(join(__dirname, '..', 'src', 'services', 'services.controller.ts'), 'utf8');
  assert.match(controller, /@RequirePermission\('services_manage'\)\s+@Put\('visibility\/rule'\)/);
  assert.match(controller, /@RequirePermission\('services_view'\)\s+@Get\(\)/);
  assert.doesNotMatch(controller, /preferredOnly[\s\S]*RequirePermission\('services_manage'\)/);
});
