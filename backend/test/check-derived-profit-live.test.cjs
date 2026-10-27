// Disposable local PostgreSQL only; no application .env or production connection.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const dist = process.env.AUTEXA_TEST_DIST || resolve(__dirname, '../dist');
const load = (path) => require(resolve(dist, path));
const { TenantAwarePool } = load('common/tenant-pool');
const { runWithTenant } = load('common/tenant-context');
const { ChecksService } = load('checks/checks.service');
const { ClientsService } = load('clients/clients.service');
const { CarsService } = load('cars/cars.service');
const { WarrantyService } = load('warranty/warranty.service');
const { WarehousesService } = load('warehouses/warehouses.service');
const { ReturnsService } = load('returns/returns.service');
Logger.overrideLogger(false);
const live = process.env.AUTEXA_CHECK_PROFIT_TEST_DB;

test(
  'saved motivation profit: journal/detail/board/car/client history, ACL, returns and restore',
  { skip: !live, timeout: 60000 },
  async () => {
    const url = new URL(live);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55452');
    assert.equal(url.pathname, '/autexa_oct27_display');
    assert.equal(url.username, 'oct27_display_admin');
    const admin = new Pool({ connectionString: live });
    const appUrl = new URL(live);
    appUrl.username = 'autexa_app';
    const pool = new TenantAwarePool(admin, new Pool({ connectionString: appUrl.toString() }));
    const clients = new ClientsService(pool);
    const checks = new ChecksService(pool, new WarrantyService(pool), clients);
    const cars = new CarsService(pool, clients, undefined);
    const warehouses = new WarehousesService(pool);
    const returns = new ReturnsService(pool, warehouses);
    const tenant = randomUUID(),
      foreign = randomUUID(),
      owner = randomUUID(),
      first = randomUUID(),
      second = randomUUID(),
      client = randomUUID(),
      car = randomUUID();
    const actor = { tenantID: tenant, userID: owner, role: 'director' };
    const weak = {
      ...actor,
      role: 'master',
      permissions: { profit_view: false, checks_view_all: true, clients_view: true },
    };
    const run = (fn) => runWithTenant(tenant, fn);
    const q = async (sql, params = []) => (await admin.query(sql, params)).rows;
    const detail = (id, who = actor) => run(() => checks.getById(id, tenant, who));
    const ledger = async (id) =>
      Number(
        (
          await q(
            'SELECT COALESCE(SUM(amount),0) AS amount FROM motivation_accruals WHERE tenant_id=$1 AND check_id=$2',
            [tenant, id],
          )
        )[0].amount,
      );
    const assertLedger = async (id) => {
      const c = await detail(id),
        sum = await ledger(id);
      assert.equal(c.motivationAmount, sum);
      assert.equal(c.profitAfterMotivation, Math.round((c.profit - sum) * 100) / 100);
      return c;
    };
    try {
      await q(
        "INSERT INTO tenants(id,name,timezone) VALUES($1,'Derived profit QA','Europe/Moscow'),($2,'Foreign QA','Europe/Moscow')",
        [tenant, foreign],
      );
      for (const [id, role] of [
        [owner, 'director'],
        [first, 'master'],
        [second, 'master'],
      ])
        await q(
          "INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1::uuid,$2,$1::text,'unused','QA',$3)",
          [id, tenant, role],
        );
      await q("INSERT INTO clients(id,tenant_id,full_name,phone) VALUES($1,$2,'Client','79991112233')", [
        client,
        tenant,
      ]);
      await q("INSERT INTO cars(id,tenant_id,client_id,plate_number,make_model) VALUES($1,$2,$3,'A123AA77','QA Car')", [
        car,
        tenant,
        client,
      ]);
      const warehouse = await run(() => warehouses.resolveByKind(tenant, 'main'));
      const product = randomUUID();
      await q(
        "INSERT INTO products(id,tenant_id,warehouse_id,name,unit,sell_price,cost_price,stock) VALUES($1,$2,$3,'QA Product','шт',2500,500,100)",
        [product, tenant, warehouse.id],
      );
      await q("INSERT INTO motivation_rules(tenant_id,target_kind,product_id,percent) VALUES($1,'product',$2,16)", [
        tenant,
        product,
      ]);
      const create = (extra = {}) =>
        run(() =>
          checks.create(
            tenant,
            owner,
            'director',
            {
              masterId: owner,
              clientId: client,
              carId: car,
              assigneeIds: [first, second],
              assigneesConfirmed: true,
              products: [{ productId: product, name: 'QA Product', sellPrice: 2500, costPrice: 500, quantity: 1 }],
              services: [],
              paymentMethod: 'cash',
              workStatus: 'accepted',
              ...extra,
            },
            actor,
          ),
        );
      const sale = await create();
      assert.equal(sale.profit, 2000, 'raw check profit preserves established storage contract');
      assert.equal(sale.profitAfterMotivation, 1600, '2000 minus the saved 400 bonus');
      await q(
        'UPDATE motivation_accruals SET amount=CASE WHEN employee_id=$3 THEN 150 ELSE 250 END, total_bonus=400 WHERE tenant_id=$1 AND check_id=$2',
        [tenant, sale.id, first],
      );
      // Repeated total_bonus is product-wide metadata, not two independent costs.
      assert.equal((await assertLedger(sale.id)).motivationAmount, 400);
      const raw = Number(
        (await q('SELECT profit FROM checks WHERE tenant_id=$1 AND id=$2', [tenant, sale.id]))[0].profit,
      );
      await q('UPDATE motivation_rules SET percent=99 WHERE tenant_id=$1', [tenant]);
      assert.equal((await detail(sale.id)).profitAfterMotivation, 1600, 'new rates must not rewrite closed history');
      for (const query of [{}, { cursor: '', limit: 1 }]) {
        const rows = (await run(() => checks.getAll(tenant, query, actor))).data;
        assert.equal(rows.find((c) => c.id === sale.id).profitAfterMotivation, 1600);
      }
      assert.equal(
        (await run(() => checks.setWorkStatus(sale.id, tenant, 'accepted', actor))).profitAfterMotivation,
        1600,
      );
      const board = await run(() => checks.getBoard(tenant, actor));
      assert.equal(
        Object.values(board.groups)
          .flat()
          .find((c) => c.id === sale.id).profitAfterMotivation,
        1600,
      );
      const history = await run(() => checks.getClientHistory(client, tenant, {}, actor));
      assert.equal(history.data.find((c) => c.id === sale.id).profitAfterMotivation, 1600);
      assert.equal(
        (await run(() => checks.getClientHistoryCheck(sale.id, client, tenant, actor))).profitAfterMotivation,
        1600,
      );
      assert.equal(
        (await run(() => cars.getChecks(car, tenant, 50, null, actor))).find((c) => c.id === sale.id)
          .profitAfterMotivation,
        1600,
      );
      assert.equal(
        (await run(() => checks.updateOwnComment(sale.id, tenant, owner, 'Updated', actor))).profitAfterMotivation,
        1600,
      );
      for (const hidden of [
        await detail(sale.id, weak),
        await run(() => checks.getById(sale.id, tenant)),
        (await run(() => checks.getAll(tenant, {}, weak))).data[0],
        (await run(() => cars.getChecks(car, tenant, 50, null, weak)))[0],
      ]) {
        for (const key of [
          'profit',
          'motivationAmount',
          'profitAfterMotivation',
          'warrantyLoss',
          'warrantyLossAfterMotivation',
        ])
          assert.equal(hidden[key], 0, `${key} is guarded`);
      }
      await q(
        "INSERT INTO motivation_accruals(tenant_id,employee_id,check_id,amount,scheme,qty,margin_base,percent) VALUES($1,$2,$3,25,'margin_v1',1,100,25)",
        [tenant, first, sale.id],
      );
      assert.equal((await assertLedger(sale.id)).profitAfterMotivation, 1575, 'all schemes add, not only revenue_v2');
      const foreignId = randomUUID();
      await q(
        "INSERT INTO checks(id,tenant_id,number,date,total_revenue,total_cost,profit,payment_method) VALUES($1,$2,1,now(),9999,0,9999,'cash')",
        [foreignId, foreign],
      );
      await assert.rejects(detail(foreignId), (e) => e.getStatus() === 404);
      assert.equal(
        (await run(() => checks.getAll(tenant, {}, actor))).data.some((c) => c.id === foreignId),
        false,
      );
      await q('UPDATE motivation_rules SET percent=16 WHERE tenant_id=$1', [tenant]);
      const warranty = await create({ paymentMethod: 'warranty' });
      await q(
        "INSERT INTO motivation_accruals(tenant_id,employee_id,check_id,amount,scheme,qty,margin_base,percent) VALUES($1,$2,$3,40,'margin_v1',1,100,40)",
        [tenant, first, warranty.id],
      );
      const w = await detail(warranty.id);
      assert.equal(w.warrantyLoss, 540);
      assert.equal(w.warrantyLossAfterMotivation, 540);
      const partial = await create({
        products: [{ productId: product, name: 'QA Product', sellPrice: 2500, costPrice: 500, quantity: 2 }],
      });
      const line = (await q('SELECT id FROM check_product_lines WHERE check_id=$1', [partial.id]))[0];
      await run(() =>
        returns.createReturn(
          tenant,
          owner,
          partial.id,
          {
            destination: 'warehouse',
            scope: 'partial',
            refundAmount: 100,
            lines: [{ productLineId: line.id, quantity: 1 }],
          },
          actor,
        ),
      );
      assert.equal((await assertLedger(partial.id)).motivationAmount, 400);
      const full = await create();
      await run(() => returns.createReturn(tenant, owner, full.id, { destination: 'warehouse', scope: 'full' }, actor));
      assert.equal((await assertLedger(full.id)).motivationAmount, 0);
      const trashed = await create();
      await run(() => checks.remove(trashed.id, tenant, actor.role, owner, actor));
      assert.equal(await ledger(trashed.id), 0);
      const restored = await run(() => checks.restore(trashed.id, tenant, actor));
      assert.equal(restored.motivationAmount, 400);
      assert.equal(restored.profitAfterMotivation, 1600);
      let aggregateQueries = 0;
      const originalQuery = pool.query.bind(pool);
      pool.query = (sql, ...args) => {
        if (typeof sql === 'string' && sql.includes('SUM(amount)') && sql.includes('motivation_accruals'))
          aggregateQueries++;
        return originalQuery(sql, ...args);
      };
      try {
        await run(() => checks.getAll(tenant, { limit: 50 }, actor));
      } finally {
        pool.query = originalQuery;
      }
      assert.equal(aggregateQueries, 1, 'one batch ledger aggregate per page, no N+1');
      assert.equal(Number((await q('SELECT profit FROM checks WHERE id=$1', [sale.id]))[0].profit), raw);
    } finally {
      await q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenant, foreign]]);
      await pool.end();
    }
  },
);
