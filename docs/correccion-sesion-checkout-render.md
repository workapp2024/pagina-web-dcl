# Correcci?n puntual: sesi?n de checkout en Render

25/10/2026. Sin pagos, pedidos, cambios comerciales, migraciones ni deploy.

## Causa y evidencia

El texto aparece en components/store/CheckoutForm.tsx, dentro de submit, cuando POST /api/store/buyer-session devuelve una respuesta no exitosa. Reproducci?n directa en la API p?blica de Render: Origin https://pagina-web-dcl.onrender.com y Sec-Fetch-Site same-origin devolvieron HTTP 403 con {ok:false}, sin Set-Cookie. No se envi? POST /api/store/orders ni se llam? a Mercado Pago.

La ruta buyer-session emite ese 403 antes de establishBuyerSession, por fallo de isSameOriginWrite. La funci?n comparaba exclusivamente Origin con new URL(request.url).origin. En el despliegue ambos no coinciden, aunque el cliente usa el origen p?blico correcto. El origen interno exacto no es visible desde la respuesta p?blica; el c?digo instalado de Next.js construye initURL con fetchHostname/puerto cuando est?n disponibles, compatible con esta diferencia detr?s del proxy de Render.

Esto identifica el bloqueo actual como CSRF/origen, no un error de Supabase, cookie rechazada o credenciales de Mercado Pago. La cookie ni siquiera llega a crearse. Una vez publicado se deber? verificar que las etapas siguientes tambi?n funcionen.

## Cambio m?nimo

lib/store/buyer-session.ts: conserva el caso de origen directo y el rechazo de Sec-Fetch-Site cross-site. Para el despliegue detr?s del proxy acepta alternativamente SOLO el origen HTTPS configurado en NEXT_PUBLIC_SITE_URL y exige que Host coincida con ese mismo sitio. No conf?a en x-forwarded-host ni acepta comodines. Cookies, sesiones, autorizaci?n de pedidos e idempotencia permanecen iguales. La funci?n compartida se utiliza tambi?n al crear pedidos y preferencias, por lo que la correcci?n cubre los pasos siguientes del mismo checkout.

tests/buyer-session-origin.test.cjs: cuatro casos de regresi?n, con variantes de origen interno, host, origen ajeno, ausencia de origen, configuraci?n inv?lida, forwarded headers falsos y rechazo antes de crear sesi?n.

## Variable de Render

Confirmar en Web Service pagina-web-dcl > Environment > Environment Variables:

NEXT_PUBLIC_SITE_URL=https://pagina-web-dcl.onrender.com

Sin ruta, comillas ni espacios. No tuve acceso al panel privado para acreditar su valor actual; en .env.local no est? definida. La p?gina p?blica no expone un valor inequ?voco para verificarla. No se modific? .env.local.

No hay una dependencia de Vercel en esta validaci?n de sesi?n. Existe un fallback de Vercel para metadatos en layout, pero no participa en el 403. La preferencia de Mercado Pago s? depende de NEXT_PUBLIC_SITE_URL para retornos y webhook.

Cambiar solo una variable no corrige la comparaci?n original: el c?digo anterior no le?a NEXT_PUBLIC_SITE_URL. Se requieren este cambio de c?digo y el valor correcto durante el nuevo build.

## Intento fallido

La excepci?n ocurre antes de prepareCheckoutAttempt y del POST de creaci?n de pedido. Ese intento no genera un pedido nuevo, reserva, venta, movimiento de stock ni ingreso. La reproducci?n tambi?n se detuvo antes de consultar Supabase. No se inspeccion? un pedido anterior espec?fico del comprador: no se proporcion? su n?mero ni identificaci?n y no se afirma que no existan otros intentos anteriores.

## Validaci?n

- node --test --test-isolation=none tests/buyer-session-origin.test.cjs tests/buyer-checkout.test.cjs: 21 aprobadas, 0 fallidas.
- ESLint de los dos archivos: correcto.
- npm run build: correcto, compilaci?n, TypeScript y generaci?n de p?ginas. No se ejecut? la suite general ni se modificaron pruebas ajenas.

## Publicaci?n y comprobaci?n m?nima

Autorizar commit/push/deploy por separado. Publicar esta correcci?n sin incluir cambios ajenos ya presentes en el ?rbol. Configurar NEXT_PUBLIC_SITE_URL y reconstruir en Render.

Antes de enviar un pedido, comprobar desde el navegador que POST /api/store/buyer-session devuelve 200 y establece/reutiliza dcl_buyer_session con HttpOnly, Secure y SameSite=Lax. Si devuelve 503, revisar el siguiente bloqueo en Supabase/credenciales con los logs; no volver a modificar CSRF para ocultarlo. Despu?s, con autorizaci?n para la compra controlada, continuar con el producto acordado y verificar un solo pedido, pago, venta, descuento e ingreso. No se ejecut? a?n esa compra ni se certific? el resultado remoto posterior al deploy.
