// Explicit owned PostgreSQL fixture only; never read DATABASE_URL or .env.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ChecksService } = require('../dist/checks/checks.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
const { WarehousesService } = require('../dist/warehouses/warehouses.service');
const { ReturnsService } = require('../dist/returns/returns.service');
const { MotivationRulesService } = require('../dist/motivation/motivation-rules.service');
const { MotivationService } = require('../dist/motivation/motivation.service');
const { MotivationController } = require('../dist/motivation/motivation.controller');
const { SalaryService } = require('../dist/salary/salary.service');
const { ScheduleService } = require('../dist/schedule/schedule.service');
const { InstallmentsService } = require('../dist/installments/installments.service');
const { motivationByPointMonthSql } = require('../dist/common/salary-extras-sql');
const { ProductsService } = require('../dist/products/products.service');
const { WarehouseService } = require('../dist/warehouse/warehouse.service');
Logger.overrideLogger(false);
const live = process.env.AUTEXA_MOTIVATION_LIVE_DB;
const options = { skip: !live, timeout: 60000 };

test('actual PG: product FK lock ordering permits posting concurrently with a bulk rule insert', options, async () => {
  await fixture(async ({ product, run, rules, tenant, create, pool, q, accruals }) => {
    const p = await product('Posting race');
    const input = { targets: [{ kind: 'product', productId: p.productId }], percent: 8, requestId: randomUUID() };
    const preview = await run(() => rules.bulk(tenant, { ...input, dryRun: true }));
    let reachedCreate,
      releaseCreate,
      bulkPid,
      creating,
      applying,
      paused = false,
      stage = 'create';
    const reached = new Promise((r) => {
        reachedCreate = r;
      }),
      resume = new Promise((r) => {
        releaseCreate = r;
      });
    const connect = pool.connect.bind(pool);
    pool.connect = async () => {
      const client = await connect();
      if (stage === 'bulk' && !bulkPid) bulkPid = client.processID;
      const query = client.query.bind(client),
        release = client.release.bind(client);
      client.query = async (sql, values) => {
        const result = await query(sql, values);
        if (!paused && String(sql).includes('FROM products') && String(sql).includes('FOR UPDATE')) {
          paused = true;
          reachedCreate();
          await resume;
        }
        return result;
      };
      client.release = (...args) => {
        client.query = query;
        client.release = release;
        return release(...args);
      };
      return client;
    };
    try {
      creating = create([p]);
      creating.catch(() => undefined);
      await reached;
      stage = 'bulk';
      applying = run(() => rules.bulk(tenant, { ...input, previewRevision: preview.previewRevision }));
      applying.catch(() => undefined);
      let blocked = false;
      for (let i = 0; i < 200; i++) {
        if (
          bulkPid &&
          (await q('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [bulkPid]))[0]?.wait_event_type ===
            'Lock'
        ) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.ok(blocked);
      releaseCreate();
      const results = await Promise.allSettled([creating, applying]);
      assert.ok(
        results.every((r) => r.status === 'fulfilled'),
        results.map((r) => r.reason?.code || r.reason?.message).join(', '),
      );
      assert.equal(
        (await accruals(results[0].value.id)).length,
        0,
        'the earlier sale must not receive a later program',
      );
      assert.equal(Number((await accruals((await create([p])).id))[0].amount), 8);
    } finally {
      releaseCreate();
      await Promise.allSettled([creating, applying].filter(Boolean));
      pool.connect = connect;
    }
  });
});

test(
  'actual PG: old web assignee echoes cannot confirm the cashier; explicit intent and unchanged echoes are distinct',
  options,
  async () => {
    await fixture(
      async ({ product, rule, create, edit, accruals, checks, run, tenant, actor, owner, first, second, q }) => {
        const p = await product();
        await rule(p.productId);
        const old = await create([p], { isDeferred: true, assigneeIds: undefined, assigneesConfirmed: undefined });
        await edit(old, { products: [p], assigneeIds: [owner], assigneesConfirmed: undefined });
        assert.equal(
          (await q('SELECT motivation_assignees_confirmed FROM checks WHERE id=$1', [old.id]))[0]
            .motivation_assignees_confirmed,
          false,
        );
        await run(() => checks.acceptPayment(old.id, tenant, actor.role, {}, owner, actor));
        assert.equal((await accruals(old.id)).length, 0, 'an echoed legacy admin default is not a performer');
        await edit(old, { assigneeIds: [first], assigneesConfirmed: true });
        assert.equal((await accruals(old.id))[0].employee_id, first);
        await edit(old, { assigneeIds: [first], assigneesConfirmed: undefined });
        assert.equal(
          (await accruals(old.id))[0].employee_id,
          first,
          'unchanged old-client echo preserves an already confirmed choice',
        );
        const weak = {
          ...actor,
          role: 'master',
          permissions: { checks_edit: true, checks_edit_all: true, edit_closed_check: false },
        };
        await assert.rejects(
          edit(old, { assigneeIds: [second], assigneesConfirmed: undefined }, weak),
          (e) => e.getStatus() === 403,
        );
        await edit(old, { assigneeIds: [second], assigneesConfirmed: undefined });
        assert.equal((await accruals(old.id)).length, 0, 'changed legacy choices cannot silently move motivation');
        assert.equal(
          (await q('SELECT motivation_assignees_confirmed FROM checks WHERE id=$1', [old.id]))[0]
            .motivation_assignees_confirmed,
          false,
        );
      },
    );
  },
);

test(
  'actual PG: draft save race rechecks the locked posted state instead of rewriting its recipients or lines',
  options,
  async () => {
    await fixture(
      async ({ product, rule, create, edit, accruals, run, checks, tenant, actor, pool, first, second, q }) => {
        const p = await product();
        await rule(p.productId);
        const check = await create([p], { isDeferred: true });
        let reachedEdit,
          releaseEdit,
          paused = false,
          editing;
        const reached = new Promise((r) => {
            reachedEdit = r;
          }),
          resume = new Promise((r) => {
            releaseEdit = r;
          });
        const connect = pool.connect.bind(pool);
        pool.connect = async () => {
          const client = await connect(),
            query = client.query.bind(client),
            release = client.release.bind(client);
          client.query = async (sql, values) => {
            if (!paused && String(sql).includes('FROM checks') && String(sql).includes('FOR UPDATE')) {
              paused = true;
              reachedEdit();
              await resume;
            }
            return query(sql, values);
          };
          client.release = (...args) => {
            client.query = query;
            client.release = release;
            return release(...args);
          };
          return client;
        };
        try {
          editing = edit(check, { products: [{ ...p, quantity: 2 }], assigneeIds: [second], assigneesConfirmed: true });
          editing.catch(() => undefined);
          await reached;
          await run(() => checks.acceptPayment(check.id, tenant, actor.role, {}, actor.userID, actor));
          releaseEdit();
          await assert.rejects(editing, (e) => e.getStatus() === 409);
          assert.equal((await accruals(check.id))[0].employee_id, first);
          assert.equal(Number((await accruals(check.id))[0].amount), 8);
          assert.equal(
            Number((await q('SELECT quantity FROM check_product_lines WHERE check_id=$1', [check.id]))[0].quantity),
            1,
          );
        } finally {
          releaseEdit();
          if (editing) await Promise.allSettled([editing]);
          pool.connect = connect;
        }
      },
    );
  },
);

test(
  'actual PG: actual warranty boundary changes reverse v2 only with financial permission and retain saved rates',
  options,
  async () => {
    await fixture(async ({ product, rule, create, edit, accruals, q, tenant, actor }) => {
      const p = await product();
      await rule(p.productId);
      const check = await create([p]),
        original = (await accruals(check.id))[0];
      const weak = {
        ...actor,
        role: 'master',
        permissions: { checks_edit: true, checks_edit_all: true, payment_edit: true, edit_closed_check: false },
      };
      await assert.rejects(edit(check, { paymentMethod: 'warranty' }, weak), (e) => e.getStatus() === 403);
      assert.equal(Number((await accruals(check.id))[0].amount), 8);
      await edit(check, { paymentMethod: 'warranty' });
      assert.equal((await accruals(check.id)).length, 0);
      await q('UPDATE motivation_rules SET percent=90 WHERE tenant_id=$1', [tenant]);
      await edit(check, { paymentMethod: 'cash' });
      assert.equal(Number((await accruals(check.id))[0].amount), 8);
      assert.equal((await accruals(check.id))[0].accrued_at.toISOString(), original.accrued_at.toISOString());
      await edit(check, { isDeferred: false, paymentMethod: 'warranty' });
      assert.equal(
        (await q('SELECT payment_method FROM checks WHERE id=$1', [check.id]))[0].payment_method,
        'warranty',
      );
      assert.equal((await accruals(check.id)).length, 0);
    });
  },
);

test(
  'actual PG: actual catalog hard-delete retains historical identity for assignment, restore and partial return',
  options,
  async () => {
    await fixture(
      async ({
        product,
        rule,
        create,
        edit,
        accruals,
        run,
        tenant,
        checks,
        actor,
        first,
        second,
        returns,
        q,
        pool,
        legacy,
      }) => {
        const p = await product('Историческое масло');
        await rule(p.productId);
        const check = await create([{ ...p, quantity: 2 }], { discount: 20 });
        const products = new ProductsService(pool, new WarehouseService(pool));
        await run(() => products.remove(p.productId, tenant));
        await run(() => products.hardDelete(p.productId, tenant));
        assert.equal(
          (await q('SELECT product_id FROM check_product_lines WHERE check_id=$1', [check.id]))[0].product_id,
          null,
        );
        await edit(check, { assigneeIds: [second], assigneesConfirmed: true });
        let rows = await accruals(check.id);
        assert.equal(rows[0].product_id, null);
        assert.equal(rows[0].snapshot_product_id, p.productId);
        assert.equal(Number(rows[0].amount), 14.4);
        const mixed = await run(() => legacy.listAccruals(tenant, {}, true));
        assert.equal(mixed[0].productId, p.productId);
        assert.equal(mixed[0].productName, 'Историческое масло');
        await run(() => checks.remove(check.id, tenant, actor.role, actor.userID, actor));
        await run(() => checks.restore(check.id, tenant, actor));
        assert.equal(Number((await accruals(check.id))[0].amount), 14.4);
        const line = (await q('SELECT id FROM check_product_lines WHERE check_id=$1', [check.id]))[0];
        await run(() =>
          returns.createReturn(
            tenant,
            actor.userID,
            check.id,
            { destination: 'warehouse', scope: 'partial', lines: [{ productLineId: line.id, quantity: 0.5 }] },
            actor,
          ),
        );
        rows = await accruals(check.id);
        assert.equal(Number(rows[0].amount), 10.8);
        assert.equal(rows[0].snapshot_product_id, p.productId);
        await assert.rejects(
          run(() => checks.remove(check.id, tenant, actor.role, actor.userID, actor)),
          (e) => e.getStatus() === 400,
        );
      },
    );
  },
);

test(
  'actual PG: unarchived historical trash blocks explicit legacy replacement, preserving exceptions remains allowed',
  options,
  async () => {
    await fixture(async ({ product, create, legacy, run, tenant, checks, actor, q, bulk, rules, accruals }) => {
      const p = await product('Old trash');
      await run(() => legacy.setPromo(tenant, { productId: p.productId, percent: 37 }));
      const check = await create([p]);
      await run(() => checks.remove(check.id, tenant, actor.role, actor.userID, actor));
      await q('DELETE FROM check_motivation_legacy_snapshots WHERE check_id=$1', [check.id]);
      await q('DELETE FROM check_motivation_snapshots WHERE check_id=$1', [check.id]);
      await q('UPDATE checks SET motivation_v2_posted_at=NULL WHERE id=$1', [check.id]);
      const preserved = await bulk([{ kind: 'product', productId: p.productId }]);
      assert.ok(preserved.preview.legacyExceptions[0].replacementBlockedReason);
      const old = (await run(() => legacy.listPromos(tenant)))[0];
      await assert.rejects(
        bulk([{ kind: 'product', productId: p.productId }], 8, {
          replaceLegacyPromos: [{ productId: p.productId, updatedAt: old.updatedAt.toISOString() }],
        }),
        (e) => e.getStatus() === 409,
      );
      assert.equal((await run(() => legacy.listPromos(tenant))).length, 1);
      await run(() => checks.restore(check.id, tenant, actor));
      assert.equal(Number((await accruals(check.id))[0].percent), 37);
    });
  },
);

test('actual PG: archive lock ordering lets replacement and soft-delete commit without deadlock', options, async () => {
  await fixture(async ({ product, create, legacy, run, tenant, rules, pool, q, checks, actor }) => {
    const p = await product('Concurrent legacy');
    await run(() => legacy.setPromo(tenant, { productId: p.productId, percent: 37 }));
    const check = await create([p]);
    const old = (await run(() => legacy.listPromos(tenant)))[0];
    const input = {
      targets: [{ kind: 'product', productId: p.productId }],
      percent: 8,
      requestId: randomUUID(),
      replaceLegacyPromos: [{ productId: p.productId, updatedAt: old.updatedAt.toISOString() }],
    };
    const preview = await run(() => rules.bulk(tenant, { ...input, dryRun: true }));
    let releaseDelete, reachedDelete, bulkPid, deleting, applying;
    const reached = new Promise((resolve) => {
      reachedDelete = resolve;
    });
    const resume = new Promise((resolve) => {
      releaseDelete = resolve;
    });
    const connect = pool.connect.bind(pool);
    let stage = 'delete';
    pool.connect = async () => {
      const client = await connect();
      if (stage === 'bulk' && !bulkPid) bulkPid = client.processID;
      const query = client.query.bind(client),
        release = client.release.bind(client);
      client.query = async (sql, values) => {
        if (String(sql).includes('INSERT INTO check_motivation_legacy_snapshots') && values?.[1] === check.id) {
          reachedDelete();
          await resume;
        }
        return query(sql, values);
      };
      client.release = (...args) => {
        client.query = query;
        client.release = release;
        return release(...args);
      };
      return client;
    };
    try {
      deleting = run(() => checks.remove(check.id, tenant, actor.role, actor.userID, actor));
      deleting.catch(() => undefined);
      await reached;
      stage = 'bulk';
      applying = run(() => rules.bulk(tenant, { ...input, previewRevision: preview.previewRevision }));
      applying.catch(() => undefined);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        if (bulkPid) {
          const activity = await q('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [bulkPid]);
          if (activity[0]?.wait_event_type === 'Lock') {
            blocked = true;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(blocked, 'replacement is waiting on the deletion transaction');
      releaseDelete();
      const outcomes = await Promise.allSettled([deleting, applying]);
      assert.ok(
        outcomes.every((result) => result.status === 'fulfilled'),
        outcomes.map((r) => r.reason?.code || r.reason?.message).join(', '),
      );
      await run(() => checks.restore(check.id, tenant, actor));
      const rows = await q('SELECT percent,amount FROM motivation_accruals WHERE check_id=$1', [check.id]);
      assert.equal(Number(rows[0].percent), 37);
      assert.equal(Number(rows[0].amount), 7.4);
    } finally {
      releaseDelete();
      await Promise.allSettled([deleting, applying].filter(Boolean));
      pool.connect = connect;
    }
  });
});

test(
  'actual PG: preview binds its selection/rate; mid-batch database failure rolls all effects back',
  options,
  async () => {
    await fixture(async ({ product, run, tenant, rules, q }) => {
      const a = await product('First'),
        b = await product('Second');
      const input = { targets: [{ kind: 'product', productId: a.productId }], percent: 8, requestId: randomUUID() };
      const preview = await run(() => rules.bulk(tenant, { ...input, dryRun: true }));
      for (const patch of [
        { percent: 9 },
        { targets: [{ kind: 'product', productId: b.productId }] },
        { active: false },
      ]) {
        await assert.rejects(
          run(() => rules.bulk(tenant, { ...input, ...patch, previewRevision: preview.previewRevision })),
          (e) => e.getStatus() === 409,
        );
      }
      const both = {
        ...input,
        targets: [
          { kind: 'product', productId: a.productId },
          { kind: 'product', productId: b.productId },
        ],
      };
      const bothPreview = await run(() => rules.bulk(tenant, { ...both, dryRun: true }));
      const functionName = `motivation_fail_${randomUUID().replace(/-/g, '')}`;
      const triggerName = functionName + '_trigger';
      const failProduct = [a.productId, b.productId].sort()[1];
      try {
        await q(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.tenant_id='${tenant}'::uuid AND NEW.product_id='${failProduct}'::uuid THEN RAISE EXCEPTION 'injected test failure'; END IF;
        RETURN NEW; END $$`);
        await q(
          `CREATE TRIGGER ${triggerName} BEFORE INSERT ON motivation_rules FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
        );
        await assert.rejects(
          run(() => rules.bulk(tenant, { ...both, previewRevision: bothPreview.previewRevision })),
          /injected test failure/,
        );
        assert.equal((await q('SELECT * FROM motivation_rules WHERE tenant_id=$1', [tenant])).length, 0);
        assert.equal((await q('SELECT * FROM motivation_bulk_receipts WHERE tenant_id=$1', [tenant])).length, 0);
      } finally {
        await q(`DROP TRIGGER IF EXISTS ${triggerName} ON motivation_rules`);
        await q(`DROP FUNCTION IF EXISTS ${functionName}()`);
      }
      const success = await run(() => rules.bulk(tenant, { ...both, previewRevision: bothPreview.previewRevision }));
      assert.equal(success.rules.length, 2, 'the same request can retry safely after a fully rolled-back failure');
    });
  },
);

test('actual PG: large and overlapping selections count unique products once', options, async () => {
  await fixture(async ({ product, bulk, wh }) => {
    const rows = [];
    for (let index = 0; index < 30; index++) rows.push(await product(`Large ${index}`, 100, 80, wh.id, 'Large/Child'));
    const result = await bulk([
      { kind: 'folder', warehouseId: wh.id, path: 'Large' },
      { kind: 'folder', warehouseId: wh.id, path: 'Large/Child' },
      { kind: 'product', productId: rows[0].productId },
      { kind: 'product', productId: rows[0].productId },
    ]);
    assert.equal(result.preview.coveredProductCount, 30);
    assert.equal(result.result.affectedProductCount, 30);
    assert.equal(result.result.rules.length, 3);
  });
});

test(
  'actual PG: self master earns; none/margin-only assignments keep ordinary board permissions',
  options,
  async () => {
    await fixture(async ({ product, create, edit, accruals, rule, first, actor, legacy, run, tenant }) => {
      const weak = {
        ...actor,
        role: 'master',
        permissions: { checks_edit: true, checks_edit_all: true, edit_closed_check: false },
      };
      const unmatched = await product('Unmatched');
      const ordinary = await create([unmatched], { assigneeIds: [] });
      await edit(ordinary, { assigneeIds: [first] }, weak);
      assert.equal((await accruals(ordinary.id)).length, 0);
      await run(() => legacy.setPromo(tenant, { productId: unmatched.productId, percent: 37 }));
      const margin = await create([unmatched], { assigneeIds: [] });
      await edit(margin, { assigneeIds: [first] }, weak);
      assert.equal(Number((await accruals(margin.id))[0].amount), 7.4);
      const selfProduct = await product('Self');
      await rule(selfProduct.productId);
      const selfActor = { ...actor, userID: first, role: 'master', permissions: {} };
      const selfCheck = await create([selfProduct], { masterId: first, assigneeIds: [first] }, selfActor);
      assert.equal((await accruals(selfCheck.id))[0].employee_id, first);
      assert.equal(Number((await accruals(selfCheck.id))[0].amount), 8);
    });
  },
);

async function fixture(work) {
  assert.equal(live, 'postgresql://oct8_fixture:oct8_fixture_only@127.0.0.1:55438/autexa_oct8_test');
  const admin = new Pool({ connectionString: live, max: 4, statement_timeout: 8000 });
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  appUrl.password = 'oct8_app_fixture_only';
  const pool = new TenantAwarePool(
    admin,
    new Pool({ connectionString: appUrl.toString(), max: 4, statement_timeout: 8000 }),
  );
  const q = async (sql, params = []) => (await admin.query(sql, params)).rows;
  const tenant = randomUUID(),
    owner = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  const actor = { tenantID: tenant, userID: owner, role: 'director', permissions: {} };
  const run = (fn) => runWithTenant(tenant, fn);
  const warehouses = new WarehousesService(pool);
  const installments = new InstallmentsService(pool, {});
  const checks = new ChecksService(
    pool,
    new WarrantyService(pool),
    new ClientsService(pool),
    undefined,
    undefined,
    installments,
  );
  const returns = new ReturnsService(pool, warehouses);
  const rules = new MotivationRulesService(pool),
    legacy = new MotivationService(pool);
  try {
    await q("INSERT INTO tenants(id,name,timezone) VALUES($1,'Motivation isolated QA','Europe/Moscow')", [tenant]);
    for (const [id, role] of [
      [owner, 'director'],
      [first, 'master'],
      [second, 'master'],
    ]) {
      await q("INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1,$2,$4,'unused',$4,$3)", [
        id,
        tenant,
        role,
        id,
      ]);
    }
    const wh = await run(() => warehouses.resolveByKind(tenant, 'main'));
    const product = async (name = 'Масла', price = 100, cost = 80, warehouseId = wh.id, category = 'Масла') => {
      const id = randomUUID();
      await q(
        `INSERT INTO products(id,tenant_id,warehouse_id,name,category,unit,sell_price,cost_price,stock)
               VALUES($1,$2,$3,$4,$5,'шт',$6,$7,100)`,
        [id, tenant, warehouseId, name, category, price, cost],
      );
      return { productId: id, name, sellPrice: price, costPrice: cost, quantity: 1 };
    };
    const rule = async (productId, percent = 8) =>
      q(
        `INSERT INTO motivation_rules(tenant_id,target_kind,product_id,percent)
      VALUES($1,'product',$2,$3) RETURNING *`,
        [tenant, productId, percent],
      );
    const create = (lines, extra = {}, who = actor) =>
      run(() =>
        checks.create(
          tenant,
          who.userID,
          who.role,
          {
            masterId: owner,
            assigneeIds: [first],
            assigneesConfirmed: true,
            products: lines,
            services: [],
            paymentMethod: 'cash',
            ...extra,
          },
          who,
        ),
      );
    const accruals = (id) =>
      q('SELECT * FROM motivation_accruals WHERE tenant_id=$1 AND check_id=$2 ORDER BY employee_id', [tenant, id]);
    const edit = (check, patch, who = actor) =>
      run(() => checks.update(check.id, tenant, who.role, patch, who.userID, who));
    const bulk = async (targets, rate = 8, extra = {}) => {
      const input = { targets, percent: rate, requestId: randomUUID(), ...extra };
      const preview = await run(() => rules.bulk(tenant, { ...input, dryRun: true }));
      const apply = { ...input, previewRevision: preview.previewRevision };
      return { preview, apply, result: await run(() => rules.bulk(tenant, apply)) };
    };
    await work({
      tenant,
      owner,
      first,
      second,
      actor,
      run,
      q,
      pool,
      wh,
      product,
      rule,
      create,
      accruals,
      checks,
      returns,
      rules,
      legacy,
      edit,
      bulk,
      installments,
    });
  } finally {
    await q('DELETE FROM tenants WHERE id=$1', [tenant]);
    await pool.end();
  }
}

test('actual PG: discounted sale revenue awards confirmed performers, not margin or cashier', options, async () => {
  await fixture(async ({ product, rule, create, accruals, first, second, q, tenant }) => {
    const a = await product('Масло', 60, 55),
      b = await product('Фильтр', 40, 39);
    await rule(a.productId);
    const check = await create([a, b], { discount: 10, assigneeIds: [second, first, first] });
    const rows = await accruals(check.id);
    assert.equal(rows.length, 2, 'one net-revenue bonus is distributed to two confirmed performers');
    assert.deepEqual(
      rows.map((r) => Number(r.amount)),
      [2.16, 2.16],
    );
    assert.ok(rows.every((r) => r.scheme === 'revenue_v2' && Number(r.revenue_base) === 54));
    assert.equal(
      (await q('SELECT motivation_assignees_confirmed FROM checks WHERE id=$1 AND tenant_id=$2', [check.id, tenant]))[0]
        .motivation_assignees_confirmed,
      true,
    );
  });
});

test('actual PG: bulk preview is read-only, apply/retry is atomic and version checked', options, async () => {
  await fixture(async ({ product, tenant, run, q, rules, bulk }) => {
    const a = await product('A', 100, 20, undefined, 'Derived/Child');
    const input = {
      targets: [
        {
          kind: 'folder',
          warehouseId: (await q('SELECT warehouse_id FROM products WHERE id=$1', [a.productId]))[0].warehouse_id,
          path: ' Derived // Child / ',
        },
      ],
      percent: 8,
      requestId: randomUUID(),
      dryRun: true,
    };
    const preview = await run(() => rules.bulk(tenant, input));
    assert.equal(preview.coveredProductCount, 1);
    assert.equal(
      (await q('SELECT * FROM warehouse_categories WHERE tenant_id=$1 AND path=$2', [tenant, 'Derived/Child'])).length,
      0,
    );
    const apply = { ...input, dryRun: false, previewRevision: preview.previewRevision };
    const [one, two] = await Promise.all([run(() => rules.bulk(tenant, apply)), run(() => rules.bulk(tenant, apply))]);
    assert.deepEqual(one, two);
    assert.ok(one.rules[0].target.categoryId);
    assert.equal((await q('SELECT * FROM motivation_rules WHERE tenant_id=$1', [tenant])).length, 1);
    await assert.rejects(
      run(() => rules.bulk(tenant, { ...apply, percent: 9 })),
      (e) => e.getStatus() === 409,
    );
    await assert.rejects(
      run(() => rules.change(tenant, one.rules[0].id, { expectedRevision: 999, percent: 12 })),
      (e) => e.getStatus() === 409,
    );
    const next = await run(() => rules.change(tenant, one.rules[0].id, { expectedRevision: 1, percent: 9 }));
    assert.equal(next.revision, 2);
    await assert.rejects(
      run(() => rules.bulk(tenant, { ...apply, requestId: randomUUID() })),
      (e) => e.getStatus() === 409,
    );
    const before = (await q('SELECT count(*) FROM motivation_rules WHERE tenant_id=$1', [tenant]))[0].count;
    await assert.rejects(
      bulk([
        { kind: 'product', productId: a.productId },
        { kind: 'product', productId: randomUUID() },
      ]),
      (e) => e.getStatus() === 400,
    );
    assert.equal((await q('SELECT count(*) FROM motivation_rules WHERE tenant_id=$1', [tenant]))[0].count, before);
  });
});

test(
  'actual PG: literal dynamic folders, deepest/paused/product precedence and warehouse isolation',
  options,
  async () => {
    await fixture(async ({ product, bulk, create, accruals, q, tenant, wh, run, rules, first }) => {
      const a = await product('A', 100, 90, wh.id, 'A_%/Child/Leaf');
      const sibling = await product('Sibling', 100, 90, wh.id, 'AXZ/Child');
      const anotherWh = (await q("SELECT id FROM warehouses WHERE tenant_id=$1 AND kind='used'", [tenant]))[0].id;
      const other = await product('Other', 100, 90, anotherWh, 'A_%/Child/Leaf');
      const nullWarehouse = await product('Null', 100, 90, null, 'A_%/Child/Leaf');
      const folder = (path, warehouseId = wh.id) => ({ kind: 'folder', path, warehouseId });
      const ancestor = await bulk([folder('A_%')], 8);
      assert.equal(ancestor.preview.coveredProductCount, 1);
      const future = await product('Future', 100, 99, wh.id, 'A_%/New');
      await bulk([folder('A_%/Child')], 12);
      await bulk([{ kind: 'product', productId: a.productId }], 4);
      const sell = async (line) => accruals((await create([line], { assigneeIds: [first] })).id);
      assert.equal(Number((await sell(a))[0].amount), 4);
      assert.equal(Number((await sell(future))[0].amount), 8);
      for (const line of [sibling, other, nullWarehouse]) assert.equal((await sell(line)).length, 0);
      const direct = (await run(() => rules.list(tenant))).rules.find((r) => r.target.productId === a.productId);
      await run(() => rules.change(tenant, direct.id, { expectedRevision: direct.revision, active: false }));
      assert.equal((await sell(a)).length, 0);
      await run(() => rules.change(tenant, direct.id, { expectedRevision: direct.revision + 1 }, true));
      assert.equal(Number((await sell(a))[0].amount), 12);
      await bulk([folder('A_%/Child/Leaf', null)], 9);
      assert.equal(Number((await sell(nullWarehouse))[0].amount), 9);
      const categoryId = ancestor.result.rules[0].target.categoryId;
      await q("UPDATE warehouse_categories SET path='Renamed' WHERE id=$1", [categoryId]);
      await q("UPDATE products SET category='Renamed/New' WHERE id=$1", [future.productId]);
      assert.equal(Number((await sell(future))[0].amount), 8, 'rule follows stable folder identity');
      await q('UPDATE warehouse_categories SET deleted_at=now() WHERE id=$1', [categoryId]);
      assert.equal((await sell(future)).length, 0);
    });
  },
);

test(
  'actual PG: RLS, config permission metadata and mixed-history self scope do not leak another tenant/employee',
  options,
  async () => {
    await fixture(async (a) => {
      await fixture(async (b) => {
        const pa = await a.product(),
          pb = await b.product();
        await a.rule(pa.productId);
        await b.rule(pb.productId);
        await a.create([pa], { assigneeIds: [a.first, a.second] });
        await b.create([pb]);
        for (const table of [
          'motivation_rules',
          'motivation_bulk_receipts',
          'check_motivation_snapshots',
          'check_motivation_legacy_snapshots',
        ]) {
          const rows = await a.run(() => a.pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1`, [b.tenant]));
          assert.equal(rows.rows.length, 0);
        }
        await assert.rejects(
          a.run(() =>
            a.pool.query(
              "INSERT INTO motivation_rules(tenant_id,target_kind,product_id,percent) VALUES($1,'product',$2,8)",
              [b.tenant, pb.productId],
            ),
          ),
          (e) => e.code === '42501',
        );
        await assert.rejects(a.bulk([{ kind: 'product', productId: pb.productId }]), (e) => e.getStatus() === 400);
        const controller = new MotivationController(a.legacy, a.rules);
        const self = { tenantID: a.tenant, userID: a.first, role: 'master', permissions: { salary_view_all: false } };
        const rows = await a.run(() => controller.listMixedAccruals(self, { userId: a.second }));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].employeeId, a.first);
        assert.equal(rows[0].baseAmount, 100);
        assert.equal(rows[0].shareCount, 2);
        for (const method of ['listRules', 'bulkRules', 'patchRule', 'deleteRule']) {
          assert.equal(
            Reflect.getMetadata('requiredPermission', MotivationController.prototype[method]),
            'motivation_manage',
          );
        }
      });
    });
  },
);

test(
  'actual PG: repeated/concurrent activation is once-only and keeps saved performers, warranty is excluded',
  options,
  async () => {
    await fixture(async ({ product, rule, create, accruals, run, checks, actor, tenant, first, second }) => {
      const p = await product();
      await rule(p.productId);
      const draft = await create([p], { isDeferred: true, assigneeIds: [first, second] });
      assert.equal((await accruals(draft.id)).length, 0);
      await Promise.all([
        run(() => checks.acceptPayment(draft.id, tenant, actor.role, {}, actor.userID, actor)),
        run(() => checks.acceptPayment(draft.id, tenant, actor.role, {}, actor.userID, actor)),
      ]);
      const rows = await accruals(draft.id);
      assert.equal(rows.length, 2);
      assert.equal(
        rows.reduce((sum, r) => sum + Number(r.amount), 0),
        8,
      );
      await run(() => checks.acceptPayment(draft.id, tenant, actor.role, {}, actor.userID, actor));
      assert.equal((await accruals(draft.id)).length, 2);
      const warranty = await create([p], { paymentMethod: 'warranty' });
      assert.equal((await accruals(warranty.id)).length, 0);
      const zero = await create([p], { discount: 100 });
      assert.equal((await accruals(zero.id)).length, 0);
    });
  },
);

test(
  'actual PG: installment posting credits full saved base once, salary and report totals sum the ledger',
  options,
  async () => {
    await fixture(async ({ product, rule, create, accruals, run, q, tenant, actor, first, installments, pool }) => {
      const p = await product();
      await rule(p.productId);
      const client = randomUUID();
      await q("INSERT INTO clients(id,tenant_id,full_name,phone) VALUES($1,$2,'QA Client',$3)", [
        client,
        tenant,
        client,
      ]);
      const check = await create([p], { paymentMethod: 'installment', clientId: client, cashAmount: 0, cardAmount: 0 });
      assert.equal(Number((await accruals(check.id))[0].amount), 8);
      const plan = (await q('SELECT id FROM installment_plans WHERE check_id=$1', [check.id]))[0];
      await run(() => installments.pay(actor, plan.id, { amount: 25, method: 'cash' }));
      assert.equal(Number((await accruals(check.id))[0].amount), 8);
      const salary = new SalaryService(pool, {}, {}, new ScheduleService(pool), {});
      const month = new Date().toISOString().slice(0, 7);
      const detail = await run(() => salary.getEmployeeMonth(tenant, first, month));
      assert.equal(detail.motivationAmount, 8);
      assert.equal(detail.totalEarnings, 8);
      const point = randomUUID();
      await q("INSERT INTO tenant_points(id,tenant_id,name) VALUES($1,$2,'QA Point')", [point, tenant]);
      await q('UPDATE checks SET point_id=$2 WHERE id=$1', [check.id, point]);
      const report = await run(() => pool.query(motivationByPointMonthSql(), [tenant, month + '-01']));
      assert.equal(Number(report.rows[0].total), 8);
    });
  },
);

test(
  'actual PG: no confirmed performers means no bonus; late assignment needs financial permission',
  options,
  async () => {
    await fixture(async ({ product, rule, create, accruals, first, second, owner, actor, edit, q }) => {
      const p = await product();
      await rule(p.productId);
      const check = await create([p], { assigneeIds: [] });
      assert.equal((await accruals(check.id)).length, 0);
      assert.equal((await q('SELECT * FROM check_motivation_snapshots WHERE check_id=$1', [check.id])).length, 1);
      const weak = {
        ...actor,
        role: 'master',
        permissions: {
          checks_edit: true,
          checks_edit_all: true,
          checks_edit_assigned_order: true,
          edit_closed_check: false,
        },
      };
      await assert.rejects(edit(check, { assigneeIds: [first] }, weak), (e) => e.getStatus() === 403);
      await edit(check, { assigneeIds: [first, second], assigneesConfirmed: true });
      assert.equal(
        (await accruals(check.id)).reduce((a, r) => a + Number(r.amount), 0),
        8,
      );
      assert.ok((await accruals(check.id)).every((r) => r.employee_id !== owner));
      const oldClient = await create([p], { assigneeIds: undefined, assigneesConfirmed: undefined });
      assert.equal((await accruals(oldClient.id)).length, 0, 'legacy default including cashier is not confirmed');
      await assert.rejects(create([p], { assigneeIds: [randomUUID()] }), (e) => e.getStatus() === 400);
    });
  },
);

test(
  'actual PG: original rates/date survive config changes, edits, trash/restore and tombstone re-add',
  options,
  async () => {
    await fixture(async ({ product, rule, create, accruals, edit, q, run, checks, tenant, actor, first, bulk }) => {
      const p = await product();
      await rule(p.productId);
      const check = await create([p]);
      const before = (await accruals(check.id))[0];
      await q('UPDATE motivation_rules SET percent=50,revision=revision+1 WHERE tenant_id=$1', [tenant]);
      await edit(check, { products: [{ ...p, quantity: 2 }] });
      let rows = await accruals(check.id);
      assert.equal(Number(rows[0].amount), 16);
      assert.equal(Number(rows[0].percent), 8);
      assert.equal(rows[0].accrued_at.toISOString(), before.accrued_at.toISOString());
      await edit(check, { products: [], services: [{ name: 'Работа', price: 1 }] });
      assert.equal((await accruals(check.id)).length, 0);
      await edit(check, { products: [p], services: [] });
      assert.equal(Number((await accruals(check.id))[0].amount), 8);
      await run(() => checks.remove(check.id, tenant, actor.role, actor.userID, actor));
      assert.equal((await accruals(check.id)).length, 0);
      await run(() => checks.restore(check.id, tenant, actor));
      rows = await accruals(check.id);
      assert.equal(Number(rows[0].amount), 8);
      assert.equal(rows[0].accrued_at.toISOString(), before.accrued_at.toISOString());
      assert.equal(rows[0].employee_id, first);
    });
  },
);

test(
  'actual PG: no retroactive new rules, including unmatched and newly added old-check products',
  options,
  async () => {
    await fixture(async ({ product, create, bulk, accruals, edit, tenant, q, run, checks, actor, first }) => {
      const original = await product('Original', 100, 80, undefined, 'Retro'),
        added = await product('Added', 100, 80, undefined, 'Retro');
      const unmatched = await create([original]);
      const historical = await create([original]);
      await q('DELETE FROM check_motivation_snapshots WHERE check_id=$1', [historical.id]);
      await q('UPDATE checks SET motivation_v2_posted_at=NULL WHERE id=$1', [historical.id]);
      await bulk([
        {
          kind: 'folder',
          warehouseId: (await q('SELECT warehouse_id FROM products WHERE id=$1', [original.productId]))[0].warehouse_id,
          path: 'Retro',
        },
      ]);
      for (const check of [unmatched, historical]) {
        await edit(check, { comment: 'Комментарий' });
        await edit(check, { assigneeIds: [first], assigneesConfirmed: true });
        await edit(check, { products: [original, added] });
        assert.equal((await accruals(check.id)).length, 0);
        await run(() => checks.remove(check.id, tenant, actor.role, actor.userID, actor));
        await run(() => checks.restore(check.id, tenant, actor));
        assert.equal((await accruals(check.id)).length, 0);
      }
      assert.equal(
        (
          await q('SELECT decision FROM check_motivation_snapshots WHERE check_id=$1 AND product_id=$2', [
            unmatched.id,
            added.productId,
          ])
        )[0].decision,
        'none',
      );
      const fresh = await create([original, added]);
      assert.equal((await accruals(fresh.id)).length, 2, 'only a newly posted sale sees the new program');
    });
  },
);

test(
  'actual PG: partial returns reduce saved net quantities, full returns reverse v2, legacy partial remains',
  options,
  async () => {
    await fixture(async ({ product, rule, create, accruals, run, returns, tenant, owner, actor, q, legacy }) => {
      const p = await product('Oil', 100, 80);
      await rule(p.productId);
      const check = await create([{ ...p, quantity: 2 }], { discount: 20 });
      const line = (await q('SELECT id FROM check_product_lines WHERE check_id=$1', [check.id]))[0];
      await run(() =>
        returns.createReturn(
          tenant,
          owner,
          check.id,
          {
            destination: 'warehouse',
            scope: 'partial',
            refundAmount: 1,
            lines: [{ productLineId: line.id, quantity: 0.5 }],
          },
          actor,
        ),
      );
      assert.equal(
        Number((await accruals(check.id))[0].amount),
        10.8,
        '0.5/2 of saved 180 net base is returned, not 1 ruble refund ratio',
      );
      const full = await create([p]);
      await run(() => returns.createReturn(tenant, owner, full.id, { destination: 'warehouse', scope: 'full' }, actor));
      assert.equal((await accruals(full.id)).length, 0);
      const old = await product('Legacy', 100, 80);
      await run(() => legacy.setPromo(tenant, { productId: old.productId, percent: 37 }));
      const legacyCheck = await create([old]);
      const oldLine = (await q('SELECT id FROM check_product_lines WHERE check_id=$1', [legacyCheck.id]))[0];
      await run(() =>
        returns.createReturn(
          tenant,
          owner,
          legacyCheck.id,
          { destination: 'warehouse', scope: 'partial', lines: [{ productLineId: oldLine.id, quantity: 0.5 }] },
          actor,
        ),
      );
      assert.equal(Number((await accruals(legacyCheck.id))[0].amount), 7.4);
    });
  },
);

test(
  'actual PG: explicit legacy replacement preserves old 37% history through edit and trash/restore',
  options,
  async () => {
    await fixture(async ({ product, create, bulk, legacy, run, tenant, accruals, edit, q, checks, actor }) => {
      const p = await product('Old', 100, 80);
      await run(() => legacy.setPromo(tenant, { productId: p.productId, percent: 37 }));
      const active = await create([p]),
        trashed = await create([p]);
      const original = (await accruals(active.id))[0],
        oldDate = original.accrued_at.toISOString();
      await run(() => checks.remove(trashed.id, tenant, actor.role, actor.userID, actor));
      const config = (await run(() => legacy.listPromos(tenant)))[0];
      const firstPreview = await bulk([{ kind: 'product', productId: p.productId }], 8);
      assert.equal(firstPreview.preview.affectedProductCount, 0);
      assert.equal(firstPreview.preview.legacyExceptions[0].replacing, false);
      const replacement = await bulk([{ kind: 'product', productId: p.productId }], 8, {
        replaceLegacyPromos: [
          {
            productId: p.productId,
            updatedAt: config.updatedAt.toISOString ? config.updatedAt.toISOString() : config.updatedAt,
          },
        ],
      });
      assert.equal(replacement.result.affectedProductCount, 1);
      assert.equal(Number((await accruals(active.id))[0].amount), 7.4);
      await edit(active, { products: [p], comment: 'Preserve old rule' });
      assert.equal(Number((await accruals(active.id))[0].percent), 37);
      assert.equal((await accruals(active.id))[0].accrued_at.toISOString(), oldDate);
      await run(() => checks.restore(trashed.id, tenant, actor));
      assert.equal(Number((await accruals(trashed.id))[0].amount), 7.4);
      assert.equal(Number((await accruals((await create([p])).id))[0].amount), 8);
      await assert.rejects(
        run(() => legacy.setPromo(tenant, { productId: p.productId, percent: 99 })),
        (e) => e.getStatus() === 409,
      );
      const mixed = await run(() => legacy.listAccruals(tenant, {}, true)),
        oldOnly = await run(() => legacy.listAccruals(tenant, {}));
      assert.ok(mixed.some((r) => r.scheme === 'margin_v1') && mixed.some((r) => r.scheme === 'revenue_v2'));
      assert.ok(oldOnly.every((r) => r.marginBase > 0));
    });
  },
);
