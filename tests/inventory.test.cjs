/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const database = require('./database.cjs');
const fs = require('node:fs');
let db;
before(async () => { db = await database(); });
after(async () => { await db?.close(); });
const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
async function product(stock=5) {
  const id=randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,$2)',[id,stock]);
  return id;
}
async function order(items, method='mercadopago', key=randomUUID(), name='Test') {
  return scalar("SELECT create_public_order($1,$1,'','pickup','','',$2,$3::jsonb,$4::uuid)",[name,method,JSON.stringify(items),key]);
}
async function pay(id, status='processed') {
  await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1",[id]);
  return scalar("SELECT complete_mercadopago_order($1::uuid,'test-'||$1::text,'payment-'||$1::text,(SELECT total FROM orders WHERE id=$1::uuid),'ARS',$2)",[id,status]);
}
const expire=id=>db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE order_id=$1",[id]);
test('late payment A cannot consume the last unit reserved by B; repeated webhook stays idempotent',async()=>{
  const p=await product(1),a=await order([{productId:p,quantity:1}]);
  await expire(a);
  const b=await order([{productId:p,quantity:1}]);
  assert.equal(await pay(a),null);
  assert.equal(await pay(a),null);
  assert.equal(await pay(a,'rejected'),null);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[p]),1);
  assert.equal(await scalar('SELECT status FROM orders WHERE id=$1',[a]),'stock_unavailable');
  assert.equal(await scalar('SELECT status FROM payment_transactions WHERE order_id=$1',[a]),'approved');
  assert.equal(await scalar('SELECT count(*)::int FROM order_notes WHERE order_id=$1',[a]),1);
  assert.equal(await scalar('SELECT status FROM inventory_reservations WHERE order_id=$1',[b]),'active');
  const sale=await pay(b); assert.ok(sale); assert.equal(await pay(b),sale);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[p]),0);
});
test('late payment without competing reservation still requires review',async()=>{
  const p=await product(),a=await order([{productId:p,quantity:1}]); await expire(a);
  assert.equal(await pay(a),null); assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[p]),5);
});
test('duplicates normalize before reservations and items; invalid aggregate rolls back',async()=>{
  const p=await product(100),a=await order([{productId:p,quantity:1},{productId:p,quantity:2}]);
  assert.deepEqual((await db.query('SELECT quantity FROM order_items WHERE order_id=$1',[a])).rows,[{quantity:3}]);
  assert.equal(await scalar('SELECT quantity FROM inventory_reservations WHERE order_id=$1',[a]),3);
  await assert.rejects(order([{productId:p,quantity:60},{productId:p,quantity:60}]),/INVALID_QUANTITY/);
});
test('same request reuses order; changed quantity, method and context conflict; expired request rejected',async()=>{
  const p=await product(),key=randomUUID(),items=[{productId:p,quantity:1}],a=await order(items,'mercadopago',key);
  assert.equal(await order(items,'mercadopago',key),a);
  await assert.rejects(order([{productId:p,quantity:2}],'mercadopago',key),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(order(items,'transfer',key),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(order(items,'mercadopago',key,'Changed'),/IDEMPOTENCY_CONFLICT/);
  await expire(a); await assert.rejects(order(items,'mercadopago',key),/RESERVATION_EXPIRED/);
});
test('out of stock rolls back order, customer, items and reservations',async()=>{
  const p=await product(0),before=await scalar('SELECT count(*)::int FROM orders');
  await assert.rejects(order([{productId:p,quantity:1}]),/OUT_OF_STOCK/);
  assert.equal(await scalar('SELECT count(*)::int FROM orders'),before);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_reservations WHERE product_id=$1',[p]),0);
});
test('availability is pure and ignores expired/released/consumed reservations',async()=>{
  const p=await product(8),a=await order([{productId:p,quantity:2}]);
  assert.equal(await scalar('SELECT get_available_product_stock($1)',[p]),6);
  await expire(a);
  assert.equal(await scalar('SELECT get_available_product_stock($1)',[p]),8);
  assert.equal(await scalar('SELECT status FROM inventory_reservations WHERE order_id=$1',[a]),'active');
  for(const status of ['released','consumed']) {
    await db.query('UPDATE inventory_reservations SET status=$2,expires_at=clock_timestamp()+interval \'1 hour\' WHERE order_id=$1',[a,status]);
    assert.equal(await scalar('SELECT get_available_product_stock($1)',[p]),8);
  }
});
test('payment deadline follows actual earliest reservation minus one minute',async()=>{
  const p=await product(),a=await order([{productId:p,quantity:1}]);
  assert.equal(await scalar("SELECT get_order_payment_window($1)=min(expires_at)-interval '1 minute' FROM inventory_reservations WHERE order_id=$1",[a]),true);
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()+interval '7 minutes' WHERE order_id=$1",[a]);
  assert.equal(await scalar("SELECT get_order_payment_window($1)=min(expires_at)-interval '1 minute' FROM inventory_reservations WHERE order_id=$1",[a]),true);
  await expire(a); assert.equal(await scalar('SELECT get_order_payment_window($1)',[a]),null);
});
test('transfer declaration and confirmation repeat safely; cancellation after sale denied',async()=>{
  const p=await product(),a=await order([{productId:p,quantity:2}],'transfer');
  for(let n=0;n<2;n++) assert.equal(await scalar('SELECT declare_manual_transfer($1)',[a]),true);
  const sale=await scalar('SELECT complete_manual_transfer($1)',[a]); assert.ok(sale);
  assert.equal(await scalar('SELECT complete_manual_transfer($1)',[a]),sale);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[p]),3);
  assert.equal(await scalar('SELECT cancel_public_order($1)',[a]),false);
});
test('expired and cancelled transfers cannot sell',async()=>{
  const p=await product(),a=await order([{productId:p,quantity:1}],'transfer');
  await scalar('SELECT declare_manual_transfer($1)',[a]); await expire(a);
  assert.equal(await scalar('SELECT complete_manual_transfer($1)',[a]),null);
  assert.equal(await scalar('SELECT cancel_public_order($1)',[a]),true);
  await assert.rejects(scalar('SELECT complete_manual_transfer($1)',[a]),/no verificable/);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[p]),5);
});
test('all admin sale signatures resolve to reservation-aware implementation; direct adjustment guarded',async()=>{
  const signatures=(await db.query("SELECT pronargs FROM pg_proc WHERE proname='create_sale_with_inventory'")).rows;
  assert.deepEqual(signatures,[{pronargs:9}]);
  const p=await product(1),a=await order([{productId:p,quantity:1}]);
  const customer=await scalar('SELECT customer_id FROM orders WHERE id=$1',[a]);
  await assert.rejects(scalar('SELECT create_sale_with_inventory($1,NULL,\'\',$2::jsonb,false)',[customer,JSON.stringify([{productId:p,quantity:1}])]),/reservad/);
  await assert.rejects(db.query('UPDATE products SET stock=0 WHERE id=$1',[p]),/reserva/);
  await scalar('SELECT cancel_public_order($1)',[a]);
  assert.ok(await scalar('SELECT create_sale_with_inventory($1,NULL,\'\',$2::jsonb,false)',[customer,JSON.stringify([{productId:p,quantity:1}])]));
});
test('least privilege table and sensitive function ACLs',async()=>{
  for(const role of ['anon','authenticated','service_role']) for(const table of ['inventory_reservations','order_notes']) {
    const allowed=role==='service_role'?(table==='inventory_reservations'?['SELECT','INSERT','UPDATE']:['SELECT','INSERT']):[];
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES']) assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3)',[role,table,privilege]),allowed.includes(privilege),`${role} ${table} ${privilege}`);
  }
  for(const role of ['anon','authenticated']) assert.equal(await scalar("SELECT has_function_privilege($1,'public.complete_manual_transfer(uuid)','EXECUTE')",[role]),false);
});
test('admin filters count before pagination with more than 50 orders and conservative delivery',async()=>{
  const p=await product(100);
  for(let n=0;n<62;n++) await order([{productId:p,quantity:1}],n%2?'transfer':'mercadopago',randomUUID(),'Filter-fixture');
  const result=await scalar("SELECT list_admin_orders('Filter-fixture','all',NULL,2,50)");
  assert.equal(result.pagination.total,62);assert.equal(result.data.length,12);
  const transfer=await scalar("SELECT list_admin_orders('Filter-fixture','transfer',NULL,1,50)");
  assert.equal(transfer.pagination.total,31);
  for(const filter of ['attention','pending','paid','cancelled','delivery']) {
    const list=await scalar('SELECT list_admin_orders($1,$2,NULL,1,50)',['Filter-fixture',filter]);
    assert.equal(list.pagination.total,filter==='attention'?31:filter==='pending'?62:0);
  }
  const ids=(await scalar("SELECT list_admin_orders('Filter-fixture','all',NULL,1,100)")).data.map(x=>x.id);
  await db.query("UPDATE orders SET status='completed',fulfillment_method='delivery' WHERE id=$1",[ids[0]]);
  await db.query("UPDATE orders SET status='completed',fulfillment_method='pickup' WHERE id=$1",[ids[1]]);
  await db.query("UPDATE orders SET status='cancelled' WHERE id=$1",[ids[2]]);
  assert.equal((await scalar("SELECT list_admin_orders('Filter-fixture','paid',NULL,1,50)")).pagination.total,2);
  assert.equal((await scalar("SELECT list_admin_orders('Filter-fixture','delivery',NULL,1,50)")).pagination.total,1);
  assert.equal((await scalar("SELECT list_admin_orders('Filter-fixture','cancelled',NULL,1,50)")).pagination.total,1);
  // A product-name match must not bypass status or date predicates.
  assert.equal((await scalar('SELECT list_admin_orders($1,\'delivery\',NULL,1,50)',[p])).pagination.total,1);
  assert.equal((await scalar("SELECT list_admin_orders($1,'all',clock_timestamp()+interval '1 day',1,50)",[p])).pagination.total,0);
});
test('invalid consumed or missing reservation blocks payment window',async()=>{
  const p=await product(),a=await order([{productId:p,quantity:1}]);
  await db.query("UPDATE inventory_reservations SET status='consumed' WHERE order_id=$1",[a]);
  assert.equal(await scalar('SELECT get_order_payment_window($1)',[a]),null);
  await db.query('DELETE FROM inventory_reservations WHERE order_id=$1',[a]);
  assert.equal(await scalar('SELECT get_order_payment_window($1)',[a]),null);
});
test('cancelled and expired transfer declarations fail even after an earlier declaration',async()=>{
  const p=await product(),a=await order([{productId:p,quantity:1}],'transfer');
  await scalar('SELECT declare_manual_transfer($1)',[a]);await expire(a);
  assert.equal(await scalar('SELECT declare_manual_transfer($1)',[a]),false);
  await scalar('SELECT cancel_public_order($1)',[a]);
  assert.equal(await scalar('SELECT declare_manual_transfer($1)',[a]),false);
});
test('admin sale with duplicate products and idempotent reversal updates stock only once',async()=>{
  const p=await product(),customer=await scalar("INSERT INTO customers(full_name,phone) VALUES('Admin test','admin-test') RETURNING id");
  const key=randomUUID(),items=JSON.stringify([{productId:p,quantity:1},{productId:p,quantity:2}]);
  const sql="SELECT create_sale_with_inventory($1,NULL,'',$2::jsonb,false,'cash',$3)";
  const sale=await scalar(sql,[customer,items,key]);assert.equal(await scalar(sql,[customer,items,key]),sale);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[p]),2);
  for(let n=0;n<2;n++)assert.equal(await scalar("SELECT cancel_sale_with_reversal($1,'test')",[sale]),sale);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[p]),5);
});
test('simultaneously submitted inverse-order requests preserve inventory (PGlite serializes SQL execution)',async()=>{
  const a=await product(1),b=await product(1);
  const results=await Promise.allSettled([order([{productId:a,quantity:1},{productId:b,quantity:1}]),order([{productId:b,quantity:1},{productId:a,quantity:1}])]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  for(const p of [a,b])assert.equal(await scalar('SELECT get_available_product_stock($1)',[p]),0);
});
test('effective multi-product functions lock products in deterministic order; no obsolete signatures or unsafe ACLs',async()=>{
  for(const fn of ['create_public_order','create_sale_with_inventory','complete_mercadopago_order','complete_manual_transfer','cancel_public_order','release_expired_inventory_reservations','cancel_sale_with_reversal']) {
    const definition=await scalar('SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname=$1',[fn]);
    assert.match(definition,/ORDER BY p.id FOR UPDATE/);
    for(const role of ['anon','authenticated'])assert.equal(await scalar('SELECT has_function_privilege($1,oid,\'EXECUTE\') FROM pg_proc WHERE proname=$2',[role,fn]),false);
  }
  assert.equal(await scalar("SELECT count(*)::int FROM pg_indexes WHERE tablename='inventory_reservations' AND indexdef LIKE '%UNIQUE%'"),2);
  assert.equal(await scalar("SELECT count(*)::int FROM pg_trigger WHERE tgname='guard_product_reserved_stock' AND NOT tgisinternal"),1);
});
test('service_role can create and complete an order with actual final ACLs and triggers',async()=>{
  const p=await product();
  await db.exec('SET ROLE service_role');
  try {
    const a=await order([{productId:p,quantity:1}],'transfer');
    assert.equal(await scalar('SELECT declare_manual_transfer($1)',[a]),true);
    assert.ok(await scalar('SELECT complete_manual_transfer($1)',[a]));
  } finally { await db.exec('RESET ROLE'); }
});
test('corrective DDL is transactional, repeatable and does not change existing product/order data',async()=>{
  const sql=fs.readFileSync('supabase/migrations/20260904020000_inventory_reservations_safety.sql','utf8');
  const statements=sql.replace(/--[^\n]*/g,'').trim();
  assert.match(statements,/^BEGIN;/);assert.match(statements,/COMMIT;$/);
  assert.doesNotMatch(statements,/DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM|\bCASCADE\b/i);
  const before=await scalar("SELECT jsonb_build_object('products',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM products p),'orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM orders o))");
  await db.exec(sql);
  const after=await scalar("SELECT jsonb_build_object('products',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM products p),'orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM orders o))");
  assert.deepEqual(after,before);
});
