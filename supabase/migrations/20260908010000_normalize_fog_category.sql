-- Data-only normalization: arrays already exist. Preserve all other product data.
BEGIN;

UPDATE public.products
SET category = 'Auxiliar',
    functions = CASE
      WHEN 'fog' = ANY(COALESCE(functions, '{}'::TEXT[])) THEN functions
      ELSE array_append(COALESCE(functions, '{}'::TEXT[]), 'fog')
    END
WHERE category = 'Antiniebla';

COMMIT;
