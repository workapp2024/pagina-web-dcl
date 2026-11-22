-- Apply only after rolling back the application and backing up the new fields.
ALTER TABLE public.home_settings
  DROP COLUMN IF EXISTS hero_mobile_image_url,
  DROP COLUMN IF EXISTS hero_focal_x,
  DROP COLUMN IF EXISTS hero_focal_y,
  DROP COLUMN IF EXISTS hero_mobile_focal_x,
  DROP COLUMN IF EXISTS hero_mobile_focal_y;
