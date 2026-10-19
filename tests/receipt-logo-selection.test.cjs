const {test}=require('node:test'),assert=require('node:assert/strict'),load=require('./load-ts.cjs');
const defaults=load('lib/receipt-identity.ts').DEFAULT_RECEIPT_IDENTITY;
function harness(){
 const states=[],refs=[],effects=[],requests=[],revoked=[];let si=0,ri=0,first=true,uploadCount=0,saves=0,failUpload=0,failSave=false,failImage=false;
 let stored={settings:{...defaults,mainLogo:null,watermarkLogo:null},revision:null,available:true};
 const react={useState(initial){const i=si++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=ri++;return refs[i]??={current:initial};},useEffect(effect){if(first)effects.push(effect);}};
 let urls=0;const URLMock={createObjectURL:()=>`blob:local/${++urls}`,revokeObjectURL:url=>revoked.push(url)};
 const globals={URL:URLMock,File,FormData,window:{Image:class{async decode(){if(failImage)throw Error('image');}}},fetch:async(url,init={})=>{
  requests.push({url,method:init.method||'GET'});
  if(url.endsWith('/logo')){uploadCount++;if(failUpload===uploadCount)return new Response('too large',{status:413});return Response.json({path:`site/receipt-identity/12345678-1234-4123-8123-${String(uploadCount).padStart(12,'0')}.png`});}
  if(init.method==='POST'){saves++;if(failSave)return Response.json({error:'No se pudo guardar.'},{status:503});stored={settings:JSON.parse(init.body).settings,revision:'12345678-1234-4123-8123-123456789abc',available:true};}
  return Response.json(stored);
 }};
 const mocks={react,'next/image':()=>null,'@/components/admin/OrderReceipt':{OrderReceipt:()=>null},'@/lib/receipt-logo-client':{RECEIPT_LOGO_ORIGINAL_MAX_BYTES:5242880,prepareReceiptLogo:async file=>({file:new File(['normalized'],'DCL-logo.png',{type:'image/png'}),transparent:file.type==='image/png',width:1600,height:1600})}};
 const {ReceiptIdentitySettings}=load('components/admin/ReceiptIdentitySettings.tsx',mocks,globals);
 const render=()=>{si=0;ri=0;const tree=ReceiptIdentitySettings();first=false;return tree;};
 const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
 const settle=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
 const ready=async()=>{render();for(const effect of effects)effect();await settle();};
 const select=async(key,file)=>{nodes(render()).filter(n=>n.type==='input'&&n.props.type==='file')[key==='mainLogo'?0:1].props.onChange({target:{files:[file],value:'selected'}});await settle();};
 const click=async label=>{nodes(render()).find(n=>n.type==='button'&&n.props.children===label).props.onClick();await settle();};
 const text=()=>JSON.stringify(render(),(key,value)=>typeof value==='function'?undefined:value);
 return {ready,select,click,text,render,requests,revoked,get stored(){return stored;},get uploadCount(){return uploadCount;},get saves(){return saves;},set failUpload(value){failUpload=value;},set failSave(value){failSave=value;},set failImage(value){failImage=value;}};
}
test('selection previews independent local logos without upload; Save uploads both and persists their paths',async()=>{
 const h=harness();await h.ready();await h.select('mainLogo',new File(['png'],'Canva.png',{type:'image/png'}));assert.equal(h.uploadCount,0);assert.match(h.text(),/blob:local/);assert.match(h.text(),/Seleccionada, sin guardar/);assert.match(h.text(),/Transparencia comprobada/);
 await h.select('watermarkLogo',new File(['jpg'],'Agua.jpg',{type:'image/jpeg'}));assert.match(h.text(),/Imagen sin transparencia/);assert.equal(h.uploadCount,0);
 await h.click('Guardar cambios');assert.equal(h.uploadCount,2);assert.equal(h.saves,1);assert.notEqual(h.stored.settings.mainLogo,h.stored.settings.watermarkLogo);assert.match(h.text(),/Diseño guardado correctamente/);assert.doesNotMatch(h.text(),/Seleccionada, sin guardar/);assert.equal(h.revoked.length,4);
});
test('oversized originals and unsupported formats report inline errors and cannot silently save old logos',async()=>{
 const h=harness();await h.ready();await h.select('mainLogo',new File([new Uint8Array(5242881)],'grande.png',{type:'image/png'}));assert.match(h.text(),/5 MB/);assert.match(h.text(),/alert/);await h.click('Guardar cambios');assert.equal(h.saves,0);assert.equal(h.uploadCount,0);
 await h.select('mainLogo',new File(['svg'],'a.svg',{type:'image/svg+xml'}));assert.match(h.text(),/Otros formatos/);assert.equal(h.uploadCount,0);
});
test('partial upload failure never saves settings or claims success; retries reuse the first successful upload',async()=>{
 const h=harness();await h.ready();for(const key of ['mainLogo','watermarkLogo'])await h.select(key,new File(['png'],key+'.png',{type:'image/png'}));h.failUpload=2;
 await h.click('Guardar cambios');assert.equal(h.saves,0);assert.match(h.text(),/No se confirmó el guardado/);assert.match(h.text(),/su tamaño/);assert.match(h.text(),/Seleccionada, sin guardar/);
 await h.click('Guardar cambios');assert.equal(h.uploadCount,3);assert.equal(h.saves,1);assert.match(h.text(),/Diseño guardado correctamente/);
});
test('an inaccessible uploaded image cannot be persisted; a successful retry reuses its path',async()=>{
 const h=harness();await h.ready();await h.select('mainLogo',new File(['png'],'a.png',{type:'image/png'}));h.failImage=true;await h.click('Guardar cambios');assert.equal(h.saves,0);assert.match(h.text(),/no se puede recuperar/);
 h.failImage=false;await h.click('Guardar cambios');assert.equal(h.uploadCount,1);assert.equal(h.saves,1);
});
test('settings failure retains selection for retry; restoring defaults clears pending blobs without uploading',async()=>{
 const h=harness();await h.ready();await h.select('mainLogo',new File(['png'],'a.png',{type:'image/png'}));h.failSave=true;await h.click('Guardar cambios');assert.equal(h.saves,1);assert.match(h.text(),/No se confirmó/);assert.match(h.text(),/Seleccionada, sin guardar/);
 h.failSave=false;await h.click('Guardar cambios');assert.equal(h.uploadCount,1);assert.match(h.text(),/Diseño guardado correctamente/);
 await h.select('watermarkLogo',new File(['png'],'agua.png',{type:'image/png'}));await h.click('Restaurar diseño predeterminado');assert.equal(h.uploadCount,1);assert.doesNotMatch(h.text(),/agua.png/);
});
