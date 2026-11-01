const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('crypto');
const {fixture,options,status}=require('./helpers/nov01-inventory-fixture.cjs');
const {ChecksService}=require('../dist/checks/checks.service');
const {ClientsService}=require('../dist/clients/clients.service');
const {WarrantyService}=require('../dist/warranty/warranty.service');
const {ReturnsService}=require('../dist/returns/returns.service');
const {WarehousesService}=require('../dist/warehouses/warehouses.service');

function flows(f) {
  const checks=new ChecksService(f.pool,new WarrantyService(f.pool),new ClientsService(f.pool));
  const returns=new ReturnsService(f.pool,new WarehousesService(f.pool));
  const line=(p,quantity=1)=>({productId:p.id,name:p.name,sellPrice:p.sellPrice,costPrice:999999,quantity});
  const create=(products,more={})=>f.run(()=>checks.create(f.tenant,f.owner,'director',{
    masterId:f.owner,services:[{name:'History labour',price:100,quantity:1}],products,isDeferred:false,paymentMethod:'cash',...more,
  },f.actor));
  const edit=(id,dto)=>f.run(()=>checks.update(id,f.tenant,'director',dto,f.owner,f.actor));
  const events=(id)=>f.q('SELECT * FROM check_product_events WHERE check_id=$1 ORDER BY revision,product_id',[id]);
  const stock=async(p)=>Number((await f.q('SELECT stock FROM products WHERE id=$1',[p.id]))[0].stock);
  return {checks,returns,line,create,edit,events,stock};
}

test('new active/draft/activation paths preserve actual sale events and normal negative inventory',options,()=>fixture(async(f)=>{
  const x=flows(f),a=await f.product(),b=await f.product();
  const active=await x.create([x.line(a,15)]);assert.equal(await x.stock(a),-5);
  let events=await x.events(active.id);assert.equal(events.length,1);assert.equal(events[0].kind,'sale');assert.equal(Number(events[0].stock_delta),-15);assert.equal(Number(events[0].stock_before),10);assert.equal(Number(events[0].stock_after),-5);
  const draft=await x.create([x.line(b,2)],{isDeferred:true});assert.equal((await x.events(draft.id)).length,0);assert.equal(await x.stock(b),10);
  await x.edit(draft.id,{isDeferred:false});assert.equal(await x.stock(b),8);assert.equal((await x.events(draft.id)).length,1);
  const full=await x.create([x.line(b,1)],{isDeferred:true});
  await x.edit(full.id,{isDeferred:false,products:[x.line(b,3)],services:[{name:'History labour',price:100,quantity:1}]});
  assert.equal(await x.stock(b),5);assert.equal((await x.events(full.id)).length,1);
}));

test('closed A→B edits, echo, delete→restore→delete and purge retain immutable facts',options,()=>fixture(async(f)=>{
  const x=flows(f),a=await f.product(),b=await f.product({name:'Диск'});
  const sale=await x.create([x.line(a,2)]);
  await x.edit(sale.id,{products:[x.line(b,3)]});
  assert.equal(await x.stock(a),10);assert.equal(await x.stock(b),7);
  let events=await x.events(sale.id);assert.equal(events.length,3);assert.equal(events[0].product_id,a.id);
  assert.deepEqual(new Set(events.filter(e=>e.kind==='sale_correction').map(e=>Number(e.stock_delta))),new Set([2,-3]));
  await x.edit(sale.id,{products:[x.line(b,3)]});assert.equal((await x.events(sale.id)).length,3);
  await f.run(()=>x.checks.remove(sale.id,f.tenant,'director',f.owner,f.actor));assert.equal(await x.stock(b),10);
  await f.run(()=>x.checks.restore(sale.id,f.tenant,f.actor));assert.equal(await x.stock(b),7);
  await f.run(()=>x.checks.remove(sale.id,f.tenant,'director',f.owner,f.actor));assert.equal(await x.stock(b),10);
  events=await x.events(sale.id);assert.equal(events.length,6);
  await f.q("UPDATE checks SET deleted_at=now()-interval '31 days' WHERE id=$1",[sale.id]);
  // Same retention predicate and hard delete as purgeExpiredTrash; no check FK may remove events.
  await f.q("DELETE FROM checks WHERE id=$1 AND deleted_at<now()-interval '30 days'",[sale.id]);
  assert.equal((await x.events(sale.id)).length,6);
  const history=await f.run(()=>f.movements.history(f.tenant,{productId:b.id,includeSales:true},f.point,f.actor));
  assert.equal(history.data.length,4);assert.ok(history.data.every(row=>row.checkId===null&&row.receiptAvailable===false));
}));

test('legacy baseline freezes all original SKUs before destructive edit and invalidates an existing cursor',options,()=>fixture(async(f)=>{
  const x=flows(f),a=await f.product(),b=await f.product({name:'Диск'}),id=randomUUID();
  await f.q("INSERT INTO checks(id,tenant_id,point_id,master_id,service_total,product_total,total_revenue,cash_amount,payment_method) VALUES($1,$2,$3,$4,0,450,450,450,'cash')",[id,f.tenant,f.point,f.owner]);
  await f.q("INSERT INTO check_product_lines(check_id,product_id,name,sell_price,cost_price,quantity,total_sell,total_cost) VALUES($1,$2,'A original',150,100,1,150,100),($1,$3,'B original',150,100,2,300,200)",[id,a.id,b.id]);
  const first=await f.run(()=>f.movements.history(f.tenant,{includeSales:true,limit:1},f.point,f.actor));assert.ok(first.nextCursor);
  await x.edit(id,{products:[x.line(b,1)]});
  const events=await x.events(id);assert.equal(events.filter(e=>e.kind==='legacy_baseline').length,2);
  assert.ok(events.filter(e=>e.kind==='legacy_baseline').every(e=>e.stock_before===null&&e.stock_after===null&&e.stock_delta===null&&e.warehouse_id===null));
  await assert.rejects(f.run(()=>f.movements.history(f.tenant,{includeSales:true,limit:1,cursor:first.nextCursor},f.point,f.actor)),error=>error.getStatus()===409&&error.getResponse().code==='HISTORY_CURSOR_STALE');
  const history=await f.run(()=>f.movements.history(f.tenant,{includeSales:true},f.point,f.actor));
  assert.equal(history.data.filter(row=>row.id.startsWith('sale:')).length,0);
  assert.equal(history.data.filter(row=>row.legacyBaseline).length,2);
}));

test('partial product/service returns keep a single physical return event with check/return/source provenance',options,()=>fixture(async(f)=>{
  const x=flows(f),a=await f.product();
  const sale=await x.create([x.line(a,3)]);
  const line=(await f.q('SELECT id FROM check_product_lines WHERE check_id=$1',[sale.id]))[0].id;
  await f.run(()=>x.returns.createReturn(f.tenant,f.owner,sale.id,{destination:'warehouse',scope:'partial',lines:[{productLineId:line,quantity:1}]},f.actor));
  assert.equal(await x.stock(a),8);assert.equal((await x.events(sale.id)).length,1);
  const movement=(await f.q('SELECT * FROM stock_movements WHERE product_id=$1',[a.id]))[0];
  assert.equal(movement.type,'customer_return');assert.equal(movement.check_id,sale.id);assert.equal(movement.source_product_id,a.id);assert.ok(movement.return_id);
  const history=await f.run(()=>f.movements.history(f.tenant,{productId:a.id,includeSales:true},f.point,f.actor));assert.equal(history.data.length,2);
  const serviceSale=await x.create([x.line(a,1)]);
  const serviceLine=(await f.q('SELECT id FROM check_service_lines WHERE check_id=$1',[serviceSale.id]))[0].id;
  await f.run(()=>x.returns.createReturn(f.tenant,f.owner,serviceSale.id,{destination:'warehouse',scope:'partial',lines:[{serviceLineId:serviceLine}]},f.actor));
  assert.equal((await f.q('SELECT count(*)::int n FROM stock_movements WHERE product_id=$1',[a.id]))[0].n,1);
}));

test('defect returns retain original SKU provenance in its product history; uncovered date edits invalidate cursors',options,()=>fixture(async(f)=>{
  const x=flows(f),a=await f.product();
  const sale=await x.create([x.line(a,2)]);
  await f.run(()=>x.returns.createReturn(f.tenant,f.owner,sale.id,{destination:'defect',scope:'full',reason:'Повреждён'},f.actor));
  assert.equal(await x.stock(a),8);
  const movement=(await f.q('SELECT * FROM stock_movements WHERE source_product_id=$1',[a.id]))[0];
  assert.equal(movement.type,'defect_transfer');assert.notEqual(movement.product_id,a.id);assert.equal(movement.check_id,sale.id);
  const history=await f.run(()=>f.movements.history(f.tenant,{productId:a.id,includeSales:true},f.point,f.actor));
  assert.equal(history.data.length,2);assert.ok(history.data.find(row=>row.type==='defect_transfer'&&row.sourceProductId===a.id));
  const legacy=randomUUID();await f.q("INSERT INTO checks(id,tenant_id,point_id,master_id,date) VALUES($1,$2,$3,$4,'2026-09-01')",[legacy,f.tenant,f.point,f.owner]);
  await f.q("INSERT INTO check_product_lines(check_id,product_id,name,quantity) VALUES($1,$2,'Original',1),($1,$2,'Original 2',1)",[legacy,a.id]);
  const page=await f.run(()=>f.movements.history(f.tenant,{includeSales:true,limit:1},f.point,f.actor));
  await f.q("UPDATE checks SET date='2026-09-02' WHERE id=$1",[legacy]);
  await assert.rejects(f.run(()=>f.movements.history(f.tenant,{includeSales:true,limit:1,cursor:page.nextCursor},f.point,f.actor)),error=>error.getResponse().code==='HISTORY_CURSOR_STALE');
}));
