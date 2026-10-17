# Bloque 3 — Finanzas

Actualización: los ajustes finales y el estado vigente se describen en `docs/bloque3-ajustes-finales.md`. El saldo se presenta como registrado, no como disponibilidad bancaria verificada. Las transferencias entre cuentas ahora están en la pantalla simple; las transferencias de sector, fechas elegidas y reversiones manuales siguen como propuesta SQL no aplicada. Las secciones siguientes conservan los antecedentes de la primera versión donde difieran.

Implementación local del 17/10/2026, limitada a Finanzas. No modifica pantallas de los Bloques 1 y 2 ni sus operaciones. No se aplicó SQL ni se hicieron operaciones de dinero en producción.

## Interfaz para revisión

`FinanceOverview` sirve las tres rutas existentes:

- `/admin/minoristas/finanzas`
- `/admin/mayoristas/finanzas`
- `/admin/finanzas`

Los sectores comparten la misma presentación de dinero atribuible, ingresos y egresos del período. Los cobros pendientes tienen aviso separado. El historial está plegado inicialmente, con búsqueda y filtros por fecha local de Argentina, tipo, sector e importe absoluto mínimo/máximo, y paginación de 25 registros. Referencias técnicas y herramientas avanzadas permanecen ocultas.

La pantalla general separa Minoristas, Mayoristas, Sin atribución (cuando su neto es distinto de cero) y Total consolidado. Reutiliza cuentas y procedimientos existentes. No presenta ganancias en el resumen. En herramientas avanzadas, el resultado solo se muestra con costos completos; se retiraron las estimaciones de inventario de esa pantalla financiera.

## Cálculo y límites de atribución

La única fuente de dinero es `cash_movements` del período seleccionado, leído completo mediante páginas estables. Los filtros y límites del historial anterior no afectan el cálculo. Las ventas, reconocimientos contables y cobros pendientes no se suman al dinero disponible.

- Referencia mayorista: `wholesale_payment_entry_id`, sin referencia minorista simultánea.
- Referencia minorista: `sale_id` y tipo `sale_income` o `sale_reversal`, sin referencia mayorista simultánea.
- Operaciones generales y aperturas: Sin atribución. No se infiere sector por cuenta, cliente, descripción, estado actual de venta o ausencia de referencia mayorista.
- La propuesta futura permite atribuciones explícitas de nuevas operaciones mediante `financial_sector_allocations`. Si la tabla no existe, su ausencia es compatible; cualquier otro error de lectura se informa.

Los importes se suman en centavos. Se rechazan valores inválidos y movimientos duplicados. Los tres saldos netos suman el consolidado. Los egresos y las reversiones conservan su signo; no se usan archivos visuales para modificar saldos. Aperturas y pares de transferencia no cuentan como ingresos o egresos externos.

**Límite histórico:** los asientos de apertura existentes no guardan el reparto por sector del período anterior. Permanecen Sin atribución, incluso si su importe coincide con el saldo de cierre. No se inventa un reparto. Esto también afecta aperturas futuras generadas por el cierre actual, hasta que se autorice un mecanismo de arrastre explícito. Un egreso general que deja negativo el dinero Sin atribución impide asegurar el disponible de cada sector: el resumen sectorial muestra No disponible y un aviso; el general conserva los netos documentados y el total real.

## Acciones disponibles y pendientes

Ingresar y retirar dinero general reutilizan `record_financial_movement` a través de la API existente, en el período abierto. Piden importe, cuenta, origen/destino externo y motivo. Registran fecha/hora del sistema y permanecen Sin atribución. No simulan fecha elegida ni atribución a un sector. Conservan la clave y el mismo payload ante un resultado incierto; bloquean envíos simultáneos y refrescan el resumen tras éxito.

La transferencia existente entre cuentas se conserva en herramientas avanzadas. **No es una transferencia entre sectores.** No hay botón operativo para transferir entre sectores, seleccionar fecha de operación o revertir operaciones manuales mediante un procedimiento que aún no existe en Supabase.

`scripts/maintenance/proposed-block3-sector-finances.sql` es una propuesta nueva, no aplicada ni lista para ejecutar directamente. Agrega registros de operaciones y atribuciones explícitas, una RPC de ingreso/retiro/transferencia de atribución entre sectores dentro de una misma cuenta, y contramovimientos de reversión de esas operaciones nuevas. Conserva el libro y las cuentas existentes. No reclasifica movimientos anteriores ni reemplaza funciones actuales. Incluye validación ADMIN, permisos service_role, RLS, idempotencia con comprobación de payload, fecha dentro del período abierto, comprobación de fondos, locks/timeouts y protección del historial nuevo. Las transferencias tienen dos patas vinculadas y suma cero. No se propone eliminar registros ni revertir cobros comerciales mediante esta RPC.

Antes de habilitar esas acciones se requiere revisión puntual contra el esquema instalado, preparar su ejecución y obtener autorización explícita. También debe resolverse y probarse el arrastre de atribuciones en cierres si se requiere conservar el reparto entre períodos. Los formularios de esas acciones nuevas deberán conectarse al procedimiento autorizado; no se habilitan automáticamente por instalar la propuesta.

## Validación

Pasaron 32 pruebas focalizadas del modelo de dinero, API paginada con más de 1.000 movimientos, interfaz común, historial, reintentos y procedimientos financieros existentes. TypeScript y build pasaron. Lint terminó con cero errores y 66 advertencias existentes. Los casos adicionales de cierre/apertura y denegación a authenticated también pasaron al ampliar la prueba de la propuesta.

La propuesta se ejecutó solamente en PGlite efímero sobre las migraciones actuales del repositorio, sin cargar credenciales ni conectarse a producción desde las pruebas. Se probaron idempotencia, conflictos de clave, doble reversión, saldo insuficiente, inmutabilidad, permisos, transferencias con consolidado constante y aperturas sin doble conteo. PGlite no reemplaza una prueba de concurrencia entre sesiones PostgreSQL para la futura autorización.

Una consulta independiente, exclusivamente de lectura en Supabase, confirmó que `record_financial_movement`, `transfer_financial_balance` y `close_financial_period` están instaladas, pertenecen a postgres y son ejecutables por service_role. La RPC propuesta `record_sector_finance` no está instalada. No se invocaron esos procedimientos en producción. Evidencia privada y resultado de lint en `.local-test-regularization/block3-review/`. El servidor local respondió HTTP 200 al consultar la ruta general (sin validación visual autenticada).

No hubo navegador conectado disponible para una inspección visual automatizada. Las pruebas comprueban la estructura responsive y navegación; queda pendiente la revisión autenticada desde PC y celular reales. No se hicieron migraciones, commits, pushes ni despliegues.
