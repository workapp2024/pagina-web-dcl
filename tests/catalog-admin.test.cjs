const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const load=require('./load-ts.cjs');
require('./offline-network.cjs');
let db,authorized=true,calls=0;
const env={NODE_ENV:'production',DCL_CATALOG_ADMIN_ENABLED:'1',NEXT_PUBLIC_SITE_URL:'https://dcl.test'};
const originGuard=load('lib/store/buyer-session.ts',{'next/headers':{},'@/lib/supabase/server':{}},{Buffer,process:{env}}).isSameOriginWrite;
const permitted=new Set(['catalog_categories','catalog_vehicle_types','product_catalog_assignments','product_catalog_vehicle_types','catalog_category_aliases']);
const client={from(table){
  assert.ok(permitted.has(table),'API must not access legacy/commercial tables');calls++;
  let operation='SELECT',values=null,columns='*',head=false,one=false,limit=1000;const filters=[],orders=[];
  const q={select(c='*',options={}){columns=c;head=!!options.head;return q;},order(c){orders.push(c);return q;},limit(n){limit=n;return q;},
    insert(v){operation='INSERT';values=v;return q;},update(v){operation='UPDATE';values=v;return q;},delete(){operation='DELETE';return q;},
    match(v){for(const [key,value] of Object.entries(v))filters.push([key,value]);return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){assert.equal(v,null);filters.push([k,null]);return q;},single(){one=true;return q;},maybeSingle(){one=true;return q;},
    async then(resolve){try{
      const args=[];const add=v=>{args.push(v);return '$'+args.length;};
      const where=()=>filters.length?' WHERE '+filters.map(([k,v])=>v===null?k+' IS NULL':k+'='+add(v)).join(' AND '):'';
      let sql;
      if(operation==='SELECT')sql='SELECT '+columns+' FROM '+table+where()+(orders.length?' ORDER BY '+orders.join(','):'')+' LIMIT '+limit;
      if(operation==='INSERT'){const entries=Object.entries(values);sql='INSERT INTO '+table+'('+entries.map(([k])=>k).join(',')+') VALUES('+entries.map(([,v])=>add(v)).join(',')+') RETURNING '+columns;}
      if(operation==='UPDATE')sql='UPDATE '+table+' SET '+Object.entries(values).map(([k,v])=>k+'='+add(v)).join(',')+where()+' RETURNING '+columns;
      if(operation==='DELETE')sql='DELETE FROM '+table+where()+' RETURNING '+columns;
      const rows=(await db.query(sql,args)).rows;
      resolve({data:head?null:one?(rows[0]??null):rows,count:rows.length,error:null});
    }catch(error){resolve({data:null,count:null,error:{code:error.code,message:error.message}});}}
  };return q;
}};
const route=load('app/api/admin/catalog-foundation/route.ts',{
  '@/lib/admin-auth':{isAdminAuthenticated:async p=>{assert.equal(p,'admin');return authorized;}},
  '@/lib/store/buyer-session':{isSameOriginWrite:originGuard},'@/lib/rate-limit':{rateLimit:()=>null},
  '@/lib/supabase/server':{createAdminServerClient:()=>client},
},{process:{env}});
const req=(method,body,origin='https://dcl.test')=>new Request('http://localhost:10000/api/admin/catalog-foundation',{method,headers:{origin,host:'dcl.test','content-type':'application/json'},body:JSON.stringify(body)});
const cat=(id,name,slug,parent=null)=>({id,name,slug,parent_id:parent,description:'',sort_order:10,active:true,form_profile:'general'});
const clean=row=>{const {usage,...v}=row;void usage;return v;};
const snapshot=async()=>{const r=await route.GET();assert.equal(r.status,200);return r.json();};
before(async()=>{
 db=new PGlite();await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE products(id varchar(64) PRIMARY KEY,category text,stock int); INSERT INTO products VALUES('existing','Auxiliar',5);");
 await db.exec(fs.readFileSync('supabase/migrations/20261025010000_catalog_foundation.sql','utf8'));await db.exec('SET ROLE service_role');
});
after(async()=>{await db?.close();});
test('anonymous/seller, cross-origin and disabled requests never reach database',async()=>{
 calls=0;authorized=false;assert.equal((await route.GET()).status,401);assert.equal((await route.POST(req('POST',{}))).status,401);assert.equal(calls,0);
 authorized=true;assert.equal((await route.POST(req('POST',{},'https://evil.test'))).status,403);assert.equal(calls,0);
 env.DCL_CATALOG_ADMIN_ENABLED='0';assert.equal((await route.GET()).status,503);assert.equal(calls,0);env.DCL_CATALOG_ADMIN_ENABLED='1';
});
test('ADMIN creates categories/subcategories, renames, reorders and detects stale changes',async()=>{
 const created=await route.POST(req('POST',{kind:'category',value:cat('client-chosen','Custom','custom')}));assert.equal(created.status,201);
 let data=await snapshot();let row=data.categories.find(c=>c.slug==='custom');assert.notEqual(row.id,'client-chosen');assert.match(row.id,/^category-/);
 const original=clean(row),changed={...original,name:'Renamed',sort_order:2,active:false};
 assert.equal((await route.PATCH(req('PATCH',{kind:'category',expected:original,value:changed}))).status,200);
 assert.equal((await route.PATCH(req('PATCH',{kind:'category',expected:original,value:{...original,name:'Stale'}}))).status,409);
 assert.equal((await route.DELETE(req('DELETE',{kind:'category',expected:original}))).status,409);
 assert.equal((await route.DELETE(req('DELETE',{kind:'category',expected:changed}))).status,200);
 assert.equal((await route.POST(req('POST',{kind:'category',value:cat('x','Child','child','lighting')}))).status,201);
 data=await snapshot();row=clean(data.categories.find(c=>c.slug==='child'));
 assert.equal((await route.POST(req('POST',{kind:'category',value:cat('x','Too deep','too-deep',row.id)}))).status,400);
 const parent=clean(data.categories.find(c=>c.id==='lighting'));
 assert.equal((await route.DELETE(req('DELETE',{kind:'category',expected:parent}))).status,409);
 assert.equal((await route.DELETE(req('DELETE',{kind:'category',expected:row}))).status,200);
});
test('used records are protected; no endpoint can reassign products',async()=>{
 await db.exec("INSERT INTO product_catalog_assignments VALUES('existing','accessories'); INSERT INTO product_catalog_vehicle_types VALUES('existing','auto');");
 const data=await snapshot(),category=data.categories.find(c=>c.id==='accessories'),vehicle=data.vehicleTypes.find(v=>v.id==='auto');
 assert.equal(category.usage.products,1);assert.equal(vehicle.usage.products,1);
 assert.equal((await route.DELETE(req('DELETE',{kind:'category',expected:clean(category)}))).status,409);
 assert.equal((await route.DELETE(req('DELETE',{kind:'vehicle',expected:clean(vehicle)}))).status,409);
 assert.equal((await route.POST(req('POST',{kind:'category',value:cat('x','X','x'),reassignTo:'lighting'}))).status,400);
 assert.equal((await route.PATCH(req('PATCH',{kind:'vehicle',expected:clean(vehicle),value:{...clean(vehicle),id:'changed'}}))).status,400);
 const result=await db.query("SELECT category_id FROM product_catalog_assignments WHERE product_id='existing'");assert.equal(result.rows[0].category_id,'accessories');
});
test('configurable vehicle types support create/edit/delete; invalid data and duplicate slugs fail',async()=>{
 assert.equal((await route.POST(req('POST',{kind:'vehicle',value:{id:'fake',name:'Tractor',sort_order:80,active:true}}))).status,201);
 const data=await snapshot(),row=clean(data.vehicleTypes.find(v=>v.name==='Tractor'));
 assert.equal((await route.PATCH(req('PATCH',{kind:'vehicle',expected:row,value:{...row,name:'Renamed tractor',sort_order:1,active:false}}))).status,200);
 const current=clean((await snapshot()).vehicleTypes.find(v=>v.id===row.id));
 assert.equal((await route.DELETE(req('DELETE',{kind:'vehicle',expected:current}))).status,200);
 assert.equal((await route.POST(req('POST',{kind:'category',value:cat('x','Duplicate','accesorios')}))).status,409);
 assert.equal((await route.POST(req('POST',{kind:'vehicle',value:{...row,sort_order:-1}}))).status,400);
 assert.equal((await route.POST(req('POST',{kind:'vehicle',value:{...row,stock:99}}))).status,400);
 await db.exec('RESET ROLE');try{assert.deepEqual((await db.query('SELECT * FROM products')).rows,[{id:'existing',category:'Auxiliar',stock:5}]);}finally{await db.exec('SET ROLE service_role');}
});
