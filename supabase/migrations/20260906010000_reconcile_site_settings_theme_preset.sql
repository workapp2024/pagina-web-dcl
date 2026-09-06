-- Corrective migration only. Apply manually after review; no data conversion.
BEGIN;

-- Keep the precondition and constraint replacement atomic against concurrent writes.
LOCK TABLE public.site_settings IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.site_settings
    WHERE theme_preset IS NULL
       OR theme_preset NOT IN ('dcl-dark', 'clean-light', 'graphite-pro', 'midnight-blue')
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile site_settings_theme_preset_check: unexpected theme_preset. No settings were changed; review the stored values before retrying.';
  END IF;
END;
$$;

ALTER TABLE public.site_settings
  DROP CONSTRAINT site_settings_theme_preset_check;

ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_theme_preset_check
  CHECK (theme_preset IN ('dcl-dark', 'clean-light', 'graphite-pro', 'midnight-blue'));

COMMIT;
