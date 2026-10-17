# Creación mayorista — revisión para autorización

## Instalación autorizada completada — 17/10/2026

El usuario autorizó explícitamente instalar la propuesta corregida. Se ejecutó únicamente `.local-test-regularization/block2-review/execute-after-authorization.sql`, SHA256 `7F3118217300713DD1C88CF5463210A2DE6129B20E377A1D5D54B0F7110BEC9D`, después de confirmar que el preflight y los hashes seguían coincidiendo con la revisión. La transacción terminó correctamente.

Una consulta posterior independiente comprobó el cuerpo exacto instalado, propietario postgres, SECURITY INVOKER, `search_path=pg_catalog, public` y EXECUTE únicamente para postgres y service_role. Permanecen idénticos los siete clientes, los doce eventos de auditoría y las dependencias, triggers y permisos revisados. No se invocó la función ni se crearon clientes ficticios. No se activaron accesos ni códigos y no se ejecutaron escrituras comerciales, otras migraciones, commits, pushes o despliegues.

Evidencia privada: `authorized-preflight.json`, `authorized-execution-result.json`, `authorized-postflight.json` y `authorized-completion.json` en `.local-test-regularization/block2-review/`. Con la aprobación visual previa y esta instalación, el Bloque 2 queda terminado. No se avanzó al Bloque 3. Las secciones siguientes conservan el estado histórico de preparación.

17/10/2026. El usuario aprobó visualmente el Bloque 2. Esta revisión no autoriza ni aplica SQL en producción.

**La propuesta corregida está lista para solicitar autorización explícita**, limitada a instalar `public.admin_create_wholesale_customer(jsonb)` y sus permisos. La instalación no invoca la función ni crea clientes.

## Compatibilidad y corrección

Se consultaron en Supabase, exclusivamente en lectura, las columnas, restricciones, funciones, propietarios, permisos efectivos, RLS, triggers de clientes/historial y event triggers relevantes. La definición instalada de `admin_manage_customer(text,uuid,jsonb)` coincide con la utilizada en las pruebas y con la exportada en el respaldo recuperado. La función nueva todavía no existe.

La propuesta anterior intentaba UPDATE sobre `customer_admin_history`, operación que `service_role` no puede realizar. Se corrigió sin ampliar permisos: utiliza la creación original, clasifica solamente el UUID recién generado y agrega un evento `edit` con estados anterior y posterior. El evento `create` original permanece íntegro. Devuelve la fila final actualizada, sin hash de acceso.

La nueva función es SECURITY INVOKER, pertenece a postgres y fija `search_path=pg_catalog,public`. Solo postgres y service_role tienen EXECUTE. Conserva las validaciones originales de datos. No habilita acceso mayorista ni asigna códigos. La ruta existente exige administrador para esta creación. No reemplaza funciones existentes.

La condición mayorista no impone exclusividad: no cambia clientes existentes ni elimina relaciones minoristas; los clientes con actividad en ambos canales conservan su identificación y clasificación visual actual. No agrega una habilitación dual explícita sin historial, cuestión que queda fuera de este cambio.

No contiene escrituras sobre pedidos, ventas, inventarios o finanzas. Los triggers de clientes revisados actualizan la fecha de modificación o gestionan historial de códigos; la propuesta no actualiza códigos. Los event triggers aplicables al CREATE FUNCTION notifican la recarga de esquema a PostgREST, sin operaciones comerciales.

## Respaldo

Se encontró el respaldo posterior `20261014-224755`, creado el 14/10 local y recuperado/verificado el 15/10. Se comprobaron nuevamente tamaños y SHA256 de los tres archivos del manifiesto y su vinculación con `recovery-status.json`. Las huellas de contenido de los siete clientes y doce eventos de auditoría actuales coinciden con los datos de la recuperación, además de la función de creación original.

El respaldo completo sigue siendo histórico; no se afirma que represente el estado actual de toda la base. Es adecuado como respaldo recuperable para este alcance aditivo, acompañado de la captura actual de dependencias y permisos. La reversión prevista consiste en retirar únicamente la función nueva, sin restaurar la base histórica sobre datos actuales. Retirar la función no elimina clientes que se creen después de su habilitación.

No se repitió la auditoría general ni una restauración completa. El motor Docker está detenido/no disponible; se reutilizó la evidencia de recuperación ya verificada, vinculada al mismo hash.

## Ejecución preparada, no aplicada

Evidencia privada excluida de Git: `.local-test-regularization/block2-review/`.

- `current-schema.json`: lectura actual, permisos y huellas de clientes/historial.
- `readiness.json`: integridad del respaldo, comparación de dependencias y hashes de propuesta/ejecutor.
- `execute-after-authorization.sql`: transacción con preflight contra el estado revisado, timeouts, CREATE FUNCTION y comprobaciones de propietario, SECURITY INVOKER, search_path y ACL. Comprueba después que clientes, historial y dependencias permanecen iguales. No llama a la RPC.
- `rollback-after-authorization.sql`: retirada de la función nueva, sin CASCADE.

El ejecutor debe usarse solo después de autorización explícita. Cualquier cambio del estado revisado provoca error y rollback; debe revisarse esa diferencia antes de preparar otra ejecución. No se debe sustituir por ejecutar la propuesta sin sus controles.

## Pruebas

Pasaron 15 pruebas focalizadas de propuesta, rutas y acceso de clientes y navegación ya existente. La prueba SQL utiliza PGlite aislado, las definiciones de migraciones existentes, restricciones, RLS y permisos equivalentes a los inspeccionados. Comprueba ejecución como service_role sin UPDATE de auditoría, denegación a anon/authenticated, clasificación sin activar acceso, auditoría agregada, validación de entrada, rollback por fallo de clasificación/auditoría, conservación de un cliente con relaciones minoristas y condición mayorista, y tablas comerciales sin cambios. Lint de la prueba modificada pasó sin errores.

No se crearon clientes de prueba en producción ni se aplicaron migraciones, commits, pushes o despliegues. No se avanzó al Bloque 3.
