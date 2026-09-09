-- Keep image_url and all existing cover images untouched.
BEGIN;

ALTER TABLE public.products
  ADD COLUMN additional_image_urls TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT products_additional_image_urls_check CHECK (
      cardinality(additional_image_urls) <= 2
      AND (cardinality(additional_image_urls) = 0 OR array_ndims(additional_image_urls) = 1)
      AND array_position(additional_image_urls, NULL) IS NULL
      AND array_position(additional_image_urls, '') IS NULL
    );

GRANT SELECT (additional_image_urls) ON public.products TO anon, authenticated;

COMMIT;
