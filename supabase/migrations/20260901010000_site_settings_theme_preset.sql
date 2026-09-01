-- Tema visual controlado por código. No modifica datos existentes ni RLS.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS theme_preset VARCHAR(24) NOT NULL DEFAULT 'dcl-dark'
  CHECK (theme_preset IN ('dcl-dark','clean-light','graphite-pro','midnight-blue'));
