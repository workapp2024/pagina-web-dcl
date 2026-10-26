const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./load-ts.cjs');
require('./offline-network.cjs');
let db;
before(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; CREATE TABLE products(id varchar(64) PRIMARY KEY,category text,vehicle_types text[],stock int); INSERT INTO products VALUES('legacy','Auxiliar',ARRAY['auto'],7);");
  await db.exec(fs.readFileSync('supabase/migrations/20261025010000_catalog_foundation.sql','utf8'));
});
after(async () => { await db?.close(); });
const scalar = async (sql, args = []) => Object.values((await db.query(sql,args)).rows[0])[0];
async function rejected(sql, pattern = /./) { await assert.rejects(db.exec(sql), pattern); }
test('additive seed leaves legacy products and assignments untouched', async () => {
  assert.equal(await scalar('SELECT count(*)::int FROM catalog_categories'),2);
  assert.equal(await scalar('SELECT count(*)::int FROM catalog_vehicle_types'),6);
  assert.equal(await scalar('SELECT count(*)::int FROM product_catalog_assignments'),0);
  assert.equal(await scalar('SELECT count(*)::int FROM product_catalog_vehicle_types'),0);
  assert.deepEqual((await db.query('SELECT * FROM products')).rows,[{id:'legacy',category:'Auxiliar',vehicle_types:['auto'],stock:7}]);
});
test('category hierarchy, stable identity, slug and deletion restrictions are enforced', async () => {
  await db.exec("INSERT INTO catalog_categories(id,name,slug,parent_id) VALUES('led','LED','led','lighting');");
  await rejected("INSERT INTO catalog_categories(id,name,slug,parent_id) VALUES('deep','Deep','deep','led')",/one subcategory/);
  await rejected("UPDATE catalog_categories SET parent_id='accessories' WHERE id='lighting'",/children/);
  await rejected("UPDATE catalog_categories SET parent_id='led' WHERE id='lighting'");
  await rejected("UPDATE catalog_categories SET id='new-id' WHERE id='lighting'",/immutable/);
  await rejected("INSERT INTO catalog_categories(id,name,slug) VALUES('duplicate','D','led')",/unique/);
  await rejected("INSERT INTO catalog_categories(id,name,slug,form_profile) VALUES('bad','B','bad','unknown')",/check/);
  await rejected("DELETE FROM catalog_categories WHERE id='lighting'",/foreign key/);
  await db.exec("INSERT INTO catalog_categories(id,name,slug) VALUES('empty','Empty','empty'); DELETE FROM catalog_categories WHERE id='empty';");
  await db.exec("INSERT INTO product_catalog_assignments VALUES('legacy','led');");
  await rejected("DELETE FROM catalog_categories WHERE id='led'",/foreign key/);
  await db.exec("UPDATE product_catalog_assignments SET category_id='accessories' WHERE product_id='legacy'; DELETE FROM catalog_categories WHERE id='led';");
  await rejected("INSERT INTO product_catalog_assignments VALUES('missing','lighting')",/foreign key/);
});
test('destinations are configurable, Universal exclusive, deactivation preserves existing links', async () => {
  await db.exec("INSERT INTO catalog_vehicle_types VALUES('tractor','Tractor',70,true); INSERT INTO product_catalog_vehicle_types VALUES('legacy','auto'),('legacy','tractor');");
  await rejected("INSERT INTO product_catalog_vehicle_types VALUES('legacy','universal')",/Universal/);
  await rejected("INSERT INTO product_catalog_vehicle_types VALUES('legacy','auto')",/unique/);
  await db.exec("UPDATE catalog_vehicle_types SET active=false WHERE id='tractor';");
  assert.equal(await scalar("SELECT count(*)::int FROM product_catalog_vehicle_types WHERE vehicle_type_id='tractor'"),1);
  await rejected("DELETE FROM catalog_vehicle_types WHERE id='tractor'",/foreign key/);
  await rejected("UPDATE catalog_vehicle_types SET id='other' WHERE id='tractor'",/immutable/);
  await db.exec("DELETE FROM product_catalog_vehicle_types WHERE product_id='legacy'; INSERT INTO product_catalog_vehicle_types VALUES('legacy','universal');");
  await rejected("INSERT INTO product_catalog_vehicle_types VALUES('legacy','auto')",/Universal/);
  await db.exec("DELETE FROM product_catalog_vehicle_types WHERE product_id='legacy';");
  await rejected("INSERT INTO product_catalog_vehicle_types VALUES('legacy','tractor')",/inactive/);
  await rejected("INSERT INTO product_catalog_vehicle_types VALUES('legacy','unknown')",/missing/);
  assert.equal(await scalar("SELECT category FROM products WHERE id='legacy'"),'Auxiliar');
});
test('inactive parents prevent new assignment; used categories and aliases cannot be deleted', async () => {
  await db.exec("INSERT INTO catalog_categories(id,name,slug,parent_id) VALUES('child','Child','child','lighting'); UPDATE catalog_categories SET active=false WHERE id='lighting';");
  await rejected("UPDATE product_catalog_assignments SET category_id='child' WHERE product_id='legacy'",/inactive/);
  await db.exec("UPDATE catalog_categories SET active=true WHERE id='lighting'; INSERT INTO catalog_category_aliases VALUES('old-link','child');");
  await rejected("DELETE FROM catalog_categories WHERE id='child'",/foreign key/);
});
test('RLS and revoked platform defaults deny all browser writes; service role operates with real grants', async () => {
  const tables=['catalog_categories','catalog_vehicle_types','product_catalog_assignments','product_catalog_vehicle_types','catalog_category_aliases','catalog_foundation_lock'];
  for (const table of tables) {
    assert.equal(await scalar("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass",[table]),true);
    for (const role of ['anon','authenticated']) for(const permission of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
      assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3)',[role,table,permission]),false);
  }
  for(const role of ['anon','authenticated']) {
    await db.exec('SET ROLE '+role);
    try { await rejected("INSERT INTO catalog_vehicle_types VALUES('intruder','X',1,true)",/permission denied/); }
    finally { await db.exec('RESET ROLE'); }
  }
  await db.exec('SET ROLE service_role');
  try { await db.exec("INSERT INTO catalog_categories(id,name,slug) VALUES('authorized','Authorized','authorized'); UPDATE catalog_categories SET name='Renamed' WHERE id='authorized'; DELETE FROM catalog_categories WHERE id='authorized';"); }
  finally { await db.exec('RESET ROLE'); }
});
test('code validation accepts configurable destinations and rejects invalid or injected fields', () => {
  const v=load('lib/catalog-foundation.ts');
  assert.deepEqual(Array.from(v.validateCatalogDestinations(['utilitario','tractor'])),['utilitario','tractor']);
  for(const value of [['universal','auto'],['auto','auto'],['bad id'],null]) assert.throws(()=>v.validateCatalogDestinations(value));
  const row={id:'lighting',name:'Lighting',description:'',slug:'lighting',parent_id:null,sort_order:10,active:true,form_profile:'lighting'};
  assert.equal(v.validateCatalogCategory(row).id,'lighting');
  for(const patch of [{stock:999},{parent_id:'lighting'},{sort_order:-1},{form_profile:'other'},{slug:'Bad Slug'},{active:'true'}]) assert.throws(()=>v.validateCatalogCategory({...row,...patch}));
});
test('preparation reader authenticates ADMIN before DB, stays disabled, and handles missing schema', async () => {
  let allowed=false, calls=0, missing=true;
  const env={};
  const reader=load('lib/supabase/catalog-foundation.ts',{
    '@/lib/admin-auth':{isAdminAuthenticated:async permission=>{assert.equal(permission,'admin');return allowed;}},
    './server':{createAdminServerClient:()=>{calls++;return {from:()=>{const q={select:()=>q,order:()=>q,then:resolve=>resolve({data:[],error:missing?{code:'PGRST205'}:null})};return q;}};}},
  },{process:{env}});
  await assert.rejects(reader.readCatalogFoundation(),/ADMIN/); assert.equal(calls,0);
  allowed=true;assert.equal((await reader.readCatalogFoundation()).status,'disabled');assert.equal(calls,0);
  env.DCL_CATALOG_FOUNDATION_READ_ENABLED='1';assert.equal((await reader.readCatalogFoundation()).status,'unavailable');
  missing=false;assert.equal((await reader.readCatalogFoundation()).status,'ready');
});
