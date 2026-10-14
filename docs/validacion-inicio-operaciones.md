# Validación para comenzar a operar — 13/10/2026

| Apartado | Estado | Resultado |
| --- | --- | --- |
| A. Tienda minorista | LISTO CON OBSERVACIONES | Catálogo, búsquedas, compatibilidades, carrito, checkout, transferencia, reservas, estados e inventario cubiertos por pruebas. Mercado Pago sigue condicionado a configuración externa. |
| B. Portal mayorista | LISTO CON OBSERVACIONES | Acceso, catálogo y precios, pedidos/propuestas, aceptación, confirmación, reservas, entregas, cobros y separación minorista cubiertos por pruebas. El inventario mayorista actual está íntegramente en cero: se requieren entradas reales autorizadas para confirmar y entregar mercadería. |
| C. Administrador, inventarios y finanzas | LISTO CON OBSERVACIONES | Permisos, navegación por sectores, búsquedas, listados y lecturas financieras cubiertos. Historiales e inventarios ya verificados en la regularización. Pendiente comprobación visual en computadora y celular. |
| D. Mercado Pago en producción | BLOQUEADO | El entorno local tiene credenciales con prefijo APP_USR, pero faltan NEXT_PUBLIC_SITE_URL y MERCADOPAGO_WEBHOOK_SECRET. No se accedió a la configuración de Vercel ni al panel del proveedor: no se puede certificar su configuración externa ni la validez de credenciales. |
| E. Errores críticos y correcciones | LISTO | Se excluyó explícitamente .local-test-regularization/ del paquete de Vercel para proteger evidencia privada. Se amplió la prueba existente de empaquetado. No se detectaron fallas funcionales en la suite. |
| F. Imprescindibles antes de publicar | BLOQUEADO | Confirmar variables reales de Production en Vercel, URL pública HTTPS y secreto coincidente con el webhook de Mercado Pago; revisar las pantallas y rutas en un entorno de vista previa sin crear operaciones en producción. Los cambios externos requieren autorización. |
| G. Despliegue comercial en Vercel | BLOQUEADO | El código compila; falta cerrar D y F para recomendar publicación comercial con Mercado Pago. No se ejecutó ningún despliegue. |

Comprobado automáticamente: **553/553 pruebas**, build de producción con TypeScript satisfactorio y lint **0 errores / 66 advertencias**. La prueba de empaquetado modificada se volvió a ejecutar y pasó. El build se ejecutó con el preloader existente que impide conexiones externas; sus avisos de datos remotos ausentes son esperados. La suite utiliza mocks, PGlite y arneses React: no equivale a una comprobación visual ni a una certificación del proveedor de pagos.

Se reutilizó la evidencia de base obtenida durante el cierre de regularización de esta sesión: **55 migraciones locales / 55 registradas**, 26 productos activos y visibles con precios positivos e imágenes configuradas, cinco con stock minorista positivo, nueve con precio mayorista y tres clientes habilitados. Tener URL de imagen configurada no verifica su carga visual. Transferencia tiene alias y titular; WhatsApp y correo de contacto están configurados. Esto no certifica entrega automática de correos ni notificaciones externas.

La batería cubre falta de stock y disponibilidad fallida, reservas y descuento, pagos aprobados/rechazados/pendientes/tardíos, preferencias y URLs de retorno, firmas de webhook, recuperación e idempotencia, anulaciones/reversiones locales, permisos y flujos mayoristas. No hubo pagos reales, pedidos ficticios, escrituras en Supabase, migraciones nuevas, commits, pushes ni despliegues durante esta validación.

Evidencia local privada: `.local-test-regularization/final-functional-tests.log`, `final-functional-build.log` y `final-functional-lint.log`.
