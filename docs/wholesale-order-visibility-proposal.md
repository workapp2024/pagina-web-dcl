# Archivo de pedidos mayoristas: habilitado

## Aplicación autorizada, 15/10/2026

Se recibió autorización explícita y se aplicó únicamente `proposed-wholesale-order-visibility.sql`, mediante el ejecutor previamente validado: una transacción con NOWAIT, timeout y comprobación de las funciones dependientes. Se crearon dos tablas privadas con RLS, tres funciones y sus índices, restricciones, trigger de historial inmutable y permisos. No se reemplazaron funciones comerciales ni se ejecutaron otras migraciones.

Antes de aplicar se verificaron nuevamente los archivos del respaldo recuperable `20261014-224755`, los hashes de la propuesta y del ejecutor. Las 66 tablas públicas comparadas, excluyendo las sesiones de acceso mayorista, conservaron sus datos. Las funciones, restricciones, relaciones y políticas públicas coincidieron con la captura validada de producción. El primer cotejo contra Docker mostró únicamente las representaciones conocidas de casts de arrays y permisos implícitos del propietario; se confirmó la coincidencia contra la captura de producción antes de escribir.

La comprobación posterior confirmó los tres cuerpos de función exactos, propietario y search_path, RLS y denegación de acceso directo a tablas y secuencia para anon, authenticated y service_role. Solo el backend dispone de las dos RPC de aplicación. Los datos de las 66 tablas y el esquema preexistente permanecieron iguales. Las tablas nuevas quedaron vacías: no se archivó ningún pedido ni se crearon eventos de auditoría de prueba en producción.

Pasaron 28 pruebas relevantes, reutilizando las 22 existentes y seis comprobaciones de presentación y acceso local. Los ensayos aislados verifican archivo/restauración, pertenencia del cliente, independencia del archivo administrativo, idempotencia, auditoría y bloqueo por deuda, crédito/reembolso y mercadería pendiente. Las comprobaciones remotas posteriores fueron exclusivamente de lectura. La configuración local del backend detectó las RPC mediante PostgREST para el administrador y los tres clientes habilitados, sin secretos en la salida y sin escrituras.

Evidencia privada excluida de Git: `.local-postgres/visibility-apply-20261015/`, con autorización, preflight, resultado de aplicación, estados anterior/posterior, `verification.json` y `local-availability.json`. Pendiente: revisión visual del usuario en el entorno local. Sin commit, push, deploy ni avance al Bloque 2. Las secciones siguientes son antecedentes y quedan reemplazadas por este cierre donde difieran.

No aplicada en producción. El respaldo actualizado ya se recuperó y validó, y las diferencias que detuvieron el preflight quedaron revisadas. El usuario pidió informar el resultado para autorizar la aplicación posteriormente. El archivo minorista existente opera sobre `orders`; no corresponde reutilizarlo sobre `wholesale_orders` ni alterar sus estados para ocultarlos.

## Recuperación y cierre del bloqueo, 14/10/2026

Nuevo respaldo completo: `C:\Users\jvs1\AppData\Local\DCL-Backups\20261014-224755`. Sus archivos coinciden en tamaño y SHA256 con el manifiesto; SHA256 del dump: `F64940DE03B1F2737BDE623D991E1C6F32A61D8B86246579D58A72874041BFC6`. El respaldo anterior permanece intacto.

Se reutilizó el procedimiento validado con PostgreSQL 17.6 y `supabase_vault`. Contenedor nuevo `dcl-visibility-20261014-224755`, red `none`, sin puertos publicados, respaldo montado en solo lectura. Restauración completa con `--single-transaction --exit-on-error`, sin excluir objetos, propietarios, ACL ni datos. El validador existente comprobó las 109 tablas y sus 908 registros por contenido, 1.411 secciones de esquema, restricciones, secuencias, RLS, permisos y funciones. Se conservaron las cuatro diferencias locales conocidas de representación de ACL de catálogo/extensiones; sus permisos efectivos fueron verificados. Coinciden los atributos de 16 roles y las 22 membresías originales. No se modificaron los indicadores históricos del manifiesto; la recuperación verificada consta en evidencia separada vinculada al SHA256 del dump.

La revisión se limitó a las diferencias ya señaladas respecto del cierre de regularización:

- Seis sesiones de Auth, seis registros MFA/AMR y seis tokens nuevos, sin eliminar ni modificar los registros previos. Los mismos dos usuarios solo actualizaron `last_sign_in_at` y `updated_at`.
- Cuatro sesiones mayoristas nuevas, sin cambios en las diez originales.
- Una fila adicional en `storage.migrations`: `revoke-grants-to-unused-operations`; las 73 anteriores permanecen iguales. Se comprobaron las revocaciones efectivas de `TRUNCATE`, `REFERENCES`, `TRIGGER` y `MAINTAIN` a `anon` y `authenticated` en las tablas Storage afectadas. No modifica las dependencias públicas de la propuesta.
- La secuencia `auth.refresh_tokens_id_seq` avanzó de 47 a 53, en correspondencia con los seis tokens nuevos. No cambiaron las otras tablas cotejadas, incluidos los datos comerciales y financieros.

Los cambios revisados corresponden a actividad posterior de acceso y a permisos de Storage, sin conflicto identificado con el archivo mayorista.

La propuesta conserva SHA256 `3406441c16a3a0937faf15c5277daba4a533b47b93fb29ae61aefad080aec551`. Se comprobó en la copia PostgreSQL restaurada, con rol efectivo `postgres`, dentro de una transacción terminada con `ROLLBACK`: creación compatible, RLS, denegación de acceso directo a tablas y secuencia de auditoría, denegación de RPC a `anon`/`authenticated`, acceso del backend, pertenencia del cliente, separación del archivo administrativo, restauración, idempotencia e historial inmutable. Las 109 tablas restauradas quedaron idénticas y los objetos de ensayo desaparecieron al revertir. Pasaron nuevamente las mismas 22 pruebas locales aprobadas, incluidos los bloqueos por deuda y reembolso pendiente. No se ensayaron operaciones comerciales nuevas en producción.

Evidencia privada: `.local-postgres/visibility-recovery-20261014/recovery-status.json`, `validation.json`, `differences-review.json`, `archive-compatibility.json` y `archive-readiness.json`. La ejecución está preparada en `archive-ready.sql`, con una transacción, NOWAIT/timeout y comprobación de dependencias y ausencia de objetos previos. Antes de ejecutarla deben repetirse exclusivamente las comprobaciones de estado vigentes. El contenedor quedó detenido conservando las bases.

**Listo para solicitar autorización de aplicación. No se ejecutó la propuesta en producción, ni hubo commit, push o despliegue.** El respaldo cubre la base de datos; conserva los límites previamente documentados respecto de archivos físicos de Storage y secretos externos.

## Preflight del 14/10/2026

Antecedente reemplazado por el cierre de recuperación anterior donde difiera.

Corrección TLS del intento de respaldo nuevo: el primer lanzador utilizó `trusted-windows-roots.pem`, exportado desde Windows, en lugar de la CA de Supabase `prod-ca-2021.crt`. Se reprodujo el error con el conjunto de Windows y se verificó el éxito de la CA de Supabase con el mismo pooler `aws-0-sa-east-1.pooler.supabase.com:5432`, usuario del proyecto y `sslmode=verify-full`. Las tres IPv4 resueltas superaron la comprobación sin contraseña, hasta el rechazo esperado `fe_sendauth: no password supplied` en autenticación. No fue necesario cambiar endpoint, omitir validación ni modificar el servidor. El script ahora verifica TLS antes del prompt oculto y registra ruta, SHA256 y resultado de ese preflight en el manifiesto. Evidencia privada: `.local-postgres/visibility-recovery-20261014/tls-verified.json` y `tls-gate-tests.json`. El respaldo nuevo y su recuperación continúan pendientes de completar el prompt oculto.

- Los tres archivos del respaldo `20261012-235145` conservan tamaños y SHA256 del manifiesto. La evidencia de recuperación verificada corresponde a ese mismo dump. Ese respaldo es anterior a la regularización del 13/10 y no se considera suficiente, por sí solo, para recuperar el estado actual.
- Una transacción remota exclusivamente de lectura cotejó las 106 tablas de la evidencia final de regularización. Cambiaron `auth.mfa_amr_claims`, `auth.refresh_tokens`, `auth.sessions`, `auth.users`, `public.wholesale_access_sessions` y `storage.migrations`, además de valores de secuencias. No cambiaron los contenidos de las otras tablas cotejadas, incluidas las comerciales y financieras. Tampoco cambiaron las funciones, restricciones, relaciones y políticas públicas incluidas en ese cotejo.
- Los objetos de archivo todavía no existen. Se encontraron las dos funciones reutilizadas, con propietario `postgres` y `search_path=pg_catalog, public`. La consulta de elegibilidad se resolvió correctamente contra el esquema actual; se exportaron 110 columnas de las tablas dependientes para su comprobación.
- Pasaron las 22 pruebas locales relevantes: pertenencia del cliente, independencia del archivo administrativo, restauración, permisos, idempotencia, historial inmutable, bloqueo por créditos/reembolsos y deudas pendientes, y conservación de las operaciones comerciales. Las escrituras de ensayo ocurrieron únicamente en PGlite efímero.
- No se ejecutó DDL ni se archivaron/restauraron pedidos en producción. No hubo commit, push ni despliegue.

Evidencia privada excluida de Git: `.local-test-regularization/visibility-20261014/`, incluyendo hashes de la propuesta, `preflight.json`, la instantánea de lectura y `compatibility.json`. Para reintentar hay que disponer de un respaldo actualizado recuperado y validado, y revisar las diferencias detectadas antes de repetir el preflight. La autorización recibida conserva las condiciones expresadas por el usuario; no habilita omitirlas.

La propuesta [SQL](../scripts/maintenance/proposed-wholesale-order-visibility.sql) agrega dos tablas privadas con RLS: visibilidad y auditoría inmutable. Agrega tres funciones: comprobación de elegibilidad, lectura y cambio reversible de visibilidad. Reutiliza la validación de administrador y el guardián de historial existentes. No reemplaza funciones comerciales ni modifica pedidos, pagos, entregas, reservas o inventarios.

El administrador comparte un archivo administrativo. Cada cliente tiene su propio archivo, separado del administrativo. Los endpoints obtienen la identidad desde la sesión y rechazan identidades adicionales del navegador. Solo `service_role` puede ejecutar las dos RPC públicas para la aplicación; las tablas no permiten escritura directa a clientes ni al rol de servicio.

Se permite archivar cancelados, rechazados o confirmados con evento real de entrega completa no revertida. Se bloquea si hay un saldo financiero neto pendiente por moneda, o mercadería sin devolver en un pedido cancelado/rechazado. Si una operación posterior crea una obligación o revierte la entrega completa, el pedido vuelve a aparecer en los listados habituales. Restaurar permanece permitido.

La interfaz detecta si las RPC están instaladas. Mientras falten, no ofrece botones de archivo ni guarda preferencias locales que aparenten un archivo persistente. Las correcciones visuales de resumen e historial funcionan sin esta propuesta.

Ensayo: la propuesta se ejecutó exclusivamente en la base efímera PGlite de las pruebas, con controles de pertenencia, permisos, restauración, idempotencia, auditoría e integridad del pedido comercial. Esto no acredita concurrencia real entre sesiones PostgreSQL.

Antes de habilitar el archivo se requiere cumplir las condiciones de la autorización: respaldo adecuado y recuperable, compatibilidad y ausencia de diferencias inesperadas. Aplicar únicamente este archivo SQL y verificar las funciones y permisos instalados. No ejecutar otras migraciones ni el conjunto de migraciones del repositorio. No hay despliegue autorizado en este bloque.
