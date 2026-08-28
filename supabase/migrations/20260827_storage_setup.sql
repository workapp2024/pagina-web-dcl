-- =============================================================================
-- CONFIGURACIÓN DE SUPABASE STORAGE - DCL CREE LED
-- Archivo: supabase/migrations/20260827_storage_setup.sql
-- Descripción: Creación segura e idempotente del bucket 'dcl-media' y su política de lectura pública.
-- =============================================================================

-- 1. CREACIÓN O ACTUALIZACIÓN DEL BUCKET 'dcl-media'
-- La tabla storage.buckets sí permite inserción/actualización directa por el rol postgres de Supabase.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dcl-media',
  'dcl-media',
  true,
  10485760, -- Límite máximo de 10 MB por archivo
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif'];

-- 2. CREACIÓN SEGURA DE POLÍTICA DE LECTURA PÚBLICA EN STORAGE.OBJECTS
-- RLS ya viene habilitado de fábrica por Supabase en storage.objects (no ejecutar ALTER TABLE).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
      AND tablename = 'objects' 
      AND policyname = 'Public read access for dcl-media'
  ) THEN
    CREATE POLICY "Public read access for dcl-media"
      ON storage.objects FOR SELECT
      TO anon, authenticated
      USING (bucket_id = 'dcl-media');
  END IF;
END $$;

-- NOTA DE SEGURIDAD ABSOLUTA:
-- NO se ejecuta ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY (gestionado por Supabase).
-- NO se ejecutan sentencias DROP, DELETE ni TRUNCATE.
-- NO se alteran las tablas ni políticas del esquema 'public' (products, promotions, vehicle_categories, site_settings, home_settings).
-- NO se otorgan permisos de INSERT, UPDATE ni DELETE al rol anónimo (anon).
