# Propuesta separada — conciliación de cuentas

Estado: diseño pendiente; no agrega tablas, integraciones ni botones activos. No cambia la contabilización existente ni los flujos de Mercado Pago, pedidos o ventas.

## Lo que existe

El circuito minorista verifica pagos con el proveedor y registra su estado en `payment_transactions`. El puente financiero incorpora una sola vez el ingreso en `cash_movements` y conserva pendientes cuando no puede imputarlo. La conciliación operativa mayorista registra eventos vinculados a cobros y reembolsos. Ninguno de esos estados demuestra por sí mismo el saldo que puede retirarse de una billetera o banco.

La recuperación de Mercado Pago inspeccionada valida identidad, referencia, importe, moneda, orden/preferencia y estado del pago. No persiste un cálculo completo de acreditación, disponibilidad, comisiones ni retenciones para todos los movimientos y cuentas. Por eso la interfaz final muestra **saldo registrado** y **disponibilidad sin verificar**, sin restar comisiones supuestas ni considerar un pago aprobado como dinero retirable.

## Mecanismo mínimo propuesto

1. Elegir cuenta y fecha/hora de corte. Registrar el saldo observado mediante arqueo de Caja o extracto de banco/Mercado Pago, con moneda, fuente y evidencia privada. Conservar identidad del administrador y fecha real de registro.
2. Capturar el saldo del libro para el mismo corte y la lista de movimientos incluidos, sin modificar los movimientos originales. El corte debe contemplar la apertura y los cierres de períodos; no sumar aperturas de varios períodos.
3. Comparar el observado con el registrado y dejar la diferencia explícita: conforme, con diferencia o pendiente de evidencia. Observar una diferencia no genera dinero ni un ajuste automático.
4. Vincular líneas del extracto con referencias existentes de pago/reembolso/transferencia. Una misma línea de fuente y cuenta solo puede conciliarse una vez; correcciones se registran como nuevos eventos que invalidan o reemplazan la observación anterior, sin borrarla.
5. Para cobros brutos, acreditación neta y comisiones: mantener cada concepto separado. El cobro ya contabilizado se vincula, no vuelve a insertarse como ingreso cuando se acredita. Una comisión comprobada que todavía no figure requiere un egreso separado, con referencia única a la línea del extracto y autorización del administrador. Un reembolso ya contabilizado se vincula al existente, sin generar otro.

La primera versión puede ser manual con un saldo y un extracto privado; no necesita una integración nueva con el proveedor. Si más adelante se automatiza la lectura, debe ser exclusivamente de consulta, validar las referencias de fuente y conservar el mismo control de idempotencia. No se propone iniciar transferencias ni devoluciones desde el conciliador.

## Decisiones pendientes de autorización

- Qué evidencia demuestra disponibilidad y a qué hora corresponde el saldo observado de cada cuenta.
- Cómo separar saldos retenidos, pendientes y disponibles cuando la fuente los informa; si no los informa, conservar disponibilidad desconocida.
- Cómo atribuir al sector una comisión o diferencia compartida; sin evidencia o decisión explícita, permanece Sin atribución.
- Retención y acceso a extractos privados, y reglas de corte entre períodos.
- Esquema aditivo para observaciones, referencias únicas y eventos de conciliación, con RLS, permisos de administrador, pruebas de importación repetida y revisión previa de recuperación/concurrencia.

Estas decisiones y su implementación requieren una autorización posterior. La propuesta actual de movimientos por sector no resuelve ni simula la acreditación bancaria o de Mercado Pago.
