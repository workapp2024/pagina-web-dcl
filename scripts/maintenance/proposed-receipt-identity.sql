-- PROPUESTA: NO APLICADA. Requiere autorización y preflight antes de instalar.
-- Sólo configuración visual; sin pedidos, pagos, stock ni datos históricos.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.site_settings IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.site_settings'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'site_settings debe conservar RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='site_settings' AND cmd IN ('ALL','INSERT','UPDATE','DELETE')) THEN
    RAISE EXCEPTION 'Revisar políticas de escritura existentes antes de agregar la columna';
  END IF;
  IF (SELECT count(*) FROM public.site_settings WHERE id=1) <> 1 THEN
    RAISE EXCEPTION 'Falta la configuración singleton existente';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.site_settings'::regclass AND attname='receipt_identity' AND NOT attisdropped AND atttypid <> 'jsonb'::regtype) THEN
    RAISE EXCEPTION 'Columna instalada incompatible';
  END IF;
END $$;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS receipt_identity jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.site_settings'::regclass AND conname='site_settings_receipt_identity_shape') THEN
    ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_receipt_identity_shape CHECK (
      receipt_identity IS NULL OR (
        jsonb_typeof(receipt_identity)='object' AND octet_length(receipt_identity::text)<=8192
        AND receipt_identity ?& ARRAY['version','revision','settings']
        AND receipt_identity->'version'='1'::jsonb
        AND jsonb_typeof(receipt_identity->'revision')='string'
        AND (receipt_identity->>'revision') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND jsonb_typeof(receipt_identity->'settings')='object'
      )
    );
  END IF;
END $$;
-- No ampliar ACL, políticas ni permisos de Storage: usa service_role en servidor.
COMMIT;
