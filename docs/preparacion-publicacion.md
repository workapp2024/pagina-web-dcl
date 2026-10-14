# Publicación preparada — 14/10/2026

La versión local está preparada para publicación. Se reutilizan las 553 pruebas aprobadas, el build con TypeScript correcto y lint sin errores. El usuario confirmó las variables de Production en Vercel, el evento Order (Mercado Pago), el dominio HTTPS y una simulación de webhook con HTTP 200. No se volvieron a ejecutar pruebas comerciales ni la regularización.

Cambios pendientes: navegación y pantallas de administrador por Minoristas/Mayoristas, finanzas por sector y generales, indicadores de costos, búsquedas y filtros de clientes/pedidos/compatibilidades/inventarios, confirmaciones mayoristas, edición de imágenes y controles asociados. Se incluyen los módulos nuevos y sus pruebas. Las rutas de Mercado Pago, el checkout y los módulos de recuperación de pagos no tienen diferencias pendientes respecto de HEAD: se conserva el circuito de cobro existente, con Checkout Pro por preferences y tarjetas por Orders API, y sus webhooks separados.

La regularización y su configuración cash ya están aplicadas en Supabase. Publicar el código no vuelve a ejecutar esas operaciones. Los SQL y ejecutores conservados como fuente de mantenimiento no se ejecutan en build/start y están excluidos del paquete Vercel. No se requieren migraciones nuevas.

Las carpetas privadas `.local-test-regularization/`, `.local-postgres/`, `.vercel/`, los archivos `.env` reales y la referencia local están excluidos de Git. La evidencia privada y las herramientas de mantenimiento están excluidas del paquete Vercel. El único archivo de entorno versionado es `.env.example`. El plan utiliza selección explícita de archivos; no usa `git add .`.

No se identificó un bloqueo crítico nuevo con la evidencia disponible y las confirmaciones del usuario. El stock mayorista cero exige cargar entradas comerciales reales antes de confirmar entregas; no impide publicar la plataforma. La comprobación visual pendiente no se presenta como ya realizada.

## Comandos preparados, NO ejecutados

Desde `C:\Users\jvs1\Proyectos\pagina-web-dcl`, rama actual `master`:

```powershell
git add -- .gitignore .vercelignore eslint.config.mjs app components lib tests docs
git add -- scripts/maintenance/regularize-confirmed-tests.cjs scripts/maintenance/complete-approved-test-regularization.cjs scripts/maintenance/compare-installed-regularization-functions.cjs scripts/maintenance/proposed-delivered-test-regularization.sql scripts/maintenance/proposed-neutralize-test-postings.sql scripts/maintenance/proposed-regularization-concurrency.sql scripts/maintenance/apply-20261013010000-only.sql
git diff --cached --stat
git diff --cached --check
git commit -m "Prepare commercial launch and sector admin workflows"
git push origin master
```

Destino Git existente: `https://github.com/workapp2024/pagina-web-dcl.git`. Revisar la selección antes de confirmar el commit. Los demás scripts e informes locales no forman parte de esta selección.

**El push puede disparar el despliegue automático en Vercel.** Antes de ejecutarlo, confirmar que el proyecto existente toma `master` como Production Branch. La autorización debe incluir tanto commit/push como ese posible despliegue automático. No generar un segundo despliegue si el automático ya publica el commit correcto.

Si no hay despliegue automático y se elige la CLI, estos comandos son alternativos al despliegue por Git, no una segunda ejecución necesaria:

```powershell
# Requiere Vercel CLI y sesión autorizada.
# En link, seleccionar el equipo y proyecto EXISTENTES; no crear otro proyecto.
vercel link
vercel --prod
```

No se encontró Vercel CLI instalada ni una vinculación local `.vercel`; el método preferido es el proyecto Git existente. La URL de referencia es `https://pagina-web-dcl.vercel.app`. Las variables ya guardadas en Production se aplican al nuevo despliegue; no deben reemplazarse ni regenerarse.

Acción a autorizar: registrar y publicar esta selección en `origin/master`, y desplegar ese mismo commit en Production del proyecto Vercel existente, conservando sus variables y sin ejecutar migraciones ni operaciones comerciales.
