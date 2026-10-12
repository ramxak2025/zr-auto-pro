const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { StarterCatalogsService } = require('../dist/starter-catalogs/starter-catalogs.service');
const { ProductsService } = require('../dist/products/products.service');
const { ServicesService } = require('../dist/services/services.service');
const { CheckTemplatesService } = require('../dist/check-templates/check-templates.service');
const { updateReceiptPrices, lockReceiptProducts } = require('../dist/suppliers/procurement-history');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { resolveTemplateProductSources } = require('../dist/check-templates/template-product-source');
const { STARTER_ENTRIES, STARTER_DIRECTIONS } = require('../dist/starter-catalogs/starter-manifest');
const live = Boolean(process.env.AUTEXA_OCT13_LIVE_DB);
test(
  'starter catalogs real PostgreSQL: transactions, exact identity, tombstones, placeholders and preview conflicts',
  { skip: !live },
  async () => {
    const url = new URL(process.env.DATABASE_URL);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55443');
    assert.ok(
      ['/autexa_oct13', '/autexa_oct13_starter'].includes(url.pathname),
      'Disposable integration or feature DB only',
    );
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const appUrl = new URL(process.env.DATABASE_URL);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.AUTEXA_OCT13_APP_PASSWORD;
    assert.ok(appUrl.password);
    const app = new Pool({ connectionString: appUrl.toString() });
    const tenantId = randomUUID();
    const otherId = randomUUID();
    try {
      await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)', [
        tenantId,
        'Starter live QA',
        otherId,
        'Other tenant',
      ]);
      const owner = (
        await pool.query(
          "INSERT INTO users(phone,password,full_name,role,tenant_id) VALUES($1,'test-hash','Starter owner','director',$2) RETURNING id",
          ['qa-' + randomUUID(), tenantId],
        )
      ).rows[0].id;
      const warehouse = (
        await pool.query(
          "INSERT INTO warehouses(tenant_id,name,kind) VALUES($1,'Основной склад','main') RETURNING id",
          [tenantId],
        )
      ).rows[0].id;
      await pool.query("INSERT INTO warehouses(tenant_id,name,kind) VALUES($1,'Брак','defect'),($1,'Б/У','used')", [
        tenantId,
      ]);
      const foreignWarehouse = (
        await pool.query("INSERT INTO warehouses(tenant_id,name,kind) VALUES($1,'Другой склад','main') RETURNING id", [
          otherId,
        ])
      ).rows[0].id;
      const actor = { userID: owner, tenantID: tenantId, role: 'director', permissions: {} };
      const scopedPool = new TenantAwarePool(pool, app);
      const real = new StarterCatalogsService(scopedPool);
      const service = {
        preview: (...args) => runWithTenant(tenantId, () => real.preview(...args)),
        install: (...args) => runWithTenant(tenantId, () => real.install(...args)),
      };
      assert.equal(STARTER_DIRECTIONS.length, 10);
      const selection = {
        directionIds: ['oil_service', 'brakes', 'lpg'],
        parts: ['services', 'products', 'templates'],
        warehouseId: warehouse,
      };
      await assert.rejects(
        service.preview(tenantId, { ...actor, role: 'admin' }, selection),
        (e) => e.getStatus() === 403,
      );
      await assert.rejects(
        service.preview(tenantId, actor, { ...selection, warehouseId: foreignWarehouse }),
        (e) => e.getStatus() === 400,
      );
      // Real exact identity with unrelated name is reused without price or stock changes.
      const oil = STARTER_ENTRIES.find((e) => e.key === 'product-lm8972');
      const existing = (
        await pool.query(
          'INSERT INTO products(tenant_id,warehouse_id,name,brand,article,packaging,unit,cost_price,sell_price,stock) VALUES($1,$2,$3,$4,$5,$6,$7,250,500,7) RETURNING id',
          [tenantId, warehouse, 'Owner oil', oil.brand, oil.article, oil.packaging, oil.unit],
        )
      ).rows[0].id;
      const preview = await service.preview(tenantId, actor, selection);
      assert.equal(preview.items.find((i) => i.key === oil.key).status, 'reuse');
      const [first, second] = await Promise.all([
        service.install(tenantId, actor, { previewId: preview.id }),
        service.install(tenantId, actor, { previewId: preview.id }),
      ]);
      assert.deepEqual(first, second);
      assert.ok(first.added > 0);
      await assert.rejects(
        service.install(tenantId, actor, { previewId: preview.id, resolutions: { [oil.key]: { action: 'skip' } } }),
        (e) => e.getStatus() === 409,
      );
      const saved = (await pool.query('SELECT cost_price,sell_price,stock FROM products WHERE id=$1', [existing]))
        .rows[0];
      assert.deepEqual(saved, { cost_price: '250.00', sell_price: '500.00', stock: '7.000' });
      const starters = (await pool.query('SELECT * FROM products WHERE tenant_id=$1 AND id<>$2', [tenantId, existing]))
        .rows;
      assert.ok(starters.length > 0);
      assert.ok(
        starters.every(
          (p) =>
            Number(p.stock) === 0 &&
            Number(p.sell_price) === 1 &&
            Number(p.cost_price) === 1 &&
            p.cost_price_is_placeholder &&
            p.sell_price_is_placeholder,
        ),
      );
      const again = await service.preview(tenantId, actor, selection);
      const repeat = await service.install(tenantId, actor, { previewId: again.id });
      assert.equal(repeat.added, 0);
      // Template source costs are unknown until real cost confirmation.
      const projected = await new CheckTemplatesService(pool).getAll(tenantId, actor);
      const linked = projected.find((t) => t.products.length);
      assert.ok(linked);
      assert.equal(linked.products[0].costStatus, 'unknown');
      assert.equal(linked.productCostTotal, undefined);
      const templateFolders = (await pool.query('SELECT folder_id FROM check_templates WHERE tenant_id=$1', [tenantId]))
        .rows;
      assert.ok(templateFolders.every((t) => t.folder_id));
      const sourceTx = await pool.connect();
      try {
        await sourceTx.query('BEGIN');
        await assert.rejects(
          resolveTemplateProductSources(sourceTx, tenantId, owner, [linked.products[0]]),
          (e) => e.getResponse().code === 'TEMPLATE_PRODUCT_COST_UNKNOWN',
        );
        await sourceTx.query('ROLLBACK');
      } finally {
        sourceTx.release();
      }
      const product = starters[0];
      const productsApi = new ProductsService(pool, {});
      await productsApi.update(product.id, tenantId, { name: product.name + ' owner edit' }, owner);
      assert.equal(
        (await pool.query('SELECT cost_price_is_placeholder FROM products WHERE id=$1', [product.id])).rows[0]
          .cost_price_is_placeholder,
        true,
      );
      await productsApi.update(product.id, tenantId, { costPrice: 1 }, owner);
      assert.deepEqual(
        (
          await pool.query('SELECT cost_price_is_placeholder,sell_price_is_placeholder FROM products WHERE id=$1', [
            product.id,
          ])
        ).rows[0],
        { cost_price_is_placeholder: false, sell_price_is_placeholder: true },
      );
      await productsApi.setSellPrice(product.id, tenantId, 1, owner);
      assert.equal(
        (await pool.query('SELECT sell_price_is_placeholder FROM products WHERE id=$1', [product.id])).rows[0]
          .sell_price_is_placeholder,
        false,
      );
      const serviceRow = (await pool.query('SELECT * FROM services WHERE tenant_id=$1 LIMIT 1', [tenantId])).rows[0];
      const servicesApi = new ServicesService(pool, {});
      await servicesApi.update(serviceRow.id, tenantId, { name: serviceRow.name + ' owner edit' }, owner);
      assert.equal(
        (await pool.query('SELECT price_is_placeholder FROM services WHERE id=$1', [serviceRow.id])).rows[0]
          .price_is_placeholder,
        true,
      );
      await servicesApi.update(serviceRow.id, tenantId, { defaultPrice: 1 }, owner);
      const confirmed = (
        await pool.query('SELECT price_version,price_is_placeholder FROM services WHERE id=$1', [serviceRow.id])
      ).rows[0];
      assert.equal(confirmed.price_version, 2);
      assert.equal(confirmed.price_is_placeholder, false);
      assert.equal(
        (
          await pool.query(
            'SELECT price_is_placeholder FROM service_price_history WHERE service_id=$1 ORDER BY version',
            [serviceRow.id],
          )
        ).rows[0].price_is_placeholder,
        true,
      );
      // Explicit zero purchase confirms a placeholder free good; unrelated receipt fields do not.
      const receiptProduct = starters[1];
      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        const [locked] = await lockReceiptProducts(tx, tenantId, [receiptProduct.id], null);
        await updateReceiptPrices(tx, tenantId, owner, locked, 0, undefined, false);
        await tx.query('COMMIT');
      } finally {
        tx.release();
      }
      assert.deepEqual(
        (
          await pool.query(
            'SELECT cost_price,cost_price_is_placeholder,sell_price_is_placeholder FROM products WHERE id=$1',
            [receiptProduct.id],
          )
        ).rows[0],
        { cost_price: '0.00', cost_price_is_placeholder: false, sell_price_is_placeholder: true },
      );
      const imported = starters[2];
      await productsApi.importCsv(tenantId, [{ name: imported.name, category: 'Owner path' }]);
      assert.equal(
        (await pool.query('SELECT cost_price_is_placeholder FROM products WHERE id=$1', [imported.id])).rows[0]
          .cost_price_is_placeholder,
        true,
      );
      await productsApi.importCsv(tenantId, [{ name: imported.name, costPrice: 1 }]);
      assert.deepEqual(
        (
          await pool.query('SELECT cost_price_is_placeholder,sell_price_is_placeholder FROM products WHERE id=$1', [
            imported.id,
          ])
        ).rows[0],
        { cost_price_is_placeholder: false, sell_price_is_placeholder: true },
      );
      // Hard deletion leaves membership, no automatic resurrection; restore is explicit.
      const member = (
        await pool.query("SELECT * FROM starter_catalog_memberships WHERE tenant_id=$1 AND kind='services' LIMIT 1", [
          tenantId,
        ])
      ).rows[0];
      await pool.query('DELETE FROM services WHERE id=$1', [member.resource_id]);
      const deleted = await service.preview(tenantId, actor, selection);
      assert.equal(deleted.items.find((i) => i.key === member.item_key).status, 'deleted');
      await service.install(tenantId, actor, { previewId: deleted.id });
      assert.equal((await pool.query('SELECT id FROM services WHERE id=$1', [member.resource_id])).rows.length, 0);
      const restore = await service.preview(tenantId, actor, selection);
      await service.install(tenantId, actor, {
        previewId: restore.id,
        resolutions: { [member.item_key]: { action: 'restore' } },
      });
      const newMember = (
        await pool.query('SELECT resource_id FROM starter_catalog_memberships WHERE tenant_id=$1 AND item_key=$2', [
          tenantId,
          member.item_key,
        ])
      ).rows[0];
      assert.notEqual(newMember.resource_id, member.resource_id);
      // Different owner catalogue version invalidates preview, no uncontrolled partial install.
      const stale = await service.preview(tenantId, actor, {
        directionIds: ['suspension'],
        parts: ['services', 'products'],
        warehouseId: warehouse,
      });
      const match = stale.items.find((i) => i.kind === 'products' && i.status === 'reuse');
      const matched = (
        await pool.query('SELECT resource_id FROM starter_catalog_memberships WHERE tenant_id=$1 AND item_key=$2', [
          tenantId,
          match.key,
        ])
      ).rows[0];
      await pool.query('UPDATE products SET sell_price=99 WHERE id=$1', [matched.resource_id]);
      await assert.rejects(service.install(tenantId, actor, { previewId: stale.id }), (e) => e.getStatus() === 409);
      // Deselecting service/product parts cannot create them through a template dependency.
      const templatesOnly = await service.preview(tenantId, actor, {
        directionIds: ['ac_service'],
        parts: ['templates'],
        warehouseId: warehouse,
      });
      assert.ok(templatesOnly.items.some((i) => i.kind === 'templates' && i.status === 'blocked'));
      const before = (await pool.query('SELECT count(*) FROM services WHERE tenant_id=$1', [tenantId])).rows[0].count;
      await service.install(tenantId, actor, { previewId: templatesOnly.id });
      assert.equal(
        (await pool.query('SELECT count(*) FROM services WHERE tenant_id=$1', [tenantId])).rows[0].count,
        before,
      );
      // Name-only goods are ambiguous; reuse candidate must belong to preview.
      const detail = STARTER_ENTRIES.find((e) => e.key === 'generic-Микрофибра');
      const collision = (
        await pool.query(
          'INSERT INTO products(tenant_id,warehouse_id,name,cost_price,sell_price,stock) VALUES($1,$2,$3,40,80,2) RETURNING id',
          [tenantId, warehouse, detail.name],
        )
      ).rows[0].id;
      const ambiguous = await service.preview(tenantId, actor, {
        directionIds: ['detailing'],
        parts: ['products'],
        warehouseId: warehouse,
      });
      assert.equal(ambiguous.items.find((i) => i.key === detail.key).status, 'ambiguous');
      await assert.rejects(service.install(tenantId, actor, { previewId: ambiguous.id }), (e) => e.getStatus() === 400);
      await assert.rejects(
        service.install(tenantId, actor, {
          previewId: ambiguous.id,
          resolutions: { [detail.key]: { action: 'reuse', resourceId: randomUUID() } },
        }),
        (e) => e.getStatus() === 400,
      );
      await service.install(tenantId, actor, {
        previewId: ambiguous.id,
        resolutions: { [detail.key]: { action: 'reuse', resourceId: collision } },
      });
      assert.equal(
        (await pool.query('SELECT sell_price FROM products WHERE id=$1', [collision])).rows[0].sell_price,
        '80.00',
      );
      // Transfers and customer defect returns retain catalog identity and unknown-cost provenance.
      const { WarehousesService } = require('../dist/warehouses/warehouses.service');
      const { StockMovementsService } = require('../dist/stock-movements/stock-movements.service');
      const { ReturnsService } = require('../dist/returns/returns.service');
      const warehousesService = new WarehousesService(pool);
      const movements = new StockMovementsService(pool, warehousesService);
      const source = (
        await pool.query(
          "SELECT * FROM products WHERE tenant_id=$1 AND cost_price_is_placeholder=true AND brand<>'' LIMIT 1",
          [tenantId],
        )
      ).rows[0];
      await productsApi.updateStock(source.id, tenantId, { type: 'inventory', quantity: 3 }, owner);
      const countBefore = (await pool.query('SELECT count(*) FROM expenses WHERE tenant_id=$1', [tenantId])).rows[0]
        .count;
      const movementBefore = (await pool.query('SELECT count(*) FROM stock_movements WHERE tenant_id=$1', [tenantId]))
        .rows[0].count;
      const rejection = (e) => e.getStatus() === 409 && e.getResponse().code === 'PRODUCT_COST_CONFIRMATION_REQUIRED';
      await assert.rejects(
        productsApi.updateStock(source.id, tenantId, { type: 'writeoff', quantity: 1, recordAsExpense: true }, owner),
        rejection,
      );
      await assert.rejects(
        movements.create(tenantId, owner, {
          type: 'writeoff',
          productId: source.id,
          quantity: 1,
          recordAsExpense: true,
          purchasePrice: 1,
        }),
        rejection,
      );
      assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1', [source.id])).rows[0].stock, '3.000');
      assert.equal(
        (await pool.query('SELECT count(*) FROM expenses WHERE tenant_id=$1', [tenantId])).rows[0].count,
        countBefore,
      );
      assert.equal(
        (await pool.query('SELECT count(*) FROM stock_movements WHERE tenant_id=$1', [tenantId])).rows[0].count,
        movementBefore,
      );
      await movements.create(tenantId, owner, { type: 'used_transfer', productId: source.id, quantity: 1 });
      const usedCopy = (
        await pool.query(
          "SELECT p.* FROM products p JOIN warehouses w ON w.id=p.warehouse_id WHERE p.tenant_id=$1 AND p.name=$2 AND w.kind='used'",
          [tenantId, source.name],
        )
      ).rows[0];
      assert.ok(usedCopy);
      for (const key of [
        'brand',
        'article',
        'packaging',
        'source_url',
        'cost_price_is_placeholder',
        'sell_price_is_placeholder',
      ])
        assert.equal(usedCopy[key], source[key], key);
      const oldCheck = (
        await pool.query(
          'INSERT INTO checks(tenant_id,master_id,total_revenue,cash_amount,product_total,product_cost_total,total_cost,profit) VALUES($1,$2,10,10,10,7,7,3) RETURNING id',
          [tenantId, owner],
        )
      ).rows[0].id;
      await pool.query(
        'INSERT INTO check_product_lines(check_id,product_id,name,sell_price,cost_price,quantity,total_sell,total_cost) VALUES($1,$2,$3,10,7,1,10,7)',
        [oldCheck, source.id, source.name],
      );
      await new ReturnsService(pool, warehousesService).createReturn(
        tenantId,
        owner,
        oldCheck,
        { destination: 'defect', scope: 'full', reason: 'Isolated defect QA' },
        actor,
      );
      const defectCopy = (
        await pool.query(
          "SELECT p.* FROM products p JOIN warehouses w ON w.id=p.warehouse_id WHERE p.tenant_id=$1 AND p.name=$2 AND w.kind='defect'",
          [tenantId, source.name],
        )
      ).rows[0];
      assert.ok(defectCopy);
      for (const key of [
        'brand',
        'article',
        'packaging',
        'source_url',
        'cost_price_is_placeholder',
        'sell_price_is_placeholder',
      ])
        assert.equal(defectCopy[key], source[key], key);
      assert.equal(
        (await pool.query('SELECT cost_price FROM check_product_lines WHERE check_id=$1', [oldCheck])).rows[0]
          .cost_price,
        '7.00',
      );
      // Confirmed real1 retains the usual monetary writeoff behavior.
      await productsApi.update(source.id, tenantId, { costPrice: 1 }, owner);
      await movements.create(tenantId, owner, {
        type: 'writeoff',
        productId: source.id,
        quantity: 1,
        recordAsExpense: true,
        purchasePrice: 1,
      });
      assert.equal(
        (
          await pool.query('SELECT amount FROM expenses WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1', [
            tenantId,
          ])
        ).rows[0].amount,
        '1.00',
      );
      const isolated = await runWithTenant(otherId, () =>
        scopedPool.query('SELECT id FROM starter_catalog_previews WHERE tenant_id=$1', [tenantId]),
      );
      assert.equal(isolated.rows.length, 0);
      console.log(
        'Validated real PG RLS installer, concurrency/replay, confirmed identity, no stock/price overwrite, tombstones, explicit ₽1/₽0 confirmation, template dependency blocking.',
      );
    } finally {
      await pool.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenantId, otherId]]);
      await app.end();
      await pool.end();
    }
  },
);

test(
  'starter selection survives all four existing creation seams and moderated approval',
  { skip: !live },
  async () => {
    const { JwtService } = require('@nestjs/jwt');
    const { TenantsService } = require('../dist/tenants/tenants.service');
    const { AuthService } = require('../dist/auth/auth.service');
    const { RegistrationService } = require('../dist/registration/registration.service');
    const { AuditService } = require('../dist/tenants/audit.service');
    const { ManagerCabinetService } = require('../dist/platform-managers/manager-cabinet.service');
    const { ManagerFinanceService } = require('../dist/platform-managers/manager-finance.service');
    const { PlatformSettingsService } = require('../dist/settings/platform-settings.service');
    const { randomInt } = require('node:crypto');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const cleanup = [];
    const phone = () => '+7' + String(randomInt(9000000000, 9999999999));
    const suffix = randomUUID();
    let requestId, planId, actorId;
    try {
      actorId = (
        await pool.query(
          "INSERT INTO users(phone,password,full_name,role) VALUES($1,'unused','Starter platform QA','superadmin') RETURNING id",
          [phone()],
        )
      ).rows[0].id;
      const jwt = new JwtService({ secret: 'isolated-starter-qa-credential-only-32chars' });
      const audit = new AuditService(pool);
      const starter = new StarterCatalogsService(pool);
      const tenants = new TenantsService(pool, jwt, audit, starter);
      const check = async (id) => {
        cleanup.push(id);
        assert.equal((await pool.query('SELECT count(*) FROM warehouses WHERE tenant_id=$1', [id])).rows[0].count, '3');
        assert.ok(
          Number((await pool.query('SELECT count(*) FROM services WHERE tenant_id=$1', [id])).rows[0].count) > 0,
        );
        assert.ok(
          Number((await pool.query('SELECT count(*) FROM products WHERE tenant_id=$1', [id])).rows[0].count) > 0,
        );
        assert.equal(
          (await pool.query('SELECT count(*) FROM services WHERE tenant_id=$1 AND master_percent IS NOT NULL', [id]))
            .rows[0].count,
          '0',
        );
      };
      const adminCreated = await tenants.create({
        name: 'Admin ' + suffix,
        directorName: 'Owner QA',
        directorPhone: phone(),
        directorPassword: 'OwnerQA123',
        starterDirections: ['oil_service'],
      });
      await check(adminCreated.id);
      const authCreated = await new AuthService(pool, jwt, starter).register({
        phone: phone(),
        password: 'OwnerQA123',
        fullName: 'Owner QA',
        tenantName: 'Auth ' + suffix,
        starterDirections: ['detailing'],
      });
      await check(authCreated.user.tenantId);
      const registration = new RegistrationService(pool, tenants, audit);
      const requestPhone = phone();
      const before = (await pool.query('SELECT count(*) FROM tenants')).rows[0].count;
      await registration.submit({
        companyName: 'Request ' + suffix,
        ownerName: 'Owner QA',
        phone: requestPhone,
        password: 'OwnerQA123',
        starterDirections: ['suspension'],
      });
      assert.equal((await pool.query('SELECT count(*) FROM tenants')).rows[0].count, before);
      const request = (
        await pool.query('SELECT id,starter_directions,status FROM registration_requests WHERE phone=$1', [
          requestPhone,
        ])
      ).rows[0];
      requestId = request.id;
      assert.deepEqual(request.starter_directions, ['suspension']);
      assert.equal(request.status, 'pending');
      const approved = await registration.approve(requestId, {}, { userId: actorId, name: 'Starter platform QA' });
      await check(approved.id);
      planId = (
        await pool.query("INSERT INTO plans(name,monthly_price,max_users,features) VALUES($1,0,10,'[]') RETURNING id", [
          'Starter QA ' + suffix,
        ])
      ).rows[0].id;
      const cabinet = new ManagerCabinetService(
        pool,
        tenants,
        audit,
        new ManagerFinanceService(pool, tenants),
        new PlatformSettingsService(pool),
      );
      const managed = await cabinet.createTenant(
        { userId: actorId, isManager: false, scope: { managerId: null } },
        {
          name: 'Manager ' + suffix,
          planId,
          director: { name: 'Owner QA', phone: phone(), password: 'OwnerQA123' },
          starterDirections: ['brakes'],
        },
      );
      await check(managed.id);
    } finally {
      if (requestId) await pool.query('DELETE FROM registration_requests WHERE id=$1', [requestId]);
      if (cleanup.length) await pool.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [cleanup]);
      if (planId) await pool.query('DELETE FROM plans WHERE id=$1', [planId]);
      if (actorId) await pool.query('DELETE FROM users WHERE id=$1', [actorId]);
      await pool.end();
    }
  },
);
