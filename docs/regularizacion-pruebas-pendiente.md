# Estado de regularización de pruebas

## Regularización ejecutada el 13/10/2026

Se recibió autorización explícita para el alcance previamente ensayado. Se aplicaron únicamente las tres propuestas SQL revisadas en una transacción, con bloqueos NOWAIT, timeout y comprobación de las funciones instaladas antes de reemplazarlas. No se aplicaron otras migraciones ni se realizaron commits, pushes o despliegues.

Antes de escribir se verificaron nuevamente el manifiesto y el respaldo recuperado. Una consulta de solo lectura comparó las 106 tablas respaldadas, las secuencias, las funciones, las restricciones, las relaciones y las políticas públicas contra la base restaurada. No hubo diferencias semánticas. El primer cotejo incluyó diferencias de orden, permisos implícitos del propietario y representación de referencias según search_path; se corrigió y repitió antes de escribir. El respaldo verificado representa el estado inmediatamente anterior a esta regularización, con coincidencia de sus datos y esquema de aplicación.

Ejecutado mediante las RPC revisadas, con claves idempotentes deterministas y verificación por paso:

- Reversión de los cinco pedidos minoristas entregados pendientes y sus ventas vinculadas. Las dos ventas independientes ya anuladas no se ejecutaron nuevamente. Las siete ventas de prueba están anuladas.
- Cinco restituciones de una unidad, seguidas de un único ajuste de -10 unidades de Producto prueba 1. No se ajustaron otros productos.
- Dos contramovimientos de -$1 en Mercado Pago, ligados a los ingresos originales. Caja $0, Mercado Pago $0, consolidado $0. No se realizaron reembolsos externos.
- Invalidación de la instalación `470a2110-0bfb-40ca-a002-5a841dc6dbb0`, conservando `completed_at=2026-09-30T01:54:34.242Z` y su snapshot original.
- Neutralización de las dos imputaciones del par cobro/contrarregistro de MW-000004, sin generar movimientos de efectivo.

Existencias finales verificadas:

| Producto | Identificador | Existencia | Reserva | Disponible |
| --- | --- | ---: | ---: | ---: |
| Producto prueba 1 | `producto-1790288673630` | 0 | 0 | 0 |
| LUPA POSICION DORADO | `producto-1790731943415` | 0 | 0 | 0 |
| IR 100 DAKAR mayorista | `producto-1788919384672` | 0 | 0 | 0 |

Verificación posterior de solo lectura: las 106 tablas originales se cotejaron nuevamente. Todos los registros originales de movimientos, notas e historial operacional permanecen íntegros. Los snapshots de las cinco órdenes, pagos y ventas coinciden exactamente con el estado anterior; también los de instalación e imputaciones. Coinciden los ocho cuerpos de funciones instalados con las propuestas; se comprobaron propietarios, ACL, search_path y RLS de auditoría. Los demás productos coinciden íntegramente, y todos los movimientos de inventario mayorista permanecen idénticos.

Los cuatro pedidos mayoristas tienen ventas netas, pagos netos, deuda y crédito cero. Los saldos netos de los asientos de prueba por rol contable —cash_clearing, customer_advances, accounts_receivable y sales_revenue— son cero. Se conservaron los asientos originales. No se crearon operaciones comerciales nuevas para probar en producción.

**Regularización completa, sin bloqueos pendientes.** El usuario aprobó explícitamente `cash` (Caja) como destino del efectivo mayorista. Se repitieron las comprobaciones de estado y funciones y se ejecutó únicamente `map_confirmed_test_cash_safely`, sin repetir reversiones ni ajustes. El mapeo quedó en `cash`, con un único evento de auditoría del actor autorizado. No se generaron movimientos de dinero: las dos imputaciones de MW-000004 permanecen neutralizadas. La comprobación posterior de las 106 tablas confirmó saldos, deudas y créditos cero, los tres inventarios en cero y los registros ajenos e históricos conservados. La aprobación y los estados anterior/posterior del mapeo están guardados en la misma carpeta privada de evidencia.

Evidencia privada excluida de Git: `.local-test-regularization/final-20261013/`, incluyendo preflight, estado anterior y posterior, operaciones con claves y resultados, verificaciones por paso, `final-verification.json`, `audit-verification.json` y resumen de ejecución. Las secciones siguientes describen antecedentes y quedan reemplazadas por este estado donde difieren.


# Regularización de pruebas — estado y autorización pendiente

Se ejecutó únicamente el bloque con procedimientos existentes, autorizado el 12/10/2026.
Los respaldos privados y verificaciones por paso están en `.local-test-regularization/`, excluidos de Git.

Aplicado:
- Ventas independientes `8cc24ca5-b618-4cd0-b5f3-9ef8f233250a` y `49a5d8de-9ccb-4172-a54a-c3e2f1abb31e`: anuladas; dos garantías invalidadas; dos ingresos de $1 compensados.
- MW-000001: cancelado sin restitución de mercadería.
- MW-000004: entrega corregida, reconocimiento revertido, pedido cancelado y cobro contrarregistrado. Venta, cobro y saldo comercial netos: cero.
- LUPA minorista e IR 100 DAKAR mayorista: existencia/reserva/disponible cero, mediante movimientos con motivo autorizado.
- Otros inventarios: comparados antes/después, sin cambios.

Pendiente, no aplicado:
1. `scripts/maintenance/proposed-delivered-test-regularization.sql`: agrega auditoría y reversión restringida a los cinco pedidos entregados confirmados como pruebas; conserva sus snapshots y archivo. Solo admite la transición final a anulado desde el procedimiento, sin volver a abrir pedidos. Invalida la instalación completada conservando la fecha original.
2. `scripts/maintenance/proposed-neutralize-test-postings.sql`: conserva el par cobro/contrarregistro de MW-000004 y lo marca neutralizado, evitando generar un ingreso efectivo ficticio al configurar efectivo. No altera otros cobros; nuevos pagos continúan usando el puente existente.
3. `scripts/maintenance/complete-approved-test-regularization.cjs`: ejecución restringida, posterior a aprobación y aplicación de ambas propuestas; termina las cinco ventas, ajusta Producto prueba 1 a cero, neutraliza el par mayorista y solo entonces configura efectivo.

Las propuestas fueron probadas en PostgreSQL aislado (PGlite), sin credenciales remotas. No fueron enviadas a la base configurada ni colocadas en el directorio de migraciones automáticas.

Estado financiero actual: Caja $0, Mercado Pago $2, consolidado $2. Cinco ventas siguen pendientes de reversión; solo dos tienen ingresos originales a compensar. Producto prueba 1 permanece en 5 unidades hasta que se complete ese bloque; no ajustar antes.

Requiere autorización adicional para aplicar las dos propuestas no destructivas y ejecutar el bloque de finalización. No desplegar, hacer commit/push, borrar registros ni ejecutar devoluciones externas.
