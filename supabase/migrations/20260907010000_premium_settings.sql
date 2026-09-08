-- Independent Premium selection. Does not update products or existing settings.
BEGIN;

CREATE FUNCTION public.valid_premium_product_ids(ids TEXT[])
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = public AS $$
  SELECT ids IS NOT NULL
    AND cardinality(ids) <= 24
    AND (cardinality(ids) = 0 OR array_ndims(ids) = 1)
    AND NOT EXISTS (SELECT 1 FROM unnest(ids) AS item WHERE item IS NULL OR item !~ '^[a-zA-Z0-9_-]{1,64}$')
    AND cardinality(ids) = (SELECT count(DISTINCT item) FROM unnest(ids) AS item);
$$;

CREATE TABLE public.premium_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  product_ids TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT premium_settings_product_ids_check CHECK (public.valid_premium_product_ids(product_ids)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

-- Empty until the owner explicitly chooses products in Admin.
INSERT INTO public.premium_settings (id) VALUES (1);
ALTER TABLE public.premium_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY premium_settings_public_read ON public.premium_settings FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.premium_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.premium_settings TO anon, authenticated;
GRANT SELECT, UPDATE ON public.premium_settings TO service_role;
REVOKE ALL ON FUNCTION public.valid_premium_product_ids(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valid_premium_product_ids(TEXT[]) TO service_role;

COMMIT;
