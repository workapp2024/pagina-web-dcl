const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=require('./load-ts.cjs');
const {heroPresentation}=load('lib/hero-presentation.ts');
test('legacy, empty mobile and focal defaults retain the desktop image',()=>{
  const old={heroImage:'https://example.test/desktop.jpg'};
  const image=heroPresentation(old);
  assert.equal(image.mobile,image.desktop);
  assert.equal(image.desktopPosition,'50% 50%');
  assert.equal(heroPresentation({...old,heroMobileImage:''}).mobile,image.desktop);
  assert.equal(heroPresentation({...old,heroMobileImage:'data:unsafe',heroFocalX:200}).desktopPosition,'50% 50%');
  assert.equal(heroPresentation({...old,heroMobileImage:'https://example.test/mobile.jpg',heroMobileFocalX:20,heroMobileFocalY:80}).mobilePosition,'20% 80%');
});
test('picture selects one mobile source with desktop fallback and preserves breakpoint',()=>{
  const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
  const {HeroImage}=load('components/sections/HeroImage.tsx',{'./HeroImage.module.css':{default:{image:'hero-image'}}});
  const html=renderToStaticMarkup(React.createElement(HeroImage,{settings:{heroImage:'https://example.test/desktop.jpg',heroMobileImage:'https://example.test/mobile.jpg'}}));
  assert.match(html,/<picture/);assert.match(html,/media="\(max-width: 767px\)"/);
  assert.equal((html.match(/<img /g)||[]).length,1);
  assert.match(fs.readFileSync('components/sections/HeroImage.module.css','utf8'), /@media \(max-width: 767px\)/);
});
test('home settings denies unauthorized users, validates focal points and preserves omitted fields',async()=>{
  let role=null;let writes=0;let saved;let dbError=null;
  const {hasAdminPermission}=load('lib/admin-permissions.ts');
  const {POST}=load('app/api/admin/home-settings/route.ts',{
    '@/lib/admin-auth':{isAdminAuthenticated:async permission=>Boolean(role && hasAdminPermission(role,permission))},
    '@/lib/supabase/server':{isServiceRoleConfigured:()=>true,createAdminServerClient:()=>({from(){writes++;return {upsert(row){saved=row;return {select:()=>({single:async()=>({data:row,error:dbError})})}}}}})},
  });
  const request=body=>new Request('https://local.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({homeSettings:body})});
  assert.equal((await POST(request({heroMobileImage:'https://example.test/m.jpg'}))).status,401);assert.equal(writes,0);
  role='VENDEDOR';
  assert.equal((await POST(request({heroMobileImage:'https://example.test/m.jpg'}))).status,401);assert.equal(writes,0);
  role='ADMIN';
  assert.equal((await POST(request({heroFocalX:101}))).status,400);assert.equal(writes,0);
  assert.equal((await POST(request({heroMobileImage:'blob:bad'}))).status,400);
  assert.equal((await POST(request({heroImage:'https://example.test/old.jpg'}))).status,200);
  assert.equal(Object.hasOwn(saved,'hero_mobile_image_url'),false);
  assert.equal((await POST(request({heroImage:'https://example.test/old.jpg',heroMobileImage:'',heroFocalX:0,heroMobileFocalY:100}))).status,200);
  assert.equal(saved.hero_image_url,'https://example.test/old.jpg');assert.equal(saved.hero_mobile_image_url,'');assert.equal(saved.hero_focal_x,0);
  dbError={message:'column hero_mobile_image_url does not exist'};
  const unavailable=await POST(request({heroMobileImage:'https://example.test/m.jpg'}));
  assert.equal(unavailable.status,500);assert.match((await unavailable.json()).error,/migración autorizada/);
});
test('migration and rollback preserve existing desktop settings in isolated PostgreSQL',async()=>{
  const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
  try{
    await db.exec("CREATE TABLE home_settings(id integer PRIMARY KEY,hero_image_url text); INSERT INTO home_settings VALUES(1,'original.jpg');");
    const sql=fs.readFileSync('supabase/migrations/20261121123355_hero_responsive.sql','utf8');
    await db.exec(sql);await db.exec(sql);
    let row=(await db.query('SELECT * FROM home_settings')).rows[0];
    assert.equal(row.hero_image_url,'original.jpg');assert.equal(row.hero_mobile_image_url,'');assert.equal(row.hero_focal_x,50);
    await assert.rejects(db.exec('UPDATE home_settings SET hero_focal_x=101'));
    await db.exec(fs.readFileSync('scripts/maintenance/rollback-hero-responsive.sql','utf8'));
    row=(await db.query('SELECT * FROM home_settings')).rows[0];assert.deepEqual(row,{id:1,hero_image_url:'original.jpg'});
  }finally{await db.close();}
});

test('saved desktop and mobile URLs and independent focal points survive the actual home reader', async () => {
  let row;
  const client = {
    from(table) {
      assert.equal(table, 'home_settings');
      return {
        upsert(value) {
          row = { ...row, ...value };
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
        select: () => ({
          eq: (key, value) => {
            assert.equal(key, 'id');
            assert.equal(value, 1);
            return { maybeSingle: async () => ({ data: row, error: null }) };
          },
        }),
      };
    },
  };
  const mocks = {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => true },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => client },
    './server': { createServerClient: () => client },
    './client': { createBrowserClient: () => { throw Error('Expected server reader'); } },
    './test-connection': { isSupabaseConfigured: () => true },
    './storage': { sanitizeStoredImageUrl: value => value || '' },
  };
  const { POST } = load('app/api/admin/home-settings/route.ts', mocks);
  const { getSupabaseHomeSettings } = load('lib/supabase/home-settings.ts', mocks);
  const settings = {
    heroImage: 'https://example.test/desktop.jpg',
    heroMobileImage: 'https://example.test/mobile.jpg',
    heroFocalX: 10, heroFocalY: 25,
    heroMobileFocalX: 80, heroMobileFocalY: 65,
  };
  const save = value => POST(new Request('https://local.test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ homeSettings: value }),
  }));
  assert.equal((await save(settings)).status, 200);
  let recovered = await getSupabaseHomeSettings();
  for (const key of Object.keys(settings)) assert.equal(recovered[key], settings[key], key);
  assert.equal(heroPresentation(recovered).desktopPosition, '10% 25%');
  assert.equal(heroPresentation(recovered).mobilePosition, '80% 65%');

  assert.equal((await save({ ...settings, heroMobileImage: '' })).status, 200);
  recovered = await getSupabaseHomeSettings();
  assert.equal(recovered.heroMobileImage, '');
  assert.equal(heroPresentation(recovered).mobile, settings.heroImage);
  assert.equal(heroPresentation(recovered).mobilePosition, '80% 65%');

  row = { id: 1, hero_image_url: settings.heroImage };
  recovered = await getSupabaseHomeSettings();
  assert.equal(recovered.heroImage, settings.heroImage);
  assert.equal(recovered.heroMobileImage, '');
  assert.equal(heroPresentation(recovered).desktopPosition, '50% 50%');
  assert.equal(heroPresentation(recovered).mobilePosition, '50% 50%');
});
