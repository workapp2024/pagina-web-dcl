# Validación local del bloque de reservas

Ejecutar desde la raíz: `npm run test:store`.

La suite usa Node Test Runner sin crear subprocesos (el sandbox Windows puede
rechazar `spawn`), PGlite en memoria y mocks explícitos. No carga `.env`, no
conecta a Supabase ni llama a Mercado Pago o PostHog. Los pagos son respuestas
simuladas; los pedidos, productos y transferencias sólo existen en memoria.

`database.cjs` reconstruye el esquema de los archivos SQL con timestamp de 14
dígitos, excluyendo la configuración de Storage específica de Supabase. Modela
roles y los grants por defecto de la plataforma antes de aplicar el esquema.
Así las pruebas verifican que la correctiva revoca permisos previamente amplios,
no sólo que una base inicialmente restringida carezca de ellos.

PGlite tiene un único backend. La prueba con `Promise.allSettled` comprueba
integridad de solicitudes simultáneamente presentadas, pero su SQL se serializa.
`concurrency.test.cjs` explora intercalaciones de un modelo de locks: detecta el
ciclo con órdenes inversos y comprueba su ausencia al ordenar los productos.
La suite verifica además las definiciones efectivas de las funciones SQL.
Esto no sustituye una prueba con dos conexiones a PostgreSQL convencional.

`load-ts.cjs` transpila para ejecutar mocks; no sustituye `tsc --noEmit`.
Las pruebas de React usan un arnés de hooks y elementos, no un navegador real.

`offline-network.cjs` es exclusivamente un preloader para el build de validación:
bloquea fetch y conexiones externas y no se importa desde la aplicación. Las
advertencias de datos remotos ausentes en ese build son esperadas.
