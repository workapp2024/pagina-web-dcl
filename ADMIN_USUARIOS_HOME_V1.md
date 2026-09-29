# Usuarios y Home V1 — transición manual

Publicación autorizada: la migración `20260930010000_staff_users_why_dcl.sql`
fue aplicada y registrada una sola vez. La comparación PRE/POST por conteos y
huellas de todas las filas confirmó igualdad en las nueve tablas comerciales
solicitadas, stock, configuración existente y usuarios Auth. No se crearon usuarios;
los perfiles y la marca de bootstrap siguen vacíos. Defaults: sección habilitada,
modo tarjetas, texto vacío. No se modificaron variables de autenticación.
Las instrucciones de migración siguientes describen el flujo completo; el paso SQL
ya está realizado y no debe repetirse. Los resultados locales y el git status al
final son el registro previo a la publicación.

## Home

Administración → Página web / Home → ¿Por qué DCL? → Guardar todos los cambios.
`site_settings` conserva el título existente y agrega `why_us_enabled`,
`why_us_display_mode` (`cards` / `text`) y `why_us_text` (hasta 4000 caracteres).
La migración mantiene la sección encendida, las cuatro tarjetas y el diseño actual.
No se crea otra configuración ni se almacenan credenciales en las tablas públicas.

## Primer ADMIN y retiro del acceso anterior

Estos pasos son manuales y deben completarse antes de dar por terminada la transición:

1. Conservar `ADMIN_PASSWORD` y `ADMIN_SESSION_SECRET` actuales. Dejar
   `ADMIN_AUTH_MODE=legacy` durante la preparación. Si la variable no existe,
   se mantiene el comportamiento anterior para evitar perder acceso.
2. Aplicar, cuando se autorice por separado, la migración
   `supabase/migrations/20260930010000_staff_users_why_dcl.sql`.
   Es aditiva; no modifica pedidos, ventas, pagos, stock ni Finanzas.
3. Publicar por separado esta versión cuando se autorice. Ingresar con el acceso
   administrativo anterior a `/admin/login` (email vacío y contraseña anterior).
4. Abrir Usuarios → Crear administrador principal. Completar nombre, email,
   contraseña y confirmación (12 a 128 caracteres). El servidor crea Supabase Auth
   y el perfil ADMIN activo. No crear usuarios ni perfiles manualmente en Supabase.
5. Cerrar sesión e ingresar con el nuevo email y contraseña. Verificar acceso total,
   particularmente Usuarios y Configuración, en producción. El acceso anterior
   sigue habilitado si hiciera falta volver a entrar; no se retira automáticamente.
6. Sólo después de comprobar el acceso individual, configurar
   `ADMIN_AUTH_MODE=users` y reiniciar/publicar por el procedimiento habitual.
   El login anterior y todas las cookies antiguas dejan de ser aceptados inmediatamente.
   Verificar nuevamente el login individual y retirar `ADMIN_PASSWORD`.
   Mantener `ADMIN_SESSION_SECRET`: también firma las sesiones individuales.
7. Crear el vendedor desde `/admin/usuarios`, con email, nombre opcional y una
   contraseña inicial de al menos 12 caracteres. Entregarla por un canal privado.
   No se envían invitaciones ni se muestran contraseñas almacenadas.

No dejar `legacy` como configuración final. Si falla la prueba del paso 5,
mantener el acceso anterior y corregir el usuario/perfil antes del paso 6.
Un valor desconocido de `ADMIN_AUTH_MODE` no habilita el acceso anterior.

El bootstrap sólo acepta la sesión legada firmada mientras ese modo esté habilitado.
No hay alta pública. Si existe un ADMIN activo o una marca de bootstrap completado,
la API rechaza el alta. `complete_admin_bootstrap` serializa la comprobación y el
alta del perfil con un bloqueo transaccional; dos solicitudes no crean dos ADMIN.
`admin_bootstrap` conserva la marca incluso si se elimina o desactiva el primer
usuario. Ambas tablas tienen RLS; la función sólo puede ejecutarla service role.
Ante una respuesta de red ambigua no se elimina una identidad que podría haberse
creado correctamente: probar el nuevo login antes de reintentar. El legado permanece.

Después del alta, la acción desaparece. La sesión legada ya no puede listar ni
crear/activar/desactivar vendedores: debe usarse una cuenta ADMIN individual.

## Mi cuenta

ADMIN y VENDEDOR acceden a `/admin/mi-cuenta`: nombre visible editable, email y rol
de sólo lectura. El legado muestra una indicación para crear o usar la cuenta personal.
El cambio de contraseña solicita nueva contraseña y confirmación, con 12 a 128
caracteres y la política de Supabase Auth. No se implementa recuperación avanzada.

La API toma el UUID exclusivamente de la cookie validada, rechaza campos adicionales
(`id`, `role`, `active`, `session_version`, email, etc.) y actualiza la contraseña con
[Supabase Auth, sólo servidor](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).
No guarda contraseñas en tablas propias ni devuelve credenciales o claves privadas.
Invalida versiones previas de sesión y renueva la cookie de quien realizó el cambio.
Si falla la actualización de Auth o la renovación, se exige un nuevo login, sin
reactivar las cookies anteriores. El email no se cambia en esta V1 para evitar un
flujo adicional de verificación de la nueva dirección.

Se amplió la misma migración todavía no aplicada; no se creó otra migración.

Variables ya utilizadas: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`ADMIN_SESSION_SECRET`; `ADMIN_PASSWORD` solamente durante la transición.
No se modificaron archivos de entorno ni variables de Vercel.

## Autenticación y permisos

Supabase Auth verifica email/contraseña en el servidor. La aplicación conserva
una sesión propia firmada de 12 horas en cookie HttpOnly, SameSite=Lax y Secure
en producción. No entrega tokens de Supabase al navegador ni guarda contraseñas.
Cada petición verifica firma, vencimiento, perfil activo, rol y versión de sesión.
La desactivación, reactivación o cambio de rol invalida cookies previas mediante
un trigger; una reactivación exige un nuevo login. Si falla la consulta, se deniega.

`isAdminAuthenticated()` sigue siendo exclusivo de ADMIN por defecto. Las páginas
y APIs habilitadas solicitan explícitamente permisos de catálogo, comercial,
consulta de stock u operación de pedidos. Las acciones sensibles dentro de APIs
compartidas vuelven a exigir ADMIN antes de ejecutar la operación. El proxy de
mantenimiento y las sesiones de compradores no cambian.

ADMIN conserva todos los módulos actuales. Usuarios V1 sólo crea vendedores y
activa/desactiva vendedores; no puede desactivar al propietario, cambiar roles ni
crear otro ADMIN mediante parámetros manipulados. `admin_profiles` tiene RLS y
no concede acceso a anon/authenticated. Sólo el servidor usa service role.

VENDEDOR puede usar Dashboard operativo sin métricas financieras, ver/crear ventas,
crear/editar clientes, ver pedidos y comprobantes, agregar notas y aplicar las
transiciones operativas existentes, crear/editar productos, clasificación,
compatibilidades e imágenes, y consultar inventario. La desactivación de productos
mantiene el flujo actual del catálogo; no hay borrado físico.

Quedan bloqueados Finanzas/caja/cuentas/períodos, Analítica, configuración del sitio,
Home, Usuarios, otros módulos administrativos, confirmación de transferencias,
resoluciones/reembolsos/anulación de ventas, archivo/restauración de pedidos,
archivo/restauración/borrado de clientes y ajustes manuales de stock. Las ventas
conservan los efectos automáticos que ya tienen sobre stock y contabilidad.

Productos conserva el editor actual. Las imágenes pasan por `/api/admin/upload`;
el vendedor sólo puede cargar en la categoría `products`. Cambiar/quitar referencias
de imágenes adicionales usa la API de productos. No se abren permisos de escritura
en Storage. Costos, precios, márgenes y mínimos del producto siguen formando parte
de sus datos comerciales editables; el stock real nunca se toma del formulario.

`getAdminIdentity()` expone UUID, nombre y rol confiables para futura trazabilidad.
No se agregaron columnas a tablas comerciales ni se migró su historial.

## Validación local

Pruebas focalizadas: `tests/staff-home.test.cjs`, `tests/site-settings.test.cjs` y
`tests/product-editor-images.test.cjs`. Auth, APIs y Storage usan dobles locales;
la migración se prueba en PostgreSQL embebido (PGlite), sin servicios remotos.
No sustituye la comprobación manual del primer login contra Supabase del paso 5.

Referencia de integración: [Supabase signInWithPassword](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
y [createUser, sólo servidor](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

## Resultado final local del complemento

READY local. 12/12 pruebas nuevas de `tests/admin-account.test.cjs` aprobadas y 1/1 prueba anterior afectada de creación/activación de vendedores. No se repitieron las 33 pruebas anteriores.
TypeScript (`--noEmit --incremental false`), ESLint solamente de los archivos de este complemento y `git diff --check`: OK.
Auth/API usan dobles locales y el SQL se ejecuta en PGlite, sin Supabase remoto. No se hizo build, commit, push ni deploy.

Archivos adicionales de este complemento:

- Nuevos: `lib/admin-account.ts`, `app/api/admin/users/bootstrap/route.ts`, `app/api/admin/account/route.ts`, `app/admin/mi-cuenta/page.tsx`, `components/admin/MyAccount.tsx`, `tests/admin-account.test.cjs`.
- Actualizados: `lib/admin-auth.ts`, `lib/admin-permissions.ts`, `lib/supabase/database.types.ts`, `app/api/admin/users/route.ts`, `components/admin/UsersManager.tsx`, `components/admin/AdminSidebar.tsx`, la migración existente y este documento.

Pendiente real: aplicar la migración y verificar el primer login ADMIN en producción antes de retirar el acceso anterior. No se hicieron esas operaciones remotas.

`INFORME_POST_MIGRACION.md`, `INFORME_SITE_SETTINGS.md` y `scripts/` ya estaban sin seguimiento y no fueron modificados. El estado siguiente incluye también el trabajo anterior de Home/roles.

### git status --short

```text
 M app/admin/clientes/page.tsx
 M app/admin/compatibilidades/page.tsx
 M app/admin/inventario/page.tsx
 M app/admin/layout.tsx
 M app/admin/login/page.tsx
 M app/admin/page.tsx
 M app/admin/pedidos/[orderNumber]/comprobante/page.tsx
 M app/admin/pedidos/page.tsx
 M app/admin/productos/page.tsx
 M app/admin/ventas/page.tsx
 M app/api/admin/customers/route.ts
 M app/api/admin/inventory/route.ts
 M app/api/admin/login/route.ts
 M app/api/admin/orders/operational-status/route.ts
 M app/api/admin/orders/route.ts
 M app/api/admin/products/route.ts
 M app/api/admin/sales/route.ts
 M app/api/admin/upload/route.ts
 M app/api/admin/vehicle-compatibility/route.ts
 M components/admin/AdminSidebar.tsx
 M components/admin/CustomersManager.tsx
 M components/admin/EditorForms.tsx
 M components/admin/InventoryManager.tsx
 M components/admin/OrdersManager.tsx
 M components/admin/SalesManager.tsx
 M components/sections/WhyUs.tsx
 M lib/admin-auth.ts
 M lib/site-data.ts
 M lib/site-settings-patch.ts
 M lib/supabase/database.types.ts
 M lib/supabase/site-settings.ts
?? ADMIN_USUARIOS_HOME_V1.md
?? INFORME_POST_MIGRACION.md
?? INFORME_SITE_SETTINGS.md
?? app/admin/mi-cuenta/
?? app/admin/usuarios/
?? app/api/admin/account/
?? app/api/admin/users/
?? components/admin/AdminIdentityProvider.tsx
?? components/admin/AdminLoginForm.tsx
?? components/admin/MyAccount.tsx
?? components/admin/SellerDashboard.tsx
?? components/admin/UsersManager.tsx
?? lib/admin-account.ts
?? lib/admin-permissions.ts
?? scripts/
?? supabase/migrations/20260930010000_staff_users_why_dcl.sql
?? tests/admin-account.test.cjs
?? tests/staff-home.test.cjs
```
