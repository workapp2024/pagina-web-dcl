/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID, webcrypto, createHash } = require('node:crypto');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const database = require('./database.cjs');
const load = require('./load-ts.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
let db;
const jar = new Map(), cookiesWritten = [], calls = [];
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0] || {})[0];
function client() {
  return { from(table) {
    assert.match(table, /^[a-z_]+$/);
    let columns = '*', filters = [], values = [], insert, single = false, sort = '', limit = '';
    const q = {
      select(value) { columns = value; return q; },
      eq(key, value) { values.push(value); filters.push(`${key}=$${values.length}`); return q; },
      insert(value) { insert = value; return q; },
      order(key) { sort = ` ORDER BY ${key}`; return q; },
      limit(value) { limit = ` LIMIT ${value}`; return q; },
      single() { single = true; return q; }, maybeSingle() { single = true; return q; },
      then(resolve, reject) {
        let sql;
        if (insert) { const keys = Object.keys(insert); values = Object.values(insert); sql = `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`; }
        else sql = `SELECT ${columns} FROM ${table}${filters.length ? ' WHERE ' + filters.join(' AND ') : ''}${sort}${limit}`;
        return db.query(sql, values).then(({ rows }) => ({ data: single ? plain(rows[0] || null) : plain(rows), error: null })).catch(() => ({ data: null, error: { message: 'test query failure' } })).then(resolve, reject);
      },
    }; return q;
  }, async rpc(name, args) {
    calls.push({ name, args: plain(args) });
    const keys = Object.keys(args);
    try { return { data: await scalar(`SELECT ${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')})`, Object.values(args)), error: null }; }
    catch (error) { return { data: null, error: { message: error.message } }; }
  } };
}
const cookieApi = { cookies: async () => ({ get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set(name, value, options) { jar.set(name, value); cookiesWritten.push({ name, value, options: plain(options) }); } }) };
const base = { '@/lib/supabase/server': { createAdminServerClient: client }, 'next/headers': cookieApi, '@/lib/rate-limit': { rateLimit: () => null }, '@/lib/store/analytics-outbox': { scheduleAnalyticsFlush() {} } };
const globals = { Buffer, process: { env: { NODE_ENV: 'production', VERCEL_ENV: 'preview' } }, console: { warn() {}, error() {}, info() {} } };
const session = load('lib/store/buyer-session.ts', base, globals);
const mocks = { ...base, '@/lib/store/buyer-session': session };
const publicOrder = load('lib/store/public-order.ts', mocks, globals);
const statusRoute = load('app/api/store/orders/[id]/status/route.ts', { ...mocks, '@/lib/store/public-order': publicOrder }, globals);
const creation = load('app/api/store/orders/route.ts', mocks, globals);
const recovery = load('app/api/store/orders/recover/route.ts', mocks, globals);
const request = (body, origin = 'https://test.invalid') => new Request('https://test.invalid/api', { method: 'POST', headers: { 'content-type': 'application/json', origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
const context = number => ({ params: Promise.resolve({ id: number }) });
async function newSession() { jar.clear(); await session.establishBuyerSession(); return { token: jar.get(session.BUYER_COOKIE), ...(await session.getBuyerSession()) }; }
async function orderInput(method = 'transfer') {
  const product = randomUUID();
  await db.query("INSERT INTO products(id,name,slug,price,stock) VALUES($1,'Historical LED',$1,125.50,20)", [product]);
  return { name: 'Private Name', phone: '1500011223', email: 'private@example.test', fulfillment: 'pickup', address: '', notes: 'Private note', paymentMethod: method, idempotencyKey: randomUUID(), items: [{ productId: product, quantity: 2 }] };
}
async function createOrder(method = 'transfer') {
  const input = await orderInput(method);
  const response = await creation.POST(request(input)); assert.equal(response.status, 200);
  const body = await response.json();
  return { input, number: body.orderNumber, id: await scalar('SELECT id FROM orders WHERE idempotency_key=$1', [input.idempotencyKey]) };
}
before(async () => {
  db = await database();
  await db.exec("ALTER SEQUENCE order_commercial_number_seq RESTART WITH 900001; INSERT INTO financial_periods(name,status) VALUES('Local only','open')");
});
after(async () => { await db?.close(); });

test('session stores only SHA-256, sets strict 30-day cookie, reuses and expires', async () => {
  const owner = await newSession(); const cookie = cookiesWritten.at(-1);
  assert.equal(owner.token.length, 64);
  assert.deepEqual(cookie.options, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 2592000 });
  const record = (await db.query('SELECT * FROM buyer_sessions WHERE id=$1', [owner.id])).rows[0];
  assert.equal(record.token_hash, createHash('sha256').update(owner.token).digest('hex'));
  assert.doesNotMatch(JSON.stringify(record), new RegExp(owner.token));
  assert.deepEqual(Object.keys(record).sort(), ['created_at','expires_at','id','token_hash']);
  const count = cookiesWritten.length; await session.establishBuyerSession(); assert.equal(cookiesWritten.length, count);
  await db.query("UPDATE buyer_sessions SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1", [owner.id]);
  assert.equal(await session.getBuyerSession(), null);
});

test('migration is navigation-only, RLS enabled, public access and helper execution denied', async () => {
  const sql = fs.readFileSync('supabase/migrations/20260924010000_buyer_sessions.sql','utf8');
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION.*(?:create_public_order|complete_|resolve_order)|UPDATE (?:public\.)?(?:orders|products|payment_transactions)\b/);
  for (const table of ['buyer_sessions','buyer_session_orders']) {
    assert.equal(await scalar("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass",[table]),true);
    for (const role of ['anon','authenticated']) assert.equal(await scalar("SELECT has_table_privilege($1,$2,'SELECT')",[role,table]),false);
  }
  for (const role of ['anon','authenticated']) assert.equal(await scalar("SELECT has_function_privilege($1,'recover_buyer_order(uuid,uuid)','EXECUTE')",[role]),false);
});

test('lost creation response is recovered with same key/session even after completion; one order and outbox event', async () => {
  await newSession(); const f = await createOrder();
  const before = await scalar('SELECT last_value FROM order_commercial_number_seq');
  await scalar('SELECT declare_manual_transfer($1)',[f.id]);
  await scalar("SELECT complete_manual_transfer($1,'preview')",[f.id]);
  calls.length = 0;
  const retried = await creation.POST(request(f.input)); assert.equal(retried.status,200);
  assert.deepEqual(await retried.json(), { ok:true, orderNumber:f.number });
  assert.ok(!calls.some(call=>call.name==='create_public_order'));
  assert.equal(await scalar('SELECT count(*)::int FROM orders WHERE idempotency_key=$1',[f.input.idempotencyKey]),1);
  assert.equal(await scalar('SELECT last_value FROM order_commercial_number_seq'),before);
  assert.equal(await scalar("SELECT count(*)::int FROM analytics_outbox WHERE order_id=$1 AND event_type='order_created'",[f.id]),1);
  assert.deepEqual((await db.query('SELECT event_type FROM analytics_outbox WHERE order_id=$1 ORDER BY occurred_at,id',[f.id])).rows.map(r=>r.event_type),['order_created','payment_approved','purchase_completed']);
  assert.deepEqual(await (await recovery.POST(request({idempotencyKey:f.input.idempotencyKey}))).json(),{ok:true,orderNumber:f.number});
});

test('recover commit/authorization gap without re-running commerce; unauthorized session cannot claim key', async () => {
  const owner = await newSession(); const input = await orderInput();
  assert.equal(await session.claimBuyerAttempt(owner.id,input.idempotencyKey,'request'),true);
  const id = await scalar("SELECT create_public_order($1,$2,$3,'pickup','','','transfer',$4::jsonb,$5)",[input.name,input.phone,input.email,JSON.stringify(input.items),input.idempotencyKey]);
  assert.equal(await scalar('SELECT order_id FROM buyer_session_orders WHERE idempotency_key=$1',[input.idempotencyKey]),null);
  const number = await session.recoverBuyerOrder(owner.id,input.idempotencyKey);
  assert.equal(await scalar('SELECT order_id FROM buyer_session_orders WHERE idempotency_key=$1',[input.idempotencyKey]),id);
  const other = await newSession();
  assert.equal(await session.claimBuyerAttempt(other.id,input.idempotencyKey,'request'),false);
  assert.equal(await session.recoverBuyerOrder(other.id,input.idempotencyKey),null);
  assert.equal(await session.authorizedBuyerOrder(number),null);
});

test('same session authorizes multiple orders; foreign number, UUID, missing/expired session reveal no existence', async () => {
  const owner = await newSession(); const first = await createOrder(), second = await createOrder();
  assert.equal(await session.authorizedBuyerOrder(first.number),first.id);
  assert.equal(await session.authorizedBuyerOrder(second.number),second.id);
  const dto = await publicOrder.getPublicOrder(first.number); assert.equal(dto.orderNumber,first.number);
  await newSession();
  for (const number of [first.number,'DCL-999999',first.id]) {
    const response = await statusRoute.GET(new Request('https://test.invalid'),context(number));
    assert.equal(response.status,404); assert.deepEqual(await response.json(),{ok:false,error:'Pedido no disponible en este navegador.'});
  }
  jar.clear(); assert.equal((await statusRoute.POST(request(),context(first.number))).status,404);
  jar.set(session.BUYER_COOKIE,owner.token);
  await db.query("UPDATE buyer_sessions SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1",[owner.id]);
  assert.equal((await statusRoute.GET(new Request('https://test.invalid'),context(first.number))).status,404);
});

test('public DTO uses historical order_items, no customer data, tokens or technical identifiers', async () => {
  const owner=await newSession(); const f=await createOrder();
  await db.query("UPDATE products SET name='New catalog',price=999 WHERE id=$1",[f.input.items[0].productId]);
  const dto=await publicOrder.getPublicOrder(f.number);
  assert.deepEqual(plain(dto.items),[{name:'Historical LED',quantity:2,unitPrice:125.5,lineTotal:251}]);
  assert.deepEqual(Object.keys(dto).sort(),['orderNumber','result','paymentReceived','paymentStatus','total','currency','paymentMethod','transferDeclared','canPay','items','transfer'].sort());
  for(const value of [owner.token,owner.id,f.id,f.input.name,f.input.phone,f.input.email,f.input.notes]) assert.ok(!JSON.stringify(dto).includes(value));
  assert.doesNotMatch(JSON.stringify(dto),/customer_id|external_payment|sale_id|analytics|unit_cost|margin/);
  assert.equal(dto.transfer.alias,'test.alias'); assert.equal(dto.result,'pending');
});

test('GET success never approves; transfer declaration authorized, origin-protected and not approval', async () => {
  await newSession();const f=await createOrder();
  const response=await statusRoute.GET(new Request('https://test.invalid?result=success&status=approved'),context(f.number));
  assert.equal((await response.json()).result,'pending');
  assert.equal((await statusRoute.POST(request(undefined,'https://evil.invalid'),context(f.number))).status,404);
  assert.equal(await scalar('SELECT transfer_declared_at FROM orders WHERE id=$1',[f.id]),null);
  assert.equal((await statusRoute.POST(request(),context(f.number))).status,200);
  assert.ok(await scalar('SELECT transfer_declared_at FROM orders WHERE id=$1',[f.id]));
  assert.equal(await scalar('SELECT status FROM payment_transactions WHERE order_id=$1',[f.id]),'pending');
  assert.equal(await scalar('SELECT count(*)::int FROM sales WHERE id=(SELECT sale_id FROM payment_transactions WHERE order_id=$1)',[f.id]),0);
});

test('explicit results never misclassify refund/cancellation/review as pending',()=>{
  for(const [status,payment,result] of [['completed','approved','approved'],['pending_payment','pending','pending'],['rejected','rejected','rejected'],['refunded','refunded','refunded'],['cancelled','cancelled','cancelled'],['refund_required','approved','review'],['stock_unavailable','approved','review'],['refunded','pending','review']]) assert.equal(publicOrder.publicOrderResult(status,payment),result);
});

function storage() { const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)}; }
const attemptModule=()=>load('lib/store/checkout-attempt.ts',{}, {crypto:webcrypto,TextEncoder});
const cart=load('lib/store/cart-persistence.ts');

test('checkout lock falls back per tab, preserves attempt key and releases after failure; prefers Web Locks', async () => {
  const store = storage();
  const attemptApi = load('lib/store/checkout-attempt.ts', {}, { navigator: {}, crypto: webcrypto, TextEncoder });
  const items = [{ productId: 'A', quantity: 1 }], form = { name: 'Test', fulfillment: 'pickup' };
  let release; const gate = new Promise(resolve => { release = resolve; });
  const events = []; let firstKey;
  const first = attemptApi.checkoutLock(async () => {
    events.push('first');
    firstKey = (await attemptApi.prepareCheckoutAttempt(store, items, 'transfer', form)).key;
    await gate; throw new Error('lost response');
  });
  const rejected = assert.rejects(first, /lost response/);
  const second = attemptApi.checkoutLock(async () => {
    events.push('second');
    return (await attemptApi.prepareCheckoutAttempt(store, items, 'transfer', form)).key;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['first']); release();
  await rejected; assert.equal(await second, firstKey);
  assert.deepEqual(events, ['first', 'second']);
  let lockName;
  const native = load('lib/store/checkout-attempt.ts', {}, { navigator: { locks: { request: async (name, action) => { lockName = name; return action(); } } } });
  assert.equal(await native.checkoutLock(async () => 42), 42);
  assert.equal(lockName, 'dcl-checkout');
});
test('attempt survives reload/lost response, equivalent data reuse key, changed method/items/data create new key; no raw PII',async()=>{
  const store=storage(), items=[{productId:'A',quantity:2}],form={name:'Private Name',phone:'123456789',email:'private@example.test',fulfillment:'pickup',address:'Private address',notes:'Private note'};
  const first=await attemptModule().prepareCheckoutAttempt(store,items,'transfer',form);
  const reloaded=await attemptModule().prepareCheckoutAttempt(store,items,'transfer',{...form,name:' Private Name ',address:'ignored pickup address'});
  assert.equal(first.key,reloaded.key);
  for(const value of Object.values(form).filter(v=>v!=='pickup')) assert.ok(!store.getItem('dcl-checkout-attempt-v1').includes(value));
  const changed=await attemptModule().prepareCheckoutAttempt(store,items,'card',form);assert.notEqual(changed.key,first.key);
  const more=await attemptModule().prepareCheckoutAttempt(store,[{productId:'A',quantity:3}],'card',form);assert.notEqual(more.key,changed.key);
  const newName=await attemptModule().prepareCheckoutAttempt(store,[{productId:'A',quantity:3}],'card',{...form,name:'Another'});assert.notEqual(newName.key,more.key);
  attemptModule().finishCheckoutAttempt(store,newName.key,'DCL-900001');assert.equal(store.getItem('dcl-checkout-attempt-v1'),null);
});

test('cart consumes partial quantities once, preserves later additions and persists atomically before navigation',()=>{
  const store=storage();store.setItem(cart.CART_KEY,JSON.stringify([{id:'A',quantity:3},{id:'B',quantity:1}]));
  const consumed=cart.consumeCart(store,'DCL-900001',[{productId:'A',quantity:2}]);
  assert.deepEqual(plain(consumed.lines),[{id:'A',quantity:1},{id:'B',quantity:1}]);
  consumed.lines[0].quantity=5;store.setItem(cart.CART_KEY,JSON.stringify(consumed));
  assert.equal(cart.consumeCart(store,'DCL-900001',[{productId:'A',quantity:2}]).lines[0].quantity,5);
  const stored=cart.readStoredCart(store);assert.equal(stored.consumedOrders[0],'DCL-900001');
});

test('payment endpoints reject unauthorized/cross-origin requests before provider access',async()=>{
  await newSession(); const foreign = await createOrder('card'); await newSession();
  for(const path of ['preference','orders']) {
    let fetches=0;
    const {POST}=load(`app/api/payments/mercadopago/${path}/route.ts`,mocks,{...globals,fetch:()=>{fetches++;throw new Error('forbidden')}});
    assert.equal((await POST(request({orderNumber:foreign.number}))).status,404);
    assert.equal((await POST(request({orderNumber:'DCL-900001'},'https://evil.invalid'))).status,404);
    assert.equal(fetches,0);
  }
});

test('transfer RPC failure leaves declaration unset and payment pending', async () => {
  await newSession(); const f = await createOrder();
  const route = load('app/api/store/orders/[id]/status/route.ts', {
    ...mocks, '@/lib/store/public-order': publicOrder,
    '@/lib/supabase/server': { createAdminServerClient: () => ({ rpc: async () => ({ data: null, error: { message: 'offline' } }) }) },
  }, globals);
  assert.equal((await route.POST(request(), context(f.number))).status, 409);
  assert.equal(await scalar('SELECT transfer_declared_at FROM orders WHERE id=$1', [f.id]), null);
  assert.equal((await publicOrder.getPublicOrder(f.number)).paymentStatus, 'pending');
});

function componentHarness(file, initial, extra = {}, runtime = {}) {
  const states = [], refs = []; let cursor = 0, refCursor = 0;
  const component = load(file, { react: { ...React,
    useState(value) { const i = cursor++; if (!(i in states)) states[i] = i in initial ? initial[i] : value;
      return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef(value) { const i = refCursor++; return refs[i] ||= { current: value }; },
    useEffect() {}, useId: () => 'test',
  }, ...extra }, runtime);
  return { render(name, props) { cursor = 0; refCursor = 0; return component[name](props); }, states };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
const resultMocks = { '@/components/store/MercadoPagoBrick': { MercadoPagoBrick: () => null }, '@/lib/analytics': { capture() {}, captureOnce() {}, analyticsEvents: {} } };

test('failed transfer declaration renders independent WhatsApp without false success or navigation', async () => {
  await newSession(); const f = await createOrder(); const dto = await publicOrder.getPublicOrder(f.number);
  for (const fetch of [async () => Response.json({ ok: false }, { status: 409 }), async () => { throw new Error('offline'); }]) {
    let navigations = 0;
    const h = componentHarness('components/store/CheckoutResult.tsx', [dto], resultMocks, { fetch, window: { location: { assign() { navigations++; } } } });
    const props = { orderNumber: f.number, publicKey: '' };
    const tree = h.render('CheckoutResult', props);
    const button = nodes(tree).find(node => node.type === 'button' && node.props.children === 'Ya transferí — Avisar por WhatsApp');
    button.props.onClick(); await new Promise(resolve => setImmediate(resolve));
    const updated = h.render('CheckoutResult', props);
    assert.equal(h.states[0].transferDeclared, false); assert.equal(navigations, 0);
    const link = nodes(updated).find(node => node.type === 'a' && node.props.children === 'Avisar por WhatsApp');
    assert.ok(link.props.href.includes(encodeURIComponent(f.number)));
    assert.doesNotMatch(renderToStaticMarkup(updated), /Aviso registrado/);
  }
});

test('rejected payment disables payment actions and retains consumed cart and existing order', async () => {
  await newSession(); const f = await createOrder('card');
  await db.query("UPDATE orders SET status='rejected' WHERE id=$1", [f.id]);
  await db.query("UPDATE payment_transactions SET status='rejected' WHERE order_id=$1", [f.id]);
  const dto = await publicOrder.getPublicOrder(f.number);
  assert.equal(dto.result, 'rejected'); assert.equal(dto.canPay, false);
  const store = storage(); store.setItem(cart.CART_KEY, JSON.stringify([{ id: f.input.items[0].productId, quantity: 3 }]));
  cart.consumeCart(store, f.number, f.input.items); const saved = store.getItem(cart.CART_KEY);
  const h = componentHarness('components/store/CheckoutResult.tsx', [dto], resultMocks);
  const markup = renderToStaticMarkup(h.render('CheckoutResult', { orderNumber: f.number, publicKey: 'test' }));
  assert.doesNotMatch(markup, /Continuar con el pago|Continuar con tarjeta|href="\/checkout"/);
  assert.equal(store.getItem(cart.CART_KEY), saved);
  const retry = await creation.POST(request(f.input)); assert.equal((await retry.json()).orderNumber, f.number);
  assert.equal(await scalar('SELECT count(*)::int FROM orders WHERE idempotency_key=$1', [f.input.idempotencyKey]), 1);
});

test('card submission cannot be repeated after lost response', async () => {
  let callbacks, fetches = 0;
  const h = componentHarness('components/store/MercadoPagoBrick.tsx', [], {
    react: { ...React, useRef: value => ({ current: value }), useState: value => [value, () => {}], useId: () => 'test', useEffect: effect => effect() },
    'next/navigation': { useRouter: () => ({ replace() {}, refresh() {} }) },
  }, { window: { MercadoPago: class { bricks() { return { create: async (_type, _id, settings) => { callbacks = settings.callbacks; return { unmount() {} }; } }; } } },
    fetch: async () => { fetches++; throw new Error('lost response'); } });
  h.render('MercadoPagoBrick', { orderNumber: 'DCL-900001', amount: 1, publicKey: 'test' });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(callbacks.onSubmit({}, {}), /lost response/);
  await assert.rejects(callbacks.onSubmit({}, {}), /Consultá el estado/);
  assert.equal(fetches, 1);
});

const resultModule=load('components/store/CheckoutResult.tsx',{'@/components/store/MercadoPagoBrick':{MercadoPagoBrick:()=>null},'@/lib/analytics':{capture(){},captureOnce(){},analyticsEvents:{}}});
test('result copy for rejected/refunded/cancelled and WhatsApp has only order number; no cart recreation',()=>{
  for(const state of ['rejected','refunded','cancelled','review']) {
    const copy=resultModule.orderMessage({result:state,paymentReceived:true});
    assert.doesNotMatch(copy.title,/pendiente/i);
  }
  const source=fs.readFileSync('components/store/CheckoutResult.tsx','utf8');
  assert.doesNotMatch(source,/href="\/checkout"|\/api\/store\/orders["']|clearCart|consumeCart|setLines/);
  assert.match(source,/Ya transferí — Avisar por WhatsApp/);
  const {whatsappUrl}=load('lib/whatsapp.ts');
  const url=new URL(whatsappUrl('Hola, necesito ayuda con mi pedido DCL-900001.'));
  assert.equal(url.pathname,'/5492617791393');assert.equal(url.searchParams.get('text'),'Hola, necesito ayuda con mi pedido DCL-900001.');
});
