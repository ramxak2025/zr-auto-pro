const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('crypto');
const {fixture,options,status}=require('./helpers/nov01-inventory-fixture.cjs');
const {ProductKitsService}=require('../dist/product-kits/product-kits.service');
const {ChecksService}=require('../dist/checks/checks.service');
const {ClientsService}=require('../dist/clients/clients.service');
const {WarrantyService}=require('../dist/warranty/warranty.service');
const {ReturnsService}=require('../dist/returns/returns.service');
const {WarehousesService}=require('../dist/warehouses/warehouses.service');
const {SuppliersService}=require('../dist/suppliers/suppliers.service');

async function kitFixture(f,work) {
  const kits=new ProductKitsService(f.pool,f.products);
  const a=await f.product({name:'A',costPrice:4000,sellPrice:7000}),b=await f.product({name:'B',costPrice:6000,sellPrice:8000});
  const input=(more={})=>({requestId:randomUUID(),name:'Комплект',quantity:1,sellPrice:13000,warehouseId:f.main,components:[{productId:a.id,quantity:1},{productId:b.id,quantity:1}],...more});
  const assemble=(more={})=>f.run(()=>kits.assemble(input(more),f.actor));
  const stock=async(id)=>Number((await f.q('SELECT stock FROM products WHERE id=$1',[id]))[0].stock);
  const value=async()=>Number((await f.q('SELECT SUM(stock*cost_price) value FROM products WHERE tenant_id=$1',[f.tenant]))[0].value);
  await work({kits,a,b,input,assemble,stock,value});
}

test('physical assembly preserves 10k cost with 13k retail instead of 15k components, no money/debt and exact retry',options,()=>fixture(f=>kitFixture(f,async(k)=>{
  const before=await k.value(),dto=k.input();
  const [a,b]=await Promise.all([f.run(()=>k.kits.assemble(dto,f.actor)),f.run(()=>k.kits.assemble(dto,f.actor))]);
  assert.equal(a.productId,b.productId);assert.equal(a.costPrice,10000);assert.equal(a.sellPrice,13000);
  assert.equal(await k.stock(k.a.id),9);assert.equal(await k.stock(k.b.id),9);assert.equal(await k.stock(a.productId),1);assert.equal(await k.value(),before);
  assert.equal((await f.q('SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1',[f.tenant]))[0].n,3);
  assert.equal((await f.q('SELECT count(*)::int n FROM expenses WHERE tenant_id=$1',[f.tenant]))[0].n,0);
  assert.equal((await f.q('SELECT count(*)::int n FROM supplier_payments WHERE tenant_id=$1',[f.tenant]))[0].n,0);
  await assert.rejects(f.run(()=>k.kits.assemble({...dto,sellPrice:14000},f.actor)),status(409));
  const snapshot=await f.run(()=>k.kits.get(a.productId,f.actor));assert.equal(snapshot.components.length,2);
  const visible=await f.run(()=>k.kits.get(a.productId,{...f.actor,role:'master',permissions:{warehouse_access:true,warehouse_manage:false}}));
  assert.equal(visible.costPrice,undefined);assert.ok(visible.components.every(component=>component.costPrice===undefined));
}))); 

test('disassembly restores captured cost/place into a compatible position without repricing moved source stock',options,()=>fixture(f=>kitFixture(f,async(k)=>{
  const cell=randomUUID();await f.q("INSERT INTO storage_cells(id,tenant_id,warehouse_id,code) VALUES($1,$2,$3,'A-01')",[cell,f.tenant,f.main]);
  await f.q("INSERT INTO warehouse_categories(tenant_id,warehouse_id,path) VALUES($1,$2,'Полка')",[f.tenant,f.main]);
  await f.run(()=>f.products.update(k.a.id,f.tenant,{category:'Полка',storageCellId:cell},f.owner,f.point));
  const assembled=await k.assemble();
  await f.run(()=>f.products.update(k.a.id,f.tenant,{costPrice:9000,warehouseId:f.used,category:''},f.owner,f.point));
  const before=await k.value();
  const result=await f.run(()=>k.kits.disassemble(assembled.productId,{requestId:randomUUID(),expectedRevision:1,quantity:1},f.actor));
  const restored=result.sources.find(source=>source.sourceProductId===k.a.id);assert.notEqual(restored.productId,k.a.id);
  const row=(await f.q('SELECT * FROM products WHERE id=$1',[restored.productId]))[0];
  assert.equal(row.warehouse_id,f.main);assert.equal(row.category,'Полка');assert.equal(row.storage_cell_id,cell);assert.equal(Number(row.cost_price),4000);
  const original=(await f.q('SELECT * FROM products WHERE id=$1',[k.a.id]))[0];assert.equal(Number(original.cost_price),9000);assert.equal(Number(original.stock),9);assert.equal(original.warehouse_id,f.used);
  assert.equal(await k.value(),before);assert.equal(await k.stock(assembled.productId),0);
}))); 

test('missing original place, insufficient stock, fractional-cent basis and generic mutation paths fail atomically',options,()=>fixture(f=>kitFixture(f,async(k)=>{
  await assert.rejects(k.assemble({quantity:11}),status(409));
  const fractional=await f.product({name:'Fractional cent',costPrice:0.01,sellPrice:1});
  await assert.rejects(k.assemble({components:[{productId:fractional.id,quantity:0.5}]}),error=>error.getResponse().code==='KIT_COST_PRECISION');
  assert.equal((await f.q('SELECT count(*)::int n FROM product_assemblies WHERE tenant_id=$1',[f.tenant]))[0].n,0);
  const cell=randomUUID();await f.q("INSERT INTO storage_cells(id,tenant_id,warehouse_id,code) VALUES($1,$2,$3,'A-02')",[cell,f.tenant,f.main]);
  await f.run(()=>f.products.update(k.a.id,f.tenant,{storageCellId:cell},f.owner,f.point));
  const assembled=await k.assemble(),before=await k.value();
  await assert.rejects(f.run(()=>f.products.update(assembled.productId,f.tenant,{costPrice:1},f.owner,f.point)),status(409));
  await assert.rejects(f.run(()=>f.products.update(assembled.productId,f.tenant,{stock:5},f.owner,f.point)),status(409));
  await assert.rejects(f.run(()=>f.products.updateStock(assembled.productId,f.tenant,{type:'income',quantity:1},f.owner,f.point)),status(409));
  await assert.rejects(f.run(()=>f.movements.create(f.tenant,f.owner,{type:'income',productId:assembled.productId,quantity:1},f.point,f.actor)),status(409));
  await assert.rejects(f.q('UPDATE products SET cost_price=1 WHERE id=$1',[assembled.productId]),error=>error.code==='P0001');
  await f.q('DELETE FROM storage_cells WHERE id=$1',[cell]);
  await assert.rejects(f.run(()=>k.kits.disassemble(assembled.productId,{requestId:randomUUID(),expectedRevision:1,quantity:1},f.actor)),error=>error.getResponse().code==='KIT_SOURCE_PLACE_UNAVAILABLE');
  assert.equal(await k.value(),before);assert.equal(await k.stock(assembled.productId),1);
}))); 

test('concurrent disassembly cannot duplicate components; recipe edits and recomposition create a fresh immutable batch',options,()=>fixture(f=>kitFixture(f,async(k)=>{
  const recipe=await f.run(()=>k.kits.saveRecipe({name:'Recipe',components:k.input().components},f.actor));
  const assembled=await k.assemble({recipeId:recipe.id,expectedRecipeVersion:recipe.version});
  await f.run(()=>k.kits.saveRecipe({name:'New recipe',components:[{productId:k.a.id,quantity:2}]},f.actor,recipe.id,1));
  assert.equal((await f.run(()=>k.kits.get(assembled.productId,f.actor))).components.length,2);
  const before=await k.value();
  const changed=await f.run(()=>k.kits.recompose(assembled.productId,{...k.input({components:[{productId:k.a.id,quantity:1},{productId:k.b.id,quantity:2}]}),expectedRevision:1},f.actor));
  assert.notEqual(changed.productId,assembled.productId);assert.equal(changed.costPrice,16000);assert.equal(await k.value(),before);
  const results=await Promise.allSettled([1,2].map(()=>f.run(()=>k.kits.disassemble(changed.productId,{requestId:randomUUID(),expectedRevision:1,quantity:1},f.actor))));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(await k.stock(changed.productId),0);
  assert.equal(await k.stock(k.a.id),10);assert.equal(await k.stock(k.b.id),10);
}))); 

test('whole-kit POS consumes one kit; delete/restore/return preserve it and oversell cannot fabricate assembled units',options,()=>fixture(f=>kitFixture(f,async(k)=>{
  const assembled=await k.assemble();
  const checks=new ChecksService(f.pool,new WarrantyService(f.pool),new ClientsService(f.pool));
  const create=(quantity=1)=>f.run(()=>checks.create(f.tenant,f.owner,'director',{masterId:f.owner,products:[{productId:assembled.productId,name:'Комплект',quantity,sellPrice:13000}],services:[],isDeferred:false,paymentMethod:'cash'},f.actor));
  await assert.rejects(create(2),status(409));assert.equal(await k.stock(assembled.productId),1);
  const sale=await create();assert.equal(await k.stock(assembled.productId),0);assert.equal(await k.stock(k.a.id),9);
  await f.run(()=>checks.remove(sale.id,f.tenant,'director',f.owner,f.actor));assert.equal(await k.stock(assembled.productId),1);
  await f.run(()=>checks.restore(sale.id,f.tenant,f.actor));assert.equal(await k.stock(assembled.productId),0);
  const returns=new ReturnsService(f.pool,new WarehousesService(f.pool));
  await f.run(()=>returns.createReturn(f.tenant,f.owner,sale.id,{destination:'warehouse',scope:'full'},f.actor));assert.equal(await k.stock(assembled.productId),1);assert.equal(await k.stock(k.a.id),9);
  const supplier=randomUUID();await f.q("INSERT INTO suppliers(id,tenant_id,name) VALUES($1,$2,'Supplier')",[supplier,f.tenant]);
  const suppliers=new SuppliersService(f.pool,f.movements,new WarehousesService(f.pool));
  await assert.rejects(f.run(()=>suppliers.createDelivery(f.tenant,{supplierId:supplier,items:[{productId:assembled.productId,quantity:1,price:1}]},f.point,f.owner)),status(409));
}))); 
