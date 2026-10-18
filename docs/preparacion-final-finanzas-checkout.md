# Preparación final de Finanzas y checkout mayorista

Preparación local del 18/10/2026. No se escribieron datos productivos, no se aplicaron migraciones productivas ni se realizaron cobros, commits, push o despliegues. Todos los registros comerciales actuales son de prueba según el administrador. No se autoriza el lanzamiento comercial.

## Finanzas por sector

`proposed-block3-sector-finances.sql` queda ampliado con reclasificación auditada. Las operaciones ordinarias de ingreso/retiro exigen Minoristas o Mayoristas, no admiten omitir sector. Mantiene el libro `cash_movements`, cuentas y puente financiero existentes. La atribución está en una tabla auxiliar enlazada al movimiento, no en una segunda caja.

La nueva API local `/api/admin/finances/sector` deriva el actor de la sesión ADMIN individual, valida sector/cuenta/importe/motivo y vincula una única RPC atómica. La interfaz tiene sector, cuenta, importe y motivo; conserva clave, datos y fecha de confirmación en reintentos. SQL comprueba período, cuenta activa, fondos por cuenta y sector al corte y posteriores, permisos service_role, RLS, inmutabilidad de auditoría y payload idempotente. No se confía en el texto del motivo para asignar sector.

## Reclasificación puntual, no ejecutada

Lectura actualizada: retiro `5b87e40f-f4c8-4897-a83a-2e1b271dddc1`, -$29.998, Mercado Pago, fecha original 18/10/2026 02:07:37.679887 UTC, originado por la RPC manual con clave `aed4b56c-07ae-4781-9e18-d2faeaf9077c`. Sigue siendo el último movimiento consultado; no hay posteriores que cambien esa lectura. El administrador confirmó Mayoristas como sector.

La propuesta puntual **reemplaza el borrador anterior de contramovimiento y retiro sustituto**. Usa `record_sector_finance(action='reclassify')`: agrega una operación de auditoría y una atribución única del movimiento existente a Mayoristas. No inserta, modifica ni elimina filas del libro de dinero. Conserva fecha, cuenta, importe, motivo e idempotency_key originales y registra por separado actor, motivo y fecha de reclasificación. Las restricciones únicas impiden reclasificar o revertir el mismo original por otra clave. Un reintento idéntico devuelve la misma operación. No se permite revertir una reclasificación como si fuera dinero nuevo.

La comprobación de fondos atribuibles considera toda la cronología del sector desde la fecha original; no vuelve a descontar dinero de la cuenta. Si los datos permanecen iguales, el modelo resulta Minoristas $13.300, Mayoristas $0, Sin atribución $0 y consolidado $13.300. Son verificaciones derivadas del libro, nunca constantes impuestas. Si aparecen otra compensación, cambios de período, nuevos movimientos o diferencias del original, detener y revisar antes de ejecutar.

Archivo: `scripts/maintenance/proposed-correct-test-withdrawal-29998.sql`. Requiere autorización específica posterior al SQL financiero. No se ejecutó.

## Checkout mayorista implementado localmente

Endpoints nuevos de preparación y webhook, intención de pago y componente de elección Mercado Pago/Transferencia. Se reutilizan el token/configuración existentes, `providerGet` y la validación de firma del SDK usado en Minoristas; no se modifican endpoints minoristas ni se copia su confirmación de ventas/stock.

El servidor valida sesión y titularidad, cliente activo, pedido confirmado, revisión, moneda ARS y saldo actualizado. Admite parcialidades validadas en SQL y un único intento abierto por pedido. El intento reserva el circuito de cobro: un trigger rechaza otro cobro manual mientras esté en proceso. No modifica reservas de productos, entregas o precios. La confirmación automática inserta el cobro mayorista de proveedor y reutiliza los triggers de auditoría contable y de imputación a Mercado Pago. La nueva auditoría diferencia cliente iniciador y proveedor confirmador; no suplanta a un administrador.

La preferencia se solicita una sola vez por intención mediante una reclamación atómica. Una respuesta de red incierta no autoriza repetir el POST: se busca y verifica la preferencia por external_reference; si no hay una única coincidencia, se conserva el bloqueo para revisión. No se supone que un encabezado de idempotencia de preferencias garantice por sí solo el resultado.

El webhook exige firma válida y consulta al proveedor el pago, merchant order y preferencia: se verifican identidad, relaciones, metadatos, moneda e importe. Un identificador de pago único y bloqueos PostgreSQL serializan callbacks simultáneos. Una aprobación compatible registra un solo cobro, un movimiento financiero enlazado y atribución Mayoristas. No se confirma desde redirects ni parámetros del navegador. Pagos posteriores a cancelación, repetidos con otro ID, devoluciones, contracargos o diferencias se conservan para revisión y no fuerzan un saldo comercial ficticio. Un fallo del puente revierte la transacción y permite reintentar el webhook.

La referencia externa lleva prefijo `wholesale:`: la conciliación minorista existente rechaza esa referencia antes de consultar sus transacciones. Tras volver del proveedor se abre Mis pedidos y se consulta el estado real. Si se recarga la página durante un pago parcial, se recuperan el importe y la clave del intento pendiente, sin generar otro. El administrador ve el bloqueo de un pago automático en proceso y las referencias del proveedor en un apartado secundario de Historial.

### Límites deliberados antes de habilitar

- Un intento vencido o incierto **no se libera automáticamente**: podría existir un pago procesándose. Hace falta verificar su cierre real antes de permitir otro circuito. No hay un botón que lo libere sin evidencia; se conserva para revisión administrativa. Los rechazos durante la vigencia pueden reintentar la misma preferencia.
- Dinero que el proveedor ya haya recibido fuera del saldo esperado queda identificado para revisión/reembolso; no se inventa una devolución externa ni se contabiliza dos veces. Una preferencia externa no garantiza impedir cualquier pago externo tardío; la integración impide su doble imputación y bloquea nuevos intentos al detectar la incidencia.
- Las pruebas de proveedor son simulaciones automatizadas, sin requests reales a Mercado Pago. Antes de habilitación productiva corresponde verificar la configuración de notificaciones y el flujo del proveedor en su entorno de pruebas autorizado.

Referencia técnica primaria de notificaciones y firma: [Mercado Pago](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/payment-notifications). Preferencias y sus referencias/expiración: [API oficial](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post).

## Desactivación por defecto

Ambos circuitos preparados exigen NODE_ENV distinto de production, Supabase de loopback y una bandera local explícita. No se modificó `.env` ni se activó ninguna bandera. Incluso un despliegue accidental conserva los endpoints nuevos sin capacidad de cobrar/mover dinero. La habilitación productiva requiere autorización y una revisión separada del mecanismo de activación, no basta con instalar SQL.

El cierre financiero existente conserva dinero por cuenta mediante aperturas compartidas. No se inventa un reparto de esas aperturas por sector: siguen sujetos a la revisión y reglas ya documentadas para saldos sin atribución.

## PostgreSQL real y ejecución preparada

PostgreSQL 17.11 nativo, cluster nuevo en `.local-postgres/final-preparation/cluster`, exclusivamente `127.0.0.1:55439`. Bases de ensayo creadas con esquema de aplicación y datos inventados, sin consumidores ni credenciales productivas. No se declara que este laboratorio sea una recuperación del proyecto Supabase administrado.

El ensayo entre conexiones independientes verificó bloqueos NOWAIT y timeout reales, dos retiros compitiendo por fondos, reintentos concurrentes de una clave, transferencias sin cambiar el consolidado, denegación por permisos/RLS, auditoría inmutable, checkouts simultáneos, exclusión manual/automático, webhooks simultáneos, parcialidad y pago completo, incidencia tardía por cancelación, reclasificación sin tocar el libro y rollback de dinero/auditoría ante fallo de atribución. Evidencia privada: `.local-postgres/final-preparation/concurrency.json` y ejecutor local.

Resultado: **18 comprobaciones correctas** con PostgreSQL real y conexiones independientes. Se ensayaron además ambos instaladores preparados en otra base vacía: conservaron el libro original y verificaron RLS, ausencia de lectura anon, ausencia de INSERT directo service_role y permiso de las RPC autorizadas. Evidencia: `execution-rehearsal.json`. El servidor aislado quedó detenido al finalizar, conservando las bases.

Se prepararon archivos privados separados `execute-sector-after-authorization.sql` y `execute-checkout-after-authorization.sql`, con transacción, timeouts, rechazo de instalación previa y comprobación de conservación de pedidos, cobros y dinero. Antes de ejecutar: respaldo actualizado recuperable, repetir el preflight READ ONLY, comparar esquema, funciones/ACL y triggers actuales con la evidencia revisada, cotejar el SHA256 de las propuestas, revisar incidencias y actor autorizado. Ante diferencias, detener y rollback. Después: comprobar propietarios postgres, RLS, ausencia de permisos para anon/authenticated, lectura service_role y RPC service_role, inmutabilidad y saldos. Ninguna prueba comercial se ejecuta en producción.

Los rollbacks preparados solo retiran instalaciones nuevas sin ninguna operación o intención. Si existe historia, abortan: no se borra auditoría. Para detener una instalación usada se retira el acceso de los endpoints y se conserva la evidencia, con autorización correspondiente.

## Lista breve para la regularización final de pruebas

- MW-000005: cobro original de $9.880 por Transferencia, aún `pending_mapping`, sin movimiento financiero. No reprocesarlo al instalar SQL ni registrar otro ingreso.
- MW-000006: cobro de prueba de $29.998 por Mercado Pago ya contabilizado; revisar con su pedido, entregas y stock de prueba antes del lanzamiento.
- Retiro de prueba de $29.998: reclasificación puntual pendiente de autorización, manteniendo el original.
- Venta minorista de prueba de $13.300 y sus relaciones operativas: revisar para el cierre de pruebas, sin anularla aquí.
- Los pares y asientos previamente neutralizados conservan su historial: no repetir regularizaciones anteriores.

## Autorizaciones necesarias

1. Instalar exclusivamente el SQL financiero por sector revisado.
2. Ejecutar separadamente la reclasificación puntual del retiro confirmado como Mayoristas.
3. Instalar el SQL del checkout mayorista y validar su configuración de proveedor con pruebas autorizadas.
4. Revisar y autorizar la activación y publicación del código; no constituyen lanzamiento comercial.

La regularización de MW-000005 y los demás registros de prueba requiere otro alcance explícito. No está incluida en ninguno de estos pasos.

## Validacion final de la preparacion

Pasaron la bateria de 91 pruebas de regresion, 44 pruebas de interfaz y 35 pruebas finales de proveedor/API, en ejecuciones separadas con casos compartidos. Pasaron las 18 comprobaciones PostgreSQL independientes y el ensayo de ambos instaladores. TypeScript y build final correctos; lint completo sin errores, con 66 advertencias existentes, y lint focalizado final sin errores. Evidencia: `.local-postgres/final-preparation/tests-final.txt`, `ui-final-tests.txt`, `provider-final-tests.txt`, `concurrency.json`, `execution-rehearsal.json`, `build-complete.txt` y `lint-final.txt`. El cluster quedo detenido. El commit publicado sigue siendo `c04ba0e`; nada de esta preparacion se publico.

## Ejecución autorizada del 18/10/2026

Se generó un respaldo completo actualizado fuera del repositorio y se restauró con éxito en Supabase PostgreSQL aislado, sin red ni puertos: 111 tablas, 1.100 registros y 1.431 secciones de esquema verificadas. Se conservaron propietarios y permisos. La evidencia privada está en `.local-postgres/authorization-recovery-20261018/`.

Se aplicaron las tres operaciones autorizadas en transacciones independientes: SQL financiero por sector, reclasificación exclusiva del retiro original de $29.998 a Mayoristas y SQL de checkout mayorista. Los cuerpos de las 11 funciones coinciden con las propuestas; se verificaron propietario, search_path, RLS y permisos de las cinco tablas nuevas. No se crearon intenciones ni cobros de checkout. La comparación con el respaldo confirmó sin cambios dinero, pedidos, cobros, imputaciones, ventas y productos.

La reclasificación agregó una sola atribución y su auditoría. Conservó el movimiento original, importe, cuenta y fecha, sin un segundo retiro. Saldos derivados: Minoristas $13.300, Mayoristas $0, sin atribución $0 y consolidado $13.300. MW-000005 continúa pending_mapping; no fue imputado.

Esta publicación habilita ingresos y retiros por sector exclusivamente para el proyecto productivo verificado, con opción de desactivación del servidor. Las transferencias entre sectores, fechas elegidas y reversiones no reciben botones nuevos. El checkout automático mayorista conserva su bloqueo productivo: falta verificar en el entorno Vercel la configuración efectiva de credenciales/URL y la entrega firmada de notificaciones del proveedor. No se crearon cargos para certificarlo. La transferencia manual sigue disponible y requiere confirmación del administrador después de verificar la recepción.

La publicación técnica no constituye autorización de lanzamiento comercial. Todos los registros actuales siguen siendo de prueba; su regularización general requiere un procedimiento separado.

Verificación de esta publicación: 79 pruebas focalizadas/regresión correctas, TypeScript y build correctos, lint sin errores (66 advertencias existentes). Se reutilizaron las 18 comprobaciones PostgreSQL de la misma propuesta SQL, cuyos hashes se conservaron, y se verificó la instalación productiva mediante lectura y comparación con el respaldo recuperado. Sin cargos ni movimientos ficticios en producción.
