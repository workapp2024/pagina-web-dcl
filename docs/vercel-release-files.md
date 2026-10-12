# Archivos propuestos para la publicación

Estado: build final aprobado; lint sin errores (66 advertencias); suite completa: 530 aprobadas, 0 fallidas. Variables NEXT_PUBLIC_SITE_URL y MERCADOPAGO_WEBHOOK_SECRET confirmadas en Vercel Production por el propietario; publicación autorizada.

Incluir únicamente estos cambios sobre la base ya versionada. Conservar las ocho migraciones como historial, sin ejecutarlas durante el deploy.

- `.gitignore`
- `.vercelignore`
- `app/admin/configuracion/page.tsx`
- `app/admin/inventario-mayorista/page.tsx`
- `app/admin/pedidos-mayoristas/page.tsx`
- `app/api/admin/finances/route.ts`
- `app/api/admin/home-settings/route.ts`
- `app/api/admin/login/route.ts`
- `app/api/admin/promotions/route.ts`
- `app/api/admin/site-settings/route.ts`
- `app/api/admin/vehicle-categories/route.ts`
- `app/api/admin/warranties/route.ts`
- `app/api/admin/wholesale-inventory/route.ts`
- `app/api/admin/wholesale-orders/[id]/ledger/route.ts`
- `app/api/admin/wholesale-orders/[id]/route.ts`
- `app/api/admin/wholesale-orders/route.ts`
- `app/api/wholesale/orders/[id]/proposal-response/route.ts`
- `app/api/wholesale/orders/attempts/route.ts`
- `app/api/wholesale/orders/route.ts`
- `app/checkout/confirmacion/page.tsx`
- `app/checkout/page.tsx`
- `app/mayoristas/page.tsx`
- `app/page.tsx`
- `components/admin/AdminSidebar.tsx`
- `components/admin/AppearanceSettings.tsx`
- `components/admin/FinancesManager.tsx`
- `components/admin/WholesaleInventoryManager.tsx`
- `components/admin/WholesaleOrderLedger.tsx`
- `components/admin/WholesaleOrdersManager.tsx`
- `components/sections/PaymentMethods.tsx`
- `components/wholesale/WholesaleCatalog.tsx`
- `docs/vercel-release-files.md`
- `eslint.config.mjs`
- `lib/payment-presentation.ts`
- `lib/site-data.ts`
- `lib/site-settings-patch.ts`
- `lib/supabase/database.types.ts`
- `lib/supabase/site-settings.ts`
- `lib/wholesale-commercial-conditions.ts`
- `lib/wholesale-customer-orders.ts`
- `lib/wholesale-finance-read-model.cjs`
- `lib/wholesale-finance-read-model.d.cts`
- `supabase/migrations/20261011010000_wholesale_revision_expected.sql`
- `supabase/migrations/20261012010000_wholesale_customer_proposal_responses.sql`
- `supabase/migrations/20261013010000_wholesale_stock_deliveries.sql`
- `supabase/migrations/20261014010000_wholesale_delivery_corrections_payments.sql`
- `supabase/migrations/20261015010000_wholesale_sale_recognition.sql`
- `supabase/migrations/20261016010000_wholesale_accounting_journal.sql`
- `supabase/migrations/20261017010000_wholesale_financial_account_postings.sql`
- `supabase/migrations/20261018010000_financial_accounts_and_payment_presentation.sql`
- `tests/analytics.test.cjs`
- `tests/analytics-outbox.test.cjs`
- `tests/analytics-outbox-routes.test.cjs`
- `tests/appearance-location.test.cjs`
- `tests/database.cjs`
- `tests/finances-idempotency-key.test.cjs`
- `tests/inventory.test.cjs`
- `tests/load-ts.cjs`
- `tests/order-archive-routes.test.cjs`
- `tests/order-operations-routes.test.cjs`
- `tests/order-receipt.test.cjs`
- `tests/order-resolution-admin.test.cjs`
- `tests/payment-presentation.test.cjs`
- `tests/product-taxonomy.test.cjs`
- `tests/site-settings.test.cjs`
- `tests/staff-home.test.cjs`
- `tests/store.test.cjs`
- `tests/vehicle-product-search.test.cjs`
- `tests/vehicle-search-flow.test.cjs`
- `tests/wholesale-admin-actions.test.cjs`
- `tests/wholesale-admin-orders.test.cjs`
- `tests/wholesale-admin-ui.test.cjs`
- `tests/wholesale-catalog-cart.test.cjs`
- `tests/wholesale-catalog-recovery.test.cjs`
- `tests/wholesale-commercial-conditions.test.cjs`
- `tests/wholesale-customer-orders.test.cjs`
- `tests/wholesale-customer-proposal-response.test.cjs`
- `tests/wholesale-finance-read-model.test.cjs`
- `tests/wholesale-migration-regressions.test.cjs`
- `tests/wholesale-orders-api.test.cjs`
- `tests/wholesale-orders-base.test.cjs`
- `tests/wholesale-stock-deliveries.test.cjs`
- `tests/why-us-cards.test.cjs`

## Excluir de esta publicación

- `docs/payment-brand-assets.md`
- `docs/wholesale-accounting.md`
- `docs/wholesale-migration-readiness.md`
- `INFORME_POST_MIGRACION.md`
- `INFORME_SITE_SETTINGS.md`
- `scripts/maintenance/apply-20261011010000-only.sql`
- `scripts/maintenance/apply-20261012010000-only.sql`
- `scripts/maintenance/apply-20261013010000-only.sql`
- `scripts/maintenance/apply-six-migrations-only.sql`
- `scripts/maintenance/backup-supabase.ps1`
- `scripts/maintenance/check-six-contracts-readonly.sql`
- `scripts/maintenance/check-two-migrations.cjs`
- `scripts/maintenance/complete-postgresql-local.ps1`
- `scripts/maintenance/diagnose-contracts-readonly.sql`
- `scripts/maintenance/initialize-postgresql-local.ps1`
- `scripts/maintenance/initial-reset.sql`
- `scripts/maintenance/initial-reset.template.sql`
- `scripts/maintenance/initial-reset-sql-editor.sql`
- `scripts/maintenance/pg_hba-local.conf`
- `scripts/maintenance/postgresql-local.conf`
- `scripts/maintenance/post-reset-verification.sql`
- `scripts/maintenance/prepare-20261013010000-verifier.cjs`
- `scripts/maintenance/prepare-six-migrations.cjs`
- `scripts/maintenance/pre-reset-logical-backup.sql`
- `scripts/maintenance/pre-reset-snapshot.sql`
- `scripts/maintenance/README.md`
- `scripts/maintenance/README-logical-backup.md`
- `scripts/maintenance/README-postgresql-local.md`
- `scripts/maintenance/README-supabase-recovery.md`
- `scripts/maintenance/remote-contracts.json`
- `scripts/maintenance/restore-backup-local.ps1`
- `scripts/maintenance/schema-contract.sql`
- `scripts/maintenance/supabase-reset-preflight.sql`
- `scripts/maintenance/validate-initial-reset.cjs`
- `scripts/maintenance/verify-local-recovery.sql`
- `tests/wholesale-stock-verifier.test.cjs`

Excluir también .env.local, .local-postgres, Referencia, C:/Respaldos-DCL y .next. .vercelignore excluye credenciales y archivos operativos de la carga a Vercel.

## Correcciones y pruebas

Error real corregido: la RPC de entregas recibe p_key, no p_idempotency_key. Prueba específica aprobada.
Fixtures de pagos actualizadas al contrato vigente: sesión compradora, número comercial, reconciliación idempotente y evidencia completa del proveedor; no se eliminan verificaciones de pago.
Fixtures de componentes: props explícitos de productos, rol ADMIN, hidratación y almacenamiento del intento de checkout.
Fixtures de productos: precio requerido y válido; se mantiene el rechazo de importes inválidos.
Transferencias tardías: expectativa actualizada a la migración ya aplicada del 28/09, que exige stock disponible, conserva idempotencia y no reactiva reservas vencidas. Cancelaciones siguen rechazadas.
Outbox: desempate explícito por tipo de evento solo cuando occurred_at coincide; no se altera ni ignora el orden de timestamps diferentes.

## Condición para publicar

En Vercel → proyecto DCL → Settings → Environment Variables, confirmar NEXT_PUBLIC_SITE_URL (origen HTTPS definitivo) y MERCADOPAGO_WEBHOOK_SECRET (secreto del webhook correspondiente) con alcance Production. No revelar valores. Sin URL, Checkout Pro falla; sin secreto, los webhooks se rechazan y no se confirma automáticamente el pago.

No se modificó Supabase ni se generaron pedidos o pagos reales.
