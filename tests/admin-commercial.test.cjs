/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const channels = load('lib/admin-channels.ts');
const { adminMessage } = load('lib/admin-messages.ts');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];

test('channel selection restricts sellers and never fabricates a combined orders/inventory view', () => {
  for (const value of [undefined, 'all', 'wholesale', ['wholesale'], 'invalid']) {
    assert.equal(channels.selectedAdminChannel(value, 'VENDEDOR', true), 'retail');
    assert.equal(channels.selectedAdminChannel(value, 'VENDEDOR', false), 'retail');
  }
  assert.deepEqual(Array.from(channels.adminChannels('ADMIN', true)), ['all', 'retail', 'wholesale']);
  assert.deepEqual(Array.from(channels.adminChannels('ADMIN', false)), ['retail', 'wholesale']);
  assert.equal(channels.selectedAdminChannel('all', 'ADMIN', false), 'retail');
  assert.equal(channels.selectedAdminChannel('wholesale', 'ADMIN', true), 'wholesale');
});

function pageHarness(section, role, authenticated = true) {
  const Retail = () => null, Wholesale = () => null, Customers = () => null, Finance = () => null;
  const auth = { isAdminAuthenticated: async () => authenticated, getAdminIdentity: async () => role ? { role } : null };
  const page = load('app/admin/gestion/' + section + '/page.tsx', {
    '@/lib/admin-auth': auth,
    'next/navigation': { redirect: path => { throw Error('redirect:' + path); } },
    '@/app/admin/pedidos/page': Retail, '@/app/admin/pedidos-mayoristas/page': Wholesale,
    '@/components/admin/EditorForms': { AdminProductsManager: Retail },
    '@/components/admin/InventoryManager': { AdminInventoryManager: Retail },
    '@/components/admin/WholesaleInventoryManager': { WholesaleInventoryManager: Wholesale },
    '@/components/admin/CustomersManager': { CustomersManager: Customers },
    '@/components/admin/FinanceOverview': { FinanceOverview: Finance },
  }).default;
  return { page: params => page({ searchParams: Promise.resolve(params) }), Retail, Wholesale, Customers, Finance };
}

test('server entry points enforce roles even with a manually supplied wholesale query', async () => {
  for (const section of ['pedidos', 'catalogo']) {
    for (const role of ['ADMIN', 'VENDEDOR']) {
      const h = pageHarness(section, role);
      const tree = await h.page({ canal: 'wholesale', vista: 'stock' });
      assert.equal(nodes(tree).some(n => n.type === h.Wholesale), role === 'ADMIN');
      assert.equal(nodes(tree).some(n => n.type === h.Retail), role === 'VENDEDOR');
    }
  }
  for (const section of ['pedidos', 'catalogo', 'clientes', 'finanzas']) {
    await assert.rejects(pageHarness(section, 'ADMIN', false).page({}), /redirect:/);
    await assert.rejects(pageHarness(section, null).page({}), /redirect:/);
  }
  await assert.rejects(pageHarness('finanzas', 'VENDEDOR').page({ canal: 'all' }), /redirect:/);
});

test('customer and finance selectors pass only their existing sector contracts', async () => {
  for (const role of ['ADMIN', 'VENDEDOR']) for (const canal of ['all', 'retail', 'wholesale']) {
    const h = pageHarness('clientes', role);
    const manager = nodes(await h.page({ canal })).find(n => n.type === h.Customers);
    assert.equal(manager.props.sector, role === 'ADMIN' ? canal : 'retail');
  }
  for (const [canal, sector] of [['all', 'general'], ['retail', 'minoristas'], ['wholesale', 'mayoristas']]) {
    const h = pageHarness('finanzas', 'ADMIN');
    assert.equal(nodes(await h.page({ canal })).find(n => n.type === h.Finance).props.sector, sector);
  }
});

test('commercial messages preserve specific remedies while removing technical implementation details', () => {
  for (const message of ['Stock insuficiente', 'Precio inválido', 'No tenés permiso para esta operación', 'La entrega excede la cantidad pendiente', 'No repitas el cobro. Verificá el historial.']) assert.equal(adminMessage(message), message);
  assert.match(adminMessage('Failed to fetch'), /conexión/);
  for (const message of ['Supabase no configurado', 'column customer_secret does not exist', 'PGRST202 schema cache', 'Migración pendiente']) {
    assert.match(adminMessage(message), /Contactá al administrador/);
    assert.doesNotMatch(adminMessage(message), /customer_secret|Supabase|PGRST|migración/i);
  }
  assert.match(adminMessage('Reintentá sin cambiar los datos para conservar la idempotencia.'), /evitar registrar la operación dos veces/);
});
