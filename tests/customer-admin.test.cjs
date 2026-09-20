/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const migration = '20260920010000_customer_admin.sql';
let db;
const scalar = async (sql, values = []) => Object.values((await db.query(sql, values)).rows[0])[0];
const manage = (action, id = null, data = {}) => scalar('SELECT admin_manage_customer($1,$2,$3::jsonb)', [action, id, JSON.stringify(data)]);
const customerData = (name, phone = null) => ({ full_name: name, phone, email: null, document_number: null, notes: '' });
const create = (name = randomUUID(), phone = null) => manage('create', null, customerData(name, phone));

before(async () => {
  db = new PGlite(); // Local in-memory database only.
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;');
  for (const file of fs.readdirSync('supabase/migrations').filter(name => /^\d{14}_/.test(name) && !name.includes('storage_setup') && name < migration).sort()) {
    await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await db.exec(fs.readFileSync('supabase/migrations/' + migration, 'utf8'));
});
after(async () => { await db?.close(); });

test('manual create, edit, archive and restore keep an audit trail', async () => {
  const row = await create('Ana Cliente', '1111');
  assert.equal(row.full_name, 'Ana Cliente');
  const changed = await manage('edit', row.id, { ...customerData('Ana Editada', '2222'), notes: 'Preferencia' });
  assert.equal(changed.phone, '2222');
  assert.equal(changed.notes, 'Preferencia');
  const archived = await manage('archive', row.id);
  assert.ok(archived.archived_at);
  assert.equal(await scalar('SELECT count(*)::int FROM customers WHERE id=$1 AND archived_at IS NULL', [row.id]), 0);
  assert.equal(await scalar('SELECT count(*)::int FROM customers WHERE id=$1 AND archived_at IS NOT NULL', [row.id]), 1);
  assert.equal((await manage('restore', row.id)).archived_at, null);
  assert.deepEqual((await db.query('SELECT action FROM customer_admin_history WHERE customer_id=$1 ORDER BY id', [row.id])).rows.map(row => row.action), ['create', 'edit', 'archive', 'restore']);
});

test('safe delete works only without direct dependencies', async () => {
  const empty = await create();
  assert.equal((await manage('delete', empty.id)).deleted, true);
  assert.equal(await scalar('SELECT count(*)::int FROM customers WHERE id=$1', [empty.id]), 0);

  const withVehicle = await create();
  await db.query("INSERT INTO customer_vehicles(customer_id,brand_name,model_name) VALUES($1,'Marca','Modelo')", [withVehicle.id]);
  await assert.rejects(manage('delete', withVehicle.id), /CUSTOMER_HAS_DEPENDENCIES/);
  assert.equal(await scalar('SELECT count(*)::int FROM customer_vehicles WHERE customer_id=$1', [withVehicle.id]), 1);

  const withOrder = await create();
  await db.query("INSERT INTO orders(customer_id,idempotency_key,fulfillment_method,payment_method) VALUES($1,$2,'pickup','transfer')", [withOrder.id, randomUUID()]);
  await assert.rejects(manage('delete', withOrder.id), /CUSTOMER_HAS_DEPENDENCIES/);

  const withSale = await create();
  await db.query('INSERT INTO sales(customer_id) VALUES($1)', [withSale.id]);
  await assert.rejects(manage('delete', withSale.id), /CUSTOMER_HAS_DEPENDENCIES/);

  const withWarranty = await create();
  const sale = await scalar('INSERT INTO sales(customer_id) VALUES($1) RETURNING id', [withSale.id]);
  const product = randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,0)', [product]);
  const item = await scalar("INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,line_total) VALUES($1,$2,'Producto',1,100,100) RETURNING id", [sale, product]);
  await db.query('INSERT INTO warranties(sale_item_id,customer_id) VALUES($1,$2)', [item, withWarranty.id]);
  await assert.rejects(manage('delete', withWarranty.id), /CUSTOMER_HAS_DEPENDENCIES/);
  assert.equal(await scalar('SELECT count(*)::int FROM sales WHERE customer_id=$1', [withWarranty.id]), 0);
});

test('checkout reuses an active customer and restores an archived one by phone', async () => {
  await db.exec("INSERT INTO site_settings(id,transfer_alias,transfer_holder,transfer_institution) VALUES(1,'test.alias','Test','Test') ON CONFLICT(id) DO UPDATE SET transfer_alias='test.alias',transfer_holder='Test',transfer_institution='Test'");
  const product = randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,10)', [product]);
  const customer = await create('Cliente Checkout', '123456');
  const order = () => scalar("SELECT create_public_order('Cliente Checkout','123456','','pickup','','','transfer',$1::jsonb,$2)", [JSON.stringify([{ productId: product, quantity: 1 }]), randomUUID()]);
  const first = await order();
  assert.equal(await scalar('SELECT customer_id FROM orders WHERE id=$1', [first]), customer.id);
  await manage('archive', customer.id);
  const second = await order();
  assert.equal(await scalar('SELECT customer_id FROM orders WHERE id=$1', [second]), customer.id);
  assert.equal(await scalar('SELECT archived_at FROM customers WHERE id=$1', [customer.id]), null);
  assert.equal(await scalar("SELECT count(*)::int FROM customers WHERE phone='123456'"), 1);
});

test('safe delete locks the customer row before dependency checks', () => {
  const sql = fs.readFileSync('supabase/migrations/' + migration, 'utf8');
  assert.match(sql, /SELECT \* INTO v_customer FROM public\.customers WHERE id=p_customer FOR UPDATE;[\s\S]*IF p_action='delete'/);
  assert.doesNotMatch(sql, /DELETE FROM public\.customer_vehicles|DELETE FROM public\.orders|DELETE FROM public\.sales|DELETE FROM public\.warranties/);
});
