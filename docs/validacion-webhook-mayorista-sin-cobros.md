# Validación del webhook mayorista sin cobros — 18/10/2026

Este procedimiento reemplaza la instrucción de elegir Checkout Pro en el simulador contenida en `checkout-mayorista-webhook-compartido.md`. El usuario comprobó que el selector solamente ofrece las URLs globales de prueba y producción, ambas en `/api/payments/mercadopago/webhook`. No envió notificaciones ni cambió configuración.

## Integración existente

Las preferencias mayoristas ya incluyen `notification_url` con destino a `https://pagina-web-dcl.vercel.app/api/payments/mercadopago/checkout-pro-webhook`. Se conserva la aplicación, el token, el secreto y el webhook de Minoristas/Orders. No hace falta reemplazar la URL global. El receptor de Checkout Pro verifica la firma antes de consultar el proveedor y selecciona el circuito mayorista solamente por su referencia verificada `wholesale:<UUID>`.

Mercado Pago documenta la configuración por pago/preferencia/orden mediante `notification_url`, diferente para cada objeto. Eso no implica que aparezca en el selector del simulador:

- [Configuración y firma con SDK oficial](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/payment-notifications).
- [notification_url por objeto](https://www.mercadopago.com.ar/developers/es/docs/woocommerce/additional-content/your-integrations/notifications/ipn). Esta fuente también distingue IPN: no agregar `source_news=ipn` ni relajar la firma para aceptarlo.

## Sonda preparada

El endpoint de Checkout Pro admite el identificador reservado no comercial `dcl-wholesale-webhook-probe`. Pasa por la validación habitual del SDK. Con firma inválida responde 401; con firma válida devuelve 200 y:

```json
{"ok":true,"diagnostic":"signature_verified","paymentProcessed":false}
```

Termina antes de crear el cliente de base, consultar Mercado Pago, conciliar o programar analítica. No necesita token de pagos. El 200 de diagnóstico no representa un pago aprobado; ningún ID real obtiene ese tratamiento. Los pagos normales mantienen sus controles y el rechazo mayorista con 503 cuando está apagado.

`scripts/maintenance/probe-checkout-pro-webhook.cjs` envía primero una firma alterada y luego una válida usando HMAC SHA256 (`data.id`, `x-request-id`, `ts`). No permite introducir IDs, no lee `.env`, no imprime secretos, no sigue redirecciones, limita solicitudes a 15 segundos y no llama a las APIs de Mercado Pago. Imprime resultados y request IDs.

## Ejecución pendiente

Publicación y comprobación autorizadas explícitamente el 18/10/2026. Esta autorización no incluye activar cobros ni lanzamiento comercial. Antes del push se comprobó por API de Vercel, sin revelar valores, que la bandera de activación está ausente en Production y el secreto de Webhooks está configurado. El resultado HTTP público debe registrarse por separado después del despliegue; las frases de preparación siguientes no son evidencia de ejecución.

1. Comprobar que `DCL_WHOLESALE_CHECKOUT_ENABLED` esté ausente o en `0` en Production y publicar la preparación apagada. Esta tarea no modificó variables remotas ni hizo commit, push o despliegue. La ausencia remota de la bandera registrada anteriormente no se volvió a consultar en esta tarea.
2. En una terminal privada, proporcionar el secreto de Webhooks existente como variable de proceso `MERCADOPAGO_WEBHOOK_SECRET`, mediante gestor de secretos o prompt oculto. Nunca en el chat, argumentos o archivos versionados. No cargar token ni credenciales de Supabase.
3. Ejecutar:

```powershell
node scripts/maintenance/probe-checkout-pro-webhook.cjs https://pagina-web-dcl.vercel.app/api/payments/mercadopago/checkout-pro-webhook
```

4. Guardar como evidencia privada los resultados 401/200, request IDs y versión desplegada. Ante cualquier otro resultado, detenerse y mantener mayoristas apagados. Retirar el secreto del entorno al terminar.

Se puede probar localmente con un secreto ficticio y `http://localhost:3000/api/payments/mercadopago/checkout-pro-webhook`; eso no valida el entorno remoto.

## Alcance y activación

La sonda comprueba recepción en la URL elegida y aceptación/rechazo de firmas con el secreto configurado. **El emisor es nuestro script: no demuestra una entrega originada en Mercado Pago, el enrutamiento efectivo desde una preferencia ni una compra completa.** Crear una preferencia sin pagar tampoco garantiza una notificación de pago.

Si se requiere esa evidencia de origen, falta una operación exclusivamente de prueba con las cuentas y credenciales de prueba admitidas por la aplicación existente, `notification_url` específica y receptor aislado sin base productiva. No realizarla con credenciales reales ni presentarla como completada. El selector observado no permite demostrar ese recorrido bajo las restricciones actuales.

Para la comprobación técnica acotada solicitada falta **desplegar apagado y obtener 401/200 de la sonda en la URL pública**. Después de revisar la evidencia, la activación requiere autorización explícita para establecer `DCL_WHOLESALE_CHECKOUT_ENABLED=1` en Production y aplicarlo a un nuevo despliegue. No activar automáticamente al pasar la sonda. Si se exige evidencia originada en Mercado Pago, completar además la prueba aislada anterior antes de autorizar.

No se generaron cobros, preferencias o cambios de base productiva durante esta preparación. No se alteró la bandera de activación. Las pruebas aisladas usan el SDK real y bloquean cualquier acceso a integraciones durante el diagnóstico, con mayoristas tanto apagados como encendidos.

## Desactivar o retirar la sonda

La salida de diagnóstico queda automáticamente inhabilitada (404 para firma válida) cuando `DCL_WHOLESALE_CHECKOUT_ENABLED=1`. La firma se comprueba primero; una firma incorrecta sigue devolviendo 401. Solamente el ID reservado no numérico puede solicitar diagnóstico; parámetros adicionales o el cuerpo no convierten un pago real en diagnóstico ni omiten su conciliación.

Para desactivar la sonda sin habilitar pagos, establecer `DCL_WHOLESALE_WEBHOOK_DIAGNOSTIC_DISABLED=1` en Production y redesplegar. Mantener `DCL_WHOLESALE_CHECKOUT_ENABLED` ausente o en `0`. No se creó ni modificó esta variable de retiro durante la preparación.

Para retirarla del código, conservar una respuesta 404 para el ID reservado antes de cualquier acceso a integraciones y eliminar su respuesta 200. Eliminar también el ejecutor cuando deje de ser necesario; conservar las pruebas de rechazo y la evidencia privada. Publicar esa retirada sin cambios en las rutas o preferencias de Minoristas. No revertir en bloque cambios previos de integración ni restaurar versiones antiguas del checkout.
