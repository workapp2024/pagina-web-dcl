-- DCL Music: catálogo administrable de emisoras.
-- Migración local: revisar y aplicar manualmente. No se ejecuta automáticamente.

CREATE TABLE IF NOT EXISTS radio_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  genre VARCHAR(80) NOT NULL DEFAULT '',
  stream_url TEXT NOT NULL CHECK (stream_url ~ '^https://'),
  cover_url TEXT,
  description VARCHAR(240) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -10000 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_radio_stations_public
  ON radio_stations(featured DESC, sort_order, created_at)
  WHERE active;

ALTER TABLE radio_stations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read active radio stations" ON radio_stations;
CREATE POLICY "Public read active radio stations"
  ON radio_stations FOR SELECT TO anon, authenticated
  USING (active = TRUE);

GRANT SELECT ON radio_stations TO anon, authenticated;
GRANT ALL ON radio_stations TO service_role;

-- Migra una sola vez la radio configurada actualmente. Las columnas anteriores
-- permanecen como compatibilidad para no romper instalaciones o rollbacks.
INSERT INTO radio_stations (name, genre, stream_url, description, active, featured, sort_order)
SELECT
  CASE WHEN NULLIF(TRIM(radio_name), '') IS NULL OR TRIM(radio_name) = 'Seno Radio'
    THEN 'La Nueva' ELSE TRIM(radio_name) END,
  'Variados',
  radio_stream_url,
  COALESCE(NULLIF(TRIM(radio_subtitle), ''), 'Música gratis para acompañarte en el camino.'),
  radio_enabled,
  TRUE,
  0
FROM site_settings
WHERE id = 1
  AND radio_stream_url ~ '^https://'
  AND NOT EXISTS (SELECT 1 FROM radio_stations);

CREATE OR REPLACE FUNCTION set_radio_station_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS radio_stations_set_updated_at ON radio_stations;
CREATE TRIGGER radio_stations_set_updated_at
BEFORE UPDATE ON radio_stations
FOR EACH ROW EXECUTE FUNCTION set_radio_station_updated_at();
