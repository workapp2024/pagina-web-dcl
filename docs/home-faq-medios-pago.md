# Home: preguntas frecuentes e imagen de medios de pago

## Cierre autorizado del 20/10/2026

El administrador autorizó el respaldo, la aplicación exclusiva de la migración y la publicación de estas tres mejoras. La migración se aplicó en producción en una transacción con bloqueo NOWAIT, lock_timeout y statement_timeout, después de verificar que no estaba instalada y de ensayarla con ROLLBACK en una recuperación aislada.

Respaldo actualizado fuera del repositorio: `C:/Users/jvs1/AppData/Local/DCL-Backups/20261020-home-presentation`. Se cotejaron tamaños y SHA256, se restauró el archivo completo con propietarios y ACL y se verificaron 118 tablas, 1.286 registros y 1.522 secciones de esquema. Recuperación sin red ni puertos publicados. La comparación anterior y posterior conservó exactamente los datos originales de las 79 tablas públicas, incluyendo las columnas anteriores de `site_settings`. Las preguntas quedaron vacías y ocultas; la imagen quedó vacía y oculta. La restricción quedó validada y RLS conservado.

El guardado y recuperación de ambas configuraciones se comprobó como `service_role` únicamente en la copia restaurada, dentro de una transacción terminada con ROLLBACK. No se publicaron preguntas ni imágenes de ejemplo ni se generaron operaciones comerciales. La evidencia privada de ejecución y publicación se guarda en `.local-postgres/home-presentation-release/`, excluida de Git. Este cierre reemplaza las indicaciones de autorización pendiente de las secciones históricas siguientes.

Implementación local del 19/10/2026. Sin commit, push, deploy ni migración aplicada.

En Herramientas compartidas → Tienda / Home, el apartado «Preguntas frecuentes y medios de pago de la Home» permite editar preguntas, ordenarlas con Subir/Bajar, activar cada una y la sección, eliminarlas y previsualizar. No hay respuestas comerciales predefinidas. Se admiten hasta 30 preguntas; el orden guardado es el orden público. Las respuestas son texto, sin HTML ejecutable.

«Imagen de medios de pago» permite título, visibilidad, PNG/JPG de hasta 10 MB, vista previa local, reemplazo y retirada. El archivo se sube al guardar mediante la API y bucket existentes, sin conversión ni eliminación de archivos anteriores. La imagen conserva proporciones y transparencia original. El borrador no aparece en la Home hasta guardar; quitar una imagen retira su referencia, no el archivo histórico. Los logos deben corresponder a medios realmente aceptados; no cambian configuraciones operativas.

La Home presenta: Hero, buscador existente, Premium, promociones, imagen de medios de pago, acceso mayorista, necesidades/por qué DCL, DCL Music, galería, preguntas frecuentes y cierre/pie. Los componentes conservan sus configuraciones; las promociones sin elementos activos no generan un bloque vacío. El buscador y sus reglas no se modificaron. Checkout y Mayoristas conservan su componente de presentación de pagos existente.

## Publicación pendiente

Revisar y autorizar por separado `supabase/migrations/20261020010000_home_faq_payment_image.sql`. Agrega cinco columnas a `site_settings`: preguntas, visibilidad de preguntas, imagen, título y visibilidad de imagen. Los valores iniciales son preguntas vacías y ambas secciones ocultas; no actualiza columnas existentes, métodos de pago ni permisos. Sin esa migración, la Home oculta las nuevas secciones y el editor informa que la actualización está pendiente y bloquea el guardado.

Después de autorizar y aplicar la migración, autorizar commit/push/deploy del cambio específico. Cargar contenido aprobado e imagen desde el administrador y guardar explícitamente. No se cargó una imagen comercial de referencia ni se anunciaron medios adicionales.

## Validación local

Pruebas focalizadas de persistencia con dobles de base, validaciones, permisos, edición completa del formulario, orden y visibilidad, render plegable, PNG con canal alfa y conservación de bytes, búsquedas y presentación de pagos existente. TypeScript, lint de archivos nuevos/principales y build aprobados. No se guardó configuración en Supabase durante las pruebas. La inspección visual real en PC/celular queda pendiente: el entorno no ofrece navegador conectado; las vistas fueron verificadas por render y pruebas de interacción simuladas.

## Archivos de esta tarea

- Home y administración: `app/page.tsx`, `app/admin/home/page.tsx`, `components/admin/HomePresentationEditor.tsx`, `components/sections/HomePresentation.tsx`, `components/sections/Promotions.tsx`.
- Validación y persistencia: `lib/home-presentation.ts`, `lib/site-data.ts`, `lib/site-settings-patch.ts`, `lib/supabase/site-settings.ts`, `lib/supabase/database.types.ts`, `app/api/admin/home-presentation/route.ts`, `app/api/admin/site-settings/route.ts`.
- Migración, pruebas y entrega: `supabase/migrations/20261020010000_home_faq_payment_image.sql`, `tests/home-presentation.test.cjs`, `docs/home-faq-medios-pago.md`.

Resultado final: 54 pruebas focalizadas aprobadas. Los archivos previamente modificados o sin seguimiento ajenos a esta tarea se conservaron sin incluirlos en ninguna publicación.
