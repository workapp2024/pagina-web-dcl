# Identidad visual de comprobantes

## Instalación autorizada el 18/10/2026 (Argentina)

El administrador autorizó expresamente el SQL y la publicación de esta mejora. Se aplicó exclusivamente la columna `public.site_settings.receipt_identity` y su CHECK, con transacción, NOWAIT, timeouts y comprobación de conservación de datos antes del COMMIT. La columna quedó inicialmente NULL, conservando el diseño original. El cotejo posterior confirmó intactos los datos originales de las 79 tablas públicas respaldadas y toda la configuración anterior de Tienda / Home. RLS, ACL, políticas y bucket se conservaron sin cambios. No se modificaron pedidos, ventas, clientes, cobros, finanzas, stock ni históricos.

Se exportó un respaldo nuevo a `C:/Users/jvs1/AppData/Local/DCL-Backups/20261019-receipt-identity-v2`, íntegro por tamaño y SHA256. Se restauró completo en PostgreSQL 17.6 aislado, red `none`, sin puertos publicados: 118 tablas, 1272 registros y 1522 secciones de esquema. Se reutilizó el validador de recuperación, con sus diferencias conocidas de bootstrap/ACL de extensiones. El SHA256 del archivo es `9C84D8AD5828B8750C39DD9486C077182BA0781AFFCA5D20CC5309A8481D38E1`. Las 79 tablas públicas recuperadas coincidieron con producción antes de escribir. El SQL se ensayó dos veces sobre esa copia con ROLLBACK antes de la aplicación productiva.

Se repitieron las 40 pruebas, TypeScript y build, todos correctos. Lint sin errores excluyendo exclusivamente el archivo ajeno no versionado `tests/isolated-provider-webhook.test.cjs`; sus 63 advertencias son preexistentes. Se comprobó separadamente que ese archivo mantiene el error previo de la línea 12, ajeno a esta mejora. No impide el build ni forma parte del commit.

Evidencia privada, fuera de Git: `.local-postgres/receipt-identity-release/` contiene preflight, respaldo/recuperación, ensayo, hashes antes/después, instalador con guardias, `sql-verification.json`, resultados técnicos y estado de Vercel. La publicación está autorizada; su estado final y la comprobación autenticada se registran allí. Las secciones siguientes describen el desarrollo y la propuesta previa y quedan reemplazadas por este cierre cuando difieren.

## Uso

Administración → Herramientas compartidas → Tienda / Home → **Identidad visual de comprobantes**.

Permite elegir dos imágenes independientes: logo principal y marca de agua centrada. Cada uno acepta PNG con transparencia o JPG, reemplazo, quitar y volver al logo DCL original. Se preservan proporciones y transparencia. SVG no se admite: el servidor verifica MIME, firma y decodificación, rechaza animaciones y normaliza a PNG sin metadatos. Máximos: 2 MB de entrada/salida, 4096 píxeles por lado y 8 millones de píxeles. Sharp ya estaba instalado por Next.js; se declara directamente la misma versión para esta validación.

Hay fondos predeterminados, selectores de fondo y acento, tamaño de marca de agua (40–100%), intensidad (0–30%) y tono original o monocromático. El servidor rechaza fondos o acentos sin contraste suficiente. El texto secundario es más oscuro para conservar legibilidad incluso frente a una marca de agua oscura al máximo permitido. La marca de agua no se deforma.

La vista previa usa datos de ejemplo y el mismo `OrderReceipt` que los comprobantes de ambos sectores. Las imágenes se suben al almacenamiento al seleccionarlas; **el diseño sólo se activa al Guardar cambios**. Restaurar diseño predeterminado prepara la vista previa y requiere Guardar para confirmarlo. Quitar o reemplazar no elimina archivos previos ni toca comprobantes comerciales.

## Persistencia y permisos

Se reutilizan `site_settings`, la autenticación administrativa y el bucket `dcl-media`. Los archivos se guardan con UUID inmutable en `site/receipt-identity/`, sin sobrescribir archivos existentes. No se crean cuentas, tablas, buckets ni procedimientos nuevos. No se usa localStorage.

El nuevo endpoint administrativo actualiza únicamente `receipt_identity` de `site_settings.id=1`; el trigger existente puede actualizar su fecha de edición. No resetea otros campos. Guarda una revisión UUID y compara la revisión anterior dentro del UPDATE: dos dispositivos no pueden sobrescribirse silenciosamente. Ante conflicto conserva el borrador y pide recargar. Cada nuevo comprobante o solicitud de PDF lee la configuración persistida sin caché. Los PDF ya descargados y el archivo temporal de compartir (hasta 30 segundos, mecanismo existente) son copias y no cambian retroactivamente.

Sólo ADMIN puede editar o subir imágenes. Las escrituras verifican origen y límites de frecuencia. La entrega de imágenes exige los permisos comerciales existentes y sólo acepta rutas del prefijo validado; nunca descarga una URL arbitraria. La conversión monocromática se realiza en el servidor y se reutiliza en vista previa, pantalla y PDF, conservando alfa. Los logos son material de marca; el bucket existente es público y no debe utilizarse para subir documentación privada de clientes.

La lectura de importes y sus validaciones no cambian. Las páginas y los endpoints existentes agregan exclusivamente la identidad visual a su DTO después de autenticar. Se conservan pagos confirmados, pendientes, reembolsos, estado comercial y la leyenda «Comprobante comercial — No es factura fiscal». Compartir sigue adjuntando el PDF; conserva descarga, impresión, cancelación silenciosa y alternativa cuando el navegador no admite archivos.

## SQL pendiente — no ejecutar sin autorización

Propuesta mínima: `scripts/maintenance/proposed-receipt-identity.sql`. Agrega una columna JSONB nullable y un CHECK de estructura/tamaño. Sin backfill, sin cambios de operaciones y sin ampliar ACL, políticas ni permisos de Storage. Usa transacción, NOWAIT y timeouts. Comprueba RLS, singleton, tipo de columna y ausencia de políticas de escritura inesperadas. La validación completa de controles y rutas también se aplica en servidor, tanto al guardar como al leer.

Sin la columna, los comprobantes conservan el diseño predeterminado y la sección permite revisar la vista previa; Guardar queda deshabilitado. Un error de red o configuración corrupta no se interpreta como diseño predeterminado: bloquea esa generación para no exportar una identidad incorrecta.

Antes de autorizar instalación: verificar respaldo recuperable actual y cotejar esquema, políticas, ACL/privilegios y bucket con esta propuesta. Si hay diferencias, detenerse y adaptar sólo esta propuesta. No se consultó producción para esta tarea. Ejecutar exclusivamente este archivo autorizado y comprobar columna, CHECK, RLS y permisos, manteniendo los datos comerciales intactos. Ante fallo de la transacción se revierte completa; tras una instalación confirmada, revertir la publicación preservando la columna y sus valores, sin borrar configuración ni archivos.

## Validación local

`node --test --test-isolation=none tests/receipt-identity.test.cjs tests/order-receipt.test.cjs tests/wholesale-receipt.test.cjs tests/receipt-pdf.test.cjs`: **40 pruebas aprobadas**. Cubren alfa PNG, JPG, límites/formatos rechazados, autenticación, origen, persistencia entre lectores, conflictos, campos ajenos conservados, rutas de imagen, monocromático con alfa, ambos sectores, pagos parciales/pendientes/reembolsos, compartir archivos, doble clic, cancelación y descarga alternativa. La propuesta SQL se ensaya dos veces en PGlite aislado, incluida conservación de datos, rechazo de políticas inesperadas y dos UPDATE simultáneos con un solo ganador.

Chrome local, viewport de 390 píxeles y fixtures sintéticos sin credenciales: PDF real con logo personalizado transparente y marca independiente monocromática; estados parcial, pendiente, pagado y minorista, y 50 productos en tres páginas. Comprobación de vista previa, guardado simulado, restauración, lectura desde una nueva instancia y PDF de impresión. Capturas y reportes privados en `.local-test-regularization/webhook-diagnostic/`. No se envió ningún comprobante a WhatsApp ni se probó el menú de un teléfono físico: el flujo Web Share se verifica con mocks de sus capacidades, cancelación y activación del usuario.

TypeScript y build local verificados. Lint del código de esta mejora sin errores; el lint general tiene un error previo en el archivo ajeno no versionado `tests/isolated-provider-webhook.test.cjs:12` (`@next/next/no-assign-module-variable`), además de avisos previos. No se modificó ese archivo ni `tests/wholesale-stock-deliveries.test.cjs`, que ya tenía cambios locales.

El SQL y la publicación ya fueron autorizados. Después de publicar, corresponde revisar los logos propios y el menú nativo de compartir desde el celular del administrador usando un comprobante existente, sin crear operaciones nuevas. El lanzamiento comercial continúa fuera del alcance.
