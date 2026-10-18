const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const load=require('./load-ts.cjs');
function nodes(tree){if(!tree||typeof tree!=='object')return [];return [tree,...React.Children.toArray(tree.props?.children).flatMap(nodes)];}
function text(tree){if(typeof tree==='string')return tree;if(typeof tree==='number')return String(tree);return tree?.props?React.Children.toArray(tree.props.children).map(text).join(''):'';}
function form(accounts=[{method:'bank_transfer',name:'Banco real'}],result=true){
  const states=[],refs=[],calls=[];let cursor=0,refCursor=0;
  const {WholesalePaymentForm}=load('components/admin/WholesalePaymentForm.tsx',{react:{useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){return refs[refCursor++]??=( {current:initial} );}}});
  const props={due:9880,currency:'ARS',saving:false,accounts,onPayment:async fields=>{calls.push(fields);return result;}};
  const render=()=>{cursor=0;refCursor=0;return WholesalePaymentForm(props);};
  const button=label=>nodes(render()).find(n=>n.type==='button'&&text(n)===label);
  const change=(type,value)=>nodes(render()).find(n=>n.type==='input'&&n.props.type===type).props.onChange({target:{value,checked:value}});
  const submit=()=>nodes(render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  return {render,button,change,submit,calls};
}
test('payment form starts folded; partial/full payment requires receipt verification and a configured account',async()=>{
  const h=form();assert.equal(nodes(h.render()).some(n=>n.type==='input'),false);
  h.button('Registrar pago').props.onClick();h.change('number','2000');
  await h.submit();assert.equal(h.calls.length,0);
  h.change('checkbox',true);await h.submit();assert.equal(h.calls[0].amount,2000);assert.equal(h.calls[0].method,'bank_transfer');
  h.button('Registrar pago').props.onClick();h.button('Cobrar todo').props.onClick();h.change('checkbox',true);await h.submit();assert.equal(h.calls[1].amount,9880);
  const missing=form([]);missing.button('Registrar pago').props.onClick();missing.button('Cobrar todo').props.onClick();missing.change('checkbox',true);await missing.submit();assert.equal(missing.calls.length,0);assert.match(text(missing.render()),/Falta configurar la cuenta/);
});
test('overpayment and fractional cents are rejected; uncertain retries preserve exact payload and suppress double click',async()=>{
  const h=form(undefined,false);h.button('Registrar pago').props.onClick();h.change('checkbox',true);
  h.change('number','9880.01');await h.submit();h.change('number','1.001');await h.submit();assert.equal(h.calls.length,0);
  h.change('number','500');await Promise.all([h.submit(),h.submit()]);assert.equal(h.calls.length,1);
  await h.submit();assert.deepEqual(h.calls[0],h.calls[1]);
  assert.equal(nodes(h.render()).find(n=>n.type==='fieldset').props.disabled,true);
});
test('posted cash and pending attribution are distinct from optional bank verification',()=>{
  const {wholesalePostingMessage}=load('lib/wholesale-payment-presentation.ts');
  assert.match(wholesalePostingMessage('pending_mapping'),/falta configurar la cuenta.*No vuelvas/);
  assert.match(wholesalePostingMessage('posted','Banco real'),/Mayoristas.*Banco real/);
  const ledger={payments:[{id:'p',entry_type:'payment',refund_of:null,amount:9880,currency:'ARS',payment_method:'bank_transfer',occurred_at:'2026-10-17',posting_status:'pending_mapping'}],reconciliations:[{payment_entry_id:'p',event_type:'reconciled'}],recognitions:[],accountingJournals:[],deliveryCorrections:[],physicalReturns:[]};let index=0;
  const {WholesaleOrderLedger}=load('components/admin/WholesaleOrderLedger.tsx',{react:{...React,useState:initial=>[index++===0?ledger:index===2?true:initial,()=>{}],useEffect(){},useCallback:fn=>fn,useMemo:fn=>fn(),useRef:initial=>({current:initial})}});
  const html=renderToStaticMarkup(React.createElement(WholesaleOrderLedger,{orderId:'o',revisionId:'r',status:'confirmed',total:9880,currency:'ARS',deliveries:[]}));
  assert.match(html,/Estado del cobro: Pagado/);assert.match(html,/Transferencia/);assert.match(html,/Pendiente de imputar/);assert.match(html,/Verificación bancaria registrada/);
  assert.doesNotMatch(html,/<details[^>]* open|Pendiente de conciliación|<select[^>]*aria-label="Medio de reembolso[^>]*>[\s\S]*?<option value="cash" selected/);
  assert.match(html,/<option value="bank_transfer" selected/);
});

test('ledger read exposes only configured active accounts and actual posting state without writing',async()=>{
  let role='VENDEDOR';const reads=[];
  const tables={
    wholesale_payment_entries:[{id:'p',entry_type:'payment',payment_method:'bank_transfer',amount:9880,currency:'ARS'}],
    wholesale_financial_postings:[{payment_entry_id:'p',status:'pending_mapping',account_id:null,cash_movement_id:null}],
    wholesale_financial_account_mappings:[{payment_method:'cash',account_id:'cash'},{payment_method:'bank_transfer',account_id:null}],
    financial_accounts:[{id:'cash',name:'Caja'}],
  };
  const {GET}=load('app/api/admin/wholesale-orders/[id]/ledger/route.ts',{
    '@/lib/admin-auth':{getAdminIdentity:async()=>({role})},
    '@/lib/supabase/server':{isServiceRoleConfigured:()=>true,createAdminServerClient:()=>({from(table){reads.push(table);const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,then:resolve=>resolve({data:tables[table]??[],error:null})};return q;},rpc(){throw Error('No write allowed');}})},
  });
  const context={params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})};
  assert.equal((await GET(new Request('https://dcl.test'),context)).status,403);assert.equal(reads.length,0);
  role='ADMIN';const response=await GET(new Request('https://dcl.test'),context);assert.equal(response.status,200);
  const {data}=await response.json();assert.deepEqual(data.paymentAccounts,[{method:'cash',name:'Caja'}]);
  assert.equal(data.payments[0].posting_status,'pending_mapping');assert.equal(data.payments[0].financial_account_name,null);
});

test('failed payment keeps the form mounted and server retries reuse the original key and payload',async()=>{
  const ledger={payments:[],reconciliations:[],recognitions:[],accountingJournals:[],deliveryCorrections:[],physicalReturns:[],paymentAccounts:[{method:'cash',name:'Caja'}]};
  const states=[],refs=[],requests=[];let cursor=0,refCursor=0;
  function PaymentForm(){}
  const {WholesaleOrderLedger}=load('components/admin/WholesaleOrderLedger.tsx',{
    '@/components/admin/WholesalePaymentForm':{WholesalePaymentForm:PaymentForm},
    '@/lib/client-uuid':{createClientUuid:()=> '11111111-1111-4111-8111-111111111111'},
    react:{useState(initial){const i=cursor++;if(!(i in states))states[i]=i===0?ledger:i===1?true:initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){return refs[refCursor++]??={current:initial};},useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(){}},
  },{fetch:async(url,init)=>{requests.push(JSON.parse(init.body));return Response.json({ok:false,message:'Resultado incierto'},{status:500});}});
  const render=()=>{cursor=0;refCursor=0;return WholesaleOrderLedger({orderId:'o',revisionId:'r',status:'confirmed',total:100,currency:'ARS',deliveries:[]});};
  const form=()=>nodes(render()).find(n=>n.type===PaymentForm);
  const fields={amount:20,method:'cash',occurredAt:'2026-10-17T12:00:00Z',externalReference:null};
  assert.equal(await form().props.onPayment(fields),false);assert.ok(form());
  assert.equal(await form().props.onPayment({...fields,amount:50}),false);
  assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].amount,20);assert.ok(requests[0].idempotencyKey);
});
