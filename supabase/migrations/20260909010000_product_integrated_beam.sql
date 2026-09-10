-- Product characteristics only. Vehicle compatibility positions are unchanged.
BEGIN;

ALTER TABLE public.products
  ADD COLUMN integrated_high_low BOOLEAN NOT NULL DEFAULT false;

-- Old high/low labels do not prove that a lamp has physically integrated beams.
UPDATE public.products
SET functions = array_remove(array_remove(functions, 'high'), 'low')
WHERE functions && ARRAY['high', 'low']::TEXT[];

ALTER TABLE public.products DROP CONSTRAINT products_functions_check;
ALTER TABLE public.products ADD CONSTRAINT products_functions_check CHECK (
  functions IS NULL OR (
    functions <@ ARRAY['fog']::TEXT[]
    AND array_position(functions, NULL) IS NULL
    AND (cardinality(functions) = 0 OR array_ndims(functions) = 1)
    AND cardinality(functions) <= 1
  )
);

GRANT SELECT (integrated_high_low) ON public.products TO anon, authenticated;
COMMIT;
