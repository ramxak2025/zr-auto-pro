const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ValidationPipe } = require('@nestjs/common');
const { Reflector } = require('@nestjs/core');
const { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } = require('@nestjs/common/constants');
const { StockUpdateDto, InventoryUpdateDto, MAX_STOCK_QUANTITY } = require('../dist/products/dto/stock-update.dto');
const { ProductsController } = require('../dist/products/products.controller');
const { ProductsService } = require('../dist/products/products.service');
const { PermissionsGuard, PERMISSION_KEY } = require('../dist/common/guards/permissions.guard');
const { JwtAuthGuard } = require('../dist/common/guards/jwt-auth.guard');
const { RolesGuard } = require('../dist/common/guards/roles.guard');
const pipe = new ValidationPipe({ transform: true, whitelist: true });
const parse = (value, metatype = StockUpdateDto) => pipe.transform(value, { type: 'body', metatype });
const status = (n) => (e) => e.getStatus?.() === n;
const tenant = randomUUID(),
  owner = randomUUID(),
  point = randomUUID(),
  product = randomUUID(),
  warehouse = randomUUID();
const input = (more = {}) => ({
  type: 'inventory',
  quantity: 0.125,
  requestId: randomUUID(),
  expectedStock: -0.5,
  expectedWarehouseId: warehouse,
  ...more,
});

test('inventory HTTP DTO retains the complete guard and supports zero/fractions/negative baseline/bounds', async () => {
  for (const metatype of [StockUpdateDto, InventoryUpdateDto]) {
    for (const quantity of [0, 0.001, 0.125, 0.5, 1.005, MAX_STOCK_QUANTITY]) {
      const dto = input({ quantity, expectedStock: -MAX_STOCK_QUANTITY });
      assert.deepEqual({ ...(await parse({ ...dto, ignored: true }, metatype)) }, dto);
    }
  }
  for (const type of ['inventory', 'income', 'expense', 'writeoff'])
    assert.equal((await parse({ type, quantity: 0.125 })).quantity, 0.125, 'legacy /stock remains supported');
});

test('inventory HTTP DTO rejects partial/null/invalid guard groups and guarded non-inventory types', async () => {
  const fields = ['requestId', 'expectedStock', 'expectedWarehouseId'];
  for (const metatype of [StockUpdateDto, InventoryUpdateDto]) {
    for (let mask = 1; mask < 7; mask++) {
      const dto = input();
      fields.forEach((field, index) => {
        if (mask & (1 << index)) delete dto[field];
      });
      await assert.rejects(parse(dto, metatype), status(400));
    }
    for (const field of fields) {
      for (const value of [null, '', 'invalid', {}, []])
        await assert.rejects(parse(input({ [field]: value }), metatype), status(400));
    }
    for (const type of ['income', 'expense', 'writeoff', '', null, 'INVENTORY'])
      await assert.rejects(parse(input({ type }), metatype), status(400));
  }
  await assert.rejects(parse({ type: 'inventory', quantity: 1 }, InventoryUpdateDto), status(400));
});

test('inventory HTTP numbers are never coerced, truncated or rounded, including scientific notation', async () => {
  for (const metatype of [StockUpdateDto, InventoryUpdateDto]) {
    for (const quantity of [
      -1,
      -0.001,
      '0.5',
      '0,5',
      '2junk',
      null,
      NaN,
      Infinity,
      -Infinity,
      0.0001,
      1e-7,
      0.30000000000000004,
      MAX_STOCK_QUANTITY + 0.001,
      1e30,
    ])
      await assert.rejects(parse(input({ quantity }), metatype), status(400));
    for (const expectedStock of ['1', null, NaN, Infinity, 0.0001, 1e-7, -MAX_STOCK_QUANTITY - 0.001])
      await assert.rejects(parse(input({ expectedStock }), metatype), status(400));
  }
});

test('direct service callers get the same validation before connecting to PostgreSQL', async () => {
  let connections = 0;
  const service = new ProductsService({
    connect: async () => {
      connections++;
      throw new Error('unexpected database access');
    },
  });
  for (const dto of [
    null,
    [],
    {},
    input({ type: 'income' }),
    input({ quantity: '1' }),
    input({ quantity: 1e-7 }),
    input({ quantity: MAX_STOCK_QUANTITY + 0.001 }),
    input({ expectedStock: NaN }),
    input({ requestId: null }),
    input({ expectedWarehouseId: null }),
    { type: 'inventory', quantity: 1, expectedStock: 10 },
    { type: 'expense', quantity: 0 },
    { type: 'income', quantity: -1 },
    input({ reason: 10 }),
    input({ recordAsExpense: 'true' }),
  ])
    await assert.rejects(service.updateStock(product, tenant, dto, owner, point), status(400));
  for (const dto of [
    { type: 'inventory', quantity: 1 },
    input({ type: 'income' }),
    input({ expectedStock: undefined }),
  ])
    await assert.rejects(service.updateInventory(product, tenant, dto, owner, point), status(400));
  await assert.rejects(service.updateStock(product, tenant, input(), undefined, point), status(400));
  await assert.rejects(service.updateInventory('invalid', tenant, input(), owner, point), status(400));
  await assert.rejects(
    service.updateStock(product, tenant, { type: 'income', quantity: 1 }, owner, point, {
      expectedStock: '1',
      expectedWarehouseId: warehouse,
    }),
    status(400),
  );
  assert.equal(connections, 0);
});

test('dedicated inventory route preserves authentication and warehouse_manage, forwards session scope', async () => {
  const handler = ProductsController.prototype.updateInventory;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), ':id/inventory');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), 1); // POST
  assert.equal(Reflect.getMetadata(PERMISSION_KEY, handler), 'warehouse_manage');
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, ProductsController), [
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
  ]);
  assert.equal(
    Reflect.getMetadata('design:paramtypes', ProductsController.prototype, 'updateInventory')[2],
    InventoryUpdateDto,
  );
  const guard = new PermissionsGuard(new Reflector());
  const user = {
    tenantID: tenant,
    userID: owner,
    currentPointId: point,
    role: 'master',
    permissions: { warehouse_access: true, warehouse_manage: false },
  };
  const context = {
    getHandler: () => handler,
    getClass: () => ProductsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
  assert.throws(() => guard.canActivate(context), status(403));
  user.permissions.warehouse_manage = true;
  assert.equal(guard.canActivate(context), true);
  let args;
  const controller = new ProductsController({
    updateInventory: (...values) => {
      args = values;
      return 'receipt';
    },
  });
  const dto = input();
  assert.equal(controller.updateInventory(product, user, dto), 'receipt');
  assert.deepEqual(args, [product, tenant, dto, owner, point]);
});
