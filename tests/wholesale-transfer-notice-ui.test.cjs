const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const load=require('./load-ts.cjs');
function nodes(tree){if(!tree||typeof tree!=='object')return [];return [tree,...React.Children.toArray(tree.props?.children).flatMap(nodes)];}
function text(tree){if(typeof tree==='string')return tree;return tree?.props?React.Children.toArray(tree.props.children).map(text).join(''):'';}
function harness({saveOk=true,pending=null,notices=[]}={}){
 const order={id:'11111111-1111-4111-8111-111111111111',order_number:'MW-TEST',status:'confirmed',currency:'ARS',items:[],payment_summary:{total:100,paid:0,due:100,canPay:true}};
 const states=[],refs=[],calls=[];let cursor=0,rc=0;
 const paymentData={summary:order.payment_summary,status:'confirmed',orderNumber:order.order_number,noticesEnabled:true,checkoutEnabled:true,availableDue:pending?0:100,notices,pendingCheckout:pending,transfer:{holder:'DCL',alias:'test.alias',whatsapp:'5492617791393'}};
 const react={...React,useState(initial){const i=cursor++;if(!(i in states))states[i]=i===0?true:i===1?paymentData:i===3?'transfer':i===4?'40':initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){return refs[rc++]??={current:initial};},useCallback:f=>f,useEffect(){}};
 const popup={opener:null,location:{set href(value){calls.push(['navigate',value]);}},close(){calls.push(['closed']);}};
 const {WholesaleOrderPayment}=load('components/wholesale/WholesaleOrderPayment.tsx',{react,'@/lib/client-uuid':{createClientUuid:()=> '22222222-2222-4222-8222-222222222222'}},{window:{confirm:()=>true,sessionStorage:{getItem:()=>null},open(){calls.push(['blank']);return popup;}},fetch:async(url,init)=>{
  if(init?.method==='POST'){calls.push(['save',JSON.parse(init.body)]);await Promise.resolve();calls.push(['saved',saveOk]);return Response.json(saveOk?{ok:true,notice:{status:'pending'}}:{error:'DCL no recibió el aviso.'},{status:saveOk?200:409});}
  return Response.json(paymentData);
 }});
 const render=()=>{cursor=0;rc=0;return WholesaleOrderPayment({order});};return {render,calls};
}
test('WhatsApp navigation happens only after server persistence, double clicks reuse one request',async()=>{
 const h=harness();const button=nodes(h.render()).find(n=>n.type==='button'&&text(n)==='Informar transferencia por WhatsApp');
 button.props.onClick();button.props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls.filter(c=>c[0]==='save').length,1);
 assert.ok(h.calls.findIndex(c=>c[0]==='navigate')>h.calls.findIndex(c=>c[0]==='saved'));
 assert.equal(h.calls.find(c=>c[0]==='save')[1].amount,40);
 assert.match(h.calls.find(c=>c[0]==='navigate')[1],/^https:\/\/wa.me\/5492617791393/);
});
test('failed persistence never navigates to WhatsApp or claims receipt',async()=>{
 const h=harness({saveOk:false});nodes(h.render()).find(n=>n.type==='button'&&text(n)==='Informar transferencia por WhatsApp').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls.some(c=>c[0]==='navigate'),false);assert.equal(h.calls.some(c=>c[0]==='closed'),true);
 assert.match(text(h.render()),/DCL no recibió el aviso/);
});
test('provider pending blocks another automatic amount and shows confirmation, not approval',()=>{
 const h=harness({pending:{id:'pending',amount:100,state:'pending',requested_amount:100,expires_at:'2099-01-01'}});
 const tree=h.render();assert.match(text(tree),/Estamos confirmando tu pago/);assert.doesNotMatch(text(tree),/Pago completo|Coordinar entrega/);
 assert.equal(nodes(tree).some(n=>n.props?.onSubmit),false);
});
