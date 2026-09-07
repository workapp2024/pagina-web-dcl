-- Commercial classification only. No inferred category, function or fitment.
BEGIN;

ALTER TABLE public.products
  ADD COLUMN vehicle_types TEXT[] DEFAULT '{}',
  ADD COLUMN functions TEXT[] DEFAULT '{}';

ALTER TABLE public.products
  ADD CONSTRAINT products_vehicle_types_check CHECK (
    vehicle_types IS NULL OR (
      vehicle_types <@ ARRAY['auto', 'camioneta', 'moto', 'camion']::TEXT[]
      AND array_position(vehicle_types, NULL) IS NULL
      AND (cardinality(vehicle_types) = 0 OR array_ndims(vehicle_types) = 1)
      AND cardinality(vehicle_types) <= 4
    )
  ),
  ADD CONSTRAINT products_functions_check CHECK (
    functions IS NULL OR (
      functions <@ ARRAY['high', 'low', 'fog']::TEXT[]
      AND array_position(functions, NULL) IS NULL
      AND (cardinality(functions) = 0 OR array_ndims(functions) = 1)
      AND cardinality(functions) <= 3
    )
  );

-- Existing category text is deliberately retained. Controlled assignment is enforced
-- by the admin API; no category CHECK/backfill can strand a legacy product.
GRANT SELECT (vehicle_types, functions) ON public.products TO anon, authenticated;

COMMIT;
