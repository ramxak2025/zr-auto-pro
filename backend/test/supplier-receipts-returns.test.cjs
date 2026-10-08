const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger, ValidationPipe } = require('@nestjs/common');
require('reflect-metadata');
const { allocateInvoiceCents, lineCents, positiveQuantity } = require('../dist/suppliers/procurement-money');
const { SuppliersService } = require('../dist/suppliers/suppliers.service');
const { PurchaseOrdersService } = require('../dist/purchase-orders/purchase-orders.service');
const { StockMovementsService } = require('../dist/stock-movements/stock-movements.service');
const { WarehousesService } = require('../dist/warehouses/warehouses.service');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { CreateDeliveryDto } = require('../dist/suppliers/dto/create-delivery.dto');
const { ReturnDeliveryDto } = require('../dist/suppliers/dto/return-delivery.dto');
const { ReceivePurchaseOrderDto } = require('../dist/purchase-orders/dto/receive-purchase-order.dto');
const { TenantsService } = require('../dist/tenants/tenants.service');
const { PointsService } = require('../dist/points/points.service');
const { ReportBuilderService } = require('../dist/reports/builder/report-builder.service');
const { JournalService } = require('../dist/journal/journal.service');
const { SuppliersBuilder } = require('../dist/reports/builder/builders/suppliers.builder');
const { suppliersOwedTotal } = require('../dist/reports/builder/report-shared-queries');
Logger.overrideLogger(false);
const status = (code) => (error) => error.getStatus?.() === code;
const wire = (value) => JSON.parse(JSON.stringify(value));

test('exact receipt/return arithmetic respects the actual three-decimal schema and allocates old invoice cents', () => {
  assert.equal(lineCents(0.125, 10.01), 125n);
  assert.equal(lineCents(0.5, 0.01), 1n);
  assert.throws(() => positiveQuantity(0.0001), status(400));
  assert.throws(() => positiveQuantity(-1), status(400));
  const lines = ['b','a','c'].map((id) => ({ id, quantity: '0.333', price: '0.01', total: '0.00' }));
  const allocated = allocateInvoiceCents('0.01', lines);
  assert.deepEqual([...allocated].sort(), [['a',1n],['b',0n],['c',0n]]);
  const balanced = allocateInvoiceCents('0.02', [{ id:'a',quantity:0.5,price:0.01,total:0.01 },{ id:'b',quantity:0.5,price:0.01,total:0.01 }]);
  assert.deepEqual([...balanced], [['a',1n],['b',1n]]);
});

test('public DTOs accept retail zero and request UUID; reject negative money, overprecision, invalid keys and empty return lines', async () => {
  const pipe = new ValidationPipe({ transform:true, whitelist:true });
  const delivery = { supplierId:randomUUID(), requestId:randomUUID(), items:[{ productId:randomUUID(),quantity:0.125,price:1.01,sellPrice:0 }] };
  const parsed = await pipe.transform(delivery, {type:'body',metatype:CreateDeliveryDto});
  assert.equal(parsed.items[0].sellPrice, 0);
  await assert.rejects(pipe.transform({...delivery,requestId:'bad'}, {type:'body',metatype:CreateDeliveryDto}), status(400));
  for (const line of [{...delivery.items[0],quantity:0.0001},{...delivery.items[0],sellPrice:-1},{...delivery.items[0],price:1.001}]) {
    await assert.rejects(pipe.transform({...delivery,items:[line]}, {type:'body',metatype:CreateDeliveryDto}), status(400));
  }
  await assert.rejects(pipe.transform({items:[]}, {type:'body',metatype:ReturnDeliveryDto}), status(400));
  await assert.rejects(pipe.transform({items:[{itemId:randomUUID(),receivedQuantity:0.0001}]}, {type:'body',metatype:ReceivePurchaseOrderDto}), status(400));
});

const live = process.env.SUPPLIER_LIVE_DB;
test('PostgreSQL16 / real RLS: supplier receipts, ordinary returns, exact cents and concurrency', { skip: !live }, async (t) => {
  const url = new URL(live);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.port === '55438' && url.pathname === '/autexa_oct8_test', 'ONLY the explicit disposable October-8 database is allowed');
  const admin = new Pool({connectionString:live,max:14,statement_timeout:8000});
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  appUrl.password = process.env.SUPPLIER_LIVE_APP_PASSWORD || 'oct8_app_fixture_only';
  const app = new Pool({connectionString:appUrl.toString(),max:14,statement_timeout:8000});
  const pool = new TenantAwarePool(admin,app);
  const warehouses = new WarehousesService(pool);
  const stock = new StockMovementsService(pool,warehouses);
  const suppliers = new SuppliersService(pool,stock,warehouses);
  const orders = new PurchaseOrdersService(pool,stock,suppliers);
  const q = async (sql,params=[]) => (await admin.query(sql,params)).rows;
  const one = async (sql,params=[]) => (await q(sql,params))[0];
  const seed = async () => {
    const f = Object.fromEntries(['tenant','point','otherPoint','warehouse','otherWarehouse','supplier','user','product','otherProduct'].map((key) => [key,randomUUID()]));
    await q('INSERT INTO tenants(id,name,timezone) VALUES($1,$2,\'Europe/Moscow\')',[f.tenant,'Supplier fixture '+f.tenant]);
    await q('INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$3,\'Main\',true),($2,$3,\'Other\',false)',[f.point,f.otherPoint,f.tenant]);
    await q('INSERT INTO warehouses(id,tenant_id,point_id,name,kind) VALUES($1,$5,$3,\'Main stock\',\'main\'),($2,$5,$4,\'Other stock\',\'main\')',[f.warehouse,f.otherWarehouse,f.point,f.otherPoint,f.tenant]);
    await q('INSERT INTO suppliers(id,tenant_id,name) VALUES($1,$2,\'Supplier\')',[f.supplier,f.tenant]);
    await q('INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1,$2,$3,\'fixture-unused\',\'Owner\',\'director\')',[f.user,f.tenant,f.user]);
    await q('INSERT INTO products(id,tenant_id,warehouse_id,name,stock,cost_price,sell_price) VALUES($1,$5,$3,\'Part\',0,7,20),($2,$5,$4,\'Other part\',0,7,20)',[f.product,f.otherProduct,f.warehouse,f.otherWarehouse,f.tenant]);
    f.run = (fn) => runWithTenant(f.tenant,fn);
    f.deliver = (items=[{productId:f.product,quantity:1,price:10}],extra={}) => f.run(() => suppliers.createDelivery(f.tenant,{supplierId:f.supplier,items,...extra},f.point,f.user));
    f.detail = (id) => f.run(() => suppliers.getDeliveryById(id,f.tenant,f.point));
    f.return = (id,dto={}) => f.run(() => suppliers.returnDelivery(f.tenant,f.user,id,dto,f.point));
    f.balance = () => one('SELECT total_purchases,total_paid,current_debt FROM suppliers WHERE id=$1',[f.supplier]);
    f.productRow = () => one('SELECT stock,cost_price,sell_price FROM products WHERE id=$1',[f.product]);
    f.createOrder = (quantity=1,price=10) => f.run(() => orders.create(f.tenant,f.user,{supplierId:f.supplier,items:[{productId:f.product,quantity,costPrice:price}]},f.point));
    return f;
  };
  try {
    await t.test('RLS role and physical numeric precision are real; app cannot read/write a foreign tenant', async () => {
      const role = await one('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=\'autexa_app\'');
      assert.deepEqual(role,{rolsuper:false,rolbypassrls:false});
      const precision = await q("SELECT table_name,numeric_scale FROM information_schema.columns WHERE table_name IN ('products','delivery_items','purchase_order_items') AND column_name IN ('stock','quantity') ORDER BY table_name");
      assert.equal(precision.length,3); assert.ok(precision.every((r)=>r.numeric_scale===3));
      const f=await seed(), foreign=await seed();
      const doc=await f.deliver(); await f.return(doc.id,{requestId:randomUUID()});
      assert.equal((await f.run(()=>pool.query('SELECT * FROM supplier_returns'))).rows.length,1);
      assert.equal((await foreign.run(()=>pool.query('SELECT * FROM supplier_returns'))).rows.length,0);
      await assert.rejects(foreign.run(()=>pool.query("INSERT INTO procurement_requests(tenant_id,request_id,fingerprint,response) VALUES($1,$2,'bad','{}')",[f.tenant,randomUUID()])), (e)=>e.code==='42501');
      assert.equal((await app.query('SELECT * FROM supplier_returns')).rows.length,0,'no leaked tenant session GUC');
    });

    await t.test('regression proof: original implementation duplicates a retried partial receipt and rounds fractional invoice differently', { skip: !process.env.SUPPLIER_BASELINE_DIR }, async () => {
      const { PurchaseOrdersService: OriginalOrders } = require(process.env.SUPPLIER_BASELINE_DIR + '/purchase-orders/purchase-orders.baseline.js');
      const { SuppliersService: OriginalSuppliers } = require(process.env.SUPPLIER_BASELINE_DIR + '/suppliers/suppliers.baseline.js');
      const originalSuppliers=new OriginalSuppliers(pool,stock,warehouses), originalOrders=new OriginalOrders(pool,stock,originalSuppliers);
      const f=await seed(), order=await f.createOrder(2,10);
      const dto={requestId:randomUUID(),paymentMode:'debt',items:[{itemId:order.items[0].id,receivedQuantity:0.25}]};
      await f.run(()=>originalOrders.receive(order.id,f.tenant,f.user,dto,f.point));
      await f.run(()=>originalOrders.receive(order.id,f.tenant,f.user,dto,f.point));
      assert.equal((await f.productRow()).stock,'0.500', 'original request ID is ignored: retry doubles the income');
      assert.equal((await one('SELECT COUNT(*)::int n FROM deliveries WHERE purchase_order_id=$1',[order.id])).n,2);
      const bad=await f.run(()=>originalSuppliers.createDelivery(f.tenant,{supplierId:f.supplier,items:Array.from({length:3},()=>({productId:f.product,quantity:0.333,price:0.01}))},f.point));
      const sum=await one('SELECT d.total_amount,(SELECT SUM(di.total) FROM delivery_items di WHERE di.delivery_id=d.id) AS lines FROM deliveries d WHERE d.id=$1',[bad.id]);
      assert.deepEqual(sum,{total_amount:'0.01',lines:'0.00'},'old sum-then-round path creates a real historical mismatch');
    });

    await t.test('public tenant purge and remove delete the return ledger before its sources; neighbor survives', async () => {
      const neighbor=await seed(), neighborDoc=await neighbor.deliver(undefined,{requestId:randomUUID()});
      await neighbor.return(neighborDoc.id,{requestId:randomUUID()});
      const before=await neighbor.balance();
      const tenants=new TenantsService(pool,{},{});
      for (const method of ['purgeTenantData','remove']) {
        const f=await seed(), doc=await f.deliver(undefined,{requestId:randomUUID()});
        await f.return(doc.id,{requestId:randomUUID()});
        await tenants[method](f.tenant);
        for (const table of ['tenants','procurement_requests','supplier_returns','supplier_return_items']) {
          assert.equal((await one(`SELECT COUNT(*)::int n FROM ${table} WHERE ${table==='tenants'?'id':'tenant_id'}=$1`,[f.tenant])).n,0);
        }
      }
      assert.deepEqual(await neighbor.balance(),before);
      assert.equal((await neighbor.detail(neighborDoc.id)).returns.length,1);
    });

    await t.test('direct receipt accepts negative stored inventory and exact retry adds stock only once', async () => {
      for (const [quantity,expected] of [[0.5,'-0.500'],[2,'1.000']]) {
        const f=await seed(); await q('UPDATE products SET stock=-1 WHERE id=$1',[f.product]);
        const items=[{productId:f.product,quantity,price:10}], extra={requestId:randomUUID()};
        const [a,b]=await Promise.all([f.deliver(items,extra),f.deliver(items,extra)]);
        assert.deepEqual(wire(a),wire(b));
        assert.equal((await f.productRow()).stock,expected);
        assert.equal((await one('SELECT COUNT(*)::int n FROM stock_movements WHERE product_id=$1',[f.product])).n,1);
        if (quantity===0.5) await assert.rejects(f.return(a.id,{}),status(400));
      }
    });

    await t.test('first point attributes old returns to their actual source and repeats preserve journal visibility', async () => {
      const f=await seed();
      await q('DELETE FROM products WHERE id=$1',[f.otherProduct]);
      await q('DELETE FROM warehouses WHERE id=$1',[f.otherWarehouse]);
      await q('UPDATE warehouses SET point_id=NULL WHERE tenant_id=$1',[f.tenant]);
      await q('DELETE FROM tenant_points WHERE tenant_id=$1',[f.tenant]);
      const doc=await f.run(()=>suppliers.createDelivery(f.tenant,{supplierId:f.supplier,items:[{productId:f.product,quantity:1,price:10}]},null,f.user));
      await f.run(()=>suppliers.returnDelivery(f.tenant,f.user,doc.id,{},null));
      const points=new PointsService(pool);
      const tenant=await one('SELECT name FROM tenants WHERE id=$1',[f.tenant]);
      const point=await f.run(()=>points.adminCreate(f.tenant,{name:tenant.name}));
      const verify=async()=>{
        const detail=await f.run(()=>suppliers.getDeliveryById(doc.id,f.tenant,point.id));
        assert.equal(detail.returns.length,1); assert.equal(detail.returnedAmount,10);
        const rows=await f.run(()=>new JournalService(pool).getWarehouseDocs(f.tenant,{type:'return_to_supplier'},point.id));
        assert.equal(rows.length,1); assert.equal(rows[0].amount,10);
        assert.equal((await one('SELECT point_id FROM supplier_returns WHERE delivery_id=$1',[doc.id])).point_id,point.id);
      };
      await verify();
      await f.run(()=>points.adminCreate(f.tenant,{name:'Second new point'}));
      await verify();
    });

    await t.test('warm ReportBuilderService.run refreshes after a return without evicting another tenant', async () => {
      const f=await seed(), neighbor=await seed();
      const doc=await f.deliver(); await neighbor.deliver();
      const ids=['summary','masters','salary','suppliers','clients','products','services','payments','expenses','bookings','points'];
      const builders=ids.map(id=>id==='suppliers'?new SuppliersBuilder(pool):{id});
      const service=new ReportBuilderService(pool,...builders);
      const query={dateFrom:new Date(Date.now()-86400000).toISOString().slice(0,10),dateTo:new Date(Date.now()+86400000).toISOString().slice(0,10)};
      const run=(x)=>x.run(()=>service.run({tenantID:x.tenant,userID:x.user,currentPointId:x.point,role:'director',permissions:{financial_reports:true}},'suppliers',query));
      const warm=await run(f), untouched=await run(neighbor);
      assert.equal(warm.totals.debtEnd,10);
      await f.return(doc.id,{});
      const fresh=await run(f);
      assert.equal(fresh.totals.returns,10); assert.equal(fresh.totals.debtEnd,0);
      assert.notEqual(fresh,warm);
      assert.equal(await run(neighbor),untouched,'other tenant remains warm');
    });

    await t.test('receipt retry key is bound to actor, explicit date and operation; moved stock cannot source a return', async () => {
      const f=await seed(), requestId=randomUUID(), date=new Date(Date.now()-86400000).toISOString();
      const doc=await f.deliver(undefined,{requestId,date});
      const otherUser=randomUUID();
      await q("INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1,$2,$3,'unused','Other owner','director')",[otherUser,f.tenant,otherUser]);
      await assert.rejects(f.run(()=>suppliers.createDelivery(f.tenant,{supplierId:f.supplier,items:[{productId:f.product,quantity:1,price:10}],requestId,date},f.point,otherUser)),status(409));
      await assert.rejects(f.deliver(undefined,{requestId,date:new Date(Date.now()-2*86400000).toISOString()}),status(409));
      await assert.rejects(f.return(doc.id,{requestId}),status(409));
      const before=await f.balance();
      await q('UPDATE products SET warehouse_id=$1 WHERE id=$2',[f.otherWarehouse,f.product]);
      await assert.rejects(f.return(doc.id,{requestId:randomUUID()}),status(400));
      assert.deepEqual(await f.balance(),before); assert.equal((await f.productRow()).stock,'1.000');
      assert.equal((await one('SELECT COUNT(*)::int n FROM supplier_returns WHERE delivery_id=$1',[doc.id])).n,0);
    });

    await t.test('historical rounded line sum above header returns exactly the unchanged original cents', async () => {
      const f=await seed(), doc=await f.deliver(Array.from({length:2},()=>({productId:f.product,quantity:0.5,price:0.01})));
      assert.equal((await f.detail(doc.id)).totalAmount,0.02);
      await q('UPDATE deliveries SET total_amount=0.01 WHERE id=$1',[doc.id]);
      await q('UPDATE suppliers SET total_purchases=0.01,current_debt=0.01 WHERE id=$1',[f.supplier]);
      const original=await one('SELECT * FROM deliveries WHERE id=$1',[doc.id]);
      const lines=await q('SELECT * FROM delivery_items WHERE delivery_id=$1 ORDER BY id',[doc.id]);
      const detail=await f.detail(doc.id);
      assert.equal(detail.items.find(l=>l.id===lines[0].id).refundableTotal,0.01);
      const first=await f.return(doc.id,{items:[{deliveryItemId:lines[0].id,quantity:0.25}]});
      const rest=await f.return(doc.id,{});
      assert.equal(first.totalAmount+rest.totalAmount,0.01);
      assert.deepEqual(await one('SELECT * FROM deliveries WHERE id=$1',[doc.id]),original);
      assert.deepEqual(await q('SELECT * FROM delivery_items WHERE delivery_id=$1 ORDER BY id',[doc.id]),lines);
      assert.deepEqual(await f.balance(),{total_purchases:'0.00',total_paid:'0.00',current_debt:'0.00'});
    });

    await t.test('partial PO receipt duplicate requests replay identical response; different payload conflicts; payment and retail zero apply once', async () => {
      const f=await seed(), order=await f.createOrder(2,10.01);
      assert.equal(order.items[0].sellPrice,20); assert.equal(order.items[0].previousPurchase,null);
      const dto={requestId:randomUUID(),paymentMode:'paid',items:[{itemId:order.items[0].id,receivedQuantity:0.125,purchasePrice:10.01,sellPrice:0}]};
      const receive=()=>f.run(()=>orders.receive(order.id,f.tenant,f.user,dto,f.point));
      const results=await Promise.all([receive(),receive()]);
      assert.deepEqual(wire(results[0]),wire(results[1]));
      assert.deepEqual(await f.productRow(),{stock:'0.125',cost_price:'10.01',sell_price:'0.00'});
      assert.deepEqual(await f.balance(),{total_purchases:'1.25',total_paid:'1.25',current_debt:'0.00'});
      assert.equal((await one('SELECT COUNT(*)::int n FROM supplier_payments WHERE supplier_id=$1',[f.supplier])).n,1);
      assert.equal((await one('SELECT received_quantity FROM purchase_order_items WHERE id=$1',[order.items[0].id])).received_quantity,'0.125');
      await assert.rejects(f.run(()=>orders.receive(order.id,f.tenant,f.user,{...dto,paymentMode:'debt'},f.point)),status(409));
      await assert.rejects(f.run(()=>orders.receive(order.id,f.tenant,f.user,dto,f.otherPoint)),status(404));
      // Full receipt retries must replay even after the order has become received.
      const full={requestId:randomUUID(),paymentMode:'debt'};
      const a=await f.run(()=>orders.receive(order.id,f.tenant,f.user,full,f.point));
      const b=await f.run(()=>orders.receive(order.id,f.tenant,f.user,full,f.point));
      assert.deepEqual(wire(a),wire(b)); assert.equal(a.status,'received');
    });

    await t.test('paid partial + full return preserves source/order/payment and produces credit; cash refund is separate', async () => {
      const f=await seed(), order=await f.createOrder(0.333,0.05);
      const received=await f.run(()=>orders.receive(order.id,f.tenant,f.user,{paymentMode:'paid',requestId:randomUUID()},f.point));
      const delivery=await f.detail(received.sourceDeliveryIds[0]);
      const initialPayment=await one('SELECT * FROM supplier_payments WHERE delivery_id=$1',[delivery.id]);
      const initialOrder=await one('SELECT * FROM purchase_order_items WHERE id=$1',[order.items[0].id]);
      const dto={requestId:randomUUID(),items:[{deliveryItemId:delivery.items[0].id,quantity:0.111}],reason:'Заказали лишнее'};
      const [a,b]=await Promise.all([f.return(delivery.id,dto),f.return(delivery.id,dto)]);
      assert.deepEqual(wire(a),wire(b)); assert.equal(a.totalAmount,0.01);
      await assert.rejects(f.return(delivery.id,{...dto,reason:'other'}),status(409));
      assert.deepEqual(await f.balance(),{total_purchases:'0.01',total_paid:'0.02',current_debt:'-0.01'});
      const rest=await f.return(delivery.id,{requestId:randomUUID()}); assert.equal(rest.totalAmount,0.01);
      const detail=await f.detail(delivery.id);
      assert.equal(detail.totalAmount,0.02); assert.equal(detail.returnedAmount,0.02); assert.equal(detail.netAmount,0);
      assert.equal(detail.items[0].quantity,0.333); assert.equal(detail.items[0].returnedQuantity,0.333); assert.equal(detail.items[0].returnableQuantity,0);
      assert.equal(detail.returns.length,2);
      assert.deepEqual(await one('SELECT * FROM supplier_payments WHERE delivery_id=$1',[delivery.id]),initialPayment);
      assert.deepEqual(await one('SELECT * FROM purchase_order_items WHERE id=$1',[order.items[0].id]),initialOrder);
      assert.equal((await one('SELECT status FROM purchase_orders WHERE id=$1',[order.id])).status,'received');
      assert.deepEqual(await f.balance(),{total_purchases:'0.00',total_paid:'0.02',current_debt:'-0.02'});
      await assert.rejects(f.return(delivery.id,{}),status(400));
      await f.run(()=>suppliers.createRefund(f.tenant,f.user,{supplierId:f.supplier,amount:0.02},f.point));
      assert.deepEqual(await f.balance(),{total_purchases:'0.00',total_paid:'0.00',current_debt:'0.00'});
      assert.deepEqual(await one('SELECT * FROM supplier_payments WHERE id=$1',[initialPayment.id]),initialPayment);
    });

    await t.test('direct delivery repeat, omitted retail, three-decimal quantity and rollback on invalid input', async () => {
      const f=await seed(); const requestId=randomUUID();
      const [a,b]=await Promise.all([f.deliver(undefined,{requestId}),f.deliver(undefined,{requestId})]);
      assert.deepEqual(a,b); assert.deepEqual(await f.productRow(),{stock:'1.000',cost_price:'10.00',sell_price:'20.00'});
      await assert.rejects(f.deliver([{productId:f.product,quantity:2,price:10}],{requestId}),status(409));
      const zero=await f.deliver([{productId:f.product,quantity:0.001,price:0,sellPrice:0}]);
      assert.equal((await f.detail(zero.id)).items[0].sellPrice,0);
      assert.equal((await f.productRow()).cost_price,'10.00');
      const balance=await f.balance(), product=await f.productRow();
      await assert.rejects(f.deliver([{productId:f.product,quantity:0.0001,price:0}]),status(400));
      await assert.rejects(f.deliver([{productId:f.product,quantity:0.1,price:0.001}]),status(400));
      await assert.rejects(f.deliver([{productId:f.otherProduct,quantity:1,price:5}]),status(400));
      assert.deepEqual(await f.balance(),balance); assert.deepEqual(await f.productRow(),product);
    });

    await t.test('historical invoice rounding mismatch allocates original header cents with stable IDs; new invoices sum rounded lines', async () => {
      const f=await seed();
      const created=await f.deliver(Array.from({length:3},()=>({productId:f.product,quantity:0.333,price:0.01})));
      assert.equal((await f.detail(created.id)).totalAmount,0,'new header sums rounded line cents');
      // Reproduce an untouched legacy invoice written by the old sum-then-round path.
      await q('UPDATE deliveries SET total_amount=0.01 WHERE id=$1',[created.id]);
      await q('UPDATE suppliers SET total_purchases=0.01,current_debt=0.01 WHERE id=$1',[f.supplier]);
      const original=await one('SELECT * FROM deliveries WHERE id=$1',[created.id]);
      const lines=await q('SELECT * FROM delivery_items WHERE delivery_id=$1 ORDER BY id',[created.id]);
      const detail=await f.detail(created.id);
      const allocated=detail.items.find((item)=>item.id===lines[0].id); assert.equal(allocated.refundableTotal,0.01);
      const first=await f.return(created.id,{items:[{deliveryItemId:lines[0].id,quantity:0.1}]}); assert.equal(first.totalAmount,0);
      const final=await f.return(created.id,{}); assert.equal(final.totalAmount,0.01);
      assert.deepEqual(await one('SELECT * FROM deliveries WHERE id=$1',[created.id]),original);
      assert.deepEqual(await q('SELECT * FROM delivery_items WHERE delivery_id=$1 ORDER BY id',[created.id]),lines);
      assert.deepEqual(await f.balance(),{total_purchases:'0.00',total_paid:'0.00',current_debt:'0.00'});
      assert.equal((await f.productRow()).stock,'0.000');
    });

    await t.test('two distinct concurrent return IDs cannot overreturn or overspend stock; failure leaves no ledger', async () => {
      const f=await seed(), doc=await f.deliver(); const line=(await f.detail(doc.id)).items[0];
      const calls=Array.from({length:2},()=>f.return(doc.id,{requestId:randomUUID(),items:[{deliveryItemId:line.id,quantity:0.75}]}));
      const results=await Promise.allSettled(calls);
      assert.equal(results.filter((r)=>r.status==='fulfilled').length,1);
      assert.equal(results.find((r)=>r.status==='rejected').reason.getStatus(),400);
      assert.equal((await f.productRow()).stock,'0.250');
      assert.deepEqual(await f.balance(),{total_purchases:'2.50',total_paid:'0.00',current_debt:'2.50'});
      assert.equal((await one('SELECT COUNT(*)::int n FROM supplier_returns WHERE delivery_id=$1',[doc.id])).n,1);
      const before=await f.balance(); await q('UPDATE products SET stock=0 WHERE id=$1',[f.product]);
      await assert.rejects(f.return(doc.id,{requestId:randomUUID()}),status(400));
      assert.deepEqual(await f.balance(),before);
      assert.equal((await one('SELECT COUNT(*)::int n FROM supplier_returns WHERE delivery_id=$1',[doc.id])).n,1);
      const retryKey=randomUUID();
      await assert.rejects(f.return(doc.id,{requestId:retryKey}),status(400));
      await q('UPDATE products SET stock=0.25 WHERE id=$1',[f.product]);
      const recovered=await f.return(doc.id,{requestId:retryKey});
      assert.equal(recovered.totalAmount,2.5,'rolled-back failures do not reserve the retry key');
    });

    await t.test('concurrent partial PO receipts cannot exceed ordered quantity; product locks survive reverse line order', async () => {
      const f=await seed(), order=await f.createOrder(1,10);
      const dto=()=>({requestId:randomUUID(),paymentMode:'debt',items:[{itemId:order.items[0].id,receivedQuantity:0.75}]});
      const results=await Promise.allSettled([f.run(()=>orders.receive(order.id,f.tenant,f.user,dto(),f.point)),f.run(()=>orders.receive(order.id,f.tenant,f.user,dto(),f.point))]);
      assert.equal(results.filter((r)=>r.status==='fulfilled').length,1); assert.equal(results.find((r)=>r.status==='rejected').reason.getStatus(),400);
      assert.equal((await f.productRow()).stock,'0.750');
      assert.deepEqual(await f.balance(),{total_purchases:'7.50',total_paid:'0.00',current_debt:'7.50'});
      const p2=randomUUID(); await q('INSERT INTO products(id,tenant_id,warehouse_id,name,stock) VALUES($1,$2,$3,\'Second\',0)',[p2,f.tenant,f.warehouse]);
      const a=[{productId:f.product,quantity:1,price:1},{productId:p2,quantity:1,price:1}];
      const docs=await Promise.all([f.deliver(a,{requestId:randomUUID()}),f.deliver([...a].reverse(),{requestId:randomUUID()})]);
      const returned=await Promise.all(docs.map((doc)=>f.return(doc.id,{requestId:randomUUID()})));
      assert.equal(returned.length,2); assert.equal((await f.productRow()).stock,'0.750');
    });

    await t.test('return racing payment reversal and receipt date correction follows one document lock order', async () => {
      const f=await seed(), order=await f.createOrder(1,10);
      const receipt=await f.run(()=>orders.receive(order.id,f.tenant,f.user,{paymentMode:'paid'},f.point));
      const docId=receipt.sourceDeliveryIds[0];
      const payment=await one('SELECT id FROM supplier_payments WHERE delivery_id=$1',[docId]);
      await assert.rejects(f.run(()=>suppliers.reversePayment(f.tenant,f.user,payment.id,'wrong branch',f.otherPoint)),status(404));
      const blocker=await admin.connect();
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM products WHERE id=$1 FOR UPDATE',[f.product]);
      const returning=f.return(docId,{requestId:randomUUID()});
      // Wait for the return to hold its document and block on the product.
      // Read-only PG wait evidence, bounded; no timing-based success assumption.
      let waiting=false;
      for (let i=0;i<100;i++) {
        const activity=await one("SELECT COUNT(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT p.id, p.name, p.stock%'");
        if (activity.n) { waiting=true; break; }
        await new Promise((resolve)=>setTimeout(resolve,5));
      }
      if (!waiting) { await blocker.query('ROLLBACK'); blocker.release(); throw new Error('return did not reach the deliberate product lock'); }
      const reversing=f.run(()=>suppliers.reversePayment(f.tenant,f.user,payment.id,'ошибка оплаты',f.point));
      const correcting=f.run(()=>orders.changeReceivedDate(order.id,f.tenant,f.user,{receivedAt:new Date(Date.now()-86400000).toISOString()},f.point));
      await blocker.query('COMMIT'); blocker.release();
      await Promise.all([returning,reversing,correcting]);
      assert.deepEqual(await f.balance(),{total_purchases:'0.00',total_paid:'0.00',current_debt:'0.00'});
      assert.equal((await f.productRow()).stock,'0.000');
    });

    await t.test('source replacement/deletion is refused after any return, even zero-valued; source FK remains intact', async () => {
      const f=await seed(), doc=await f.deliver([{productId:f.product,quantity:1,price:0}]);
      const line=(await f.detail(doc.id)).items[0]; await f.return(doc.id,{items:[{deliveryItemId:line.id,quantity:0.1}]});
      await assert.rejects(f.run(()=>suppliers.updateDelivery(f.tenant,f.user,doc.id,{items:[{productId:f.product,quantity:2,price:0}]},f.point)),status(400));
      await assert.rejects(f.run(()=>suppliers.deleteDelivery(f.tenant,f.user,doc.id,'wrong',f.point)),status(400));
      await assert.rejects(q('DELETE FROM delivery_items WHERE id=$1',[line.id]), (e)=>e.code==='23503');
      assert.equal((await f.detail(doc.id)).items[0].id,line.id);
    });

    await t.test('foreign tenant/point and source-line substitution are rejected; replay key is bound to the branch', async () => {
      const f=await seed(), other=await seed(), doc=await f.deliver(), otherDoc=await other.deliver();
      const requestId=randomUUID(), detail=await f.detail(doc.id), line=detail.items[0];
      await assert.rejects(other.run(()=>suppliers.returnDelivery(other.tenant,other.user,doc.id,{},other.point)),status(404));
      await assert.rejects(f.run(()=>suppliers.returnDelivery(f.tenant,f.user,doc.id,{},f.otherPoint)),status(404));
      await assert.rejects(f.run(()=>suppliers.getDeliveryById(doc.id,f.tenant,f.otherPoint)),status(404));
      await assert.rejects(f.return(doc.id,{items:[{deliveryItemId:(await other.detail(otherDoc.id)).items[0].id,quantity:1}]}),status(400));
      await f.return(doc.id,{requestId,items:[{deliveryItemId:line.id,quantity:0.1}]});
      await assert.rejects(f.run(()=>suppliers.returnDelivery(f.tenant,f.user,doc.id,{requestId,items:[{deliveryItemId:line.id,quantity:0.1}]},f.otherPoint)),status(409));
      assert.deepEqual(await other.balance(),{total_purchases:'10.00',total_paid:'0.00',current_debt:'10.00'});
      assert.equal((await f.productRow()).stock,'0.900');
    });

    await t.test('purchase context follows actual dated invoices, including zero; backdated receipts preserve known cost and retail absence', async () => {
      const f=await seed(), now=Date.now(), old=new Date(now-5*86400000).toISOString(), middle=new Date(now-3*86400000).toISOString(), cutoff=new Date(now-2*86400000).toISOString();
      const zero=await f.deliver([{productId:f.product,quantity:1,price:0}],{date:old});
      const recent=await f.deliver([{productId:f.product,quantity:1,price:30}],{});
      await q('UPDATE products SET cost_price=99 WHERE id=$1',[f.product]);
      const context=await f.run(()=>suppliers.getPurchaseContext(f.tenant,[f.product],middle,f.point));
      assert.equal(context[0].previousPurchase.price,0); assert.equal(context[0].previousPurchase.deliveryId,zero.id); assert.equal(context[0].sellPrice,20);
      const backdated=await f.deliver([{productId:f.product,quantity:1,price:8}],{date:middle});
      const stored=await f.detail(backdated.id); assert.equal(stored.items[0].previousPurchase.deliveryId,zero.id);
      assert.equal((await f.productRow()).cost_price,'99.00'); assert.equal((await f.productRow()).sell_price,'20.00');
      const preview=await f.run(()=>suppliers.getPurchaseContext(f.tenant,[f.product],cutoff,f.point)); assert.equal(preview[0].previousPurchase.deliveryId,backdated.id);
      const current=await f.run(()=>suppliers.getPurchaseContext(f.tenant,[f.product],undefined,f.point)); assert.equal(current[0].previousPurchase.deliveryId,recent.id);
      const order=await f.createOrder(1,2); assert.equal(order.items[0].previousPurchase.deliveryId,recent.id);
      await f.run(()=>orders.receive(order.id,f.tenant,f.user,{paymentMode:'debt',receivedAt:middle,items:[{itemId:order.items[0].id,receivedQuantity:1,sellPrice:0}]},f.point));
      assert.equal((await f.productRow()).cost_price,'99.00'); assert.equal((await f.productRow()).sell_price,'0.00');
      assert.equal((await f.run(()=>suppliers.getPurchaseContext(f.tenant,[f.otherProduct],undefined,f.point))).length,0);
    });

    await t.test('legacy stock-only receiving keeps zero money and explicitly explains missing financial source', async () => {
      const f=await seed(), order=await f.createOrder();
      const result=await f.run(()=>orders.receive(order.id,f.tenant,f.user,{requestId:randomUUID()},f.point));
      assert.deepEqual(result.sourceDeliveryIds,[]); assert.match(result.financialReturnUnavailableReason,/Нет исходной накладной/);
      assert.deepEqual(await f.balance(),{total_purchases:'0.00',total_paid:'0.00',current_debt:'0.00'});
      assert.deepEqual(await f.productRow(),{stock:'1.000',cost_price:'7.00',sell_price:'20.00'});
      assert.equal((await one('SELECT COUNT(*)::int n FROM supplier_payments WHERE supplier_id=$1',[f.supplier])).n,0);
      await assert.rejects(f.return(order.id,{}),status(404));
    });

    await t.test('report/journal account for normal return once without creating cash or expense; supplier credit fields are explicit', async () => {
      const f=await seed(), doc=await f.deliver(); await f.return(doc.id,{items:[{deliveryItemId:(await f.detail(doc.id)).items[0].id,quantity:0.4}]});
      const date=new Date().toISOString().slice(0,10);
      const report=await f.run(()=>new SuppliersBuilder(pool).build({tenantId:f.tenant,pointId:f.point,tz:'Europe/Moscow',ids:[],dateFrom:'2020-01-01',dateTo:'2099-01-01'}));
      assert.equal(report.totals.deliveries,10); assert.equal(report.totals.returns,4); assert.equal(report.totals.debtEnd,6);
      assert.equal(report.sections.find((s)=>s.key==='returns').rows.length,1);
      assert.equal(await f.run(()=>suppliersOwedTotal(pool,f.tenant)),6);
      const journal=await f.run(()=>new JournalService(pool).getWarehouseDocs(f.tenant,{type:'return_to_supplier'},f.point));
      assert.equal(journal.length,1); assert.equal(journal[0].amount,4);
      assert.equal((await one('SELECT COUNT(*)::int n FROM supplier_payments WHERE supplier_id=$1',[f.supplier])).n,0);
      assert.equal((await one('SELECT COUNT(*)::int n FROM expenses WHERE tenant_id=$1',[f.tenant])).n,0);
      await f.run(()=>suppliers.createPayment(f.tenant,{supplierId:f.supplier,amount:10,date},f.user,f.point));
      const supplier=await f.run(()=>suppliers.getById(f.supplier,f.tenant));
      assert.equal(supplier.creditBalance,4); assert.equal(supplier.amountDue,0);
    });
  } finally { await pool.end(); }
});
