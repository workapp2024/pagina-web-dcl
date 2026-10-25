# Preparación de migración de Vercel a Render

Revisión del repositorio para preparar un Web Service de Render. Esta revisión no despliega, no cambia DNS, no modifica Vercel ni escribe en Supabase.

## 1. Arquitectura y compatibilidad

- Next.js `16.3.2`, React `19.2.8`; el paquete Next instalado requiere Node.js `>=20.9.0`. Para producción se recomienda seleccionar Node `24.x` en Render.
- El gestor y lockfile son npm y `package-lock.json` versión 3. Usar `npm ci`.
- Es una aplicación App Router de Next.js, con rutas dinámicas, 65 Route Handlers bajo `app/api`, funciones de servidor y `proxy.ts`. No es una exportación estática.
- `next start` admite el `PORT` de Render y escucha por defecto en `0.0.0.0`. No hace falta servidor personalizado ni configurar un puerto fijo.
- No se encontraron dependencias directas de SDKs de Vercel, Blob, KV ni funciones de Vercel. `vercel.json` solo define un build command, que Render no consume. `VERCEL_ENV` se usa para clasificar analítica; en Render debe definirse `NEXT_PUBLIC_ANALYTICS_ENVIRONMENT=production` durante el build. El rate limiter también reconoce `x-vercel-forwarded-for`, pero usa `x-forwarded-for` como alternativa.
- Las API Routes, `proxy.ts`, `sharp` y la optimización de imágenes son compatibles con un servidor Node `next start`.

## 2. Configuración propuesta en Render

| Campo | Valor |
|---|---|
| Tipo | Web Service |
| Runtime | Node |
| Rama | `master` |
| Root Directory | Vacío |
| Node | `24.x` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start` |
| Health Check Path | `/icon.svg` |

No se necesita Docker, `output: "standalone"` ni un comando `next start` personalizado. La prueba local de producción inició `npm run start` y sirvió `/icon.svg` con HTTP 200.

## 3. Variables de entorno

Los valores no se incluyen en este documento. Copiar los valores vigentes desde el gestor seguro correspondiente; no copiar ni publicar credenciales en Git.

### Públicas

Las variables `NEXT_PUBLIC_*` se insertan en el bundle del navegador durante `next build`; por eso deben estar configuradas antes del build y mantenerse consistentes con el entorno de ejecución.

| Nombre | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL pública del proyecto Supabase. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave publicable usada por el cliente web y el servidor. |
| `NEXT_PUBLIC_SITE_URL` | Origen HTTPS público para metadatos, retornos de Mercado Pago y notificaciones creadas por la aplicación. Debe estar configurada en build y runtime. |
| `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | Clave pública del checkout en el navegador. |
| `NEXT_PUBLIC_ANALYTICS_ENVIRONMENT` | Definir `production` en Render; sin `VERCEL_ENV`, evitará clasificar la producción como preview. |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Token público de ingesta de PostHog, si se desea mantener la analítica pública. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Host público de ingesta de PostHog, si se utiliza. |

### Privadas de servidor

| Nombre | Uso |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Escrituras y operaciones administrativas de servidor. Mantener privada; nunca usar prefijo `NEXT_PUBLIC_`. |
| `ADMIN_SESSION_SECRET` | Firma de sesiones administrativas; necesaria para el inicio de sesión. |
| `ADMIN_PASSWORD` | Solo para el acceso legado por contraseña. No es necesaria si se usa exclusivamente el acceso individual por Supabase Auth. |
| `MERCADOPAGO_ACCESS_TOKEN` | Acceso de servidor a Mercado Pago. |
| `MERCADOPAGO_WEBHOOK_SECRET` | Validación de firmas de webhooks de Mercado Pago. |
| `POSTHOG_PERSONAL_API_KEY` | Consultas privadas de analítica desde el panel, si se requiere esa función. |

### Opcionales o de activación controlada

| Nombre | Uso |
|---|---|
| `ADMIN_AUTH_MODE` | Si se omite o vale `legacy`, se permite el acceso legado; otro valor deshabilita ese modo. Mantener el modo actual durante la primera migración. |
| `POSTHOG_PROJECT_ID` | Identificador de proyecto requerido junto con `POSTHOG_PERSONAL_API_KEY` para consultas privadas. |
| `POSTHOG_UI_HOST` | Host de consultas privadas de PostHog; la aplicación tiene un valor por defecto. |
| `COMMERCIAL_ANALYTICS_START_AT` | Fecha UTC opcional para el inicio de analítica comercial. |
| `DCL_MAINTENANCE_MODE` | Activar solo para mantenimiento; ausente/desactivada permite tráfico normal. |
| `DCL_WHOLESALE_CHECKOUT_ENABLED` | Opt-in explícito para nuevas operaciones automáticas de checkout mayorista. No activar como parte de una migración técnica sin autorización operativa. |
| `DCL_WHOLESALE_PAYMENT_NOTICES_ENABLED` | Mantener desactivada salvo que la función y sus prerrequisitos hayan sido autorizados. |

No configurar `VERCEL_ENV` en Render ni trasladar flags `DCL_PREPARED_*` de pruebas locales.

## 4. Dominio, callbacks y webhooks

`NEXT_PUBLIC_SITE_URL` se utiliza para construir los retornos del checkout y las notificaciones de Mercado Pago. Los handlers relevantes incluyen:

- `/api/payments/mercadopago/webhook`
- `/api/payments/mercadopago/checkout-pro-webhook`
- `/api/wholesale/checkout/webhook`

En el cutover se debe verificar que los webhooks registrados en Mercado Pago apunten al servicio que efectivamente recibe el dominio y que el secreto de firma configurado en Render coincida con el del proveedor. Los pagos existentes y sus estados permanecen en Supabase; el destino de los callbacks sí requiere actualización coordinada.

El código y `.env.example` contienen como origen de ejemplo `https://pagina-web-dcl.vercel.app`. No se inspeccionó `.env.local` ni se confirmó cuál es el dominio público activo. Un subdominio `vercel.app` pertenece a Vercel y no se puede asignar directamente a Render. Si ese fuera el único dominio actual, conservar exactamente ese dominio impide la migración; se necesita un dominio propio ya disponible. Si existe un dominio propio, se puede mantener su nombre y cambiar el destino DNS durante un cutover coordinado. No se realizó ningún cambio de dominio.

## 5. Persistencia y estado local

- Productos, inventario/stock, clientes, pedidos, ventas y configuración se consultan o guardan en Supabase.
- Las imágenes administradas se cargan al bucket Supabase Storage `dcl-media`; la base conserva las URL públicas. No dependen del disco del servicio.
- El logo predeterminado es un archivo estático incluido en `public/`.
- No se encontró escritura de datos de negocio a archivos locales. El caché de Next.js y el caché de imágenes pueden ser efímeros; son datos reconstruibles, no la fuente de verdad.
- El rate limiter actual vive en memoria del proceso: se reinicia en cada redeploy/reinicio y no se comparte entre instancias. Para escalar a varias instancias se necesitaría un almacén compartido si se requiere un límite global.

No se accedió a datos ni se modificó el esquema de Supabase.

## 6. Cambios y validación

Cambios de esta preparación:

- `app/layout.tsx`: metadatos usan `NEXT_PUBLIC_SITE_URL`, conservando el origen previo como fallback.
- `lib/prepared-finance-features.ts`: el checkout mayorista mantiene su opt-in explícito, credenciales y proyecto aprobados, pero ya no depende de una URL exclusiva de Vercel; exige un origen HTTPS público.
- `tests/shared-mercadopago-webhook.test.cjs`: cobertura para URL de Render y rechazo de HTTP/localhost.

Validaciones completadas:

- `npm run build`: correcto; Next.js compiló y completó la comprobación TypeScript.
- `node --test tests/shared-mercadopago-webhook.test.cjs`: 6/6 pruebas correctas.
- `node --test tests/prepared-finance-checkout.test.cjs`: 9/9 pruebas correctas.
- ESLint focalizado en los tres archivos modificados: correcto.
- Smoke test de `npm run start`: `/icon.svg` respondió HTTP 200.

La suite completa `npm run test:store` no se completó: su primer caso tardó aproximadamente 161 segundos, por lo que se detuvo para ejecutar las pruebas focalizadas. No se detectó un fallo en esas pruebas focalizadas. Tampoco se completó el lint de todo el repositorio.

## 7. Riesgos y recomendación de plan

El plan Starter de 512 MB puede servir para una validación de bajo tráfico, pero no se midió consumo bajo carga. Esta app mantiene un servidor Next.js dinámico, múltiples endpoints, generación de comprobantes y optimización de imágenes; 512 MB deja poco margen para picos y puede causar reinicios por memoria. Para reducir el riesgo de producción se recomienda comenzar con un plan de al menos 2 GB, o usar Starter solo como prueba inicial con monitorización de memoria y disponibilidad para escalar.

Antes del cutover todavía falta confirmar el dominio público real, cargar las variables en Render, revisar las URLs de webhooks en Mercado Pago y realizar pruebas de compra/webhook en el entorno que se vaya a activar. Esta preparación no ejecutó esas acciones.
