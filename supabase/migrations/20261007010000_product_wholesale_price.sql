BEGIN;

-- Same product and stock: only add an optional private price. Existing rows remain NULL.
ALTER TABLE public.products ADD COLUMN wholesale_price NUMERIC(12,2)
  CHECK (wholesale_price IS NULL OR (wholesale_price > 0 AND wholesale_price <= 9999999999.99));

-- Public product readers retain their existing explicit column grants.
REVOKE SELECT (wholesale_price), INSERT (wholesale_price), UPDATE (wholesale_price)
  ON public.products FROM PUBLIC, anon, authenticated;
GRANT SELECT (wholesale_price), INSERT (wholesale_price), UPDATE (wholesale_price)
  ON public.products TO service_role;

-- Abort on unexpected table-wide grants rather than silently expose private prices.
DO $$ BEGIN
  IF has_column_privilege('anon', 'public.products', 'wholesale_price', 'SELECT')
    OR has_column_privilege('authenticated', 'public.products', 'wholesale_price', 'SELECT') THEN
    RAISE EXCEPTION 'Wholesale price remains publicly readable: review existing product grants before applying.';
  END IF;
END $$;

COMMIT;
