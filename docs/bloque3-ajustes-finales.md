# Bloque 3 — ajustes finales de Finanzas

Estado del 17/10/2026: cambios locales para revisión visual. No se aplicó la propuesta SQL ni se hicieron operaciones financieras reales.

## Pantallas

Se conservan el componente común, tres tarjetas por sector, período y filtros. La primera tarjeta se llama **Saldo registrado del sector**: el libro no permite demostrar liquidez bancaria o de Mercado Pago. Se indica brevemente **Disponibilidad para retirar: sin verificar**. No se calcula un disponible ni comisiones supuestas a partir de pagos aprobados.

Las explicaciones están dentro de Ayuda sobre los saldos. Se mantiene visible el aviso de egresos sin sector y los pendientes. El historial sigue cerrado: cada fila prioriza fecha, motivo, importe y señal de ingreso/egreso o transferencia. Cuenta, sector, medio de pago, referencia comercial, fecha de registro y datos de auditoría disponibles se muestran en Ver detalle. No se inventan datos de auditoría ausentes en movimientos anteriores. Las reversiones enlazan el original por operación o movimiento, incluidos los vínculos comerciales existentes; si es otro período, debe consultarse ese período.

Las herramientas avanzadas conservan cuentas, imputaciones y cierres; al abrirse desde el resumen no repiten las tarjetas, formularios manuales ni el historial de la pantalla principal.

## Cálculo

Se mantienen las sumas en centavos desde todos los movimientos de `cash_movements` del período. Las referencias de venta y cobro mayorista determinan su sector; las aperturas y operaciones sin evidencia permanecen Sin atribución. Los cobros pendientes y reconocimientos de ventas no se agregan. Las transferencias internas se excluyen de ingresos/egresos externos y sus patas suman cero en el consolidado. No se usa el archivo de registros para cambiar saldos.

El total general es la suma de los tres netos documentados, aunque alguno sea negativo. No se presenta esa atribución como prueba de disponibilidad. La apertura actual no conserva el reparto por sector del cierre anterior: no se infiere un reparto por coincidencia de importes. El arrastre explícito entre períodos sigue siendo una decisión estructural pendiente.

## Operaciones que funcionan ahora

- Ingresar dinero: aporte o ingreso manual, con cuenta, origen externo y motivo.
- Retirar dinero: retiro del propietario, gasto operativo o compra de mercadería. La compra reutiliza `expense` y su motivo; no modifica existencias ni genera una venta.
- Transferir dinero: utiliza `transfer_financial_balance` entre dos cuentas diferentes. Registra la transferencia efectuada por el administrador; no inicia una transferencia bancaria ni cambia la atribución de sector.

Se reutilizan los tipos existentes. Los ingresos comerciales se identifican por sus referencias originales; un aporte manual no se presenta como venta. Las operaciones generales quedan Sin atribución y usan la fecha del sistema porque esos procedimientos no admiten una fecha elegida ni sector. Hay confirmación con importe y cuenta, bloqueo de envíos simultáneos y reintentos con el mismo payload/clave. No hay botón activo de transferencia entre sectores, fecha alternativa o reversión manual nueva.

## Propuesta SQL revisada, no aplicada

`scripts/maintenance/proposed-block3-sector-finances.sql` prepara:

- Ingresos manuales por aporte/ingreso y salidas por gasto/retiro, con sector explícito, cuenta, motivo, contraparte y fecha elegida dentro del período abierto. La operación guarda por separado fecha real de creación e identidad del administrador.
- Transferencias de atribución entre Minoristas, Mayoristas y Sin atribución dentro de una misma cuenta: dos patas, una referencia común, suma cero. No convierte cuentas ni envía dinero por un proveedor externo.
- Reversión compensatoria de operaciones nuevas, con vínculo único al original. También permite revertir movimientos anteriores solo si se demuestra que proceden de `record_financial_movement`, de tipos ingreso/aporte/gasto/retiro y sin vínculos de venta, pago mayorista, reembolso o transferencia. No elimina ni cambia el original. Una corrección histórica sin vínculo anterior requiere revisión puntual antes de habilitar su reversión; no se supone que un texto libre garantice ausencia de compensaciones previas.
- Comparación de payload al reutilizar claves, permisos service_role, validación de administrador activo, RLS y protección de historial. La fecha de reversión no puede preceder a la original.
- Verificación de fondos en el corte elegido y en cada saldo posterior; no permite consumir un cobro futuro ni dejar negativos intermedios por registrar un débito con fecha anterior. Advisory lock compartido con el puente/cierre, lock_timeout de función y bloqueo NOWAIT del libro durante el control.

La propuesta no reemplaza funciones actuales, no cambia categorías históricas y no altera datos comerciales. Las nuevas restricciones de historial protegen los movimientos de estas operaciones y los originales manuales que se reviertan. No modifican filas existentes durante la instalación.

Se comprobó exclusivamente en lectura el esquema financiero instalado: columnas, tipos, restricciones y triggers compatibles con las referencias utilizadas; objetos propuestos ausentes; service_role conserva BYPASSRLS. El guardia mayorista existente permite movimientos sin referencia mayorista y conserva inmutables sus cobros originales. Las dos imputaciones `neutralized_test_pair` de la regularización siguen neutralizadas y no participan de la propuesta. Evidencia privada: `.local-test-regularization/block3-review/final-compatibility.json`.

`rollback-proposed-block3-sector-finances.sql` retira únicamente una instalación nueva sin operaciones. Fue probado. Si ya existe historia, aborta: no elimina evidencias; para detener el uso debe retirarse el permiso de ejecución y conservar datos, con autorización específica.

**Pendiente antes de producción:** autorización explícita, preflight actualizado, recuperación adecuada al alcance y ensayo real de concurrencia PostgreSQL. PGlite valida atomicidad y reglas, pero serializa conexiones. Falta conectar los formularios nuevos al procedimiento autorizado; la instalación no activa botones por sí sola. No se declara listo para aplicar directamente el archivo.

## Conciliación

La propuesta separada en `docs/propuesta-conciliacion-financiera.md` compara arqueo/extracto con el libro al mismo corte, guarda evidencia y enlaza referencias existentes. No vuelve a registrar ingresos al acreditar un pago ya contabilizado. Comisiones y diferencias solo generarían movimientos separados cuando estén comprobadas y autorizadas, con referencias únicas. No se implementó una integración ni se consultaron datos financieros externos para pruebas.

## Validación y revisión visual

Pruebas focalizadas de interfaz, transferencias entre cuentas, referencias de reversión, separación de sectores, paginación completa, conciliación operativa existente y procedimientos financieros. En base efímera se prueban fecha elegida, payload repetido/conflictivo, saldo cronológico, doble reversión, permisos, reversión manual histórica admisible, rechazo de apertura, protección del original, rollback atómico ante fallo de atribución y retiro de instalación vacía/rechazo con historia. No se usan datos financieros reales para escrituras.

Pasaron 35 pruebas focalizadas, TypeScript y build. Lint finalizó con cero errores y 66 advertencias existentes. Los resultados están en `.local-test-regularization/block3-review/final-tests.txt` y `final-lint.json`. El servidor local respondió HTTP 200 en la ruta general. Las pantallas están preparadas para revisión autenticada en PC y celular; no se declara realizada esa revisión visual. No se modificaron los Bloques 1 y 2 ni se hicieron commits, pushes o despliegues.
