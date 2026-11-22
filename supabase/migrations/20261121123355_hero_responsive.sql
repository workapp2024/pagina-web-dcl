ALTER TABLE public.home_settings
  ADD COLUMN IF NOT EXISTS hero_mobile_image_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hero_focal_x smallint NOT NULL DEFAULT 50 CHECK (hero_focal_x BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS hero_focal_y smallint NOT NULL DEFAULT 50 CHECK (hero_focal_y BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS hero_mobile_focal_x smallint NOT NULL DEFAULT 50 CHECK (hero_mobile_focal_x BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS hero_mobile_focal_y smallint NOT NULL DEFAULT 50 CHECK (hero_mobile_focal_y BETWEEN 0 AND 100);
