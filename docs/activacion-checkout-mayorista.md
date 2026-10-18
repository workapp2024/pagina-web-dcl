# Activación productiva del checkout mayorista

El 18/10/2026 el administrador autorizó expresamente el funcionamiento productivo normal para todos los clientes mayoristas habilitados con pedidos confirmados y saldo pendiente, incluidos configuración, commit, push y despliegue necesarios. Esta decisión reemplaza la exigencia anterior de sandbox, sonda o restricción a un comprador. No autoriza compras ejecutadas por el agente ni un anuncio de lanzamiento comercial.

Se reutilizan las credenciales productivas y las preferencias de Checkout Pro existentes. `DCL_WHOLESALE_CHECKOUT_ENABLED=1` habilita la creación de preferencias; se mantienen titularidad, pedido confirmado, revisión, importe pendiente, moneda, vencimiento, firma, referencia verificada e idempotencia. No se modifican las rutas de Orders ni la creación minorista de preferencias.

Corrección necesaria para esta activación: los dos receptores mayoristas (compartido y de compatibilidad) dejan de depender de la bandera de creación. Las notificaciones siguen exigiendo firma válida y conciliación de una intención existente, con pruebas de relación entre pago, merchant order y preferencia. Desactivar nuevos checkouts no bloquea notificaciones de preferencias ya emitidas.

Comprobaciones indispensables: contrato de tablas y RPC disponible por metadatos, URLs productivas esperadas, credenciales configuradas y regresiones focalizadas; build normal sin sondas. No se leen historiales para activar ni se ejecutan migraciones. Las credenciales de Vercel son sensibles y no se extraen; se conserva la integración productiva existente. La evidencia del despliegue y su bandera queda en `.local-test-regularization/webhook-diagnostic/`, fuera de Git.

Pagos parciales y totales conservan las reglas existentes: una preferencia corresponde al importe elegido, sin superar el saldo; la RPC concilia idempotentemente y realiza la imputación mayorista mediante el puente financiero existente. No se marca entrega ni se altera stock por el mero retorno del navegador. No se afirma haber comprobado una compra real durante la activación: la revisión del recorrido real se hará sobre una compra posterior del usuario.

Para detener nuevos pagos, establecer `DCL_WHOLESALE_CHECKOUT_ENABLED=0` en Production y desplegar este código, sin volver a una versión anterior que bloquee las notificaciones. Las preferencias ya emitidas pueden seguir recibiendo pagos y se continúan conciliando; desactivar la creación no las cancela ni reembolsa. El diagnóstico reservado queda automáticamente deshabilitado con la bandera en `1`.
