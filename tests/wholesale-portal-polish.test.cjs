const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const presentation=load('lib/wholesale-order-presentation.ts');
const order={id:'order',order_number:'MW-000007',status:'confirmed',currency:'ARS',created_at:'2026-10-18',confirmed_at:'2026-10-18',total_amount:100,items:[{productId:'p1',quantity:1}],payment_summary:{total:100,paid:100,due:0,state:'Pago completo',canPay:false},whatsapp:'https://wa.me/5492617791393'};
test('coordination uses verified full payment and actual delivery state, in card and detail',()=>{
 assert.equal(presentation.canCoordinateWholesaleDelivery(order),true);
 assert.equal(presentation.canCoordinateWholesaleDelivery({...order,payment_summary:{...order.payment_summary,paid:40,due:60}}),false);
 const delivered={...order,tracking_events:[{id:'e',type:'order_fully_delivered',at:'2026-10-18'}]};
 assert.equal(presentation.canCoordinateWholesaleDelivery(delivered),false);
 assert.equal(presentation.matchingOpenWholesaleOrder([delivered],{p1:{quantity:1}}),undefined);
 assert.equal(presentation.matchingOpenWholesaleOrder([order],{p1:{quantity:1}}).id,order.id);
 assert.match(presentation.customerOrderNextAction(order),/Coordiná/);
 assert.doesNotMatch(presentation.customerOrderNextAction(order),/opciones de pago/);
 const {WholesaleOrderPayment}=load('components/wholesale/WholesaleOrderPayment.tsx',{react:{...React,useEffect(){}}});
 const html=renderToStaticMarkup(React.createElement(WholesaleOrderPayment,{order}));
 assert.match(html,/Coordinar entrega o retiro/);assert.match(html,/wa\.me\/5492617791393/);assert.match(html,/MW-000007/);assert.doesNotMatch(html,/Continuar al pago/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(WholesaleOrderPayment,{order:delivered})),/Coordinar entrega o retiro/);
});
test('partial notices and payment attempts reserve amounts without reducing the verified debt',()=>{
 const {unreservedPaymentAmount}=load('lib/wholesale-payment-notices.ts');
 assert.equal(unreservedPaymentAmount(100,[{amount:40,status:'pending'}]),60);
 assert.equal(unreservedPaymentAmount(100,[{amount:40,status:'pending'}],30),30);
 assert.equal(unreservedPaymentAmount(100,[{amount:40,status:'withdrawn'}]),100);
 assert.equal(unreservedPaymentAmount(10,[{amount:40,status:'pending'}]),0);
});
