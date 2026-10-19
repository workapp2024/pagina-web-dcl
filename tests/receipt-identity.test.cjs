const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),React=require('react'),sharp=require('sharp');
const {renderToStaticMarkup}=require('react-dom/server'),load=require('./load-ts.cjs');
const identity=load('lib/receipt-identity.ts'),defaults=identity.DEFAULT_RECEIPT_IDENTITY;
const asset='site/receipt-identity/12345678-1234-4123-8123-123456789abc.png';
const clone=()=>({...defaults});
test('strict visual settings accept independent logos, colors and safe opacity without arbitrary URLs',()=>{
 const custom={...clone(),mainLogo:asset,watermarkLogo:null,watermarkSize:100,watermarkOpacity:0,background:'#ffffff',accent:'#163b69',watermarkTone:'monochrome'};
 assert.equal(identity.parseReceiptIdentity(custom).mainLogo,asset);
 for(const change of [{mainLogo:'https://evil.test/a.svg'},{watermarkLogo:'../../secret'},{watermarkOpacity:NaN},{watermarkOpacity:.31},{watermarkSize:101},{background:'#000000'},{accent:'#eeeeee'},{extra:true},{watermarkTone:'javascript'}])assert.throws(()=>identity.parseReceiptIdentity({...clone(),...change}));
 for(const color of ['#f0f1f3','#ffffff','#eef2f6'])assert.equal(identity.parseReceiptIdentity({...clone(),background:color}).background,color);
 assert.equal(identity.receiptLogoSource(null),null);assert.equal(identity.receiptLogoSource('https://bad'),null);assert.match(identity.receiptLogoSource(asset,true),/tone=monochrome/);
});
test('real PNG transparency survives normalization; JPG is decoded as a safe static PNG',async()=>{
 const {normalizeReceiptLogo}=load('lib/receipt-logo.ts');
 const png=await sharp({create:{width:20,height:10,channels:4,background:{r:200,g:10,b:10,alpha:.25}}}).png().toBuffer();
 const normalized=await normalizeReceiptLogo(png,'image/png');const meta=await sharp(normalized).metadata();assert.equal(meta.hasAlpha,true);assert.equal(meta.width,20);assert.equal(meta.height,10);
 const raw=await sharp(normalized).raw().toBuffer();assert.ok(raw[3]>=63&&raw[3]<=64);
 const jpg=await sharp({create:{width:30,height:20,channels:3,background:'#335577'}}).jpeg().toBuffer();
 assert.equal((await sharp(await normalizeReceiptLogo(jpg,'image/jpeg')).metadata()).format,'png');
 for(const [bytes,mime] of [[Buffer.from('<svg/>'),'image/svg+xml'],[png,'image/jpeg'],[Buffer.from('invalid'),'image/png'],[new Uint8Array(2097153),'image/png']])await assert.rejects(normalizeReceiptLogo(bytes,mime));
 const wide=await sharp({create:{width:4097,height:1,channels:3,background:'#fff'}}).png().toBuffer();await assert.rejects(normalizeReceiptLogo(wide,'image/png'));
});
function store(initial=null){
 let saved=initial, failure=null;const updates=[];
 const client={from(table){assert.equal(table,'site_settings');let patch,expected,missing=false;return {
 select(columns){assert.equal(columns,'receipt_identity');return this;},eq(key,value){if(key==='id')assert.equal(value,1);else {assert.equal(key,'receipt_identity->>revision');expected=value;}return this;},
 is(key,value){assert.equal(key,'receipt_identity');assert.equal(value,null);missing=true;return this;},update(value){patch=value;updates.push(value);return this;},
 async maybeSingle(){if(failure)return {data:null,error:failure};if(patch){if((missing&&saved!==null)||(expected&&saved?.revision!==expected))return {data:null,error:null};saved=JSON.parse(JSON.stringify(patch.receipt_identity));}return {data:{receipt_identity:saved},error:null};}
 };}};
 const mocks={'@/lib/supabase/server':{createAdminServerClient:()=>client}};
 return {mocks,updates,get value(){return saved;},set error(value){failure=value;}};
}
test('settings persist across independent readers; compare-and-set prevents concurrent overwrites and only updates the new field',async()=>{
 const db=store(),a=load('lib/receipt-identity-server.ts',db.mocks),b=load('lib/receipt-identity-server.ts',db.mocks);
 assert.equal((await a.readReceiptIdentity()).revision,null);
 const result=await a.saveReceiptIdentity({...clone(),mainLogo:asset},null);assert.ok(result.revision);
 assert.equal((await b.readReceiptIdentity()).settings.mainLogo,asset);
 assert.equal(await b.saveReceiptIdentity(clone(),null),null);
 const second=await b.saveReceiptIdentity({...clone(),watermarkLogo:null},result.revision);assert.ok(second);
 assert.equal(await a.saveReceiptIdentity(clone(),result.revision),null);
 assert.ok(db.updates.every(row=>Object.keys(row).join()==='receipt_identity'));
 await assert.rejects(a.saveReceiptIdentity(clone(),undefined));
});
test('missing column preserves existing design; failed reads cannot export a misleading configured receipt',async()=>{
 const db=store(),helper=load('lib/receipt-identity-server.ts',db.mocks);
 db.error={code:'42703'};assert.equal((await helper.readReceiptIdentity()).available,false);
 const receipt={status:'ok',receipt:{total:100,pendingAmount:60,confirmedPaid:40}};
 const legacy=await helper.withReceiptIdentity(receipt);assert.equal(legacy.receipt.total,100);assert.equal(legacy.receipt.visual.background,defaults.background);
 db.error={code:'NETWORK'};assert.equal((await helper.withReceiptIdentity(receipt)).status,'incident');
 assert.equal((await helper.withReceiptIdentity({status:'not_found',message:'missing'})).status,'not_found');
});
test('settings endpoints enforce ADMIN, origin, validation, conflict and no-store before persistence',async()=>{
 let authorized=false,origin=false,reads=0,writes=0,conflict=false;
 const mocks={'@/lib/admin-auth':{isAdminAuthenticated:async()=>authorized},'@/lib/wholesale-session-origin':{isWholesaleSessionWriteAllowed:()=>origin},'@/lib/rate-limit':{rateLimit:()=>null},'@/lib/receipt-identity-server':{readReceiptIdentity:async()=>{reads++;return {settings:clone(),revision:null,available:true};},saveReceiptIdentity:async()=>{writes++;return conflict?null:{settings:clone(),revision:'revision',available:true};}}};
 const api=load('app/api/admin/receipt-identity/route.ts',mocks),req=(settings=clone())=>new Request('https://dcl.invalid/api',{method:'POST',body:JSON.stringify({settings,revision:null})});
 assert.equal((await api.GET()).status,401);assert.equal((await api.POST(req())).status,401);assert.equal(reads,0);
 authorized=true;assert.equal((await api.POST(req())).status,403);origin=true;
 assert.equal((await api.POST(req({...clone(),background:'#000000'}))).status,400);assert.equal(writes,0);
 assert.equal((await api.POST(req())).status,200);conflict=true;assert.equal((await api.POST(req())).status,409);
 assert.match((await api.GET()).headers.get('cache-control'),/no-store/);
});
test('logo upload and image routes deny unauthorized requests before parsing or storage',async()=>{
 let reads=0;const mocks={'@/lib/admin-auth':{isAdminAuthenticated:async()=>false},'@/lib/supabase/server':{createAdminServerClient(){reads++;throw Error('unexpected');}},'@/lib/wholesale-session-origin':{isWholesaleSessionWriteAllowed:()=>true},'@/lib/rate-limit':{rateLimit:()=>null}};
 assert.equal((await load('app/api/admin/receipt-identity/logo/route.ts',mocks).POST(new Request('https://dcl.invalid'))).status,401);
 assert.equal((await load('app/api/admin/receipt-identity/image/route.ts',mocks).GET(new Request('https://dcl.invalid?asset=default'))).status,401);assert.equal(reads,0);
});
test('authorized upload normalizes to immutable PNG in the existing bucket; no settings or commercial writes',async()=>{
 const png=await sharp({create:{width:10,height:10,channels:4,background:{r:255,g:0,b:0,alpha:.5}}}).png().toBuffer();let uploads=0;
 const mocks={'@/lib/admin-auth':{isAdminAuthenticated:async()=>true},'@/lib/wholesale-session-origin':{isWholesaleSessionWriteAllowed:()=>true},'@/lib/rate-limit':{rateLimit:()=>null},'@/lib/supabase/server':{createAdminServerClient:()=>({storage:{from(bucket){assert.equal(bucket,'dcl-media');return {async upload(path,bytes,options){uploads++;assert.match(path,identity.RECEIPT_ASSET);assert.equal(options.upsert,false);assert.equal(options.contentType,'image/png');assert.equal((await sharp(bytes).metadata()).hasAlpha,true);return {error:null};}};}}})}};
 const api=load('app/api/admin/receipt-identity/logo/route.ts',mocks,{File});
 const form=new FormData();form.set('file',new File([png],'transparent.png',{type:'image/png'}));
 const response=await api.POST(new Request('https://dcl.invalid',{method:'POST',body:form}));assert.equal(response.status,200);assert.match((await response.json()).path,identity.RECEIPT_ASSET);assert.equal(uploads,1);
 const bad=new FormData();bad.set('file',new File(['<svg/>'],'a.svg',{type:'image/svg+xml'}));assert.equal((await api.POST(new Request('https://dcl.invalid',{method:'POST',body:bad}))).status,400);assert.equal(uploads,1);
});
test('authenticated image proxy preserves alpha and applies the same monochrome conversion for preview and PDF',async()=>{
 const png=await sharp({create:{width:10,height:10,channels:4,background:{r:200,g:30,b:10,alpha:.5}}}).png().toBuffer();let downloads=0;
 const mocks={'@/lib/admin-auth':{isAdminAuthenticated:async permission=>{assert.equal(permission,'commercial');return true;}},'@/lib/supabase/server':{createAdminServerClient:()=>({storage:{from:()=>({download:async path=>{assert.equal(path,asset);downloads++;return {data:new Blob([png]),error:null};}})}})}};
 const api=load('app/api/admin/receipt-identity/image/route.ts',mocks);
 assert.equal((await api.GET(new Request('https://dcl.invalid?asset=../../secret'))).status,400);assert.equal(downloads,0);
 const response=await api.GET(new Request('https://dcl.invalid?asset='+encodeURIComponent(asset)+'&tone=monochrome'));
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.match(response.headers.get('cache-control'),/private/);
 const bytes=Buffer.from(await response.arrayBuffer()),raw=await sharp(bytes).raw().toBuffer();assert.equal(raw[0],raw[1]);assert.equal(raw[1],raw[2]);assert.ok(raw[3]>=127&&raw[3]<=128);
});
test('one renderer uses configured visual settings for both sectors without changing payment information',()=>{
 const css='@/app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css',styles=new Proxy({},{get:(_,k)=>k==='__esModule'?false:k});
 const {OrderReceipt}=load('components/admin/OrderReceipt.tsx',{[css]:styles,'next/image':props=>{const copy={...props};delete copy.unoptimized;return React.createElement('img',copy);}});
 const receipt={orderNumber:'MW-000007',soldAt:'2026-10-18T12:00:00Z',customerName:'Ejemplo',currency:'ARS',total:100,paymentMethod:'Transferencia',paymentStatus:'Pago parcial',status:'valid',confirmedPaid:40,refundedAmount:0,pendingAmount:60,items:[{name:'Producto',quantity:2,unitPrice:50,lineTotal:100}],visual:{...clone(),mainLogo:null,watermarkLogo:asset,watermarkTone:'monochrome',watermarkSize:70,watermarkOpacity:.1,background:'#eef2f6',accent:'#163b69'}};
 for(const kind of ['order',undefined]){const html=renderToStaticMarkup(React.createElement(OrderReceipt,{receipt:{...receipt,kind}}));assert.match(html,/background-color:#eef2f6/);assert.match(html,/--receipt-accent:#163b69/);assert.match(html,/--watermark-size:70%/);assert.match(html,/--watermark-opacity:0.1/);assert.match(html,/tone=monochrome/);assert.match(html,/No es factura fiscal/);assert.match(html,/Pago parcial/);assert.doesNotMatch(html,/no acredita|no confirma|Logo DCL|>Pagado</i);if(kind)assert.match(html,/Saldo pendiente/);}
});
test('SQL proposal is additive, idempotent, preserves rows and stops if write policies differ',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
 await db.exec('CREATE TABLE public.site_settings(id int primary key, logo_url text); ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY; INSERT INTO public.site_settings VALUES (1,\'original\');');
 const sql=fs.readFileSync('scripts/maintenance/proposed-receipt-identity.sql','utf8');
 await db.exec(sql);await db.exec(sql);assert.equal((await db.query('select * from site_settings')).rows[0].logo_url,'original');
 assert.equal((await db.query('select receipt_identity from site_settings')).rows[0].receipt_identity,null);
 await assert.rejects(db.exec(`UPDATE site_settings SET receipt_identity='{}'`));
 const envelope=JSON.stringify({version:1,revision:'12345678-1234-4123-8123-123456789abc',settings:clone()});
 const race=await Promise.all([1,2].map(()=>db.query('UPDATE site_settings SET receipt_identity=$1::jsonb WHERE id=1 AND receipt_identity IS NULL RETURNING id',[envelope])));assert.equal(race.reduce((n,r)=>n+r.rows.length,0),1);
 await db.exec('CREATE POLICY unexpected_write ON site_settings FOR UPDATE USING(true);');await assert.rejects(db.exec(sql));await db.exec('ROLLBACK');await db.close();
});
