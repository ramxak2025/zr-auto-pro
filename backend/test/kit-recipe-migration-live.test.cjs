const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process'),{Pool}=require('pg');
const live=process.env.NOV01_INVENTORY_LIVE_DB;
test('212 migration binds legacy batches only to matching captured compositions and preserves inventory/check costs', {skip:!live,timeout:30000},async()=>{
 const url=new URL(live);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'65479');assert.equal(url.pathname,'/autexa_nov01_inventory_test');assert.equal(url.username,'nov01_fixture');
 const admin=new Pool({connectionString:url.toString(),max:1}),dbName='autexa_nov02_kit_schema_'+randomUUID().replaceAll('-','').slice(0,12),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'autexa-nov02-kit-migration-'));
 let db;
 try {
  await admin.query('CREATE DATABASE '+dbName);url.pathname='/'+dbName;
  fs.mkdirSync(path.join(scratch,'migrations'));
  for(const file of fs.readdirSync(path.join(__dirname,'../migrations')).filter(f=>f.endsWith('.sql')&&f<'211'))fs.symlinkSync(path.join(__dirname,'../migrations',file),path.join(scratch,'migrations',file));
  const env={...process.env,DATABASE_URL:url.toString()};delete env.DB_APP_PASSWORD;
  const script=`const {Logger}=require(${JSON.stringify(require.resolve('@nestjs/common'))});Logger.overrideLogger(false);const {MigrationRunner}=require(${JSON.stringify(path.join(__dirname,'../dist/migration-runner'))});new MigrationRunner().onModuleInit().catch(e=>{console.error(e.message);process.exitCode=1;});`;
  const built=spawnSync(process.execPath,['-e',script],{cwd:scratch,env,encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  db=new Pool({connectionString:url.toString(),max:1});const tid=randomUUID(),wh=randomUUID(),r=randomUUID(),source=randomUUID(),old=randomUUID(),match=randomUUID(),unbound=randomUUID(),tpl=randomUUID(),check=randomUUID();
  await db.query("INSERT INTO tenants(id,name) VALUES($1,'Kit migration fixture')",[tid]);
  await db.query("INSERT INTO warehouses(id,tenant_id,name,kind) VALUES($1,$2,'Main','main')",[wh,tid]);
  await db.query(`INSERT INTO products(id,tenant_id,warehouse_id,name,stock,cost_price,sell_price) VALUES
    ($1,$5,$6,'Source',100,99.99,150),($2,$5,$6,'Old kit',2,49.995,130),($3,$5,$6,'Matching kit',3,99.99,200),($4,$5,$6,'Unbound kit',1,99.99,200)`,[source,old,match,unbound,tid,wh]);
  await db.query('INSERT INTO kit_recipes(id,tenant_id,name,version,components) VALUES($1,$2,$3,2,$4)',[r,tid,'Latest composition',JSON.stringify([{productId:source,quantity:1}])]);
  for(const [id,recipe,qty,cost] of [[old,r,0.5,49.995],[match,r,1,99.99],[unbound,null,1,99.99]]){
   const a=(await db.query('INSERT INTO product_assemblies(tenant_id,product_id,recipe_id,assembled_quantity,unit_cost) VALUES($1,$2,$3,3,$4) RETURNING id',[tid,id,recipe,cost])).rows[0].id;
   await db.query('UPDATE products SET assembly_id=$1,assembly_exact_cost=$2 WHERE id=$3',[a,cost,id]);
   await db.query("INSERT INTO product_assembly_components(tenant_id,assembly_id,source_product_id,source_warehouse_id,quantity,unit_cost,product_snapshot) VALUES($1,$2,$3,$4,$5,99.99,'{}')",[tid,a,source,wh,qty]);
  }
  const ordinary={productId:source,name:'Ordinary',quantity:0.5,costPrice:99.99,sellPrice:150};
  await db.query('INSERT INTO check_templates(id,tenant_id,name,products) VALUES($1,$2,$3,$4)',[tpl,tid,'Legacy template',JSON.stringify([{productId:old,name:'Old kit',quantity:1,sellPrice:130},ordinary])]);
  await db.query('INSERT INTO checks(id,tenant_id,product_cost_total,total_cost) VALUES($1,$2,50,50)',[check,tid]);
  await db.query("INSERT INTO check_product_lines(check_id,product_id,name,quantity,cost_price,total_cost,kit_exact_unit_cost) VALUES($1,$2,'Old saved kit',1,50,50,49.995)",[check,old]);
  const before=(await db.query('SELECT id,stock,cost_price,assembly_exact_cost FROM products ORDER BY id')).rows;
  await db.query('BEGIN');await db.query(fs.readFileSync(path.join(__dirname,'../migrations/212_kit_recipe_versions.sql'),'utf8'));await db.query('COMMIT');
  assert.deepEqual((await db.query('SELECT id,stock,cost_price,assembly_exact_cost FROM products ORDER BY id')).rows,before);
  const batches=(await db.query('SELECT product_id,recipe_id,recipe_version FROM product_assemblies')).rows;
  assert.notEqual(batches.find(a=>a.product_id===old).recipe_id,r);assert.equal(batches.find(a=>a.product_id===old).recipe_version,1);
  assert.equal(batches.find(a=>a.product_id===match).recipe_id,r);assert.equal(batches.find(a=>a.product_id===match).recipe_version,2);
  assert.ok(batches.find(a=>a.product_id===unbound).recipe_id);
  const lines=(await db.query('SELECT products FROM check_templates WHERE id=$1',[tpl])).rows[0].products;
  assert.equal(lines[0].kind,'kitRecipe');assert.equal(lines[0].kitRecipeId,batches.find(a=>a.product_id===old).recipe_id);assert.equal(lines[0].productId,undefined);assert.deepEqual(lines[1],ordinary);
  const saved=(await db.query('SELECT cost_price,total_cost,kit_exact_unit_cost FROM check_product_lines WHERE check_id=$1',[check])).rows[0];assert.equal(saved.cost_price,'50.00');assert.equal(saved.total_cost,'50.00');assert.equal(saved.kit_exact_unit_cost,'49.99500');
 }finally{if(db)await db.end();await admin.query('DROP DATABASE IF EXISTS '+dbName);await admin.end();fs.rmSync(scratch,{recursive:true,force:true});}
});
