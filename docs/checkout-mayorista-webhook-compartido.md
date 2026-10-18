# Checkout mayorista: reutilización del webhook de Checkout Pro

> Actualización del 18/10/2026: el simulador no permite seleccionar la URL específica de Checkout Pro. La prueba descrita aquí queda reemplazada por [Validación sin cobros](validacion-webhook-mayorista-sin-cobros.md), con sonda firmada de diagnóstico. No cambiar la URL global para usar el simulador.

Preparación local. No publicada ni activada. Base publicada: `47a3b288`.

## Solución

Las nuevas preferencias mayoristas apuntan al mismo endpoint que las preferencias minoristas: `https://pagina-web-dcl.vercel.app/api/payments/mercadopago/checkout-pro-webhook`. Se conservan `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` y `NEXT_PUBLIC_SITE_URL` existentes. No se necesita crear otra aplicación, otra cuenta financiera ni otro secreto en Mercado Pago, ni reemplazar la URL global de la aplicación.

El receptor conserva la validación de firma del SDK y consulta una sola vez el pago al proveedor antes de decidir el circuito. Una referencia `wholesale:<UUID>` devuelta por Mercado Pago se dirige a la conciliación mayorista, que sigue verificando intención, pedido, revisión, merchant order, preferencia, importe y moneda. Los parámetros de sector y el cuerpo del callback no seleccionan el circuito. Las referencias minoristas siguen las mismas consultas, conciliación y analítica anteriores. El webhook de Orders API no se modifica.

La conciliación mayorista sigue usando las RPC ya instaladas y sus claves únicas, bloqueos y auditoría. No se cambia SQL ni se crean cobros paralelos. La ruta mayorista anterior permanece disponible como compatibilidad; las nuevas preferencias utilizan la compartida.

## Bloqueo de activación

Se reemplaza el impedimento absoluto de producción por una condición explícita: `DCL_WHOLESALE_CHECKOUT_ENABLED=1`, proyecto y URL productiva esperados, token y secreto presentes. La bandera no fue creada ni modificada. Las banderas locales anteriores no activan producción. Por lo tanto, desplegar esta preparación sin la nueva bandera mantiene los cobros mayoristas apagados.

El webhook compartido valida firmas independientemente de esa bandera. Si recibe un pago mayorista mientras está deshabilitado, devuelve 503 sin consultar tablas comerciales ni contabilizarlo. Ese rechazo mantiene los reintentos. Los pagos minoristas no dependen de la bandera.

## Prueba segura posterior a la publicación autorizada

Primero publicar el código manteniendo la bandera ausente. Utilizar el simulador de notificaciones de la aplicación existente sobre el endpoint de Checkout Pro cuando el panel permita elegir esa URL; no reemplazar la configuración global de Orders/Minoristas. Utilizar un identificador sintético cuya inexistencia se haya confirmado mediante una consulta de lectura al proveedor, nunca un pago histórico.

Una firma incorrecta debe responder 401 antes de cualquier consulta al proveedor o a la base. Una simulación firmada con ID inexistente puede responder 503 después de la verificación de firma porque no representa un pago verificable: no debe inventarse un 200 de pago aprobado. Esta prueba solo verifica transporte, firma y rechazo seguro; no acredita dinero, no demuestra una compra completa ni prueba una liquidación real.

La ruta con referencias mayoristas, parcialidades, reintentos y controles contables se valida en pruebas aisladas. El evento del simulador no equivale a una transacción real del proveedor. Cualquier validación posterior con dinero real requiere autorización separada; no se necesita efectuarla para preparar o publicar el código apagado.

## Autorizaciones pendientes

1. Commit, push y despliegue de esta adaptación, manteniendo mayorista deshabilitado.
2. Activación explícita mediante la bandera productiva después de verificar la recepción y la firma en el circuito compartido.

Sin pagos reales, migraciones, cambios históricos ni cambios de configuración en Mercado Pago durante esta preparación.

Validación local: 30 pruebas correctas, incluidas regresiones minoristas y pruebas del webhook compartido con el SDK real, TypeScript y build correctos. Lint focalizado sin errores ni advertencias. No se realizaron operaciones contra Mercado Pago o Supabase durante esta implementación; las consultas del proveedor y las firmas se probaron con fixtures aislados.

Control previo de publicaci?n: la bandera `DCL_WHOLESALE_CHECKOUT_ENABLED` est? ausente en Production. Se repitieron las 30 pruebas de regresi?n y de firmas, TypeScript, build y lint focalizado: todos correctos. No se modific? el webhook minorista de Orders, la creaci?n minorista de preferencias ni sus credenciales. Las comprobaciones HTTP posteriores no deben usar pagos hist?ricos ni presentar una simulaci?n como una acreditaci?n real.
