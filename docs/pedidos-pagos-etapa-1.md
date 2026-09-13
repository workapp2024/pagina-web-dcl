# Pedidos + pagos: etapa 1

## Verificación previa realizada (2026-09-13)

Se consultó `supabase migration list --linked` contra el proyecto vinculado
`ajbztbwflhjxrenryphu`, antes de editar código. Las 27 versiones locales anteriores
a esta etapa figuran también en el historial remoto, sin versiones faltantes.
Entre ellas: inventario `20260830010000` y `20260830020000`, ventas
`20260830030000`, idempotencia `20260831000000`, pedidos/pagos `20260831010000`,
reversiones `20260901000000`, cuentas/períodos `20260902020000`, medios de pago
`20260903010000`, corrección de creación `20260903040000`, reservas
`20260904010000` y seguridad de reservas/reversiones `20260904020000`.

Esto verifica el historial de migraciones, no constituye una comparación de
definiciones remotas ni descarta alteraciones manuales posteriores. No se ejecutó
SQL de aplicación/reparación ni se cambiaron datos comerciales remotos. El CLI
inicializó su rol de conexión para realizar la consulta.

## Migración aplicada y verificada

Aplicada por autorización explícita el 2026-09-13 en el proyecto vinculado y
registrada como `20260913010000`. No volver a ejecutarla en ese proyecto.
La verificación posterior encontró 18 pedidos con referencias únicas y estado
`received`, 18 entradas iniciales correctas y ninguna contradicción histórica.
Las huellas de los campos originales de pedidos, ítems, pagos, ventas, productos,
movimientos y reservas coincidieron antes y después. Antes de publicar se
confirmó que las 28 sentencias registradas coinciden con el archivo local.

`supabase/migrations/20260913010000_order_operations.sql` es transaccional.
No reemplaza las funciones de cobro, transferencia, reserva, stock, venta o
reversión; tampoco reemplaza `list_admin_orders`. Añade una RPC de consulta nueva
para que el código anterior conserve su contrato.

- `orders.order_number`: `DCL-000001`, generado por una secuencia BIGINT sin ciclo,
  con restricción UNIQUE, formato validado e inmutabilidad al actualizar.
  Crece a `DCL-1000000` sin truncarse. Los huecos son normales por rollback o por
  consumo de secuencia: no es una numeración fiscal ni promete continuidad.
- La asignación a filas anteriores no promete orden cronológico. Preserva UUID,
  fechas, importes, estado técnico y relaciones. No se renumeran pedidos después.
- `orders.operational_status`: los pedidos nuevos empiezan `received`. En el
  backfill, los históricos `cancelled/rejected` reciben `cancelled` sólo si no
  existe ningún pago `approved` ni venta asociada vigente (`sales.status =
  'completed'`). Ante cualquiera de esas contradicciones quedan `received` para
  revisión. Los `completed` y todos los demás casos también quedan `received`;
  nunca se infiere `delivered`. Se preservan estado técnico y fechas originales.
- `order_operational_history`: evento inicial (origen `migration` o
  `order_creation`), transiciones posteriores, fecha real de registro, actor,
  origen y nota opcional. El registro de migración NO se presenta como la fecha
  histórica de entrega/preparación. La aplicación sólo puede leer esta tabla;
  un trigger con permisos limitados a la escritura del historial anexa eventos.

## Reglas operativas

Avances: `received → preparing → ready → delivered`. Requieren estado técnico
`paid/completed`, pago `approved` y venta asociada vigente `completed`. No hay
saltos ni retrocesos. `delivered` y `cancelled` son terminales en esta etapa.

Cancelación operativa: permitida desde un estado no terminal sólo si el estado
técnico ya es `cancelled/rejected`, existe transacción y todos sus pagos están
`cancelled/rejected/error`, sin ninguna venta asociada ni pago aprobado o
reembolsado. Para un pendiente activo se debe resolver primero el flujo actual.
No se invoca ese flujo desde la acción operativa. El botón de cancelación de
transferencia previo sigue separado y conserva su RPC original.

Un pedido pagado, una venta anulada pero aún vinculada o un pago sin reserva
requieren revisión financiera. No se ofrecen cancelación ficticia ni devolución.
Los defectos de conciliación/reversión diagnosticados siguen fuera de alcance.

La nueva RPC bloquea el pedido, comprueba el estado esperado y el trigger valida
la transición con bloqueos de pagos/ventas. Un reintento al mismo destino no
duplica historial; una petición sobre un estado desactualizado se rechaza. No hay
escrituras en tablas financieras o de inventario. `orders.updated_at` se actualiza
por el trigger previo, como corresponde a una modificación del pedido.

El actor se fija en servidor como `admin`: la sesión actual es un rol compartido,
no identifica a una persona. No se aceptan nombres de actor enviados por cliente.

## Interfaz y API

Admin muestra número, cliente, productos, total, método, estado financiero,
estado operativo, modalidad y fecha. Tiene filtro operativo separado y búsqueda
por referencia comercial, UUID, cliente, teléfono o producto. Las entregas
pendientes excluyen los estados operativos terminales y las ventas anuladas.
`completed` se rotula «Venta registrada (no acredita entrega)».

El resultado público muestra referencia comercial, pago y pedido por separado;
WhatsApp utiliza la referencia comercial. Las instrucciones de transferencia
también muestran el número. Las rutas y vínculos internos continúan usando UUID.

## Validación focalizada local

```powershell
node --test --test-isolation=none tests/order-operations.test.cjs
node --test --test-isolation=none tests/order-operations-routes.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Las pruebas SQL usan PGlite efímero en memoria, sin `.env`, red ni servicios
externos. Cubren migración de filas anteriores, unicidad, crecimiento de números,
inmutabilidad, aprobaciones MP/tarjeta/transferencia, historial, permisos, búsqueda,
transiciones, reintentos, rollback transaccional e invariancia de las tablas
financieras y de stock. Comparan las definiciones previas de las funciones
financieras/inventario con las posteriores a la migración.

Las pruebas de interfaz usan un arnés de React; no sustituyen revisión visual en
navegador. PGlite serializa solicitudes: la garantía de concurrencia se basa en
secuencia PostgreSQL, UNIQUE y bloqueos. Falta la prueba con dos conexiones reales
en un entorno de ensayo, sin compras reales. No se ejecutó build ni suite completa.

## Procedimiento de aplicación en otros entornos

El proyecto vinculado ya está migrado; estos pasos no deben repetirse allí.

1. Confirmar el proyecto de destino y conservar un respaldo antes del DDL.
2. Revisar este SQL y elegir una ventana breve: agregar un default volátil,
   asignar referencias e indexar requiere bloquear/reprocesar `orders`.
3. Aplicar únicamente `20260913010000_order_operations.sql` una vez, con el
   procedimiento habitual de migraciones. No hacer `migration repair` ni aplicar
   otras migraciones indiscriminadamente. Si se usa SQL Editor, el historial de
   migraciones debe gestionarse de forma explícita como un paso separado.
4. Comprobar que cada UUID anterior conserva sus datos, tiene referencia única,
   estado según las reglas del backfill y una entrada inicial de historial que
   coincida con ese estado. Revisar las ACL.
5. Sólo después publicar el código de esta etapa. El código nuevo requiere las
   columnas y las dos RPC nuevas; no desplegarlo antes de la migración.
6. Verificar Admin y resultado público; revisar pedidos históricos cancelados
   individualmente, sin inferir entregas ni ejecutar compras reales.

Consultas de control de sólo lectura tras la aplicación:

```sql
SELECT count(*) AS pedidos, count(DISTINCT order_number) AS referencias_unicas,
       count(*) FILTER (WHERE operational_status='delivered') AS entregados
FROM public.orders;
SELECT count(*) AS pedidos_sin_inicio
FROM public.orders o WHERE NOT EXISTS (
  SELECT 1 FROM public.order_operational_history h
  WHERE h.order_id=o.id AND h.previous_status IS NULL
);
SELECT operational_status, count(*) FROM public.orders GROUP BY operational_status;
```

## Rollback lógico

Si falla el DDL antes de COMMIT, PostgreSQL revierte la migración. Si se necesita
volver atrás después, restaurar el código anterior y dejar los objetos aditivos.
No borrar referencias, historial o columnas y no reiniciar la secuencia. El código
anterior puede seguir creando/cobrando pedidos con defaults y triggers nuevos;
los cambios de pago no marcan entrega. Este rollback no elimina operaciones ya
registradas ni permite reutilizar referencias emitidas.
