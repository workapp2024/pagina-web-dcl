# Bloque 2 — Clientes, inventarios y pedidos

**Cierre del 17/10/2026:** aprobación visual recibida y función de creación mayorista instalada mediante el procedimiento expresamente autorizado. Cuerpo, propietario y permisos verificados; clientes e historial existentes sin cambios. Bloque 2 terminado, sin avanzar al Bloque 3. Detalle en `docs/bloque2-autorizacion-clientes-mayoristas.md`. Las referencias siguientes a la propuesta pendiente describen su preparación anterior.

Implementación local del 17/10/2026. No se aplicaron migraciones ni se ejecutaron operaciones comerciales, commits, pushes o despliegues.

## Pedidos

Pedidos minoristas adopta el patrón aprobado de Mayoristas: lista inicialmente oculta, búsqueda, filtros, filas compactas, detalle dentro de la pantalla, regreso al listado y cuatro secciones: Resumen, Seguimiento, Cobros y entregas e Historial. El seguimiento ordena los eventos operativos originales por fecha. La presentación conserva los estados, resoluciones, comprobantes, notas y acciones existentes del minorista.

No se modificó Pedidos Mayoristas durante esta intervención. Cada panel conserva sus endpoints, permisos y operaciones originales. No se agregaron propuestas comerciales, reservas ni entregas parciales mayoristas al minorista.

## Clientes

Las rutas de cada sector envían su clasificación al mismo administrador existente. El filtro se aplica en servidor antes de paginar:

- Mayoristas: `wholesale_enabled=true`, independientemente de que el acceso mediante código esté activo.
- Minoristas: clientes sin condición mayorista, o con pedidos, ventas, vehículos o garantías minoristas asociados. Un mayorista con esas relaciones aparece también en Minoristas, con su mismo identificador y registros originales.

No se reclasifican registros existentes. El esquema no tiene una habilitación minorista explícita: los clientes de ambos canales se reconocen por las relaciones existentes. Una habilitación dual sin actividad minorista previa requeriría definir una clasificación persistente adicional; no se inventó ni aplicó esa clasificación.

El filtro por relaciones utiliza los embeds vacíos y `not.is.null` documentados por [PostgREST](https://docs.postgrest.org/en/v13/references/api/resource_embedding.html#or-filtering-across-embedded-resources). Las pruebas de ruta usan clientes simulados; no constituyen una consulta de integración al PostgREST de producción.

Crear y editar clientes minoristas conserva la RPC original. La creación mayorista usa la propuesta `scripts/maintenance/proposed-block2-customer-create.sql`: una transacción crea el cliente mediante la función existente, marca únicamente el registro nuevo como mayorista y conserva el snapshot de auditoría. No activa acceso ni asigna códigos. Si la RPC no está instalada, se informa el requisito de autorización, sin crear primero un registro minorista. La propuesta se probó en PGlite aislado, incluida la reversión completa ante error y la denegación a anon. **No está aplicada y requiere autorización explícita.**

Revisión focalizada del 17/10: se corrigió la propuesta porque `service_role` no tiene UPDATE sobre el historial en Supabase. Ahora conserva el evento original de creación y agrega un evento `edit` con estados anterior/posterior de la clasificación. No amplía permisos ni reescribe auditorías. La prueba ejecuta la RPC como `service_role`, con RLS y permisos representativos de los verificados, e incluye fallo de auditoría y clasificación con rollback completo. El detalle de preparación está en `docs/bloque2-autorizacion-clientes-mayoristas.md`.

## Inventarios

Ambos reutilizan el buscador de producto, tarjetas de existencias y tarjetas de movimientos. La información secundaria queda desplegable y se eliminan las tablas anchas en celular. La consulta y el historial conservan los filtros existentes y sus listas inicialmente ocultas.

El buscador reutiliza la normalización de `SearchableList`: nombre, código interno y conector. Las marcas se encuentran cuando forman parte del nombre registrado; no existe un campo de marca/SKU adicional en el modelo de productos inspeccionado. Se muestran hasta veinte coincidencias y se solicita afinar cuando hay más. Es obligatorio elegir una coincidencia: escribir invalida la selección anterior. Cada resultado muestra el stock de su propio sector.

El inventario minorista mantiene entradas, salidas y ajustes mediante su procedimiento original. El mayorista conserva recepción, ajustes, reservas y disponibilidad mediante sus propias RPC, con las mismas claves idempotentes. No se trasladaron cantidades entre sectores.

## Validación y revisión pendiente

Pasaron 74 pruebas: componentes con navegación y selección, rutas simuladas, propuesta SQL aislada y regresiones de clientes, inventario, pedidos y stock mayorista. TypeScript y build pasaron. Lint finalizó con cero errores y 66 advertencias existentes (principalmente directivas eslint innecesarias e imágenes). El acceso local al administrador respondió HTTP 200 al terminar. La revisión visual autenticada en PC y celular queda pendiente con el usuario; las pruebas de componentes no reemplazan esa revisión.

No se avanzó al Bloque 3.
