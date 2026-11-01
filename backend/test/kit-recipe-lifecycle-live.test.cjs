const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,options,status}=require('./helpers/nov01-inventory-fixture.cjs');
const {ProductKitsService}=require('../dist/product-kits/product-kits.service');
const {CheckTemplatesService}=require('../dist/check-templates/check-templates.service');
const {ChecksService}=require('../dist/checks/checks.service');
const {ClientsService}=require('../dist/clients/clients.service');
const {WarrantyService}=require('../dist/warranty/warranty.service');
const {ReturnsService}=require('../dist/returns/returns.service');
const {WarehousesService}=require('../dist/warehouses/warehouses.service');
async function setup(f){
 const kits=new ProductKitsService(f.pool,f.products),templates=new CheckTemplatesService(f.pool);
 const checks=new ChecksService(f.pool,new WarrantyService(f.pool),new ClientsService(f.pool));
 const source=await f.product({name:'Шланг',unit:'м',costPrice:99.99,stock:100});
 const dto=(more={})=>({requestId:randomUUID(),name:'Набор',quantity:2,sellPrice:130,warehouseId:f.main,components:[{productId:source.id,quantity:0.5}],...more});
 const assemble=(more={})=>f.run(()=>kits.assemble(dto(more),f.actor));
 const save=(batch,more={})=>f.run(()=>templates.create(f.tenant,f.actor,{name:'Повторяемый',supportsKitRecipes:true,shared:true,services:[],products:[{productId:batch.productId,name:'Набор',quantity:1,sellPrice:130}],...more}));
 const read=(actor=f.actor,opts={sourceAware:true,kitRecipes:true})=>f.run(()=>templates.getAll(f.tenant,actor,opts));
 const sale=(line,more={},actor=f.actor)=>f.run(()=>checks.create(f.tenant,actor.userID,actor.role,{masterId:actor.userID,services:[],products:[{...line,costPrice:0}],isDeferred:false,paymentMethod:'cash',...more},actor));
 return {kits,templates,checks,source,dto,assemble,save,read,sale};
}

test('adhoc assembly and replay save exactly one reusable immutable recipe; failed assembly rolls recipe back',options,()=>fixture(async f=>{
 const x=await setup(f),dto=x.dto(),a=await f.run(()=>x.kits.assemble(dto,f.actor)),b=await f.run(()=>x.kits.assemble(dto,f.actor));
 assert.equal(a.recipeVersion,1);assert.equal(a.recipeId,b.recipeId);assert.equal(a.productId,b.productId);
 assert.equal((await f.q('SELECT count(*)::int n FROM kit_recipes WHERE tenant_id=$1',[f.tenant]))[0].n,1);
 const got=await f.run(()=>x.kits.get(a.productId,f.actor));assert.equal(got.recipeId,a.recipeId);assert.equal(got.recipeVersion,1);
 await assert.rejects(x.assemble({components:[{productId:x.source.id,quantity:1000}]}),status(409));
 assert.equal((await f.q('SELECT count(*)::int n FROM kit_recipes WHERE tenant_id=$1',[f.tenant]))[0].n,1);
 await assert.rejects(f.q("UPDATE kit_recipe_versions SET name='changed' WHERE recipe_id=$1",[a.recipeId]),/KIT_RECIPE_VERSION_IMMUTABLE/);
},1));

test('exhausted recipe template stays unavailable and rebuilds from pinned v1 after latest v2 changes',options,()=>fixture(async f=>{
 const x=await setup(f),a=await x.assemble(),saved=await x.save(a);
 assert.equal(saved.products[0].kind,'kitRecipe');assert.equal(saved.products[0].kitRecipeId,a.recipeId);assert.equal(saved.products[0].kitResolution.status,'resolved');
 await f.run(()=>x.kits.disassemble(a.productId,{requestId:randomUUID(),expectedRevision:1,quantity:2},f.actor));
 let line=(await x.read())[0].products[0];assert.equal(line.catalogStatus,'unavailable');assert.equal(line.sellPrice,undefined);assert.equal(line.productId,undefined);
 const old=await f.run(()=>x.kits.recipe(a.recipeId,f.actor,'1'));
 await f.run(()=>x.kits.saveRecipe({name:'Новый состав',components:[{productId:x.source.id,quantity:1}]},f.actor,a.recipeId,1));
 const rebuilt=await x.assemble({recipeId:a.recipeId,recipeVersion:1,components:old.components});assert.equal(rebuilt.recipeVersion,1);
 line=(await x.read())[0].products[0];assert.equal(line.kitRecipeVersion,1);assert.equal(line.productId,rebuilt.productId);assert.equal(line.costPrice,49.995);
 await assert.rejects(x.assemble({recipeId:a.recipeId,expectedRecipeVersion:1,components:old.components}),status(409));
 const other=await x.assemble({recipeId:a.recipeId,recipeVersion:2,components:[{productId:x.source.id,quantity:1}]});assert.equal(other.recipeVersion,2);
 assert.equal((await x.read())[0].products[0].productId,rebuilt.productId);
},1));

test('cashier without warehouse rights resolves exact batch cost; legacy clients see no partial kit template and cannot overwrite it',options,()=>fixture(async f=>{
 const x=await setup(f),a=await x.assemble();await x.save(a);
 const cashier={...f.actor,userID:f.other,role:'master',permissions:{checks_create:true,checks_view:true,warehouse_access:false,warehouse_manage:false}};
 const current=(await x.read(cashier))[0];const line=current.products[0];assert.equal(line.costPrice,undefined);assert.equal(line.kitResolution.candidates[0].costPrice,undefined);
 assert.equal((await x.read(cashier,{sourceAware:true,kitRecipes:false})).length,0);
 assert.equal((await x.read(cashier,{sourceAware:false,kitRecipes:true})).length,0);
 await assert.rejects(f.run(()=>x.templates.update(current.id,f.tenant,f.actor,{name:'Old overwrite',products:[]})),e=>e.getResponse().code==='TEMPLATE_KIT_CLIENT_UPDATE_REQUIRED');
 const sale=await x.sale(line,{},cashier);const saved=(await f.q('SELECT * FROM check_product_lines WHERE check_id=$1',[sale.id]))[0];
 assert.equal(saved.product_id,a.productId);assert.equal(Number(saved.total_cost),50);assert.equal(Number(saved.kit_exact_unit_cost),49.995);assert.equal(saved.template_kit_batch.recipeId,a.recipeId);
},1));

test('multiple batches require explicit allocations and retain separate authoritative exact cost bases',options,()=>fixture(async f=>{
 const x=await setup(f),a=await x.assemble({quantity:1});await x.save(a,{products:[{productId:a.productId,name:'Набор',quantity:2}]});
 await f.run(()=>f.products.update(x.source.id,f.tenant,{costPrice:80},f.owner,f.point));
 const b=await x.assemble({quantity:1,recipeId:a.recipeId,recipeVersion:1});
 const line=(await x.read())[0].products[0];assert.equal(line.kitResolution.status,'selection_required');assert.equal(line.kitResolution.availableQuantity,2);assert.equal(line.productId,undefined);assert.equal(line.sellPrice,undefined);
 const parts=line.kitResolution.candidates.map(c=>({...line,productId:c.productId,quantity:1,sellPrice:c.sellPrice,costPrice:0,sourceTemplateProduct:{...line.sourceTemplateProduct,expectedAssemblyRevision:c.revision}}));
 const sale=await f.run(()=>x.checks.create(f.tenant,f.owner,'director',{masterId:f.owner,services:[],products:parts,isDeferred:false,paymentMethod:'cash'},f.actor));
 const saved=await f.q('SELECT kit_exact_unit_cost,total_cost FROM check_product_lines WHERE check_id=$1 ORDER BY kit_exact_unit_cost',[sale.id]);
 assert.deepEqual(saved.map(r=>Number(r.kit_exact_unit_cost)),[40,49.995]);assert.equal(Number(sale.productCostTotal),90);
},1));

test('shortage and stale batch revision reject without stock mutation; saved draft activation also rechecks selected revision',options,()=>fixture(async f=>{
 const x=await setup(f),a=await x.assemble({quantity:1});await x.save(a,{products:[{productId:a.productId,name:'Набор',quantity:2}]});
 let line=(await x.read())[0].products[0];assert.equal(line.kitResolution.status,'shortage');assert.equal(line.sellPrice,undefined);
 await assert.rejects(x.sale(line),status(400));
 const pick=line.kitResolution.candidates[0];line={...line,quantity:1,productId:pick.productId,sellPrice:pick.sellPrice,sourceTemplateProduct:{...line.sourceTemplateProduct,expectedAssemblyRevision:pick.revision}};
 const draft=await x.sale(line,{isDeferred:true});assert.equal(Number((await f.q('SELECT stock FROM products WHERE id=$1',[a.productId]))[0].stock),1);
 await f.run(()=>x.kits.disassemble(a.productId,{requestId:randomUUID(),expectedRevision:1,quantity:1},f.actor));
 await assert.rejects(f.run(()=>x.checks.update(draft.id,f.tenant,'director',{isDeferred:false},f.owner,f.actor)),e=>e.getResponse().code==='TEMPLATE_KIT_BATCH_CHANGED');
 assert.equal((await f.q('SELECT is_deferred FROM checks WHERE id=$1',[draft.id]))[0].is_deferred,true);
 assert.equal(Number((await f.q('SELECT stock FROM products WHERE id=$1',[a.productId]))[0].stock),0);
},1));

test('whole-kit sale exhausts recipe selection, real whole return restores it, and explicit template upgrade pins v2',options,()=>fixture(async f=>{
 const x=await setup(f),a=await x.assemble({quantity:1}),template=await x.save(a),line=(await x.read())[0].products[0];
 const sale=await x.sale(line);assert.equal((await x.read())[0].products[0].kitResolution.status,'unavailable');
 const returns=new ReturnsService(f.pool,new WarehousesService(f.pool));await f.run(()=>returns.createReturn(f.tenant,f.owner,sale.id,{destination:'warehouse',scope:'full'},f.actor));
 assert.equal((await x.read())[0].products[0].kitResolution.status,'resolved');
 await f.run(()=>x.kits.saveRecipe({name:'V2',components:[{productId:x.source.id,quantity:1}]},f.actor,a.recipeId,1));
 const b=await x.assemble({recipeId:a.recipeId,recipeVersion:2,components:[{productId:x.source.id,quantity:1}]});
 assert.equal((await x.read())[0].products[0].kitRecipeVersion,1);
 const upgrade=await f.run(()=>x.templates.update(template.id,f.tenant,f.actor,{supportsKitRecipes:true,products:[{kind:'kitRecipe',kitRecipeId:a.recipeId,kitRecipeVersion:2,name:'V2 chosen',quantity:1}]}));
 assert.equal(upgrade.products[0].kitRecipeVersion,2);assert.equal(upgrade.products[0].productId,b.productId);
 const cashier={...f.actor,userID:f.other,role:'master',permissions:{templates_shared_manage:false}};
 await assert.rejects(f.run(()=>x.templates.update(template.id,f.tenant,cashier,{supportsKitRecipes:true,products:[]})),status(403));
},1));

test('recipe resolution excludes foreign points, rejects foreign recipe edits and missing source replacement never remaps IDs',options,()=>fixture(async f=>{
 const x=await setup(f),a=await x.assemble(),template=await x.save(a);
 const otherPoint={...f.actor,currentPointId:f.secondPoint};
 const unavailable=(await x.read(otherPoint))[0].products[0];assert.equal(unavailable.kitResolution.candidates.length,0);assert.equal(unavailable.kitResolution.status,'unavailable');
 await assert.rejects(f.run(()=>x.kits.recipe(a.recipeId,otherPoint,'1')),status(404));
 await assert.rejects(f.run(()=>x.templates.update(template.id,f.tenant,otherPoint,{supportsKitRecipes:true,products:[{kind:'kitRecipe',kitRecipeId:a.recipeId,kitRecipeVersion:1,name:'Bad point',quantity:1}]})),status(400));
 await f.q('UPDATE products SET deleted_at=now() WHERE id=$1',[x.source.id]);
 await assert.rejects(x.assemble({recipeId:a.recipeId,recipeVersion:1}),status(400));
 const replacement=await f.product({name:x.source.name,costPrice:1,stock:100});
 await assert.rejects(x.assemble({recipeId:a.recipeId,recipeVersion:1,components:[{productId:replacement.id,quantity:0.5}]}),status(409));
 const variant=await x.assemble({components:[{productId:replacement.id,quantity:0.5}]});assert.notEqual(variant.recipeId,a.recipeId);
 assert.equal((await x.read())[0].products[0].kitRecipeId,a.recipeId);
},1));

test('two concurrent template sales of one selected batch have exactly one winner and no partial stock/check effects',options,()=>fixture(async f=>{
 const x=await setup(f),a=await x.assemble({quantity:1});await x.save(a);const line=(await x.read())[0].products[0];
 const results=await Promise.allSettled([x.sale(line),x.sale(line)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const failed=results.find(r=>r.status==='rejected');assert.equal(failed.reason.getStatus(),409);assert.equal(failed.reason.getResponse().code,'TEMPLATE_KIT_BATCH_CHANGED');
 assert.equal(Number((await f.q('SELECT stock FROM products WHERE id=$1',[a.productId]))[0].stock),0);
 assert.equal((await f.q('SELECT count(*)::int n FROM checks WHERE tenant_id=$1',[f.tenant]))[0].n,1);
 assert.equal((await f.q('SELECT count(*)::int n FROM check_product_lines WHERE product_id=$1',[a.productId]))[0].n,1);
}));

test('exhausted physical batches leave low-stock alerts while ordinary zero-stock items remain',options,()=>fixture(async f=>{
 const x=await setup(f),a=await x.assemble({quantity:1}),ordinary=await f.product({name:'Normal zero',stock:0,minStock:1});
 await f.run(()=>f.products.update(a.productId,f.tenant,{minStock:2},f.owner,f.point));
 assert.ok((await f.run(()=>f.products.getLowStock(f.tenant,f.actor))).some(p=>p.id===a.productId));
 await f.run(()=>x.kits.disassemble(a.productId,{requestId:randomUUID(),expectedRevision:1,quantity:1},f.actor));
 const ids=(await f.run(()=>f.products.getLowStock(f.tenant,f.actor))).map(p=>p.id);assert.ok(!ids.includes(a.productId));assert.ok(ids.includes(ordinary.id));
 assert.equal((await f.run(()=>x.kits.get(a.productId,f.actor))).quantity,0);
},1));
