const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const load=require('./load-ts.cjs');
const fs=require('node:fs');
const {validateWholesaleReceipt}=load('lib/store/wholesale-receipt.ts',{'server-only':{},'@/lib/supabase/server':{},'@/lib/api':{isUuid:()=>true}});
const order={id:'order',order_number:'MW-000123',customer_id:'private-customer',status:'confirmed',confirmed_revision_id:'revision',confirmed_at:'2026-10-18T12:00:00Z'};
const revision={id:'revision',order_id:'order',total_amount:100,currency:'ARS'};
const items=[{id:'item',revision_id:'revision',product_name_snapshot:'Producto histórico',quantity:2,unit_price:50,line_total:100,currency:'ARS'}];
const payment=(amount=40)=>({id:'payment',order_id:'order',entry_type:'payment',amount,currency:'ARS',payment_method:'mercadopago',refund_of:null});
const validate=(payments=[],o=order,r=revision,i=items)=>validateWholesaleReceipt(o,r,i,payments,'Cliente de prueba local');
test('wholesale receipt distinguishes pending, partial, full and refunded amounts without changing totals',()=>{
 for(const [amount,label,due] of [[0,'Pendiente',100],[40,'Pago parcial',60],[100,'Pagado',0]]){const result=validate(amount?[payment(amount)]:[]);assert.equal(result.status,'ok');assert.equal(result.receipt.paymentStatus,label);assert.equal(result.receipt.pendingAmount,due);assert.equal(result.receipt.total,100);}
 const refunded=validate([payment(100),{...payment(20),id:'refund',entry_type:'refund',refund_of:'payment'}]);assert.equal(refunded.receipt.pendingAmount,20);assert.equal(refunded.receipt.confirmedPaid,100);assert.equal(refunded.receipt.refundedAmount,20);
 for(const records of [[payment(),payment()],[{...payment(),order_id:'another'}],[payment(101)],[{...payment(),entry_type:'pending'}],[{...payment(),currency:'USD'}],[{...payment(),id:'refund',entry_type:'refund',refund_of:'missing'}]])assert.equal(validate(records).status,'incident');
 assert.equal(validate([],order,{...revision,order_id:'another'}).status,'incident');assert.equal(validate([],{...order,status:'cancelled'}).status,'incident');
 assert.equal(validate([],order,revision,[{...items[0],line_total:1}]).status,'incident');
});
const css='@/app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css';const styles=new Proxy({},{get:(_,k)=>k==='__esModule'?false:k});
test('both sectors render through the same receipt with a soft gray print-preserved background',()=>{
 const {OrderReceipt}=load('components/admin/OrderReceipt.tsx',{[css]:styles,'next/image':props=>{const copy={...props};delete copy.unoptimized;return React.createElement('img',copy);}});
 const receipt=validate([payment()]).receipt;
 const html=renderToStaticMarkup(React.createElement(OrderReceipt,{receipt}));
 assert.match(html,/COMPROBANTE DE COMPRA MAYORISTA/);assert.match(html,/Pago parcial/);assert.match(html,/Saldo pendiente/);assert.match(html,/60,00/);assert.match(html,/Producto histórico/);assert.doesNotMatch(html,/private-customer|revision|payment_id|preference_id/);
 assert.match(html,/class="watermark" aria-hidden="true"/);assert.doesNotMatch(html,/no acredita|no confirma/i);
 const retail=renderToStaticMarkup(React.createElement(OrderReceipt,{receipt:{...receipt,kind:undefined,paymentStatus:'Aprobado'}}));assert.match(retail,/COMPROBANTE DE COMPRA/);assert.doesNotMatch(retail,/Saldo pendiente/);
 const content=fs.readFileSync('app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css','utf8');assert.match(content,/background: #f0f1f3/);assert.match(content,/print-color-adjust: exact/);assert.match(content,/@media screen and \(max-width: 600px\)/);
});

test('wholesale page authenticates ADMIN before any read',async()=>{
 let reads=0;const mocks={[css]:styles,'next/navigation':{redirect(){throw Error('redirect');}},'@/lib/admin-auth':{getAdminIdentity:async()=>({role:'VENDEDOR'})},'@/lib/store/wholesale-receipt':{getWholesaleReceipt:async()=>{reads++;return validate();}},'@/components/admin/ReceiptShareButton':{ReceiptShareButton:()=>null},'@/components/admin/ReceiptPrintButton':{ReceiptPrintButton:()=>null},'@/components/admin/OrderReceipt':{OrderReceipt:()=>null}};
 mocks['@/lib/receipt-identity-server']={withReceiptIdentity:async result=>result};
 const Page=load('app/admin/mayoristas/pedidos/[id]/comprobante/page.tsx',mocks).default;
 await assert.rejects(Page({params:Promise.resolve({id:'order'})}),/redirect/);assert.equal(reads,0);
});


test('wholesale loader reads only the authenticated order relationships and strips private data',async()=>{
 const reads=[];const records={wholesale_orders:[order],wholesale_order_revisions:[revision],customers:[{full_name:'Cliente local'}],wholesale_order_revision_items:items,wholesale_payment_entries:[payment()]};
 const db={from(table){const record={table,filters:[]};reads.push(record);const query={select(columns){record.columns=columns;return query;},eq(key,value){record.filters.push([key,value]);return query;},order(){return query;},range(){return Promise.resolve({data:records[table],error:null});},maybeSingle(){return Promise.resolve({data:records[table][0],error:null});}};return query;}};
 const {getWholesaleReceipt}=load('lib/store/wholesale-receipt.ts',{'server-only':{},'@/lib/api':{isUuid:value=>value==='order'},'@/lib/supabase/server':{createAdminServerClient:()=>db}});
 assert.equal((await getWholesaleReceipt('invalid')).status,'not_found');assert.equal(reads.length,0);
 const result=await getWholesaleReceipt('order');assert.equal(result.status,'ok');assert.equal(result.receipt.paymentStatus,'Pago parcial');assert.doesNotMatch(JSON.stringify(result),/private-customer|customer_id|external_reference|refund_of/);
 assert.deepEqual(reads.find(r=>r.table==='wholesale_payment_entries').filters,[['order_id','order']]);
 assert.deepEqual(reads.find(r=>r.table==='wholesale_order_revisions').filters,[['id','revision'],['order_id','order']]);
 assert.equal(reads.find(r=>r.table==='customers').columns,'full_name');
});
