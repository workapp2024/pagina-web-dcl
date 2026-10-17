const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const { matchesWholesaleOrder, customerTrackingEvents } = load('lib/wholesale-order-presentation.ts');
const { WholesaleOrderTracking } = load('components/wholesale/WholesaleOrderTracking.tsx');
const order = { id:'one', order_number:'MW-000001', status:'received', created_at:'2026-10-01T12:00:00Z', confirmed_at:null, items:[] };

test('customer filters keep rejected and cancelled requests in history and search every status', () => {
  for (const status of ['rejected','cancelled']) {
    const value = {...order,status};
    assert.equal(matchesWholesaleOrder(value,'','active'),false);
    assert.equal(matchesWholesaleOrder(value,'mw-000001','history'),true);
    assert.equal(matchesWholesaleOrder(value,'MW-000002','all'),false);
    const events = customerTrackingEvents(value);
    assert.equal(events.at(-1).terminal,true);
    assert.equal(events.at(-1).at,null);
    assert.equal(events.some(event => event.id === 'confirmed'),false);
  }
});

test('tracking preserves known dates and shows cancellation after confirmation as an outcome', () => {
  const confirmed = {...order,status:'confirmed',confirmed_at:'2026-10-02T12:00:00Z'};
  assert.deepEqual(Array.from(customerTrackingEvents(confirmed),event => event.at),[order.created_at,confirmed.confirmed_at]);
  const cancelled = customerTrackingEvents({...confirmed,status:'cancelled'});
  assert.equal(cancelled.at(-1).terminal,true);
  assert.equal(cancelled.at(-1).at,null);
  assert.equal(matchesWholesaleOrder(confirmed,'','active'),true);
  assert.equal(matchesWholesaleOrder(order,'','active'),true);
});

test('shared timeline renders real deliveries and terminal outcomes without adding successful stages', () => {
  const html = renderToStaticMarkup(React.createElement(WholesaleOrderTracking,{events:[{id:'delivery',label:'Entrega registrada',at:'2026-10-02T12:00:00Z'},{id:'cancel',label:'Solicitud cancelada',terminal:true}],nextAction:'Sin acciones <internas>'}));
  assert.match(html,/Entrega registrada/);
  assert.match(html,/Solicitud cancelada/);
  assert.match(html,/dateTime="2026-10-02T12:00:00Z"/i);
  assert.match(html,/Sin acciones &lt;internas&gt;/);
  assert.doesNotMatch(html,/Pedido finalizado|Propuesta aceptada/);
  assert.equal((html.match(/<time /g)||[]).length,1);
});

test('a completed delivery enters history and a genuine completion reversal returns it to active orders', () => {
  const delivered = {...order,status:'confirmed',tracking_events:[{id:'1',type:'order_fully_delivered',at:'2026-10-03T12:00:00Z'}]};
  assert.equal(matchesWholesaleOrder(delivered,'','active'),false);
  assert.equal(matchesWholesaleOrder(delivered,'','history'),true);
  assert.equal(customerTrackingEvents(delivered)[0].label,'Entrega completa');
  const corrected = {...delivered,tracking_events:[...delivered.tracking_events,{id:'2',type:'order_delivery_completion_reversed',at:'2026-10-04T12:00:00Z'}]};
  assert.equal(matchesWholesaleOrder(corrected,'','active'),true);
  assert.equal(customerTrackingEvents(corrected).at(-1).terminal,true);
});
