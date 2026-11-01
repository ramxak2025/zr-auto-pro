// Explicit own disposable PostgreSQL16 fixture. No DATABASE_URL fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture, options, status } = require('./helpers/nov01-search-fixture.cjs');
const { ProductBarcodesService } = require('../dist/products/product-barcodes.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { ServicesService } = require('../dist/services/services.service');
const { SuppliersService } = require('../dist/suppliers/suppliers.service');
const { prepareSearch } = require('../dist/common/smart-search');
const sharedSource = fs.readFileSync(path.join(__dirname, '../../shared/utils/smartSearch.ts'), 'utf8');
const compiled = require('typescript').transpileModule(sharedSource, {
  compilerOptions: { module: 1, target: 9 },
}).outputText;
const sharedModule = { exports: {} };
new Function('exports', 'module', compiled)(sharedModule.exports, sharedModule);
const shared = sharedModule.exports;
const barcodeService = (f) => new ProductBarcodesService(f.pool, f.products);

test('query bounds reject excessive work before SQL; backend preparation mirrors shared normalization/layout', () => {
  for (const query of ['ЁЖ зиМНЯЯ', 'шина зимняя', 'Pbvyzz ibyf', 'ABCD-123', 'ＡＢ１２', 'ÅNGSTRÖM', '', '[]'])
    assert.deepEqual(
      prepareSearch(query),
      shared.getSearchQueryVariants(query)[0] ? shared.getSearchQueryVariants(query) : [],
    );
  for (const query of ['x'.repeat(257), 'a b c d e f g h i', 'x'.repeat(65), {}])
    assert.throws(() => prepareSearch(query), status(400));
});

test('SQL Unicode/rank/Damerau parity, including ё, NFKC, transposition and numeric fuzzy exclusion', options, () =>
  fixture(async (f) => {
    const items = [
      { id: 'a', name: 'Ёлка зимняя', sku: 'ABCD-123' },
      { id: 'b', name: 'Зимняя шина' },
      { id: 'c', name: 'Шинная зимняя шина' },
      { id: 'd', name: 'ÅNGSTRÖM ＡＢ１２' },
    ];
    for (const query of ['ЕЛКА', 'зим няя', 'няя елк', 'ibyf', 'шинна', 'шниа', 'ÅNGSTRÖM', 'ABCD-124', 'ABCE-123']) {
      const variants = shared.getSearchQueryVariants(query);
      const ordinary = await f.q(
        `SELECT id,stage,autexa_search_rank(query,fields) rank
      FROM jsonb_to_recordset($1::jsonb) AS item(id text,fields text[])
      CROSS JOIN unnest($2::text[]) WITH ORDINALITY variant(query,stage)
      WHERE autexa_search_rank(query,fields) IS NOT NULL ORDER BY stage,rank,id`,
        [
          JSON.stringify(
            items.map((item) => ({ id: item.id, fields: [item.name, item.sku].map(shared.normalizeSearchText) })),
          ),
          variants,
        ],
      );
      let actual;
      if (ordinary.length) actual = ordinary.filter((row) => row.stage === ordinary[0].stage).map((row) => row.id);
      else {
        const rows = await f.q(
          `SELECT id,stage FROM jsonb_to_recordset($1::jsonb) AS item(id text,fields text[])
      CROSS JOIN unnest($2::text[]) WITH ORDINALITY variant(query,stage)
      WHERE autexa_search_typo_matches(query,fields) ORDER BY stage,id`,
          [
            JSON.stringify(
              items.map((item) => ({ id: item.id, fields: [item.name, item.sku].map(shared.normalizeSearchText) })),
            ),
            variants,
          ],
        );
        actual = rows.filter((row) => row.stage === rows[0]?.stage).map((row) => row.id);
      }
      assert.deepEqual(
        actual,
        shared.smartSearch(items, query, (item) => [item.name, item.sku], { typos: true }).map((item) => item.id),
        query,
      );
    }
    for (const value of ['ЁЖ Ёлка HELLO ÅNGSTRÖM ＡＢ１２', 'Русский_% name 123', '日本語 café']) {
      assert.equal(
        (await f.q('SELECT autexa_search_normalize($1) value', [value]))[0].value,
        shared.normalizeSearchText(value),
      );
    }
  }),
);

test(
  '5000+ product search covers full scoped dataset with stable pagination/count and measured plans',
  { ...options, timeout: 60000 },
  () =>
    fixture(async (f) => {
      await f.q(
        `INSERT INTO products(tenant_id,warehouse_id,name,cost_price,sell_price,stock)
    SELECT $1,$2,'Каталог позиция '||lpad(i::text,5,'0'),99,149,10 FROM generate_series(1,5100) i`,
        [f.tenant, f.main],
      );
      const exact = await f.product({
        name: 'Шина зимняя ёлка',
        article: 'ABCD-123',
        brand: 'Nordman',
        barcode: '4600012345678',
      });
      await f.product({ name: 'Шина зимняя ёлка расширенная' });
      const hidden = await f.product({ name: 'Тайная шина' });
      await f.q('UPDATE products SET warehouse_id=$1 WHERE id=$2', [f.secondWh, hidden.id]);
      await f.q("INSERT INTO products(tenant_id,name,barcode) VALUES($1,'Чужая шина','4600012345678')", [f.foreign]);
      const search = (query, more = {}) =>
        f.run(() => f.products.getAll(f.tenant, { search: query, warehouseId: 'all', limit: 2, ...more }, f.actor));
      for (const query of [
        'зим елк',
        'ёлка зим',
        'ШИНА ЗИМНЯЯ ЕЛКА',
        'ABCD123',
        'Nord',
        '4600012345678',
        'ibyf',
        'шинна',
      ]) {
        const started = performance.now();
        const result = await search(query);
        assert.ok(
          result.data.some((row) => row.id === exact.id),
          query,
        );
        assert.ok(!result.data.some((row) => row.id === hidden.id));
        console.log(`search-perf ${query}: ${(performance.now() - started).toFixed(1)}ms total=${result.total}`);
      }
      assert.equal((await search('ABCD-124')).total, 0, 'numeric SKU is never fuzzy corrected');
      assert.equal((await search('ABCE-123')).total, 0, 'numeric query disables alpha-segment fuzzy too');
      const first = await search('каталог', { page: 1 });
      const second = await search('каталог', { page: 2 });
      assert.equal(first.total, 5100);
      assert.equal(second.total, 5100);
      assert.equal(new Set([...first.data, ...second.data].map((row) => row.id)).size, 4);
      assert.equal((await search('каталог', { page: 99999 })).total, 5100);
      assert.equal((await search('тайная')).total, 0);
      const restricted = await f.run(() =>
        f.products.getAll(
          f.tenant,
          { search: 'ABCD123', warehouseId: 'all' },
          {
            ...f.actor,
            role: 'master',
            permissions: { warehouse_access: false, warehouse_manage: false, checks_create: true },
          },
        ),
      );
      assert.equal(restricted.data[0].costPrice, 0);
      // Capture and EXPLAIN the real parameterized production query under RLS.
      const original = f.pool.query.bind(f.pool);
      let statement;
      f.pool.query = async (sql, params) => {
        if (sql.startsWith('WITH scoped')) statement = { sql, params };
        return original(sql, params);
      };
      await search('елка зим');
      f.pool.query = original;
      const plan = await f.run(() =>
        f.pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + statement.sql, statement.params),
      );
      const report = plan.rows[0]['QUERY PLAN'][0];
      console.log(`search-plan execution=${report['Execution Time']}ms planning=${report['Planning Time']}ms`);
      if (process.env.NOV01_SEARCH_PLAN_PATH)
        fs.writeFileSync(process.env.NOV01_SEARCH_PLAN_PATH, JSON.stringify(report, null, 2));
    }),
);

test(
  'clients preserve 7/8 phone, name+phone, literal plate, VIN gate and point isolation; services/suppliers search',
  options,
  () =>
    fixture(async (f) => {
      let vinEnabled = true;
      const clients = new ClientsService(f.pool, { isEnabled: async () => vinEnabled });
      await f.q('UPDATE tenants SET points_shared_clients=false WHERE id=$1', [f.tenant]);
      const id = crypto.randomUUID(),
        hidden = crypto.randomUUID(),
        car = crypto.randomUUID();
      await f.q(
        `INSERT INTO clients(id,tenant_id,full_name,phone,point_id) VALUES($1,$3,'Семён Иванов','+7 (988) 444-44-85',$4),($2,$3,'Семён чужой','+7 900 000-00-01',$5)`,
        [id, hidden, f.tenant, f.point, f.secondPoint],
      );
      await f.q(
        "INSERT INTO cars(id,tenant_id,client_id,plate_number,make_model,vin) VALUES($1,$2,$3,'Х812АА77','Toyota','JTMBD31V705012345')",
        [car, f.tenant, id],
      );
      const lookup = (search) => f.run(() => clients.getAll(f.tenant, { search }, f.point));
      for (const query of [
        'семен ива',
        'иван сем',
        '8988',
        '7-988',
        '+7 (988) 444-44-85',
        'Иван 8988',
        'Х8',
        'Х812 АА77',
        'BD31V',
      ])
        assert.ok(
          (await lookup(query)).data.some((row) => row.id === id),
          query,
        );
      assert.equal((await lookup('чужой')).total, 0);
      vinEnabled = false;
      assert.equal((await lookup('BD31V')).total, 0);
      assert.equal((await lookup('Х9')).total, 0);
      const service = crypto.randomUUID(),
        supplier = crypto.randomUUID();
      await f.q(
        "INSERT INTO services(id,tenant_id,name,category,default_price) VALUES($1,$2,'Замена масляного фильтра','Двигатель',100)",
        [service, f.tenant],
      );
      await f.q("INSERT INTO suppliers(id,tenant_id,name,contact_person) VALUES($1,$2,'Колёса зимние','Сергей')", [
        supplier,
        f.tenant,
      ]);
      const services = new ServicesService(f.pool, clients),
        suppliers = new SuppliersService(f.pool, undefined, undefined);
      await f.q(
        'INSERT INTO service_visibility_rules(tenant_id,service_id,visible_role_ids) VALUES($1,$2,$3::uuid[])',
        [f.tenant, service, [crypto.randomUUID()]],
      );
      assert.equal(
        (
          await f.run(() =>
            services.getAll(f.tenant, { search: 'филь зам', preferredOnly: true }, { ...f.actor, role: 'master' }),
          )
        ).total,
        0,
      );
      assert.equal(
        (
          await f.run(() =>
            services.getAll(f.tenant, { search: 'филь зам', preferredOnly: false }, { ...f.actor, role: 'master' }),
          )
        ).total,
        1,
      );
      assert.equal(
        (await f.run(() => services.getAll(f.tenant, { search: 'филь зам', limit: 1 }, f.actor))).data[0].id,
        service,
      );
      assert.equal(
        (await f.run(() => suppliers.getAll(f.tenant, { search: 'серг коле', limit: 1 }))).data[0].id,
        supplier,
      );
    }),
);

test(
  'barcodes generation is stable, concurrent and scoped; factory stays; ambiguous lookup never picks first; RLS/cost gates',
  options,
  () =>
    fixture(async (f) => {
      const service = barcodeService(f);
      const one = await f.product({ barcode: 'FACTORY123' }),
        two = await f.product({ barcode: 'FACTORY123' }),
        other = await f.product();
      await f.q('UPDATE products SET warehouse_id=$1 WHERE id=$2', [f.secondWh, other.id]);
      const results = await Promise.all([
        f.run(() => service.generate(f.tenant, [one.id, two.id], f.actor)),
        f.run(() => service.generate(f.tenant, [two.id, one.id], f.actor)),
      ]);
      const codes = new Map(results[0].products.map((row) => [row.id, row.internalBarcode]));
      assert.equal(new Set(codes.values()).size, 2);
      for (const row of results[1].products) assert.equal(row.internalBarcode, codes.get(row.id));
      assert.match(codes.get(one.id), /^AX\d{8}$/);
      assert.equal((await f.q('SELECT barcode FROM products WHERE id=$1', [one.id]))[0].barcode, 'FACTORY123');
      const lookup = (barcode, more = {}, actor = f.actor) =>
        f.run(() => service.lookup(f.tenant, { barcode, ...more }, actor));
      assert.equal((await lookup('FACTORY123', { limit: 1 })).status, 'ambiguous');
      assert.equal((await lookup('FACTORY123', { limit: 1, page: 2 })).total, 2);
      assert.equal((await lookup('FACTORY123', { page: 99 })).matches.length, 0);
      assert.equal((await lookup('FACTORY123', { page: 99 })).status, 'ambiguous');
      const found = await lookup(
        codes.get(one.id),
        {},
        {
          ...f.actor,
          role: 'master',
          permissions: { warehouse_access: false, warehouse_manage: false, checks_create: true },
        },
      );
      assert.equal(found.status, 'found');
      assert.equal(found.matches[0].costPrice, 0);
      assert.equal(found.matches[0].internalBarcode, codes.get(one.id));
      assert.equal((await lookup('missing')).status, 'not_found');
      await assert.rejects(
        f.run(() => service.generate(f.tenant, [other.id], f.actor)),
        status(404),
      );
      await assert.rejects(
        f.run(() => service.generate(f.tenant, Array(201).fill(one.id), f.actor)),
        status(400),
      );
      await assert.rejects(
        f.run(() => service.generate(f.tenant, ['garbage'], f.actor)),
        status(400),
      );
      assert.equal((await lookup('FACTORY123', { warehouseId: f.secondWh })).total, 0);
      const foreign = crypto.randomUUID();
      await f.q("INSERT INTO products(id,tenant_id,name,barcode) VALUES($1,$2,'Foreign','FACTORY123')", [
        foreign,
        f.foreign,
      ]);
      assert.equal((await lookup('FACTORY123')).total, 2);
      await assert.rejects(
        f.run(() => service.generate(f.tenant, [foreign], f.actor)),
        status(404),
      );
      assert.equal(
        (await f.run(() => f.pool.query('SELECT * FROM products WHERE tenant_id=$1', [f.foreign]))).rowCount,
        0,
      );
      await f.q('UPDATE products SET deleted_at=now() WHERE id=$1', [one.id]);
      assert.equal((await lookup(codes.get(one.id))).status, 'not_found');
      await f.q('DELETE FROM products WHERE id=$1', [one.id]);
      assert.equal(
        (
          await f.q(
            'SELECT count(*)::int count FROM product_internal_barcode_allocations WHERE tenant_id=$1 AND code=$2',
            [f.tenant, codes.get(one.id)],
          )
        )[0].count,
        1,
      );
      await assert.rejects(
        f.q('UPDATE products SET barcode=$1 WHERE id=$2', [codes.get(one.id), two.id]),
        (error) => error.message === 'BARCODE_RESERVED',
      );
    }),
);

test(
  'generation retries registry and factory collisions without reusing purged codes; namespace edits serialize',
  options,
  () =>
    fixture(async (f) => {
      const service = barcodeService(f),
        one = await f.product(),
        two = await f.product({ barcode: 'AX00000002' });
      await f.q('INSERT INTO product_internal_barcode_allocations(tenant_id,code,product_id) VALUES($1,$2,$3)', [
        f.tenant,
        'AX00000001',
        crypto.randomUUID(),
      ]);
      const original = crypto.randomInt;
      let attempt = 0;
      crypto.randomInt = () => ++attempt;
      try {
        const result = await f.run(() => service.generate(f.tenant, [one.id], f.actor));
        assert.equal(result.products[0].internalBarcode, 'AX00000003');
      } finally {
        crypto.randomInt = original;
      }
      assert.equal(attempt, 3);
      await assert.rejects(
        f.q("UPDATE products SET internal_barcode='AX00000004' WHERE id=$1", [one.id]),
        (error) => error.message === 'INTERNAL_BARCODE_IMMUTABLE',
      );
      await assert.rejects(
        f.q("UPDATE products SET internal_barcode='AX00000005' WHERE id=$1", [two.id]),
        (error) => error.message === 'INTERNAL_BARCODE_REGISTRY_REQUIRED',
      );
      await assert.rejects(
        f.q('DELETE FROM product_internal_barcode_allocations WHERE tenant_id=$1', [f.tenant]),
        (error) => error.message === 'INTERNAL_BARCODE_ALLOCATION_IMMUTABLE',
      );
    }),
);

test('barcode routes precede generic products, reads require auth and generation requires warehouse_manage', () => {
  const { ProductBarcodesController } = require('../dist/products/product-barcodes.controller');
  const { ProductsController } = require('../dist/products/products.controller');
  const { ProductsModule } = require('../dist/products/products.module');
  const { PermissionsGuard, PERMISSION_KEY } = require('../dist/common/guards/permissions.guard');
  const { JwtAuthGuard } = require('../dist/common/guards/jwt-auth.guard');
  const { Reflector } = require('@nestjs/core');
  const controllers = Reflect.getMetadata('controllers', ProductsModule);
  assert.ok(controllers.indexOf(ProductBarcodesController) < controllers.indexOf(ProductsController));
  assert.ok(Reflect.getMetadata('__guards__', ProductBarcodesController).includes(JwtAuthGuard));
  const guard = new PermissionsGuard(new Reflector());
  for (const method of ['generateBatch', 'generateOne']) {
    const handler = ProductBarcodesController.prototype[method];
    assert.equal(Reflect.getMetadata(PERMISSION_KEY, handler), 'warehouse_manage');
    const context = {
      getHandler: () => handler,
      getClass: () => ProductBarcodesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: 'master', permissions: { warehouse_manage: false } } }),
      }),
    };
    assert.throws(() => guard.canActivate(context), status(403));
  }
});

test(
  'factory edit and allocation use the same real namespace lock; exhausted retries roll back reservations',
  options,
  () =>
    fixture(async (f) => {
      const service = barcodeService(f),
        target = await f.product(),
        factory = await f.product();
      const writer = await f.run(() => f.pool.connect());
      const connect = f.pool.connect.bind(f.pool);
      let generatorPid;
      f.pool.connect = async () => {
        const db = await connect();
        generatorPid = db.processID;
        return db;
      };
      const originalRandom = crypto.randomInt;
      let attempt = 3;
      crypto.randomInt = () => ++attempt;
      let generation;
      try {
        await writer.query('BEGIN');
        await writer.query("UPDATE products SET barcode='AX00000004' WHERE id=$1 AND tenant_id=$2", [
          factory.id,
          f.tenant,
        ]);
        generation = f.run(() => service.generate(f.tenant, [target.id], f.actor));
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          if (
            generatorPid &&
            (await f.q('SELECT cardinality(pg_blocking_pids($1::int))>0 blocked', [generatorPid]))[0].blocked
          ) {
            blocked = true;
            break;
          }
          await new Promise((done) => setTimeout(done, 10));
        }
        assert.equal(blocked, true, 'PostgreSQL must observe generator blocked by the factory transaction');
        await writer.query('COMMIT');
        const result = await generation;
        generation = undefined;
        assert.equal(result.products[0].internalBarcode, 'AX00000005', 'generator sees committed factory collision');
      } finally {
        await writer.query('ROLLBACK');
        writer.release();
        f.pool.connect = connect;
        crypto.randomInt = originalRandom;
        if (generation) await generation;
      }
      const untouched = await f.product();
      crypto.randomInt = () => 4;
      try {
        await assert.rejects(
          f.run(() => service.generate(f.tenant, [untouched.id], f.actor)),
          status(409),
        );
      } finally {
        crypto.randomInt = originalRandom;
      }
      assert.equal(
        (await f.q('SELECT internal_barcode FROM products WHERE id=$1', [untouched.id]))[0].internal_barcode,
        null,
      );
      assert.equal(
        (
          await f.q('SELECT count(*)::int n FROM product_internal_barcode_allocations WHERE product_id=$1', [
            untouched.id,
          ])
        )[0].n,
        0,
      );
    }),
);

test(
  'barcode allocation and POS-only lookup finish through one actual RLS connection',
  { ...options, timeout: 5000 },
  () =>
    fixture(async (f) => {
      const service = barcodeService(f),
        product = await f.product({ barcode: 'POS-ONLY' });
      const generated = await f.run(() => service.generate(f.tenant, [product.id], f.actor));
      const pos = {
        ...f.actor,
        role: 'master',
        permissions: { checks_create: true, warehouse_access: false, warehouse_manage: false },
      };
      const result = await f.run(() =>
        service.lookup(f.tenant, { barcode: generated.products[0].internalBarcode }, pos),
      );
      assert.equal(result.status, 'found');
      assert.equal(result.matches[0].id, product.id);
      assert.equal(result.matches[0].costPrice, 0);
      assert.equal(result.matches[0].assemblyExactCost, undefined);
      const { ProductBarcodesController } = require('../dist/products/product-barcodes.controller');
      const { PermissionsGuard, PERMISSION_KEY } = require('../dist/common/guards/permissions.guard');
      const { Reflector } = require('@nestjs/core');
      const handler = ProductBarcodesController.prototype.lookup;
      assert.equal(Reflect.getMetadata(PERMISSION_KEY, handler), undefined);
      const context = {
        getHandler: () => handler,
        getClass: () => ProductBarcodesController,
        switchToHttp: () => ({ getRequest: () => ({ user: pos }) }),
      };
      assert.equal(new PermissionsGuard(new Reflector()).canActivate(context), true);
    }, 1),
);
