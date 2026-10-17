const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs');
const { sectorFinancialPresentation, sumByCurrency } = load('lib/finance-presentation.ts');

const data = {
  activated: true, totalAvailable: 950, salesTotal: 400, realizedProfit: 250,
  accounts: [{ id: 'cash', name: 'Caja compartida', balance: 950 }], periods: [],
  movements: [
    { id: 'opening', movement_type: 'opening_balance', amount: 500, sale_id: null },
    { id: 'manual', movement_type: 'income', amount: 50, sale_id: null },
    { id: 'retail', movement_type: 'sale_income', amount: 200, sale_id: 'retail-sale' },
    { id: 'wholesale', movement_type: 'wholesale_payment', amount: 200, source: 'wholesale' },
  ],
  wholesale: { available: true, recognizedNet: [{ currency: 'ARS', amount: 300 }, { currency: 'USD', amount: 10 }],
    receivables: [{ order_number: 'MW-000001', currency: 'ARS', amount: 100 }, { order_number: 'MW-000002', currency: 'USD', amount: 20 }] },
};

test('sector views never assign shared balances, untagged movements or unverifiable profit', () => {
  const retail = sectorFinancialPresentation(data, 'minoristas');
  const wholesale = sectorFinancialPresentation(data, 'mayoristas');
  assert.equal(retail.cash, null); assert.equal(wholesale.cash, null);
  assert.equal(retail.profit, null); assert.equal(wholesale.profit, null);
  assert.equal(retail.receivables, null);
  assert.deepEqual(Array.from(retail.movements, row => row.id), ['retail']);
  assert.deepEqual(Array.from(wholesale.movements, row => row.id), ['wholesale']);
  assert.deepEqual(Array.from(retail.sales, row => row.amount), [400]);
  assert.deepEqual(Array.from(wholesale.sales, row => row.amount), [300, 10]);
  assert.equal(data.totalAvailable, 950);
});

test('currency amounts remain separate, missing data and invalid amounts never become zero', () => {
  assert.equal(sumByCurrency([{ currency: 'ARS', amount: NaN }]), null);
  assert.equal(sumByCurrency([{ currency: '', amount: 10 }]), null);
  const sums = sumByCurrency([{ currency: 'ARS', amount: 30 }, { currency: 'USD', amount: 20 }, { currency: 'ARS', amount: -5 }]);
  assert.deepEqual(Array.from(sums, row => [row.currency, row.amount]), [['ARS', 25], ['USD', 20]]);
  assert.equal(sectorFinancialPresentation({ ...data, wholesale: { available: false } }, 'mayoristas').sales, null);
  assert.equal(sectorFinancialPresentation({ ...data, salesTotal: undefined }, 'minoristas').sales, null);
});

test('retail profit uses the API estimate only with explicit historical cost coverage', () => {
  assert.equal(sectorFinancialPresentation({ ...data, realizedProfit: 1 }, 'minoristas').profit, null);
  assert.equal(sectorFinancialPresentation({ ...data, realizedProfit: 1, retailCostsComplete: false }, 'minoristas').profit, null);
  assert.deepEqual(Array.from(sectorFinancialPresentation({ ...data, realizedProfit: 1, retailCostsComplete: true }, 'minoristas').profit, row => row.amount), [1]);
  assert.equal(sectorFinancialPresentation({ ...data, realizedProfit: 1, retailCostsComplete: true }, 'mayoristas').profit, null);
});

test('admin entry redirects to the sector and no longer renders the two-destination landing page', async () => {
  const page = load('app/admin/page.tsx', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => true },
    'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } },
  });
  await assert.rejects(page.default(), /redirect:\/admin\/minoristas$/);
});

test('financial screens render distinct sector amounts, one consolidated balance and closed advanced tools', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  function render(sector) {
    let index = 0;
    const { buildSectorCash } = load('lib/finance-sector-cash.ts');
    const cashBySector = buildSectorCash(data.movements.map(row => ({ ...row, account_id: 'cash', description: 'Movimiento', occurred_at: '2026-10-17T12:00:00Z', wholesale_payment_entry_id: row.source === 'wholesale' ? 'payment' : null })));
    const values = [{ ...data, cashBySector }, '', '', false, false];
    const { FinanceOverview } = load('components/admin/FinanceOverview.tsx', {
      react: { useState: () => [values[index++], () => {}], useEffect: () => {} },
      'next/link': ({ children, ...props }) => React.createElement('a', props, children),
      '@/components/admin/FinancesManager': { FinancesManager: () => React.createElement('span', null, 'ADVANCED_TOOLS') },
      '@/components/admin/SearchableList': load('components/admin/SearchableList.tsx'),
      '@/components/admin/FinanceCashHistory': load('components/admin/FinanceCashHistory.tsx'),
    });
    return renderToStaticMarkup(React.createElement(FinanceOverview, { sector }));
  }
  const general = render('general');
  assert.match(general, /950,00/);
  assert.doesNotMatch(general, /400,00|300,00|ADVANCED_TOOLS/);
  assert.match(general, /Sin atribución/);
  assert.doesNotMatch(general, /<details[^>]* open/);
  const retail = render('minoristas');
  assert.match(retail, /200,00/); assert.doesNotMatch(retail, /950,00|300,00|400,00/);
  const wholesale = render('mayoristas');
  assert.match(wholesale, /200,00/); assert.doesNotMatch(wholesale, /950,00|400,00|300,00/);
  assert.equal((retail.match(/<dt /g) || []).length, 3);
  assert.equal((wholesale.match(/<dt /g) || []).length, 3);
});

test('navigation retains every existing module without repeated exact destinations or general finances in sectors', () => {
  const sidebar = fs.readFileSync('components/admin/AdminSidebar.tsx', 'utf8');
  const groups = sidebar.slice(sidebar.indexOf('const groups = ['), sidebar.indexOf('const frequent ='));
  const hrefs = [...groups.matchAll(/href: "([^"]+)"/g)].map(match => match[1]);
  assert.equal(hrefs.length, new Set(hrefs).size);
  for (const path of ['/admin/ventas', '/admin/instalaciones', '/admin/garantias', '/admin/productos', '/admin/inventario', '/admin/inventario-mayorista', '/admin/compatibilidades', '/admin/home', '/admin/promociones', '/admin/galeria', '/admin/music', '/admin/vehiculos', '/admin/analitica', '/admin/usuarios', '/admin/configuracion', '/admin/finanzas']) assert.ok(hrefs.includes(path), path);
  for (const sector of ['minoristas', 'mayoristas']) {
    assert.ok(hrefs.includes(`/admin/${sector}/finanzas`));
    const page = fs.readFileSync(`app/admin/${sector}/finanzas/page.tsx`, 'utf8');
    assert.match(page, new RegExp(`FinanceOverview sector="${sector}"`));
    assert.doesNotMatch(page, /ExistingPage/);
  }
  assert.doesNotMatch(fs.readFileSync('components/admin/SectorHome.tsx', 'utf8'), /Accesos secundarios/);
});

test('successful presentation save invalidates public pages; failed or unauthorized saves do not', async () => {
  let allowed = true; let fail = false; const invalidated = [];
  const query = { update: () => query, eq: () => query, select: () => query, maybeSingle: async () => ({ data: fail ? null : { id: 1 }, error: fail ? { message: 'test failure' } : null }) };
  const { POST } = load('app/api/admin/site-settings/route.ts', {
    'next/cache': { revalidatePath: path => invalidated.push(path) },
    '@/lib/admin-auth': { isAdminAuthenticated: async () => allowed },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ from: () => query }) },
  });
  const request = () => new Request('https://test.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ section: 'payments', siteSettings: { paymentPresentationEnabled: false } }) });
  assert.equal((await POST(request())).status, 200);
  assert.deepEqual(invalidated, ['/', '/mayoristas', '/checkout']);
  invalidated.length = 0; fail = true;
  assert.equal((await POST(request())).status, 500); assert.equal(invalidated.length, 0);
  allowed = false;
  assert.equal((await POST(request())).status, 401); assert.equal(invalidated.length, 0);
});
