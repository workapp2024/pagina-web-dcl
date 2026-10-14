# Regularización final: ejecución y verificaciones

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


## Cierre verificado el 13/10/2026

La recuperación y la concurrencia pendientes están verificadas. Ya se puede solicitar autorización explícita para la regularización final. Esta verificación no autoriza ni ejecuta cambios en producción. Antes de una futura ejecución debe comprobarse nuevamente que el estado coincide con el alcance aprobado y conservar un respaldo actualizado.

Se preparó PostgreSQL 17.6 de la imagen oficial `supabase/postgres:17.6.1.136`, digest `sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`, incluyendo `supabase_vault`. Referencia de imagen: https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml. Docker respondió con motor 29.8.2. Contenedor `dcl-recovery-20261013-v2`: red `none`, sin puertos publicados, conexión por socket interno, respaldo montado en solo lectura y sin consumidores ni acceso a producción. No se usó `supabase start`. Quedó detenido, conservando las bases. El primer contenedor, cuya provisión de roles falló, también quedó detenido y no contiene una recuperación válida.

El respaldo existente se verificó contra los tamaños y SHA256 del manifiesto y se restauró completo en `dcl_restore_ensayo` con `pg_restore --single-transaction --exit-on-error`, sin excluir objetos, datos, propietarios o ACL. Los controles del restaurador existente se usaron como referencia; no se ejecutó su variante interactiva Windows porque este ensayo opera por socket Docker y no requiere contraseña local del usuario.

Comprobaciones concluidas:

- Coinciden los contenidos de las 106 tablas con COPY del archivo: 859 registros, comparados por contenido y no solamente por conteo.
- Se cotejaron 1.375 secciones de esquema: funciones, tablas, índices, restricciones, triggers, políticas, RLS, ACL y privilegios predeterminados. Se normalizaron casts equivalentes de arrays y orden de roles/grants al volver a exportar.
- Las tres funciones sensibles coinciden exactamente con el JSON instalado exportado, incluidos propietario, ACL y search_path. Coinciden los atributos de 16 roles y las 22 membresías originales con su grantor.
- Se reconstruyeron índices únicos y se comprobaron los datos de todas las claves foráneas y CHECK. Hay 526 restricciones fuera de esquemas internos, 92 tablas con RLS y 12 políticas. La restricción preexistente `realtime.messages.messages_payload_exclusive` conserva NOT VALID; sus filas fueron comprobadas y cumplen el CHECK.
- Las 12 secuencias y las secciones SEQUENCE SET/OWNED BY coinciden con el respaldo. Totales recuperados: siete ventas, cuatro pedidos mayoristas, suma financiera $2 y Producto prueba 1 con cinco unidades.

Diferencias locales de bootstrap: existe un superusuario `recovery_admin`; `supabase_admin` necesita membresías ADMIN adicionales para reproducir los GRANT con el grantor original en un cluster nuevo. Los propietarios de 51 miembros de extensiones y de `pg_reload_conf()` se repusieron según el archivo. Cuatro secciones de ACL de diagnóstico/catálogo se exportan con revocaciones del propietario anterior y grants explícitos que representan los permisos originales; se comprobaron sus permisos efectivos. No se eliminaron ACL ni propietarios para evitar errores ni se cambiaron los atributos de los roles de aplicación. El cluster no es una réplica literal del entorno administrado, aunque conserva los datos y permisos de aplicación verificados.

En `dcl_restore_concurrency`, una copia separada, pasaron 13 pruebas entre conexiones PostgreSQL independientes: bloqueo de fila de producto, conflicto con escritor de reservas, timeout del advisory lock de stock, conflicto con escritores de cada una de las cuatro tablas financieras, timeout del advisory lock compartido con el puente financiero y rechazo de escrituras en las cinco tablas protegidas. Se comprobaron errores NOWAIT/lock_timeout reales.

Las propuestas se cargaron únicamente dentro de transacciones terminadas con ROLLBACK; no se aplicaron migraciones persistentes. El flujo completo y sus reintentos produjeron siete ventas anuladas, cinco auditorías de reversión, un único ajuste de stock a cero, dos imputaciones neutralizadas, efectivo configurado y suma financiera cero, conservando la fecha de instalación. Otra prueba ejecutó las RPC como service_role, comprobó denegación para anon, rechazó stock inesperado y otro cobro cash pendiente sin configurar la cuenta y conservó los demás stocks y todos los movimientos de inventario mayorista. Tras el ROLLBACK no permanecen tablas de regularización ni cambios de stock. La base restaurada de referencia se volvió a validar después de los ensayos.

Evidencia privada excluida de Git: `.local-postgres/recovery-docker/recovery-status.json`, `validation.json`, `roles.json`, `concurrency.json`, `scenario.json`, exportaciones SQL y ejecutores locales. `recovery-status.json` registra `recoveryVerified=true` y `concurrencyVerified=true` vinculados al SHA256 del respaldo. El manifiesto original conserva su valor histórico false; la verificación posterior se registra por separado, sin reescribir el respaldo. Esta verificación cubre la base; los archivos físicos de Storage y secretos externos siguen fuera del alcance del archivo, como ya se documentó.

No se modificó producción ni se realizaron commits, pushes o despliegues. Las propuestas y el ejecutor final siguen pendientes de autorización explícita. Las secciones siguientes son antecedentes históricos y quedan reemplazadas por este cierre donde difieren.


## Avance anterior del 13/10/2026 (reemplazado por el cierre siguiente)

Comprobación puntual de entorno: no se encontraron Docker/Podman en PATH, Docker Desktop en las ubicaciones estándar de instalación global o por usuario, ni servicios/procesos Docker/Podman o instalaciones registradas de Docker/Podman/Rancher. `wsl --list --verbose` informó que WSL no está instalado. Existe un comando Supabase CLI, pero no un `supabase/config.toml` local. No se inició ni instaló ningún entorno nuevo. Próximo paso manual: instalar y abrir Docker Desktop con backend WSL 2, completar sus requisitos y esperar a que el motor esté listo. Después preparar solamente PostgreSQL de la imagen oficial de Supabase, versión 17 compatible, en un entorno dedicado de recuperación sin servicios consumidores ni acceso a producción. No usar `supabase start` en el repositorio vinculado para este ensayo.

Respaldo encontrado en `C:\Users\jvs1\AppData\Local\DCL-Backups\20261012-235145`, fuera del repositorio. Los tres archivos del manifiesto coinciden en tamaño y SHA256; el JSON de funciones coincide con su SHA256 separado. `pg_restore --file=NUL` decodificó el archivo completo sin errores y sin ejecutar SQL. Esto verifica integridad del archivo, no recuperación. El archivo de roles no contiene cláusulas PASSWORD.

Se obtuvieron las tres definiciones instaladas. Los cuerpos de `guard_order_operations()` y `post_wholesale_financial_entry(uuid)` coinciden exactamente con sus bases originales. `order_archive_block_reason(uuid)` conserva las mismas comprobaciones, con formato expandido y referencias explícitas a esquema y alias; la propuesta local se adaptó conservando ese cuerpo instalado y agregando solamente la excepción ya propuesta para las reversiones de prueba. La prueba aislada `node tests/proposed-test-reversal.test.cjs` pasó tras la adaptación. No se aplicó ninguna definición a producción.

Las tres funciones pertenecen a `postgres`. ACL exportadas: solamente `postgres` para las funciones de guardia y puente financiero; `postgres` y `service_role` para archivado. Configuración: `search_path=public` para guardia y archivado, `search_path=pg_catalog, public` para el puente. Las propuestas usan CREATE OR REPLACE sobre las firmas existentes y conservan propietario y ACL; sus search_path coinciden con los exportados.

La preparación del restaurador validó el manifiesto. La restauración completa sigue bloqueada: el archivo requiere `supabase_vault`, ausente en los controles de extensiones del PostgreSQL Windows disponible. También requiere roles gestionados de Supabase y contiene event triggers que deben permanecer aislados de servicios externos. No ejecutar roles.sql ciegamente ni eliminar extensiones, propietarios o ACL para declarar recuperación completa. Preparar un entorno aislado compatible antes de solicitar la contraseña local y ejecutar la restauración.

Pendientes para autorizar la regularización: restauración completa compatible y validación de datos, secuencias, restricciones y permisos; ensayo real de concurrencia entre dos sesiones PostgreSQL. `recoveryVerified` permanece false. Las secciones siguientes describen la preparación anterior y el procedimiento; sus afirmaciones de ausencia de respaldo/definiciones quedan reemplazadas por este avance.

## Respaldo

Clientes PostgreSQL 17.11 disponibles en `.local-postgres/runtime/pgsql/bin`.
El ensayo local `127.0.0.1:55432/dcl_restore_ensayo` consta como vacío; no hay respaldo ni restauración ejecutados.
La clave service_role de la aplicación no sustituye la contraseña PostgreSQL.

El administrador debe disponer de la contraseña existente de la base (sin resetearla), confirmar el endpoint Session pooler en Connect, proporcionar un certificado CA confiable y elegir una carpeta privada fuera del repositorio. Introducir las contraseñas únicamente en los prompts ocultos de PowerShell, nunca en el chat.

Ejecutar `scripts/maintenance/backup-supabase.ps1` con `-PgBin`, `-BackupDirectory`, `-SslRootCert` y `-Execute`. El script conecta en lectura, exporta un único archivo custom con esquema, datos, secuencias, funciones y ACL; exporta roles sin contraseñas y genera SHA256 e índice. Ante un fallo, el respaldo no se considera completo. Confirmar endpoint y versión antes de usarlo; no excluir tablas para evitar errores de permisos.

Para probar recuperación usar `restore-backup-local.ps1` solamente sobre el ensayo vacío, previa provisión local de roles y extensiones compatibles. Un PostgreSQL ordinario puede carecer de extensiones gestionadas por Supabase: si faltan, no declarar recuperación completa ni ignorar errores. Validar conteos, secuencias, restricciones, permisos y funciones antes de marcar el respaldo como recuperable. El script no marca una restauración como verificada automáticamente.

El respaldo de base no contiene los archivos físicos de Storage ni secretos de configuración del proyecto. Mantenerlos por separado si se requiere recuperar todo el servicio. Referencias: https://supabase.com/docs/guides/platform/backups y https://supabase.com/docs/guides/self-hosting/restore-from-platform.

## Funciones

Ejecutar en el SQL Editor la consulta exclusivamente de lectura `read-installed-regularization-functions.sql` y exportar el resultado como JSON privado. El comparador `compare-installed-regularization-functions.cjs <ruta-json>` coteja los cuerpos instalados con los originales utilizados al preparar las propuestas. Comparar también propietario, ACL y configuración. Una diferencia obliga a adaptar la propuesta, conservando la definición instalada; no interpretar falta de acceso como compatibilidad. No se obtuvieron definiciones instaladas en esta etapa.

## Concurrencia

`proposed-regularization-concurrency.sql` es una propuesta adicional, NO aplicada. Sustituye los dos pasos sensibles del ejecutor por RPC transaccionales. El stock se comprueba y ajusta con bloqueo del producto y de reservas; el mismo UUID impide repetir el ajuste. La configuración de efectivo toma el mismo bloqueo del puente financiero y bloquea escrituras en sus tablas durante la comprobación y configuración: cualquier otro pendiente cash provoca rollback. NOWAIT y timeout abortan ante actividad concurrente, sin detener servicios. Durante una futura ejecución autorizada estos bloqueos breves pueden hacer esperar otras escrituras; nada está bloqueado ahora.

Las cinco reversiones existentes conservan sus claves idempotentes y comprobaciones dentro de cada transacción. El ejecutor guarda cada resultado y puede retomar con las mismas claves; un paso fallido no deshace pasos ya confirmados. Toda diferencia inesperada detiene la ejecución. No iniciar mientras falten el respaldo verificado y la comparación de funciones.

Prueba aislada PGlite: ajuste rechazado con stock inesperado, ajuste único al reintentar, efectivo idempotente y rechazo de otro cobro cash pendiente sin configurar la cuenta. PGlite no verifica bloqueo real entre sesiones: resta ensayar concurrencia en PostgreSQL antes de declarar ese punto verificado.
