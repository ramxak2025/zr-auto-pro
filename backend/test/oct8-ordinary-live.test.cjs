// Opt-in behavioral contracts on the explicitly isolated October-8 PostgreSQL16 fixture.
// Application SQL is never mocked: fault/lock hooks only control execution boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { Logger, Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
require('reflect-metadata');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { UsersService } = require('../dist/users/users.service');
const { ServicesService } = require('../dist/services/services.service');
const { CheckTemplatesService } = require('../dist/check-templates/check-templates.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
const { RolesService } = require('../dist/roles/roles.service');
const { RolesController } = require('../dist/roles/roles.controller');
const { CheckTemplatesController } = require('../dist/check-templates/check-templates.controller');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { TenantContextInterceptor } = require('../dist/common/interceptors/tenant-context.interceptor');
Logger.overrideLogger(false);
const status = (code) => (error) => error.getStatus?.() === code;
const live = process.env.OCT8_ORDINARY_LIVE_DB;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('October-8 ordinary contracts / PostgreSQL16 real RLS and HTTP', { skip: !live, timeout: 120000 }, async (t) => {
  const url = new URL(live);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55438');
  assert.equal(url.pathname, '/autexa_oct8_test');
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  appUrl.password = process.env.OCT8_ORDINARY_APP_PASSWORD;
  assert.ok(appUrl.password, 'explicit disposable app password required');
  const applicationName = 'oct8-ordinary-' + randomUUID();
  const admin = new Pool({ connectionString: live, max: 8, statement_timeout: 8000 });
  const app = new Pool({ connectionString: appUrl.toString(), max: 8, statement_timeout: 8000, application_name: applicationName });
  const pool = new TenantAwarePool(admin, app);
  const tenants = [];
  const q = async (sql, values = []) => (await admin.query(sql, values)).rows;
  const one = async (sql, values = []) => (await q(sql, values))[0];
  const push = { sendDataToTenant: async () => undefined };
  const users = new UsersService(pool, push);
  const services = new ServicesService(pool);
  const templates = new CheckTemplatesService(pool);
  const seed = async () => {
    const f = Object.fromEntries(['tenant', 'owner', 'staff', 'otherStaff', 'role', 'point'].map((key) => [key, randomUUID()]));
    tenants.push(f.tenant);
    await q("INSERT INTO tenants(id,name,timezone) VALUES($1,$2,'Europe/Moscow')", [f.tenant, 'Ordinary QA ' + f.tenant]);
    await q("INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$2,'Main',true)", [f.point, f.tenant]);
    await q("INSERT INTO roles(id,tenant_id,name,matrix) VALUES($1,$2,'Custom QA','{}')", [f.role, f.tenant]);
    for (const [id, role] of [[f.owner, 'director'], [f.staff, 'master'], [f.otherStaff, 'master']]) {
      await q("INSERT INTO users(id,tenant_id,phone,password,full_name,role,role_id) VALUES($1,$2,$6,'fixture-unused',$3,$4,$5)", [id, f.tenant, role + ' QA', role, role === 'master' ? f.role : null, id]);
    }
    f.run = (fn) => runWithTenant(f.tenant, fn);
    f.actor = { userID: f.owner, tenantID: f.tenant, role: 'director', permissions: {}, pointId: f.point };
    f.viewer = { userID: f.staff, tenantID: f.tenant, role: 'master', permissions: {}, pointId: f.point };
    f.manager = { ...f.viewer, permissions: { templates_shared_manage: true } };
    f.folder = (name, parentId = null, actor = f.manager, isShared = false) => f.run(() => templates.createFolder(f.tenant, actor, { name, parentId, isShared }));
    f.tpl = (name, folderId = null, actor = f.manager, shared = false) => f.run(() => templates.create(f.tenant, actor, { name, folderId, shared, services: [{ name: 'Saved line', price: 777 }] }));
    f.svc = async (name, category = null) => (await one('INSERT INTO services(tenant_id,name,category,default_price) VALUES($1,$2,$3,1234) RETURNING id', [f.tenant, name, category])).id;
    return f;
  };
  // Wrap real clients only; PostgreSQL still executes every SELECT/UPDATE/lock.
  const clientHookPool = (hook) => ({
    query: (...args) => pool.query(...args),
    connect: async () => {
      const client = await pool.connect();
      return { query: async (sql, values) => hook(client, String(sql), values), release: () => client.release() };
    },
  });
  const waitBlocked = async () => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const row = await one("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'", [applicationName]);
      if (row.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('second tree writer did not wait on a real PostgreSQL advisory lock');
  };
  const treeRace = async (f, firstWork, secondWork) => {
    const entered = deferred(), resume = deferred();
    let intercepted = false;
    const hooked = new CheckTemplatesService(clientHookPool(async (client, sql, values) => {
      const result = await client.query(sql, values);
      if (sql.includes('pg_advisory_xact_lock') && !intercepted) {
        intercepted = true; entered.resolve(); await resume.promise;
      }
      return result;
    }));
    const first = f.run(() => firstWork(hooked));
    await entered.promise;
    const second = f.run(() => secondWork(templates)).then((value) => ({ value }), (error) => ({ error }));
    try { await waitBlocked(); } finally { resume.resolve(); }
    const value = await first;
    return { first: value, second: await second };
  };
  let httpApp;
  try {
    await t.test('fixture has migrations177–181, PostgreSQL16, enforced RLS and no leaked app GUC', async () => {
      assert.match((await one('SHOW server_version')).server_version, /^16\./);
      assert.deepEqual(await one("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='autexa_app'"), { rolsuper: false, rolbypassrls: false });
      const migrations = await q("SELECT name FROM _migrations WHERE name ~ '^(177|178|179|180|181)_' ORDER BY name");
      assert.equal(migrations.length, 5);
      for (const table of ['employee_directions', 'service_visibility_rules', 'check_templates', 'check_template_folders']) {
        const row = await one('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1', [table]);
        assert.deepEqual(row, { relrowsecurity: true, relforcerowsecurity: true });
      }
      const f = await seed(), foreign = await seed();
      const direction = await f.run(() => users.createDirection(f.actor, { name: 'Local' }));
      assert.equal((await foreign.run(() => pool.query('SELECT id FROM employee_directions WHERE id=$1', [direction.id]))).rows.length, 0);
      await assert.rejects(foreign.run(() => pool.query("INSERT INTO employee_directions(tenant_id,name) VALUES($1,'bad')", [f.tenant])), (error) => error.code === '42501');
      await f.folder('Private'); await f.folder('Shared', null, f.manager, true);
      assert.equal((await foreign.run(() => templates.getFolders(f.tenant, foreign.actor))).length, 0);
      assert.equal((await app.query('SELECT id FROM employee_directions')).rows.length, 0);
      assert.equal((await app.query("SELECT NULLIF(current_setting('app.tenant_id',true),'') AS tenant")).rows[0].tenant, null);
    });

    await t.test('directions: own/null and foreign assignment before any profile mutation; role/team unchanged', async () => {
      const f = await seed(), foreign = await seed();
      const own = await f.run(() => users.createDirection(f.actor, { name: 'Own' }));
      const other = await foreign.run(() => users.createDirection(foreign.actor, { name: 'Other' }));
      const assign = (dto) => f.run(() => users.update(f.staff, f.tenant, 'director', f.owner, dto));
      await assign({ directionId: own.id });
      const before = await one('SELECT direction_id,full_name,role,team,is_active FROM users WHERE id=$1', [f.staff]);
      await assert.rejects(assign({ directionId: other.id, fullName: 'Must not change' }), status(400));
      assert.deepEqual(await one('SELECT direction_id,full_name,role,team,is_active FROM users WHERE id=$1', [f.staff]), before);
      await assert.rejects(f.run(() => users.update(f.staff, f.tenant, 'admin', f.otherStaff, { directionId: null })), status(403));
      const assigned = await f.run(() => users.getAll(f.actor, null));
      assert.equal(assigned.find((user) => user.id === f.staff).directionId, own.id);
      await assign({ directionId: null });
      assert.equal((await one('SELECT direction_id FROM users WHERE id=$1', [f.staff])).direction_id, null);
    });

    await t.test('directions: delete clears all assigned staff atomically; injected failure rolls back actual rows', async () => {
      const f = await seed(), foreign = await seed();
      const direction = await f.run(() => users.createDirection(f.actor, { name: 'Delete' }));
      const other = await foreign.run(() => users.createDirection(foreign.actor, { name: 'Delete' }));
      await q('UPDATE users SET direction_id=$1 WHERE id=ANY($2::uuid[])', [direction.id, [f.staff, f.otherStaff]]);
      await q('UPDATE users SET direction_id=$1 WHERE id=$2', [other.id, foreign.staff]);
      const fault = new UsersService(clientHookPool(async (client, sql, values) => {
        if (sql.startsWith('DELETE FROM employee_directions')) throw new Error('fixture delete fault');
        return client.query(sql, values);
      }), push);
      await assert.rejects(f.run(() => fault.deleteDirection(f.actor, direction.id)), /fixture delete fault/);
      assert.equal((await one('SELECT count(*)::int n FROM users WHERE direction_id=$1', [direction.id])).n, 2);
      assert.equal((await one('SELECT count(*)::int n FROM employee_directions WHERE id=$1', [direction.id])).n, 1);
      await f.run(() => users.deleteDirection(f.actor, direction.id));
      assert.equal((await one('SELECT count(*)::int n FROM users WHERE direction_id=$1', [direction.id])).n, 0);
      assert.equal((await one('SELECT direction_id FROM users WHERE id=$1', [foreign.staff])).direction_id, other.id);
    });

    await t.test('directions: assign/delete race cannot leave an orphan or stale assignment', async () => {
      const f = await seed();
      const direction = await f.run(() => users.createDirection(f.actor, { name: 'Race' }));
      const results = await Promise.allSettled([
        f.run(() => users.update(f.staff, f.tenant, 'director', f.owner, { directionId: direction.id })),
        f.run(() => users.deleteDirection(f.actor, direction.id)),
      ]);
      assert.equal(results[1].status, 'fulfilled');
      if (results[0].status === 'rejected') assert.equal(results[0].reason.getStatus(), 400);
      assert.equal((await one('SELECT direction_id FROM users WHERE id=$1', [f.staff])).direction_id, null);
      assert.equal((await one('SELECT count(*)::int n FROM employee_directions WHERE id=$1', [direction.id])).n, 0);
    });

    await t.test('directions: locked deletion versus concurrent assignment avoids deadlock/500', async () => {
      const f = await seed();
      const direction = await f.run(() => users.createDirection(f.actor, { name: 'Locked race' }));
      const entered = deferred(), resume = deferred();
      const deleting = new UsersService(clientHookPool(async (client, sql, values) => {
        const result = await client.query(sql, values);
        if (sql.includes('SELECT id FROM employee_directions') && sql.includes('FOR UPDATE')) {
          entered.resolve(); await resume.promise;
        }
        return result;
      }), push);
      const removal = f.run(() => deleting.deleteDirection(f.actor, direction.id)).then((value) => ({ value }), (error) => ({ error }));
      await entered.promise;
      const assignment = f.run(() => users.update(f.staff, f.tenant, 'director', f.owner, { directionId: direction.id })).then((value) => ({ value }), (error) => ({ error }));
      try {
        const deadline = Date.now() + 3000;
        let blocked = false;
        while (Date.now() < deadline) {
          const row = await one("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'UPDATE users SET%'", [applicationName]);
          if (row.n) { blocked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.ok(blocked, 'assignment must reach an actual FK lock wait before deletion resumes');
      } finally { resume.resolve(); }
      const [deleted, assigned] = await Promise.all([removal, assignment]);
      assert.ok(!deleted.error, 'deletion failed: ' + (deleted.error?.code || deleted.error?.message));
      if (assigned.error) assert.equal(assigned.error.getStatus?.(), 400, 'assignment failed: ' + (assigned.error.code || assigned.error.message));
      assert.equal((await one('SELECT direction_id FROM users WHERE id=$1', [f.staff])).direction_id, null);
    });

    await t.test('visibility: actual nearest/direct/new-child rules, normalized segments, literal %/_ and sibling prefixes', async () => {
      const f = await seed();
      const ids = {};
      for (const [name, category] of [['root', 'Engine'], ['near', 'Engine/Oil/Filter'], ['direct', 'Engine/Oil'], ['sibling', 'EngineX/Oil'], ['literal', 'A%_/Child'], ['wildcardNeighbor', 'ABC/Child'], ['normalized', ' / Engine // Oil / Filter / '], ['unruled', null]]) ids[name] = await f.svc(name, category);
      const rule = (dto) => f.run(() => services.putVisibilityRule(f.tenant, dto));
      await rule({ categoryPath: 'Engine', visibleRoleIds: [] });
      await rule({ categoryPath: 'Engine/Oil', visibleRoleIds: [f.role] });
      await rule({ serviceId: ids.direct, visibleRoleIds: [] });
      await rule({ categoryPath: 'A%_', visibleRoleIds: [] });
      ids.future = await f.svc('future', 'Engine/Oil/New/Child');
      const preferred = await f.run(() => services.getAll(f.tenant, { preferredOnly: true, limit: 100 }, f.viewer));
      assert.deepEqual(preferred.data.map((row) => row.name).sort(), ['future', 'near', 'normalized', 'sibling', 'unruled', 'wildcardNeighbor']);
      assert.equal(preferred.total, 6);
      const full = await f.run(() => services.getAll(f.tenant, { limit: 100 }, f.viewer));
      assert.equal(full.total, 9);
      assert.equal((await f.run(() => services.getById(ids.direct, f.tenant))).id, ids.direct);
      assert.equal((await f.run(() => services.getAll(f.tenant, { preferredOnly: true, limit: 100 }, f.actor))).total, 9);
    });

    await t.test('visibility: foreign role/service rejection leaves config unchanged; filter COUNT before >1000 records pagination', async () => {
      const f = await seed(), foreign = await seed();
      const hidden = await f.svc('hidden', 'Hidden');
      const foreignService = await foreign.svc('foreign');
      await f.run(() => services.putVisibilityRule(f.tenant, { categoryPath: 'Hidden', visibleRoleIds: [] }));
      await assert.rejects(f.run(() => services.putVisibilityRule(f.tenant, { serviceId: hidden, visibleRoleIds: [foreign.role] })), status(400));
      await assert.rejects(f.run(() => services.putVisibilityRule(f.tenant, { serviceId: foreignService, visibleRoleIds: [f.role] })), status(404));
      assert.equal((await one('SELECT count(*)::int n FROM service_visibility_rules WHERE tenant_id=$1', [f.tenant])).n, 1);
      await q("INSERT INTO services(tenant_id,name,category,default_price) SELECT $1,'visible-'||lpad(n::text,4,'0'),'Shown',100 FROM generate_series(1,1005) n", [f.tenant]);
      await q("INSERT INTO services(tenant_id,name,category,default_price) SELECT $1,'hidden-'||lpad(n::text,4,'0'),'Hidden',100 FROM generate_series(1,1007) n", [f.tenant]);
      const seen = [];
      for (let page = 1; page <= 3; page++) {
        const result = await f.run(() => services.getAll(f.tenant, { preferredOnly: true, page, limit: 500 }, f.viewer));
        assert.equal(result.total, 1005); assert.equal(result.data.length, page === 3 ? 5 : 500);
        seen.push(...result.data.map((row) => row.id));
      }
      assert.equal(new Set(seen).size, 1005);
      assert.equal((await f.run(() => services.getAll(f.tenant, { preferredOnly: true, search: 'visible-100', page: 1, limit: 2 }, f.viewer))).total, 6);
      const fullIds = [];
      for (let page = 1; page <= 5; page++) {
        const full = await f.run(() => services.getAll(f.tenant, { page, limit: 500 }, f.viewer));
        assert.equal(full.total, 2013); assert.equal(full.data.length, page === 5 ? 13 : 500);
        fullIds.push(...full.data.map((row) => row.id));
      }
      assert.equal(new Set(fullIds).size, 2013); assert.ok(fullIds.includes(hidden));
    });

    await t.test('visibility does not filter saved check/order/template lines or change their name/price', async () => {
      const f = await seed();
      const hidden = await f.svc('catalog hidden', 'Hide');
      await f.run(() => services.putVisibilityRule(f.tenant, { serviceId: hidden, visibleRoleIds: [] }));
      const checks = new ChecksService(pool, new WarrantyService(pool), new ClientsService(pool, undefined));
      const created = await f.run(() => checks.create(f.tenant, f.staff, 'master', {
        masterId: f.staff, isDeferred: true, services: [{ serviceId: hidden, masterId: f.staff, name: 'Added hidden service', price: 888, quantity: 1 }],
      }, f.viewer));
      assert.equal(created.services[0].serviceId, hidden); assert.equal(created.services[0].price, 888);
      for (const deferredCheck of [false, true]) {
        const check = await one("INSERT INTO checks(tenant_id,master_id,is_deferred,payment_method,date) VALUES($1,$2,$3,'cash',now()) RETURNING id", [f.tenant, f.staff, deferredCheck]);
        await q('INSERT INTO check_service_lines(check_id,service_id,master_id,name,quantity,price,total) VALUES($1,$2,$3,$4,1,777,777)', [check.id, hidden, f.staff, 'Historical saved label']);
        const result = await f.run(() => checks.getByIdForActor(check.id, f.tenant, f.viewer));
        assert.equal(result.services.length, 1); assert.equal(result.services[0].name, 'Historical saved label'); assert.equal(result.services[0].price, 777);
      }
      const tpl = await f.run(() => templates.create(f.tenant, f.viewer, { name: 'Saved template', services: [{ serviceId: hidden, name: 'Historical saved label', price: 777 }] }));
      const saved = (await f.run(() => templates.getAll(f.tenant, f.staff))).find((row) => row.id === tpl.id);
      assert.deepEqual(saved.services, [{ serviceId: hidden, name: 'Historical saved label', price: 777, quantity: 1 }]);
      assert.equal((await f.run(() => services.getAll(f.tenant, { preferredOnly: true }, f.viewer))).total, 0);
    });

    await t.test('templates: nested publication retains IDs, detaches root, reader sees common but not other private even director', async () => {
      const f = await seed(), foreign = await seed();
      const parent = await f.folder('Parent'), root = await f.folder('Root', parent.id), child = await f.folder('Child', root.id);
      const rootTpl = await f.tpl('Root template', root.id), childTpl = await f.tpl('Child template', child.id);
      const privateOther = await f.folder('Other employee private', null, { ...f.manager, userID: f.otherStaff });
      const privateOtherTpl = await f.tpl('Other employee private template', privateOther.id, { ...f.manager, userID: f.otherStaff });
      const foreignFolder = await foreign.folder('Foreign');
      await assert.rejects(f.run(() => templates.updateFolder(privateOther.id, f.tenant, f.actor, { name: 'Owner cannot change' })), status(404));
      await assert.rejects(f.run(() => templates.update(privateOtherTpl.id, f.tenant, f.actor, { name: 'Owner cannot change' })), status(404));
      await assert.rejects(f.run(() => templates.updateFolder(foreignFolder.id, f.tenant, f.actor, { isShared: true })), status(404));
      const published = await f.run(() => templates.updateFolder(root.id, f.tenant, f.manager, { isShared: true }));
      assert.equal(published.id, root.id); assert.equal(published.parentId, null); assert.equal(published.isShared, true);
      const rows = await q('SELECT id,user_id,parent_id FROM check_template_folders WHERE id=ANY($1::uuid[]) ORDER BY id', [[root.id, child.id]]);
      assert.equal(rows.length, 2); assert.ok(rows.every((row) => row.user_id === null));
      assert.equal(rows.find((row) => row.id === child.id).parent_id, root.id);
      const tplRows = await q('SELECT id,user_id,folder_id FROM check_templates WHERE id=ANY($1::uuid[])', [[rootTpl.id, childTpl.id]]);
      assert.equal(tplRows.length, 2); assert.ok(tplRows.every((row) => row.user_id === null));
      assert.equal((await one('SELECT user_id FROM check_template_folders WHERE id=$1', [parent.id])).user_id, f.staff);
      const directorFolders = await f.run(() => templates.getFolders(f.tenant, f.actor));
      assert.ok(!directorFolders.some((row) => row.id === parent.id || row.id === privateOther.id));
      assert.ok(!(await f.run(() => templates.getAll(f.tenant, f.owner))).some((row) => row.id === privateOtherTpl.id));
      assert.ok((await f.run(() => templates.getAll(f.tenant, f.otherStaff))).some((row) => row.id === childTpl.id));
    });

    await t.test('templates: current permission gates common create/update/delete and publication without literal admin bypass', async () => {
      const f = await seed();
      const common = await f.folder('Common', null, f.manager, true), commonTpl = await f.tpl('Common', common.id, f.manager, true);
      const privateFolder = await f.folder('Private');
      const denied = { ...f.viewer, role: 'admin', permissions: { templates_shared_manage: false } };
      const actions = [
        () => templates.createFolder(f.tenant, denied, { name: 'No', isShared: true }),
        () => templates.updateFolder(common.id, f.tenant, denied, { name: 'No' }),
        () => templates.removeFolder(common.id, f.tenant, denied),
        () => templates.updateFolder(privateFolder.id, f.tenant, denied, { isShared: true }),
        () => templates.create(f.tenant, denied, { name: 'No', shared: true }),
        () => templates.update(commonTpl.id, f.tenant, denied, { name: 'No' }),
        () => templates.remove(commonTpl.id, f.tenant, denied),
      ];
      for (const action of actions) await assert.rejects(f.run(action), status(403));
      assert.equal((await one('SELECT name FROM check_template_folders WHERE id=$1', [common.id])).name, 'Common');
      await f.run(() => templates.update(commonTpl.id, f.tenant, f.actor, { name: 'Director implicit' }));
    });

    await t.test('templates: foreign-private parents, scope mismatch and cycles fail without tree mutations', async () => {
      const f = await seed(), foreign = await seed();
      const root = await f.folder('Root'), child = await f.folder('Child', root.id);
      const other = await f.folder('Other', null, { ...f.manager, userID: f.otherStaff });
      const common = await f.folder('Common', null, f.manager, true), foreignFolder = await foreign.folder('Foreign');
      for (const parentId of [child.id, root.id, other.id, common.id, foreignFolder.id]) {
        await assert.rejects(f.run(() => templates.updateFolder(root.id, f.tenant, f.manager, { parentId })), status(400));
      }
      assert.equal((await one('SELECT parent_id FROM check_template_folders WHERE id=$1', [root.id])).parent_id, null);
      await assert.rejects(f.folder('Bad', common.id), status(400));
      await assert.rejects(f.tpl('Bad', other.id), status(400));
    });

    await t.test('templates: mixed-scope descendants and templates prevent publication/deletion; injected publish rollback is atomic', async () => {
      const f = await seed();
      for (const mixedKind of ['folder', 'template']) {
        const root = await f.folder('Mixed ' + mixedKind);
        if (mixedKind === 'folder') await q("INSERT INTO check_template_folders(tenant_id,user_id,name,parent_id) VALUES($1,$2,'Mixed',$3)", [f.tenant, f.otherStaff, root.id]);
        else await q("INSERT INTO check_templates(tenant_id,user_id,name,folder_id,services) VALUES($1,$2,'Mixed',$3,'[]')", [f.tenant, f.otherStaff, root.id]);
        await assert.rejects(f.run(() => templates.updateFolder(root.id, f.tenant, f.manager, { isShared: true })), status(400));
        await assert.rejects(f.run(() => templates.removeFolder(root.id, f.tenant, f.manager)), status(400));
        assert.equal((await one('SELECT user_id FROM check_template_folders WHERE id=$1', [root.id])).user_id, f.staff);
      }
      const parent = await f.folder('Rollback parent'), root = await f.folder('Rollback root', parent.id), child = await f.folder('Rollback child', root.id);
      const tpl = await f.tpl('Rollback template', child.id);
      const fault = new CheckTemplatesService(clientHookPool(async (client, sql, values) => {
        if (sql.includes('UPDATE check_templates SET user_id=NULL')) throw new Error('fixture publish fault');
        return client.query(sql, values);
      }));
      await assert.rejects(f.run(() => fault.updateFolder(root.id, f.tenant, f.manager, { isShared: true })), /fixture publish fault/);
      const folders = await q('SELECT id,user_id,parent_id FROM check_template_folders WHERE id=ANY($1::uuid[])', [[root.id, child.id]]);
      assert.ok(folders.every((row) => row.user_id === f.staff));
      assert.equal(folders.find((row) => row.id === root.id).parent_id, parent.id);
      assert.equal((await one('SELECT user_id FROM check_templates WHERE id=$1', [tpl.id])).user_id, f.staff);
    });

    for (const publishFirst of [true, false]) {
      await t.test('templates: publication/create serialization, publishFirst=' + publishFirst, async () => {
        const f = await seed(), root = await f.folder('Race root');
        const publish = (service) => service.updateFolder(root.id, f.tenant, f.manager, { isShared: true });
        const create = (service) => service.createFolder(f.tenant, f.manager, { name: 'Race child', parentId: root.id });
        const result = await treeRace(f, publishFirst ? publish : create, publishFirst ? create : publish);
        if (publishFirst) { assert.equal(result.second.error?.getStatus(), 400); assert.equal((await one('SELECT count(*)::int n FROM check_template_folders WHERE parent_id=$1', [root.id])).n, 0); }
        else { assert.ok(!result.second.error); assert.equal((await one('SELECT user_id FROM check_template_folders WHERE id=$1', [result.first.id])).user_id, null); }
      });
      await t.test('templates: publication/template move serialization, publishFirst=' + publishFirst, async () => {
        const f = await seed(), root = await f.folder('Race root'), outside = await f.folder('Outside'), tpl = await f.tpl('Mover', outside.id);
        const publish = (service) => service.updateFolder(root.id, f.tenant, f.manager, { isShared: true });
        const move = (service) => service.update(tpl.id, f.tenant, f.manager, { folderId: root.id });
        const result = await treeRace(f, publishFirst ? publish : move, publishFirst ? move : publish);
        const row = await one('SELECT user_id,folder_id FROM check_templates WHERE id=$1', [tpl.id]);
        if (publishFirst) { assert.equal(result.second.error?.getStatus(), 400); assert.deepEqual(row, { user_id: f.staff, folder_id: outside.id }); }
        else { assert.ok(!result.second.error); assert.deepEqual(row, { user_id: null, folder_id: root.id }); }
      });
    }

    await t.test('HTTP: custom-role grant → shared write → revoke →403 using the exact same cached bearer', async () => {
      const f = await seed();
      process.env.JWT_SECRET = randomBytes(32).toString('hex');
      const roles = new RolesService(pool);
      const strategy = new JwtStrategy(pool);
      class FixtureModule {}
      Module({ controllers: [RolesController, CheckTemplatesController], providers: [
        { provide: RolesService, useValue: roles }, { provide: CheckTemplatesService, useValue: templates }, { provide: JwtStrategy, useValue: strategy },
      ] })(FixtureModule);
      httpApp = await NestFactory.create(FixtureModule, { logger: false });
      httpApp.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
      httpApp.useGlobalInterceptors(new TenantContextInterceptor());
      await httpApp.listen(0, '127.0.0.1');
      const address = httpApp.getHttpServer().address();
      const base = 'http://127.0.0.1:' + address.port;
      const jwt = new JwtService({ secret: process.env.JWT_SECRET });
      const bearer = (user) => jwt.sign({ sub: user, jti: randomUUID(), pointId: f.point }, { expiresIn: '5m' });
      const ownerToken = bearer(f.owner), staffToken = bearer(f.staff);
      const request = async (token, method, path, body) => {
        const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      };
      assert.equal((await request(staffToken, 'POST', '/check-templates/folders', { name: 'Denied', isShared: true })).status, 403);
      assert.equal((await request(ownerToken, 'PATCH', '/roles/' + f.role, { matrix: { templates: { manageShared: true } } })).status, 200);
      const created = await request(staffToken, 'POST', '/check-templates/folders', { name: 'Granted', isShared: true });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal((await request(staffToken, 'PATCH', '/check-templates/folders/' + created.body.id, { name: 'Granted edit' })).status, 200);
      assert.equal((await request(ownerToken, 'PATCH', '/roles/' + f.role, { matrix: { templates: { manageShared: false } } })).status, 200);
      assert.equal((await request(staffToken, 'PATCH', '/check-templates/folders/' + created.body.id, { name: 'Revoked edit' })).status, 403);
      assert.equal((await request(staffToken, 'DELETE', '/check-templates/folders/' + created.body.id)).status, 403);
      assert.equal((await one('SELECT name FROM check_template_folders WHERE id=$1', [created.body.id])).name, 'Granted edit');
      await httpApp.close(); httpApp = null;
    });

    await t.test('all released app connections deny reads and retain no tenant GUC after transactions/HTTP', async () => {
      const connections = await Promise.all(Array.from({ length: 8 }, () => app.connect()));
      try {
        for (const client of connections) {
          assert.equal((await client.query("SELECT NULLIF(current_setting('app.tenant_id',true),'') AS tenant")).rows[0].tenant, null);
          assert.equal((await client.query('SELECT id FROM check_template_folders')).rows.length, 0);
          assert.equal((await client.query('SELECT id FROM service_visibility_rules')).rows.length, 0);
        }
      } finally { for (const client of connections) client.release(); }
    });
  } finally {
    if (httpApp) await httpApp.close();
    for (const tenant of tenants) await admin.query('DELETE FROM tenants WHERE id=$1', [tenant]);
    await pool.end();
  }
});
