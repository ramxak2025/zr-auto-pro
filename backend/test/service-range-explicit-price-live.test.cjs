const test = require('node:test'),
  assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ServicesService } = require('../dist/services/services.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
Logger.overrideLogger(false);
test(
  'range prices require an explicit amount on create and edit; zero and above max remain valid',
  { skip: !process.env.OCT10_PRICING_LIVE_DB, timeout: 30000 },
  async () => {
    const url = new URL(process.env.OCT10_PRICING_LIVE_DB);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55438');
    assert.equal(url.pathname, '/autexa_oct8_test');
    const appUrl = new URL(url);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.OCT10_PRICING_APP_PASSWORD;
    assert(appUrl.password);
    const admin = new Pool({ connectionString: url.toString(), max: 4, statement_timeout: 8000 }),
      app = new Pool({ connectionString: appUrl.toString(), max: 4, statement_timeout: 8000 });
    const pool = new TenantAwarePool(admin, app),
      checks = new ChecksService(pool, new WarrantyService(pool), new ClientsService(pool, undefined)),
      services = new ServicesService(pool);
    const tenant = randomUUID(),
      owner = randomUUID(),
      point = randomUUID();
    const actor = {
      userID: owner,
      tenantID: tenant,
      role: 'director',
      permissions: {},
      pointId: point,
      currentPointId: point,
    };
    const run = (fn) => runWithTenant(tenant, fn),
      q = async (sql, args = []) => (await admin.query(sql, args)).rows;
    try {
      await q("INSERT INTO tenants(id,name,timezone)VALUES($1,'Explicit range QA','Europe/Moscow')", [tenant]);
      await q("INSERT INTO tenant_points(id,tenant_id,name,is_main)VALUES($1,$2,'QA',true)", [point, tenant]);
      await q(
        "INSERT INTO users(id,tenant_id,phone,password,full_name,role)VALUES($1,$2,$3,'unused','QA','director')",
        [owner, tenant, owner],
      );
      const service = await run(() =>
        services.create(tenant, { name: 'Range', priceType: 'range', minPrice: 100, maxPrice: 200 }, owner),
      );
      const create = (price) =>
        run(() =>
          checks.create(
            tenant,
            owner,
            'director',
            {
              masterId: owner,
              isDeferred: true,
              paymentMethod: 'cash',
              products: [],
              services: [
                { serviceId: service.id, masterId: owner, name: 'Range', ...(price !== undefined ? { price } : {}) },
              ],
            },
            actor,
          ),
        );
      for (const price of [undefined, null])
        await assert.rejects(
          create(price),
          (e) => e.getStatus?.() === 400 && e.getResponse().message.includes('укажите цену'),
        );
      assert.equal(
        (await q('SELECT count(*)::int AS n FROM checks WHERE tenant_id=$1', [tenant]))[0].n,
        0,
        'missing price rolls back entire creation',
      );
      const zero = await create(0);
      assert.equal(zero.services[0].price, 0);
      assert.equal(zero.services[0].priceExcess, 0);
      const above = await create(250);
      assert.equal(above.services[0].price, 250);
      assert.equal(above.services[0].priceExcess, 50);
      const line = above.services[0];
      for (const price of [undefined, null])
        await assert.rejects(
          run(() =>
            checks.update(
              above.id,
              tenant,
              'director',
              {
                services: [
                  {
                    id: line.id,
                    serviceId: line.serviceId,
                    masterId: line.masterId,
                    name: line.name,
                    ...(price !== undefined ? { price } : {}),
                  },
                ],
              },
              owner,
              actor,
            ),
          ),
          (e) => e.getStatus?.() === 400,
        );
      const [retained] = await q(
        'SELECT id,price,price_threshold,price_excess FROM check_service_lines WHERE check_id=$1',
        [above.id],
      );
      assert.equal(retained.id, line.id);
      assert.equal(Number(retained.price), 250);
      assert.equal(Number(retained.price_threshold), 200);
      assert.equal(Number(retained.price_excess), 50);
      const edited = await run(() =>
        checks.update(
          above.id,
          tenant,
          'director',
          {
            services: [{ id: line.id, serviceId: line.serviceId, masterId: line.masterId, name: line.name, price: 0 }],
          },
          owner,
          actor,
        ),
      );
      assert.equal(edited.services[0].price, 0);
      assert.equal(edited.services[0].id, line.id);
      assert.equal(edited.services[0].priceThreshold, 200);
    } finally {
      await q('DELETE FROM tenants WHERE id=$1', [tenant]);
      await pool.end();
    }
  },
);
