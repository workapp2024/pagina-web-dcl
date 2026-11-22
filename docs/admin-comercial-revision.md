# Administrador comercial: revisión de la rama

Alcance: navegación por tareas, selectores de canal, presentación del editor de productos y mensajes comerciales. Las rutas anteriores siguen disponibles.

## Decisiones

- Pedidos e inventarios conservan sus gestores individuales. No se ofrece «Todos» porque sus operaciones e historiales son independientes.
- Clientes y Finanzas reutilizan sus filtros existentes, incluida la vista general para ADMIN. VENDEDOR solo recibe el canal minorista en las nuevas pantallas y no accede a Finanzas.
- Productos utiliza el catálogo compartido existente. Sus precios por canal siguen en el editor. Los inventarios se consultan por separado.
- Se mantienen Ventas, compatibilidades, categorías y destinos, tienda, posventa, reportes y configuración. Las antiguas pantallas de resumen siguen accesibles desde sus rutas.
- Categoría permanece visible. Aplicaciones y vehículos, características y conectores y configuración avanzada se despliegan cuando se necesitan. La clasificación de un producto existente conserva su guardado independiente.
- El stock actual continúa siendo de solo lectura en el editor. Las modificaciones se realizan desde Inventario y conservan el historial.
- Se conserva el límite vigente de una fotografía principal y dos adicionales. Cambiar la principal intercambia las referencias; ordenar o quitar una selección no borra archivos almacenados.
- El guardado confirma el resultado, filtra la lista por el nombre guardado y cierra el editor. Los fallos conservan el borrador y liberan el bloqueo de guardado. Cerrar con cambios requiere confirmación y recargar la página muestra la protección del navegador.
- Los mensajes se adaptan en la presentación. Las respuestas, registros del servidor, validaciones y operaciones no cambian.

## Conservación de contratos

No se modifican `ProductPricingFields`, `lib/product-pricing.ts`, permisos, sesiones, API, migraciones, reservas, cobros, entregas ni movimientos. El Hero público responsive permanece sin cambios. No se ejecutaron operaciones sobre producción.

## Revisión local segura

Las rutas nuevas son `/admin/gestion/pedidos`, `/admin/gestion/clientes`, `/admin/gestion/catalogo` y `/admin/gestion/finanzas`. En catálogo, `?vista=stock&canal=wholesale` selecciona el inventario mayorista para ADMIN.

Para operar con datos, utilizar exclusivamente una configuración de desarrollo independiente. No ejecutar pruebas comerciales sobre las credenciales productivas de `.env.local`.

La sesión de revisión prepara una copia aislada sin `.env.local`, un iniciador temporal y capturas fuera del repositorio. La vista local sin base conectada permite revisar navegación y mensajes de indisponibilidad. No constituye una prueba de persistencia contra una base real. Las pruebas de operaciones utilizan los dobles aislados y contratos existentes de la suite, sin red.

## Recorrido de aceptación

1. ADMIN: recorrer las tareas principales y alternar canales; abrir también los enlaces antiguos a pedidos y comprobantes.
2. VENDEDOR: comprobar sus accesos minoristas y la ausencia de Finanzas y del canal mayorista en las pantallas nuevas.
3. Productos: crear un borrador, completar nombre/descripción/categoría/precios, cargar fotografías, cambiar principal y orden. Comprobar confirmación de guardado y búsqueda del artículo.
4. Simular un fallo de guardado en desarrollo: el editor conserva los datos. Cancelar el cierre debe conservar el borrador. No repetir un cobro ni registrar movimientos para revisar la presentación.
5. Revisar 360, 390, 430, 768 y 1440 px, incluido menú móvil, teclado, desplazamiento del editor y botón Guardar.

Pendiente: aprobación visual del usuario antes de integrar. Esta rama se sube únicamente para revisión; no incluye despliegue ni preparación de una publicación productiva.
