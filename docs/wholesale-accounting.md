# Diario técnico comercial mayorista

Finanzas es gestión comercial interna: no se implementan facturación electrónica, ARCA, IVA automático ni libros fiscales. El esquema minorista no sirve como destino para ventas mayoristas: `financial_pending_postings` referencia una venta o `payment_transactions`. El circuito mayorista conserva un diario técnico separado para trazabilidad. La migración del 17/10 conecta exclusivamente cobros/reembolsos con caja operativa; no crea ventas minoristas.

## Eventos técnicos del diario

- Entrega completa reconocida: Debe `accounts_receivable`, Haber `sales_revenue`.
- Cobro (incluido anticipo): Debe `cash_clearing` específico del medio, Haber `customer_advances`.
- Reembolso de dinero: Debe `customer_advances`, Haber `cash_clearing` del medio de devolución.
- Reversión del reconocimiento por corrección de entrega: Debe `sales_revenue`, Haber `accounts_receivable`.

El reconocimiento representa una venta comercial completada por entrega total, no un reconocimiento fiscal. El saldo comercial visible es el reconocimiento neto (reconocimientos menos sus reversiones) menos cobros netos (cobros menos reembolsos). Un resultado negativo no constituye automáticamente saldo a favor reutilizable. La conciliación bancaria sigue siendo el historial independiente `wholesale_payment_reconciliation_events`.

Cada journal se vincula al pedido y a su evento fuente con una clave única. Dos líneas se crean en la misma transacción y sus importes son idénticos. Las líneas conservan roles técnicos y una referencia opcional. Los journals aparecen como `awaiting_account_mapping` hasta que ADMIN configura ambos roles; `ready` significa que tienen referencias mapeadas, no una contabilización fiscal. Un plan fiscal y una exportación contable no son requisitos para esta gestión interna. Las etiquetas de interfaz que hablan de contabilidad deben ajustarse en un cambio local posterior.

## Alcance pendiente

1. Aprobar destinos operativos de cobro y mantener separados caja, cobros, ventas completadas, deuda, anticipos y rentabilidad estimada. No exigir cuentas fiscales.
2. Admitir reintegro, saldo a favor y cambio como resoluciones independientes de la devolución física, auditadas y vinculadas al pedido original. No activar efectos financieros automáticamente al recibir mercadería.
3. Definir valoración, parcialidad, aplicación de créditos, diferencias en cambios y disponibilidad de productos devueltos antes de implementar las alternativas faltantes.
4. Los costos conservados son referencias del catálogo, no costos fiscales. Confirmar su uso en rentabilidad estimada sin confundir ésta con cobros o caja.

El detalle de reglas pendientes, pedido de prueba, respaldo y secuencia está en [wholesale-migration-readiness.md](wholesale-migration-readiness.md). Se mantiene el diario técnico; no se implementaron exportaciones contables ni funcionalidades fiscales.

La configuración de cuentas requiere actor ADMIN y deja evento con referencia, fecha y actor. No ampliar permisos a VENDEDOR.
