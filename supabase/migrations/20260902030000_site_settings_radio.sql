-- Configuración centralizada de radio pública. Migración local: no ejecutar automáticamente.
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS radio_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS radio_show_player BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS radio_name VARCHAR(100) NOT NULL DEFAULT 'Seno Radio';
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS radio_stream_url TEXT NOT NULL DEFAULT 'https://stream.zeno.fm/owdfrxtingytv';
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS radio_subtitle VARCHAR(180) NOT NULL DEFAULT 'Música mientras elegís tus Cree LED';
