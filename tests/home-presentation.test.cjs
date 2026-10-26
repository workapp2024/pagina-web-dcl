const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const load=require('./load-ts.cjs');
const {defaultHomePresentation:defaults,validateHomePresentation,readHomePresentation}=load('lib/home-presentation.ts');
const {buildSiteSettingsPatch}=load('lib/site-settings-patch.ts');
const item=(id,enabled=true)=>({id,question:`Pregunta ${id}`,answer:'Respuesta aprobada\nSegunda línea',enabled});

test('saved presentation round-trips ordered questions and affects only its own columns',()=>{
  const draft={...defaults,faqEnabled:true,faqItems:[item('second'),item('first',false)],homePaymentEnabled:true,homePaymentImage:'https://cdn.example/image.png'};
  const patch=buildSiteSettingsPatch('homePresentation',draft);
  assert.deepEqual(JSON.parse(JSON.stringify(readHomePresentation(patch))),draft);
  assert.deepEqual(Object.keys(patch).sort(),['faq_enabled','faq_items','home_payment_enabled','home_payment_image','home_payment_title']);
  assert.throws(()=>buildSiteSettingsPatch('homePresentation',{...draft,transferAlias:'unrelated'}));
  assert.throws(()=>buildSiteSettingsPatch('payments',draft));
  assert.equal(readHomePresentation(null).faqEnabled,false);
  assert.equal(readHomePresentation(null).faqItems.length,0);
});
test('invalid, excessive, duplicated questions and unsafe image URLs cannot be saved',()=>{
  for(const patch of [{faqItems:[item('a'),item('a')]},{faqItems:[{...item('a'),answer:''}]},{faqItems:Array.from({length:31},(_,i)=>item(String(i)))},{homePaymentImage:'javascript:alert(1)'},{homePaymentImage:'data:image/png;base64,x'},{faqEnabled:'true'}]) assert.throws(()=>validateHomePresentation({...defaults,...patch}));
});
test('public FAQ is collapsed, escaped, ordered and hides disabled or empty sections',()=>{
  const {HomeFaq,HomePaymentImage}=load('components/sections/HomePresentation.tsx');
  const render=(component,settings)=>renderToStaticMarkup(React.createElement(component,{settings}));
  assert.equal(render(HomeFaq,defaults),'');
  const html=render(HomeFaq,{...defaults,faqEnabled:true,faqItems:[item('second'),item('first'),item('hidden',false)]});
  assert.ok(html.indexOf('Pregunta second')<html.indexOf('Pregunta first'));assert.doesNotMatch(html,/Pregunta hidden|<details[^>]* open/);
  assert.match(render(HomeFaq,{...defaults,faqEnabled:true,faqItems:[{...item('a'),answer:'<script>alert(1)</script>'}]}),/&lt;script&gt;/);
  assert.equal(render(HomePaymentImage,{...defaults,homePaymentEnabled:true}),'');
  const image=render(HomePaymentImage,{...defaults,homePaymentEnabled:true,homePaymentImage:'https://cdn.example/transparent.png'});
  assert.match(image,/object-contain/);assert.match(image,/h-auto/);assert.doesNotMatch(image,/object-cover|<button/);
});
test('Home reorders existing finder and checkout reuses compact image without legacy payment badges',()=>{
  const home=fs.readFileSync('app/page.tsx','utf8');
  const tags=['<Hero','<VehicleSelector','<PremiumProducts','<Promotions','<HomePaymentImage','<WholesaleCTA','<DclMusic','<WorkGallery','<HomeFaq','<FinalCTA','<Footer'];
  for(let i=1;i<tags.length;i++)assert.ok(home.indexOf(tags[i])>home.indexOf(tags[i-1]),tags[i]);
  assert.equal((home.match(/<VehicleSelector/g)||[]).length,1);
  assert.doesNotMatch(home,/<PaymentMethods/);
  const checkout=fs.readFileSync('app/checkout/page.tsx','utf8');
  assert.doesNotMatch(checkout, /<PaymentMethods/);
  assert.match(checkout, /HomePaymentImage settings=\{settings\} compact/);
  assert.doesNotMatch(checkout, /enabledMethods|MERCADOPAGO_ACCESS_TOKEN/);
});
test('admin read is protected; unavailable migration cannot appear as a successful empty configuration',async()=>{
  let allowed=false,failed=false,calls=0;
  const route=load('app/api/admin/home-presentation/route.ts',{
    '@/lib/admin-auth':{isAdminAuthenticated:async()=>allowed},
    '@/lib/supabase/server':{createAdminServerClient:()=>{calls++;const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:failed?null:{faq_items:[item('a')],faq_enabled:true},error:failed?{}:null})};return{from:()=>q};}},
  });
  assert.equal((await route.GET()).status,401);assert.equal(calls,0);allowed=true;
  const r=await route.GET();assert.equal(r.status,200);assert.equal((await r.json()).settings.faqItems[0].id,'a');failed=true;assert.equal((await route.GET()).status,503);
});
test('existing upload preserves original transparent PNG bytes and content type',async()=>{
  const sharp=require('sharp');const bytes=await sharp({create:{width:2,height:2,channels:4,background:{r:255,g:0,b:0,alpha:0}}}).png().toBuffer();
  let uploaded;
  const route=load('app/api/admin/upload/route.ts',{
    '@/lib/admin-auth':{isAdminAuthenticated:async()=>true},'@/lib/rate-limit':{rateLimit:()=>null},
    '@/lib/supabase/server':{isServiceRoleConfigured:()=>true,createAdminServerClient:()=>({storage:{from:()=>({upload:async(path,file,options)=>{uploaded={bytes:Buffer.from(await file.arrayBuffer()),options};return{data:{path},error:null};}})}})},
    '@/lib/supabase/storage':{STORAGE_BUCKET:'dcl-media',validateImageFile:()=>({valid:true}),generateStoragePath:()=> 'site/test.png',getStoragePublicUrl:()=> 'https://cdn.example/test.png'},
  }, { File });
  const form=new FormData();form.append('file',new File([bytes],'test.png',{type:'image/png'}));form.append('category','site');
  assert.equal((await route.POST(new Request('https://test.invalid',{method:'POST',body:form}))).status,200);
  assert.deepEqual(uploaded.bytes,bytes);assert.equal(uploaded.options.contentType,'image/png');assert.equal((await sharp(uploaded.bytes).metadata()).hasAlpha,true);
});

test('editor adds, edits, orders, hides, deletes and saves FAQ with image preview before upload',async()=>{
  let state=[],refs=[],cursor=0,refCursor=0,effect,saved={...defaults},uploads=0;
  const mockReact={...React,useState:initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useRef:initial=>refs[refCursor++]??(refs[refCursor-1]={current:initial}),useEffect:callback=>{effect=callback;}};
  const calls=[];
  class PreviewURL extends URL {static createObjectURL(){return 'blob:isolated-preview';}static revokeObjectURL(){}}
  const {HomePresentationEditor}=load('components/admin/HomePresentationEditor.tsx',{
    react:mockReact,
    '@/lib/supabase/site-settings':{upsertSupabaseSiteSettings:async(value,section)=>{saved=JSON.parse(JSON.stringify(value));calls.push({value:saved,section});return{success:true};}},
    '@/lib/supabase/storage':{MAX_FILE_SIZE_BYTES:10485760},
  },{FormData,URL:PreviewURL,crypto:require('node:crypto'),window:{confirm:()=>true},fetch:async(url)=>{
    if(url==='/api/admin/home-presentation')return Response.json({settings:saved});
    assert.equal(url,'/api/admin/upload');uploads++;return Response.json({publicUrl:'https://cdn.example/upload.png'});
  }});
  const render=()=>{cursor=0;refCursor=0;return HomePresentationEditor();};
  const text=node=>node==null?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
  const all=(node,predicate)=>node==null?[]:Array.isArray(node)?node.flatMap(n=>all(n,predicate)):typeof node==='object'?[...(predicate(node)?[node]:[]),...all(node.props?.children,predicate)]:[];
  const find=(type,label)=>{const found=all(render(),n=>n.type===type&&text(n)===label)[0];assert.ok(found,`${type}: ${label}`);return found;};
  const click=label=>find('button',label).props.onClick();
  const edit=(label,value)=>{const container=find('label',label);const control=all(container,n=>n.type==='input'||n.type==='textarea')[0];control.props.onChange({target:{value,checked:value}});};
  render();effect();await new Promise(resolve=>setTimeout(resolve,0));
  click('Agregar pregunta');edit('Pregunta 1','Compatibilidad');edit('Respuesta','Consultar con DCL');edit('Pregunta visible',true);
  click('Agregar pregunta');edit('Pregunta 2','Otra pregunta');
  const answers=all(render(),n=>n.type==='textarea');answers[1].props.onChange({target:{value:'Otra respuesta'}});
  find('button','Bajar').props.onClick();
  edit('Mostrar sección en la Home',true);
  click('Vista previa');assert.ok(all(render(),n=>n.type==='button'&&text(n)==='Cerrar vista previa').length);
  const fileControl=all(render(),n=>n.type==='input'&&n.props.type==='file')[0];
  fileControl.props.onChange({target:{files:[new File(['png'],'test.png',{type:'image/png'})],value:'test.png'}});
  assert.equal(uploads,0);assert.ok(all(render(),n=>n.type==='img'&&n.props.src==='blob:isolated-preview').length);
  click('Guardar cambios');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(uploads,1);assert.equal(saved.faqItems[0].question,'Otra pregunta');assert.equal(saved.faqItems[1].enabled,true);assert.equal(saved.homePaymentImage,'https://cdn.example/upload.png');assert.equal(calls[0].section,'homePresentation');
  find('button','Eliminar pregunta').props.onClick();click('Guardar cambios');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(saved.faqItems.length,1);
  click('Quitar imagen');click('Guardar cambios');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(saved.homePaymentImage,'');assert.equal(uploads,1);
  state=[];refs=[];render();effect();await new Promise(resolve=>setTimeout(resolve,0));assert.ok(find('label','Pregunta 1'));assert.equal(all(render(),n=>n.type==='textarea')[0].props.value,'Consultar con DCL');
});
