# Administrador de categorias y destinos

## Verificacion manual pendiente

El usuario informo que aplico 20261025010000_catalog_foundation.sql con exito. No se reaplico ni se ejecuto SQL remoto desde Codex.

Ejecutar en SQL Editor UNICAMENTE supabase/checks/catalog_foundation_after.sql. Es BEGIN READ ONLY / SELECT / ROLLBACK. No confundirlo con la migracion.

Esperado antes de usar el administrador: seis tablas con RLS=true y cero politicas directas; dos categorias y seis destinos iniciales; lock=1, assignments=0, destinations=0, aliases=0; cinco triggers habilitados, restricciones y FK presentes, indices; funcion security_definer=false. anon/authenticated sin SELECT/INSERT/UPDATE/DELETE/TRUNCATE en las tablas nuevas; service_role con CRUD en las cinco tablas de negocio, SELECT/UPDATE solamente en lock, y sin TRUNCATE. Funcion sin EXECUTE anon/authenticated y con EXECUTE service_role.

Success / No rows returned es normal al ejecutar DDL, pero falta verificar estos resultados. La consulta no modifica productos ni crea registros de ensayo. La ejecucion manual del SQL no implica por si sola registrar su version en schema_migrations; no reejecutar el archivo para intentar registrarla.

## Pantalla

Ruta: /admin/catalogo-configurable. En el menu compartido: Categorias y destinos, visible solo a ADMIN por los permisos existentes.

Dos secciones: Categorias y Tipos de vehiculo. Permiten crear, editar, buscar, renombrar, definir orden (numeros menores primero), activar/desactivar y eliminar registros vacios. Categorias incluyen descripcion, slug, padre y perfil; boton para crear subcategoria. ID generado en servidor al crear e inmutable al editar. El perfil del padre se propone al crear una subcategoria; no se sobrescribe automaticamente al editar.

La vista usa tarjetas, controles de al menos 48px, buscador y dialogo con acciones inferiores; una columna en celular. No se realizo inspeccion visual interactiva en un dispositivo real en esta sesion.

## Seguridad y comportamiento

- Pagina y API exigen ADMIN; VENDEDOR no tiene acceso aunque pueda editar productos en el editor anterior.
- Todas las escrituras comprueban origen con el guard CSRF existente y tienen rate limit.
- Validacion estricta de campos y claves; identidad nueva generada en servidor.
- Cambios y eliminaciones comparan el snapshot original para rechazar ediciones desactualizadas con 409.
- Conteos de uso consultan solo relaciones NUEVAS. No corresponden a cantidades del catalogo anterior ni suman productos legacy por nombre de categoria.
- FK y triggers siguen siendo la autoridad para jerarquia y eliminacion, incluso si los conteos cambian despues de cargar la pantalla.
- La API no permite modificar product_catalog_assignments ni product_catalog_vehicle_types. No toca products, pedidos, ventas, reservas, inventario, precios o finanzas.
- Si hay productos, hijos o alias, la eliminacion se bloquea y se explica. Reasignar productos no se implementa en esta etapa para respetar su exclusion; requerira una operacion atomica explicita cuando se autorice integrar el editor. No se usa un bucle de escrituras parciales ni se borran asociaciones para forzar la eliminacion.
- Cambiar nombre o slug solo afecta la configuracion nueva: todavia no hay lectores publicos ni alias nuevos activados.
- No se cambian RLS, grants ni funciones de Supabase desde la API. Sin esquema correcto, la interfaz falla de forma visible y no muestra una falsa configuracion vacia.

## Como probar

1. Revisar los resultados de la consulta postmigracion anterior.
2. Para prueba local, habilitar DCL_CATALOG_ADMIN_ENABLED=1 en el entorno del servidor y reiniciar Next. No se cambio .env.local automaticamente. DCL_CATALOG_FOUNDATION_READ_ENABLED es un flag diagnostico anterior distinto y no hace falta para esta pantalla.
3. Ingresar con una sesion ADMIN y abrir /admin/catalogo-configurable. La clave privada de Supabase debe permanecer exclusivamente en servidor.
4. Confirmar semillas y conteos cero. Crear una categoria de ensayo sin productos, una subcategoria y un tipo de vehiculo; cambiar nombre y orden, desactivar/reactivar y eliminar primero el hijo y luego el padre. Estas acciones escribiran configuracion nueva en la base configurada: ejecutarlas deliberadamente, no durante una inspeccion de solo lectura.
5. Comprobar que una categoria con hijo no se elimina, que no se acepta un nieto, y que otra sesion no puede sobrescribir un snapshot ya modificado. Verificar que VENDEDOR y visitante no acceden.
6. Mantener cerrado el editor de productos nuevo: no existe activacion publica ni accion de asignacion. Comparar catalogo actual y busqueda; deben seguir iguales.
7. Probar en Render requiere una autorizacion posterior de commit/push/publicacion y habilitar alli el flag. No se realizo despliegue manual.

## Validacion local

22 pruebas aprobadas: catalog-admin, catalog-admin-ui, catalog-foundation y admin-navigation-stage1. Las pruebas de API ejecutan restricciones en PGlite efimero usando service_role real de la base local de prueba; el adaptador prohibe acceder a tablas comerciales. Cubren ADMIN, rechazo antes de DB para visitante/vendedor/CSRF/flag apagado, create/update/delete, slug duplicado, jerarquia, Universal, conflictos de edicion y proteccion de registros utilizados. No realizan solicitudes remotas.

ESLint y build de produccion con TypeScript se verifican sobre los archivos nuevos. No se ejecuto una compra ni una auditoria general.

## Verificacion previa a publicacion (26/10/2026)

Se consultaron solo columnas y conteos de las seis tablas remotas: todas respondieron HTTP 200; categorias=2, destinos=6, lock=1, asignaciones=0, destinos de producto=0, alias=0. No hubo escrituras remotas. La comprobacion detallada de RLS, triggers y restricciones puede realizarse con el archivo de solo lectura incluido; no se reejecuto DDL.

DCL_CATALOG_ADMIN_ENABLED=1 habilita pagina y API para ADMIN. No crea una ruta inexistente en un build anterior: el 404 se resuelve publicando el codigo que incluye /admin/catalogo-configurable. El lector diagnostico con DCL_CATALOG_FOUNDATION_READ_ENABLED es independiente.

El repositorio incluye la migracion ya aplicada como referencia reproducible. Los comandos npm run build y npm run start no ejecutan migraciones; no volver a aplicar este SQL al desplegar. La tienda publica y el editor anterior no consumen esta clasificacion nueva.

Validacion de seleccion: copia aislada de origin/master con solo los doce archivos previstos; 22/22 pruebas, TypeScript --noEmit y build habitual de Next.js (Turbopack) correctos. Las rutas de pagina y API figuran en el build. La compilacion no depende de los cambios locales pendientes en los clientes de Supabase.
