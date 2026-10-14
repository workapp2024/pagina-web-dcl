# Preparación local del circuito mayorista

## Cambios preparados

Las migraciones pendientes del 14/10 y 17/10 contienen las correcciones locales:

- El cierre incluye pendientes mayoristas creados después de la activación financiera, aunque sean anteriores al período abierto. Excluye el historial cubierto por la apertura y no consulta otros libros ni bloquea por métodos sin uso. Conserva el bloqueo compartido con los postings y la idempotencia del cierre.
- Los cobros comparan la misma referencia normalizada que almacenan (`NULLIF(btrim(...),'')`). Una referencia diferente conserva el conflicto de idempotencia.
- Correcciones y devoluciones guardan el motivo completo sin concatenar prefijos. El tipo de movimiento identifica su naturaleza. Ambos límites continúan en 500 caracteres; no se trunca el texto.

Se modifican estas migraciones porque la auditoría confirmó que sus objetos aún no están materializados en producción. No se modificaron las dos versiones ya materializadas ni se preparó una reparación automática del historial.

## Equivalencia de las versiones 20261008020000 y 20261008030000

Proyecto comprobado: DCL-Cree-Led (`ajbztbwflhjxrenryphu`). Comparación exclusivamente de metadatos, con `BEGIN READ ONLY` y `ROLLBACK`, contra la creación de ambas migraciones en PGlite en memoria.

Coincidieron las 175 entradas del catálogo remoto comparadas: cinco tablas, dos secuencias, columnas (incluidos tipos, posiciones, nulabilidad, defaults e identidad), PK/FK/CHECK/UNIQUE, índices, triggers y habilitación, RLS/policies, propietarios, ACL de tablas/columnas/secuencias y las 24 funciones (cuerpos, argumentos, resultados, defaults, lenguaje, seguridad, volatilidad, configuración y ACL). Se normalizaron comentarios y espacios para comparar cuerpos SQL.

PGlite representa además 45 restricciones NOT NULL como entradas propias de pg_constraint; PostgreSQL 17 remoto las representa en pg_attribute. Sus indicadores de nulabilidad coincidieron. Esto es una diferencia de catálogo entre versiones, no una divergencia del esquema lógico.

También se comprobaron privilegios efectivos de anon, authenticated y service_role para tablas, columnas, secuencias y funciones: cero diferencias frente al contrato local, incluyendo posibles privilegios heredados.

Conclusión: los objetos definidos por ambas migraciones son lógicamente equivalentes al estado remoto combinado. No significa que puedan reejecutarse: sus CREATE fallarán por duplicados. Sigue pendiente una decisión autorizada sobre la reconciliación del historial, después de respaldar. No se reparó el historial ni se compararon/copiaron datos privados.

## Propuesta de transición del pedido confirmado sin reserva

Esto es un diseño pendiente de aprobación, no SQL ejecutable ni autorización de cambios.

1. Revisar físicamente el pedido: determinar si está íntegramente pendiente, parcialmente entregado o totalmente entregado, y si existe dinero recibido fuera del circuito. No deducir entregas ni cobros del estado `confirmed`.
2. Mientras no se resuelva, impedir nuevas entregas sobre ese pedido y evitar operaciones mayoristas entre etapas de la actualización. Preservar número, revisión confirmada, snapshots y fechas originales.
3. Si todas las unidades están pendientes, preparar una operación ADMIN específica de adopción, distinta de reconfirmar. Registrar en una tabla de transición inmutable una identidad única `(order_id, confirmed_revision_id)`, fingerprint del alcance aprobado, actor, motivo y fecha. La primera ejecución y todos sus movimientos deben confirmar o revertir en una sola transacción.
4. Bloquear el pedido y las existencias por producto en orden estable. Verificar el estado/revisión esperados y las cantidades exactas del snapshot. Exigir existencias físicas mayoristas cargadas mediante ingresos auditados: no copiar ni descontar `products.stock`, ni inventar stock por el backfill.
5. Insertar reservas por producto con claves deterministas propias de la adopción y referencia al registro de transición. Reintentos idénticos devuelven el mismo resultado sin escribir; un fingerprint diferente falla. Antes de reservar, descartar reservas previas/conflictos. Una falla de stock debe revertir también el registro de transición.
6. Si hubo entregas previas, no reservar el total. Preparar otro diseño de importación explícita de entregas y saldo pendiente, evitando registrar dos veces consumos físicos, reconocimiento o caja. Requiere aprobación comercial de cantidades y fechas; no está implementado aquí.
7. Ensayar en una restauración aislada: primer intento, reintento, conflicto, dos sesiones simultáneas y stock insuficiente. Verificar reservas exactas, una sola auditoría y stock minorista, cobros y períodos históricos sin cambios.

## Decisiones comerciales y contables pendientes

- Confirmar la situación física y financiera del pedido anterior y las existencias iniciales mayoristas.
- Aprobar cuentas por rol, moneda y medio de cobro; decidir si los destinos predeterminados cash/mercadopago son correctos y quién administra cambios.
- Definir cómo aplicar anticipos a cuentas por cobrar: el diario actual registra cobros como anticipos y reconocimiento como cuenta por cobrar; no incorpora su compensación.
- Definir reconocimiento en entrega completa frente a parcial, tratamiento de impuestos/costos y devoluciones reales, notas de crédito y reembolsos. Una devolución física no debe inventar automáticamente una devolución de dinero o un nuevo reconocimiento.
- Establecer exportación/recepción idempotente de asientos y conciliación de cobros ya cargados manualmente para evitar duplicar la operación económica con otra clave.

Antes de producción siguen siendo necesarios el respaldo restaurado y verificado, la resolución autorizada del historial, la transición aprobada y el ensayo de la secuencia completa. No ejecutar las diez versiones ciegamente ni habilitar actividad entre backfills: el diario del 16/10 solo captura nuevas fuentes.## Pedido de prueba: propuesta de cancelaci?n

El negocio confirm? que el pedido confirmado es de prueba. Se descarta para este caso la propuesta anterior de adopci?n de reservas: no debe simularse una venta real.

Consulta remota de solo lectura: MW-000001, estado confirmed, revisi?n actual igual a la confirmada, una revisi?n, un ?tem y un intento asociado. Eventos: order_created, revision_created, review_started y order_confirmed, uno de cada tipo. Las tablas de entregas, reservas, cobros, reconocimientos y postings mayoristas posteriores todav?a no existen. No hay referencias directas verificadas en inventario minorista, pedidos minoristas ni caja; tampoco otros eventos mayoristas. Esto no identifica movimientos manuales sin referencia ni prueba hechos fuera del sistema.

Procedimiento pendiente de autorizaci?n, preferentemente antes de la migraci?n de inventario:

1. Respaldar y probar recuperaci?n. Resolver la identidad t?cnica por n?mero ?nico MW-000001 sin publicar IDs de cliente. Volver a comprobar estado, revisi?n, relaciones y ausencia de efectos en una transacci?n; bloquear el pedido para evitar concurrencia. Si hay nuevas tablas/efectos o diferencias frente a lo aprobado, detener.
2. Usar la RPC existente close_wholesale_order con acci?n cancel, actor ADMIN activo y nota 'Pedido de prueba; anulaci?n autorizada; sin operaci?n comercial real'. No DELETE, reconfirmaci?n, reserva, devoluci?n ni reembolso.
3. La versi?n actual solo cambia estado a cancelled, establece closed_at y agrega order_cancelled. Conserva confirmaci?n, revisi?n, snapshots, intento y eventos anteriores. Un reintento sobre el mismo pedido cancelado no genera otro evento.
4. Comprobar un solo evento de cancelaci?n, historial conservado y cero movimientos nuevos en stock/caja. No modificar artificialmente el estado de la revisi?n o del intento. Conservar esta cancelaci?n y su nota en reportes/auditor?a.

No se ejecut? la cancelaci?n ni se prepar? SQL de modificaci?n autom?tica.

## Decisiones comerciales confirmadas y alcance m?nimo

Finanzas es gesti?n comercial interna. No implementar facturaci?n electr?nica, ARCA, IVA autom?tico ni libros fiscales. Conservar separados cobros/reembolsos, ventas completadas por entrega total, deuda comercial, anticipos, caja y rentabilidad estimada. El reconocimiento existente se interpreta como venta comercial completada; no es reconocimiento fiscal.

Conservar el diario t?cnico por su v?nculo idempotente con operaciones fuente. Sus nombres SQL no obligan a contabilidad formal, ni su estado ready certifica una contabilizaci?n externa. Pendiente local: cambiar etiquetas que hoy hablan de contabilidad/asientos por trazabilidad comercial; mantener cuentas operativas de caja, distintas de roles internos del diario. Mapeos fiscales y exportaci?n contable dejan de ser prerrequisitos del negocio.

Reintegro monetario y devoluci?n f?sica ya son operaciones separadas e inmutables, pero el reintegro se vincula al cobro, no a una devoluci?n espec?fica. Saldo a favor y cambio no est?n implementados. Un saldo negativo calculado de un pedido no constituye un cr?dito reutilizable.

Cambios imprescindibles futuros, despu?s de definir reglas:

- Resoluci?n comercial de devoluci?n con identidad/idempotencia, actor, motivo, pedido original e ?tems devueltos; impedir resolver dos veces las mismas unidades/importe y permitir trazabilidad entre recepci?n f?sica y resoluci?n. No crear autom?ticamente efectos monetarios por recibir mercader?a.
- Reintegro: conservar refund_of y l?mite del cobro; vincular la resoluci?n al reembolso existente y comprobar que no haya otro cr?dito/cambio por el mismo alcance.
- Saldo a favor: libro separado de cr?ditos y aplicaciones, vinculados al cliente/pedido/devoluci?n, sin ingresar dinero a caja ni reconocer una venta al emitirlo. Las aplicaciones deben ser idempotentes y limitarse al disponible.
- Cambio: vincular devoluci?n y operaci?n de reposici?n al pedido original; registrar la salida real mediante inventario mayorista. No reescribir la revisi?n confirmada ni crear un cobro ficticio.
- Ajuste comercial por devoluci?n: mostrar importe devuelto/ajustado separado de reembolsos y cr?ditos; definir su efecto en ventas netas, deuda y rentabilidad antes de implementar.

Reglas esenciales que debe definir el negocio: valoraci?n de lo devuelto (precio hist?rico y redondeo); devoluci?n parcial y combinaci?n de alternativas; si se acredita valor de mercader?a o solo importe efectivamente pagado; alcance/vencimiento/transferibilidad y aplicaci?n del cr?dito; diferencias de precio y fecha en cambios; existencia disponible y tratamiento de mercader?a defectuosa/no revendible. Hoy la devoluci?n f?sica incorpora todo al disponible: confirmar esa condici?n o introducir un destino no disponible. No programar esas reglas por suposici?n.

## Reconciliaci?n y ejecuci?n futura

Equivalencia ya comprobada arriba. Tras respaldo recuperable y autorizaci?n expresa espec?fica, reconciliar exclusivamente 20261008020000 y 20261008030000 como materializadas, mediante la herramienta oficial de historial. No reejecutar sus CREATE ni marcar las ocho restantes. Previamente confirmar que no hubo cambios desde la comparaci?n; despu?s verificar que el historial refleja ambas versiones y que datos/estructuras no cambiaron. No se ejecut? ninguna reparaci?n.

Orden de las ocho restantes, sin operaciones mayoristas entre etapas:

1. 20261011010000_wholesale_revision_expected.sql
2. 20261012010000_wholesale_customer_proposal_responses.sql
3. 20261013010000_wholesale_stock_deliveries.sql
4. 20261014010000_wholesale_delivery_corrections_payments.sql (corregida)
5. 20261015010000_wholesale_sale_recognition.sql
6. 20261016010000_wholesale_accounting_journal.sql
7. 20261017010000_wholesale_financial_account_postings.sql (corregida)
8. 20261018010000_financial_accounts_and_payment_presentation.sql

Mantener las tres correcciones y las 16 pruebas aprobadas; no se repitieron en esta preparaci?n documental. Ensayar esta secuencia en una restauraci?n aislada; no habilitar devoluciones comerciales completas hasta resolver e implementar sus reglas. El diario del 16/10 no incorpora autom?ticamente fuentes anteriores.

## Condiciones de respaldo comprobadas y faltantes

La consulta de listado de backups devolvi? backups=null, physical_backup_data vac?o, pitr_enabled=false y walg_enabled=true. No hay copia recuperable confirmada: walg_enabled no prueba existencia ni retenci?n de una copia. El pooler PostgreSQL responde por TCP; no se comprob? autenticaci?n PostgreSQL ni acceso de exportaci?n. pg_dump, pg_restore y psql no est?n en PATH.

Antes de modificar producci?n: disponer de clientes compatibles con PostgreSQL 17, acceso de lectura suficiente y destino cifrado con espacio; exportar esquema/datos, secuencias, ACL/RLS, funciones/triggers, historial de migraciones y dependencias de Auth. Registrar checksum y resultado sin credenciales. Conservar activos Storage por separado. Restaurar en un entorno Supabase/PostgreSQL aislado compatible, con extensiones/roles/dependencias correctos, y verificar conteos, stock, saldos, historial, secuencias y permisos. Un archivo descargado o pg_restore --list no prueba recuperabilidad. La restauraci?n de ensayo debe evitar correos, webhooks y pagos reales.

Trabajo local pendiente: documentaci?n de reglas aprobadas, cambios m?nimos de etiquetas/datos/API/UI de devoluciones y pruebas relacionadas. Requieren autorizaci?n separada: crear un entorno remoto de ensayo si fuese necesario, cancelar el pedido, reconciliar historial y aplicar migraciones. El respaldo de lectura y la restauraci?n local aislada pueden prepararse sin alterar producci?n. No se autoriza aqu? ninguna escritura remota.
