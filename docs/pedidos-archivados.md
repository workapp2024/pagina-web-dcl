# Archivado lógico de Pedidos

Migración local: `20260913020000_order_archiving.sql`. No aplicada remotamente.
Depende de `20260913010000_order_operations.sql`, que no se modifica.

`orders.archived_at`: NULL significa activo; fecha significa archivado. Todos los
pedidos existentes y nuevos quedan activos por defecto. No se borra ningún pedido
ni se hace backfill de pagos, ventas o estados operativos.

## Elegibilidad conservadora

Se requiere estado operativo `delivered` o `cancelled`, exactamente una transacción,
importe/moneda coincidentes y ninguna reserva activa vigente. No se permite un
estado técnico pendiente o `stock_unavailable`, ni pago `pending/error/refunded`.

- Entregado: estado técnico `completed`, pago `approved`, venta asociada
  `completed` con total igual al pedido.
- Cancelado: estado técnico `cancelled/rejected`, pago `cancelled/rejected`, sin
  ninguna venta asociada.

Sin transacción, con varias, con reembolso o con una venta anulada vinculada se
bloquea por ambigüedad. El caso «cancelado sin transacción» pudo ser válido para el
backfill operativo, pero no demuestra cierre financiero suficiente para ocultarlo.
No se resuelve ninguna incidencia desde este bloque.

La lista recibe la causa de bloqueo desde PostgreSQL; el trigger vuelve a validarla
bajo bloqueo de pedido, pagos y venta antes de archivar. La RPC no modifica pagos,
ventas, stock, reservas, productos, referencias ni estados operativos/técnicos.
Sólo cambia `archived_at`, el `updated_at` habitual y anexa auditoría.

## Activos, Archivados y restauración

Admin abre en Pedidos activos, sin límite de fecha inicial. Ver archivados cambia
el conjunto sin mezclar resultados y conserva la búsqueda. Reinicia los filtros
operativos y la página; Archivados conserva búsqueda y filtro de fecha, y permite
abrir el mismo detalle. Referencia DCL, UUID, cliente, teléfono y producto siguen
siendo buscables. El criterio de archivado se aplica antes de contar y paginar.
La firma anterior de `list_admin_operational_orders` sólo devuelve activos.

Restaurar pone `archived_at=NULL` y devuelve el pedido a Activos. No cambia su
estado operativo ni reabre pagos o ventas. Está permitido incluso si se detectó
una incidencia después de archivarlo. Repetir la misma acción sin cambio de estado
no duplica historial ni modifica la fecha de archivado.

La elegibilidad se comprueba al archivar; no se incorpora un monitor financiero
ni se modifican webhooks. Una incidencia sobrevenida después del archivado no
restaura automáticamente el pedido. Se conserva visible en su detalle archivado
y puede restaurarse para atenderla.

## Historial

Se reutiliza `order_operational_history` con una columna aditiva `action`.
Las entradas existentes conservan todos sus campos y reciben el default
`status_change`. Los triggers anexan `archive/restore`, fecha, actor y origen;
estado anterior y nuevo son iguales, porque no se trata de una transición
operativa. El Admin muestra «Pedido archivado» o «Pedido restaurado».
El rol compartido se registra como `admin`; no identifica una persona individual.
La aplicación conserva acceso de sólo lectura al historial.

## Validación y aplicación posterior

Pruebas focalizadas con Node y PGlite en memoria, sin red ni datos reales:

```powershell
node --test --test-isolation=none tests/order-archive.test.cjs
node --test --test-isolation=none tests/order-archive-routes.test.cjs
```

PGlite serializa conexiones: los bloqueos reales concurrentes quedan sujetos a
validación en un entorno de ensayo. No se ejecuta build completo en este bloque.

Para aplicar: revisar únicamente esta migración, confirmar el proyecto y respaldo,
aplicarla con el procedimiento habitual cuando se autorice, comprobar columnas,
permisos, historial y lista Activos/Archivados, y después publicar el código.
No cambiar ni reaplicar la migración anterior. No se aplicó ninguna migración,
ni se hicieron commit, push o deploy durante la preparación.
