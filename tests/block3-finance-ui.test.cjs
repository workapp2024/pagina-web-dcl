const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');

function harness(file, name, mocks = {}, globals = {}) {
  const states=[],refs=[];let cursor=0,refCursor=0;
  const jsx=(type,props)=>({type,props});
  const loaded=load(file,{
    react:{ useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=refCursor++;return refs[i]||=( {current:initial} );},useEffect(){},useCallback:fn=>fn },
    'react/jsx-runtime':{jsx,jsxs:jsx},...mocks,
  },globals);
  const render=props=>{cursor=0;refCursor=0;return loaded[name](props);};render.states=states;return render;
}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join('');if(!tree||typeof tree!=='object')return String(tree??'');return text(tree.props?.children);}

test('simple general money actions reuse actual RPC route with signed amounts and preserve the same retry payload',async()=>{
  const calls=[];let fail=true;
  const render=harness('components/admin/FinanceMoneyActions.tsx','FinanceMoneyActions',{
    '@/components/admin/FinancesManager':{createFinanceIdempotencyKey:()=> '11111111-1111-4111-8111-111111111111'},
  },{window:{confirm:()=>true},fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json(fail?{error:'Error de prueba'}:{ok:true},{status:fail?503:200});}});
  let refreshed=0;const props={accounts:[{id:'cash',name:'Caja'}],onSaved:()=>{refreshed++;}};
  let tree=render(props);
  assert.equal(calls.length,0);assert.equal(nodes(tree).find(n=>n.type==='button'&&text(n)==='Transferir dinero').props.disabled,true);
  nodes(tree).find(n=>n.type==='button'&&text(n)==='Retirar dinero').props.onClick();tree=render(props);
  nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:'cash'}});tree=render(props);
  const inputs=nodes(tree).filter(n=>n.type==='input');
  inputs[0].props.onChange({target:{value:'25.50'}});tree=render(props);
  nodes(tree).filter(n=>n.type==='input')[1].props.onChange({target:{value:'Titular'}});tree=render(props);
  nodes(tree).filter(n=>n.type==='input')[2].props.onChange({target:{value:'Retiro autorizado'}});tree=render(props);
  await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=render(props);
  assert.equal(calls[0].body.amount,-25.5);assert.equal(calls[0].body.type,'cash_withdrawal');assert.equal(calls[0].body.sector,undefined);
  assert.equal(nodes(tree).find(n=>n.type==='fieldset').props.disabled,true);
  fail=false;await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  assert.deepEqual(calls[0],calls[1]);assert.equal(refreshed,1);
});

test('history combines local-date, amount, type and sector filters and retains references only inside details',()=>{
  const render=harness('components/admin/FinanceCashHistory.tsx','FinanceCashHistory');
  const props={hidden:false,accounts:[{id:'cash',name:'Caja'}],rows:[
    {id:'a',sector:'minoristas',amount:10,account_id:'cash',movement_type:'sale_income',sale_id:'s',description:'Pedido',occurred_at:'2026-10-18T01:00:00Z'},
    {id:'b',sector:'mayoristas',amount:50,account_id:'cash',movement_type:'income',wholesale_payment_entry_id:'pay',description:'Pedido',occurred_at:'2026-10-18T13:00:00Z'},
  ]};
  let tree=render(props);assert.equal(nodes(tree).filter(n=>n.type==='li').length,2);
  nodes(tree).find(n=>n.type==='input'&&n.props.type==='date').props.onChange({target:{value:'2026-10-18'}});tree=render(props);
  assert.equal(nodes(tree).filter(n=>n.type==='li').length,1);
  assert.match(text(tree),/Cobro mayorista/);
  nodes(tree).find(n=>n.type==='select'&&n.props.value==='').props.onChange({target:{value:'income'}});tree=render(props);
  nodes(tree).find(n=>n.type==='input'&&n.props.type==='number').props.onChange({target:{value:'100'}});
  assert.equal(nodes(render(props)).filter(n=>n.type==='li').length,0);
});

test('sector overview uses one mobile-first view and never presents unknown attribution as spendable cash',()=>{
  const render=harness('components/admin/FinanceOverview.tsx','FinanceOverview');render({sector:'minoristas'});
  render.states[0]={activated:true,periods:[],selectedPeriod:{id:'p',status:'open'},accounts:[],cashBySector:{minoristas:{available:100,income:100,expense:0},mayoristas:{available:0,income:0,expense:0},unassigned:{available:-100,income:0,expense:100},total:0,movements:[],attributionNeedsReview:true}};
  let tree=render({sector:'minoristas'});
  assert.match(text(tree),/Saldo registrado del sector/);assert.match(text(tree),/Disponibilidad para retirar: sin verificar/);assert.doesNotMatch(text(tree),/Ganancia|Ventas/);
  assert.equal(nodes(tree).filter(n=>n.type==='details').every(n=>!n.props.open),true);
  assert.ok(nodes(tree).some(n=>n.props?.className?.includes('sm:grid-cols-3')));
  tree=render({sector:'mayoristas'});assert.match(text(tree),/Finanzas mayoristas/);
  assert.equal(nodes(tree).filter(n=>n.type==='dt').length,3);
});

test('account transfer reuses the existing transfer action and never sends a sector reallocation',async()=>{
  const calls=[];
  const render=harness('components/admin/FinanceMoneyActions.tsx','FinanceMoneyActions',{
    '@/components/admin/FinancesManager':{createFinanceIdempotencyKey:()=> '11111111-1111-4111-8111-111111111111'},
  },{window:{confirm:()=>true},fetch:async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({ok:true});}});
  const props={accounts:[{id:'cash',name:'Caja'},{id:'bank',name:'Banco'}],onSaved(){}};
  let tree=render(props);nodes(tree).find(n=>n.type==='button'&&text(n)==='Transferir dinero').props.onClick();tree=render(props);
  assert.match(text(tree),/Transferir entre cuentas financieras/);
  nodes(tree).filter(n=>n.type==='select')[0].props.onChange({target:{value:'cash'}});tree=render(props);
  nodes(tree).filter(n=>n.type==='select')[1].props.onChange({target:{value:'bank'}});tree=render(props);
  nodes(tree).filter(n=>n.type==='input')[0].props.onChange({target:{value:'12'}});tree=render(props);
  nodes(tree).filter(n=>n.type==='input')[1].props.onChange({target:{value:'Depósito'}});tree=render(props);
  await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  assert.deepEqual(calls,[{action:'transfer',fromAccountId:'cash',toAccountId:'bank',amount:12,description:'Depósito',idempotencyKey:'11111111-1111-4111-8111-111111111111'}]);
});

test('reversal details link to the original without exposing audit data in the compact row',()=>{
  const render=harness('components/admin/FinanceCashHistory.tsx','FinanceCashHistory');
  const props={hidden:false,accounts:[{id:'cash',name:'Caja'}],rows:[
    {id:'original',sector:'unassigned',amount:10,account_id:'cash',movement_type:'cash_contribution',description:'Aporte original',occurred_at:'2026-10-17T12:00:00Z'},
    {id:'contra',sector:'unassigned',amount:-10,account_id:'cash',movement_type:'adjustment',description:'Corrección',occurred_at:'2026-10-17T13:00:00Z',operation:{id:'op',action:'reverse',actor_id:'actor-private',created_at:'2026-10-17T13:01:00Z',reverse_of:null,legacy_movement_id:'original',request:{}}},
  ]};
  let tree=render(props);
  const contra=nodes(tree).find(n=>n.type==='li'&&text(n).includes('Corrección'));
  assert.doesNotMatch(text(contra.props.children.filter(n=>n?.type!=='details')),/actor-private|Cuenta|op/);
  nodes(contra).find(n=>n.type==='button'&&text(n)==='Ver original en este período').props.onClick();tree=render(props);
  assert.equal(nodes(tree).filter(n=>n.type==='li').length,1);assert.match(text(tree),/Aporte original/);
});

test('advanced tools do not duplicate the simple summary, forms or history',()=>{
  const render=harness('components/admin/FinancesManager.tsx','FinancesManager',{}, {crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}});
  render({toolsOnly:true});
  render.states[0]={activated:true,accounts:[],periods:[{id:'p',name:'Actual'}],selectedPeriod:{id:'p',status:'open'},wholesale:{available:false}};
  const tree=render({toolsOnly:true});
  assert.equal(nodes(tree).some(node=>['Dinero disponible','Negocio · período seleccionado'].includes(node.props?.title)),false);
  assert.doesNotMatch(text(tree),/Historial financiero|Registrar movimientos, gastos o transferencias/);
  assert.match(text(tree),/Cerrar período/);
});
