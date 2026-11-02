const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture,options,status}=require('./helpers/nov01-inventory-fixture.cjs');

test('photos: new arrays, legacy cover changes, omitted fields and clearing survive real SQL', options, () => fixture(async (f) => {
  const p = await f.product({ photos: ['a','b','c','d'] });
  assert.deepEqual(p.photos, ['a','b','c','d']);
  let next = await f.run(() => f.products.update(p.id, f.tenant, { photo: 'z' }, f.owner, f.point));
  assert.deepEqual(next.photos, ['z','b','c','d']);
  next = await f.run(() => f.products.update(p.id, f.tenant, { name: 'Updated' }, f.owner, f.point));
  assert.deepEqual(next.photos, ['z','b','c','d']);
  next = await f.run(() => f.products.update(p.id, f.tenant, { photo: null }, f.owner, f.point));
  assert.deepEqual(next.photos, ['b','c','d']);
  assert.equal(next.photo, 'b');
  next = await f.run(() => f.products.update(p.id, f.tenant, { photos: [] }, f.owner, f.point));
  assert.deepEqual(next.photos, []);
  assert.equal(next.photo, null);
  await assert.rejects(f.run(() => f.products.update(p.id, f.tenant, { photos: ['a','b','c','d','e'] }, f.owner, f.point)), status(400));
  assert.equal((await f.product({ photo: 'legacy' })).photos[0], 'legacy');
}));

test('share: tenant/point scope, least public DTO, revocation and hashed token persistence', options, () => fixture(async (f) => {
  const p = await f.product();
  const capability = await f.run(() => f.sharing.create(p.id, f.actor));
  assert.equal(capability.path, `/p/${capability.token}`);
  assert.deepEqual(await f.sharing.getPublic(capability.token), { name: 'Шина', photos: [], sellPrice: 150 });
  assert.notEqual((await f.q('SELECT token_hash FROM product_share_tokens WHERE product_id=$1', [p.id]))[0].token_hash, capability.token);
  await assert.rejects(f.run(() => f.sharing.create(p.id, { ...f.actor, currentPointId: f.secondPoint })), status(404));
  await assert.rejects(f.run(() => f.sharing.create(p.id, { ...f.actor, tenantID: f.foreign })), status(404));
  await f.run(() => f.sharing.revoke(p.id, f.actor));
  await assert.rejects(f.sharing.getPublic(capability.token), status(404));
}));

test('used intake: concurrent retries commit one product/income, no debt or expense, conflict and rollback', options, () => fixture(async (f) => {
  const dto = { name: 'Б/У диск', quantity: 2.5, costPrice: 1000, sellPrice: 1300, requestId: randomUUID() };
  const [a,b] = await Promise.all([f.run(() => f.intake.create(dto, f.actor)), f.run(() => f.intake.create(dto, f.actor))]);
  assert.equal(a.product.id, b.product.id);
  assert.equal(a.product.stock, 2.5);
  assert.equal(a.product.warehouseId, f.used);
  assert.equal((await f.q('SELECT count(*)::int n FROM products WHERE tenant_id=$1', [f.tenant]))[0].n, 1);
  const rows = await f.q('SELECT * FROM stock_movements WHERE tenant_id=$1', [f.tenant]);
  assert.equal(rows.length, 1); assert.equal(rows[0].type, 'income'); assert.equal(Number(rows[0].quantity), 2.5);
  assert.equal((await f.q('SELECT count(*)::int n FROM expenses WHERE tenant_id=$1', [f.tenant]))[0].n, 0);
  assert.equal((await f.q('SELECT count(*)::int n FROM supplier_payments WHERE tenant_id=$1', [f.tenant]))[0].n, 0);
  await assert.rejects(f.run(() => f.intake.create({ ...dto, quantity: 3 }, f.actor)), status(409));
  // Force the actual income SQL to fail after product INSERT; the whole intake must roll back.
  await f.q(`CREATE FUNCTION nov01_reject_income() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.reason='Добавление товара Б/У' THEN RAISE EXCEPTION 'fixture income failure'; END IF; RETURN NEW; END $$`);
  await f.q('CREATE TRIGGER nov01_reject_income BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION nov01_reject_income()');
  try { await assert.rejects(f.run(() => f.intake.create({ ...dto, requestId: randomUUID(), name: 'Rollback' }, f.actor))); }
  finally { await f.q('DROP TRIGGER nov01_reject_income ON stock_movements'); await f.q('DROP FUNCTION nov01_reject_income()'); }
  assert.equal((await f.q('SELECT count(*)::int n FROM products WHERE tenant_id=$1', [f.tenant]))[0].n, 1);
}));

test('history: all 451 records, stable tie order, new backdated events excluded, filter-bound cursor', options, () => fixture(async (f) => {
  const p = await f.product({stock:0});
  await f.q(`INSERT INTO stock_movements(product_id,tenant_id,type,quantity,stock_before,stock_after,warehouse_id,created_at)
    SELECT $1,$2,'income',1,0,1,$3,'2026-09-01 12:00:00.123456Z'::timestamptz FROM generate_series(1,451)`, [p.id,f.tenant,f.main]);
  let page = await f.run(() => f.movements.history(f.tenant, { productId:p.id,limit:43 }, f.point, f.actor));
  const ids = page.data.map(r => r.id);
  const firstCursor = page.nextCursor;
  await f.q("INSERT INTO stock_movements(product_id,tenant_id,type,quantity,stock_before,stock_after,warehouse_id,created_at) VALUES($1,$2,'income',1,0,1,$3,'2026-08-01')", [p.id,f.tenant,f.main]);
  while (page.nextCursor) { page=await f.run(() => f.movements.history(f.tenant, { productId:p.id,limit:43,cursor:page.nextCursor }, f.point, f.actor)); ids.push(...page.data.map(r=>r.id)); }
  assert.equal(ids.length,451); assert.equal(new Set(ids).size,451);
  await assert.rejects(f.run(() => f.movements.history(f.tenant, { productId:p.id,type:'expense',cursor:firstCursor }, f.point, f.actor)),status(400));
  assert.equal((await f.run(() => f.movements.list(f.tenant,{productId:p.id},f.point,f.actor))).length,200);
}));

test('history: sale dates, draft/annul exclusion, return context and actor visibility match detail grants', options, () => fixture(async (f) => {
  const p=await f.product();
  const check = async (master, more={}) => {
    const id=randomUUID();
    await f.q(`INSERT INTO checks(id,tenant_id,point_id,master_id,date,is_deferred,deleted_at,is_returned,return_scope)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,f.tenant,more.point??f.point,master,more.date??'2026-09-01 22:00Z',!!more.draft,more.deleted?'2026-09-03':null,!!more.returned,more.returned?'full':null]);
    await f.q("INSERT INTO check_product_lines(check_id,product_id,name,quantity) VALUES($1,$2,'Шина',1)",[id,p.id]);return id;
  };
  const own=await check(f.owner),other=await check(f.other),returned=await check(f.owner,{returned:true});
  await check(f.owner,{draft:true});await check(f.owner,{deleted:true});await check(f.owner,{date:'2026-08-01'});await check(f.owner,{point:f.secondPoint});
  const restricted={...f.actor,role:'master',permissions:{checks_view:true,checks_view_all:false}};
  const query={productId:p.id,includeSales:true,dateFrom:'2026-09-02',dateTo:'2026-09-02'}; // 22Z is next Moscow day.
  const history=()=>f.run(()=>f.movements.history(f.tenant,query,f.point,restricted));
  let rows=(await history()).data;assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map(r=>r.checkId)),new Set([own,returned]));
  assert.equal(rows.find(r=>r.checkId===returned).isReturned,true);
  await f.q('INSERT INTO check_assignees(check_id,user_id,tenant_id) VALUES($1,$2,$3)',[other,f.owner,f.tenant]);
  rows=(await history()).data;assert.equal(rows.length,3);
  const denied={...restricted,permissions:{checks_view:false,checks_view_all:true}};
  assert.equal((await f.run(()=>f.movements.history(f.tenant,query,f.point,denied))).data.length,0);
  await assert.rejects(f.run(()=>f.movements.history(f.tenant,{dateFrom:'2026-02-30'},f.point,f.actor)),status(400));
}));
