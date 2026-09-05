/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
test('checkout fingerprint is canonical and changes with products, quantities, payment and context',()=>{
  const {checkoutFingerprint,normalizeOrderItems}=load('lib/store/order-input.ts');
  const items=[{productId:'x',quantity:1},{productId:'x',quantity:2}];
  assert.deepEqual(plain(normalizeOrderItems(items)),[{productId:'x',quantity:3}]);
  const base=checkoutFingerprint(items,'card',{name:' Test ',fulfillment:'pickup'});
  assert.equal(base,checkoutFingerprint([{productId:'x',quantity:3}],'card',{fulfillment:'pickup',name:'Test'}));
  for(const [lines,method,form] of [[[{productId:'y',quantity:3}],'card',{name:'Test'}],[items,'transfer',{name:'Test'}],[items,'card',{name:'Other'}],[[{productId:'x',quantity:2}],'card',{name:'Test'}]]) assert.notEqual(base,checkoutFingerprint(lines,method,form));
});
test('fitment confirms valid year; missing, outside range, manipulated connector and position cannot confirm',()=>{
  const {assessFitment}=load('lib/store/fitment.ts');
  const fitment={yearFrom:2012,yearTo:2017,connectorLow:'H7',connectorHigh:'H1',connectorFog:null,connectorAux:null,combinedHighLow:false};
  assert.equal(assessFitment(fitment,'H7','low','2015').state,'confirmed');
  assert.equal(assessFitment(fitment,'H7','low',undefined).state,'missing_year');
  for(const year of ['2011','2018','2015abc']) assert.equal(assessFitment(fitment,'H7','low',year).state,'out_of_range');
  for(const position of ['high','constructor','other']) assert.equal(assessFitment(fitment,'H7',position,'2015').state,'invalid');
  assert.equal(assessFitment(null,'H7','low','2015').state,'invalid');
});
test('scoped PostHog events discard PII, URLs, queries, order IDs and profile updates',()=>{
  const {sanitizeStoreEvent}=load('lib/store/analytics-privacy.ts');
  for(const event of ['product_viewed','fitment_result_viewed','manual_transfer_instructions_viewed','manual_transfer_marked_sent']) {
    const result=sanitizeStoreEvent(event,{product_id:'x',quantity:1,result_count:2,email:'pii',phone:'pii',name:'pii',order_id:'pii',$current_url:'https://test.invalid/?email=pii',$referrer:'pii',$set:{email:'pii'},arbitrary:'pii'});
    assert.equal(JSON.stringify(result).includes('pii'),false);assert.equal(result.product_id,'x');
  }
  assert.equal(JSON.stringify(sanitizeStoreEvent('page_view',{$current_url:'pii',$referrer:'pii',path:'/checkout'})).includes('pii'),false);
});
test('captureOnce deduplicates instruction views and never transmits its order-specific key',()=>{
  const calls=[],posthog={__loaded:true,capture:(...args)=>calls.push(args)};
  const {captureOnce}=load('lib/analytics.ts',{'posthog-js':posthog},{window:{location:{pathname:'/checkout'}}});
  for(let n=0;n<3;n++)captureOnce('private-order-id','manual_transfer_instructions_viewed');
  assert.equal(calls.length,1);assert.equal(JSON.stringify(calls).includes('private-order-id'),false);
});
test('EventOnMount effect replay does not duplicate product_viewed',()=>{
  const calls=[],effects=[],ref={current:''};
  const {EventOnMount}=load('components/analytics/EventOnMount.tsx',{react:{useRef:()=>ref,useEffect:fn=>effects.push(fn)},'@/lib/analytics':{capture:(...args)=>calls.push(args)}});
  EventOnMount({event:'product_viewed',properties:{product_id:'x'}});effects[0]();effects[0]();
  assert.equal(calls.length,1);
});
test('CheckoutForm retains a retry key and rotates it on cart or method changes',async()=>{
  const slots=[];let cursor=0,sequence=0;const posted=[],effects=[];
  const cart={lines:[{id:'x',quantity:1}],total:100};
  const react={
    useRef:initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},
    useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useEffect:fn=>effects.push(fn),
  };
  const {CheckoutForm}=load('components/store/CheckoutForm.tsx',{
    react,'@/components/store/CartProvider':{useCart:()=>cart},'@/components/store/MercadoPagoBrick':{MercadoPagoBrick:()=>null},
    '@/lib/analytics':{analyticsEvents:{},capture:()=>{},captureOnce:()=>{}},'@/lib/client-uuid':{createClientUuid:()=>`key-${++sequence}`},
  },{fetch:async(url,init)=>{posted.push(JSON.parse(init.body));return Response.json({orderId:'order',total:100,publicKey:null});}});
  const render=()=>{cursor=0;return CheckoutForm({transfer:{alias:'test',cbuCvu:'',holder:'test',institution:'test',instructions:''}});};
  function nodes(node,type) {if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(x=>nodes(x,type));return [...(node.type===type?[node]:[]),...nodes(node.props?.children,type)];}
  let tree=render();nodes(tree,'button')[1].props.onClick(); // Card, then provider config error keeps form available.
  for(let n=0;n<2;n++){tree=render();await nodes(tree,'form')[0].props.onSubmit({preventDefault(){}});}
  assert.equal(posted[0].idempotencyKey,posted[1].idempotencyKey);
  cart.lines=[{id:'x',quantity:2}];tree=render();await nodes(tree,'form')[0].props.onSubmit({preventDefault(){}});
  assert.notEqual(posted[1].idempotencyKey,posted[2].idempotencyKey);
  tree=render();nodes(tree,'button')[2].props.onClick();tree=render();await nodes(tree,'form')[0].props.onSubmit({preventDefault(){}});
  assert.notEqual(posted[2].idempotencyKey,posted[3].idempotencyKey);assert.equal(posted[3].paymentMethod,'transfer');
});
