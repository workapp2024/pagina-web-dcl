const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const load=require('./load-ts.cjs');
const category={id:'lighting',name:'Lighting',description:'Example',slug:'lighting',parent_id:null,sort_order:10,active:true,form_profile:'lighting',usage:{products:1,children:0,aliases:0}};
const vehicle={id:'universal',name:'Universal',sort_order:60,active:true,usage:{products:0}};
function harness(){
 const states=[[category],[vehicle],'category','',false,false,'','',null,null,''];const requests=[];let cursor=0;
 const {CatalogFoundationManager}=load('components/admin/CatalogFoundationManager.tsx',{
  react:{...React,useEffect(){},useCallback:fn=>fn,useRef:value=>({current:value}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];}},
  '@/components/admin/ProductEditorDialog':{ProductEditorDialog:({children})=>React.createElement('section',{},children)},
 },{fetch:async(url,options={})=>{assert.equal(url,'/api/admin/catalog-foundation');requests.push(options);return Response.json({ok:true,categories:[category],vehicleTypes:[vehicle]});}});
 return {requests,render:()=>{cursor=0;return CatalogFoundationManager();}};
}
const text=node=>node==null?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
const all=(node,predicate)=>node==null?[]:Array.isArray(node)?node.flatMap(n=>all(n,predicate)):typeof node==='object'?[...(predicate(node)?[node]:[]),...all(node.props?.children,predicate)]:[];
const button=(tree,label)=>all(tree,n=>n.type==='button'&&text(n)===label)[0];
test('admin cards explain isolation and block deletion of used categories',()=>{
 const h=harness(),tree=h.render();const html=renderToStaticMarkup(tree);
 assert.match(html,/Lighting/);assert.match(html,/no se reasignan productos/);assert.equal(button(tree,'Eliminar').props.disabled,true);
 assert.ok(button(tree,'Editar'));assert.ok(button(tree,'Desactivar'));assert.ok(button(tree,'+ Subcategor\u00eda'.replace('\u00ed','í')));
});
test('editing submits only catalog fields and original snapshot, never product assignments',async()=>{
 const h=harness();button(h.render(),'Editar').props.onClick();
 const tree=h.render(),form=all(tree,n=>n.type==='form')[0];assert.ok(form);
 const labels=all(tree,n=>n.type==='label');const order=labels.find(n=>text(n).includes('Orden de visualizaci'));const input=all(order,n=>n.type==='input')[0];input.props.onChange({target:{value:'3'}});
 all(h.render(),n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
 await new Promise(resolve=>setTimeout(resolve,0));
 const write=h.requests.find(r=>r.method==='PATCH');assert.ok(write);const body=JSON.parse(write.body);
 assert.equal(body.kind,'category');assert.equal(body.value.sort_order,3);assert.equal(body.expected.sort_order,10);assert.equal(body.value.id,'lighting');assert.equal('usage' in body.value,false);assert.equal('product_id' in body.value,false);
});
test('vehicle tab offers configurable creation and Universal explanation',()=>{
 const h=harness();const first=h.render();const tab=all(first,n=>n.type==='button'&&text(n).startsWith('Tipos de veh'))[0];tab.props.onClick();
 const tree=h.render();assert.match(renderToStaticMarkup(tree),/Universal es un destino comercial excluyente/);assert.ok(button(tree,'+ Crear tipo'));assert.equal(button(tree,'Eliminar').props.disabled,false);
});

test('admin page uses server flag and checks ADMIN before rendering management UI',async()=>{
 let allowed=false;const env={DCL_CATALOG_ADMIN_ENABLED:'1'};const Manager=()=>null;
 const {default:Page}=load('app/admin/catalogo-configurable/page.tsx',{
  'next/navigation':{redirect:url=>{throw Error('redirect:'+url);}},
  '@/lib/admin-auth':{isAdminAuthenticated:async permission=>{assert.equal(permission,'admin');return allowed;}},
  '@/components/admin/CatalogFoundationManager':{CatalogFoundationManager:Manager},
 },{process:{env}});
 await assert.rejects(Page(),/redirect:\/admin\/login/);allowed=true;env.DCL_CATALOG_ADMIN_ENABLED='0';
 const disabled=renderToStaticMarkup(await Page());assert.match(disabled,/no habilitada/);
 env.DCL_CATALOG_ADMIN_ENABLED='1';assert.equal((await Page()).type,Manager);
});
