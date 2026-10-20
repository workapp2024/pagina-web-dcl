-- Prepared only. Apply in production only with separate administrator authorization.
-- Additive defaults: no public FAQ or payment image until explicitly saved.
BEGIN;
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS faq_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS faq_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS home_payment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_payment_title text NOT NULL DEFAULT 'Medios de pago',
  ADD COLUMN IF NOT EXISTS home_payment_image text NOT NULL DEFAULT '';
ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_faq_items_array CHECK (jsonb_typeof(faq_items) = 'array' AND jsonb_array_length(faq_items) <= 30);
COMMIT;
