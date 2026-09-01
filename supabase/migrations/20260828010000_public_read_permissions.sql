-- =============================================================================
-- PERMISOS DE LECTURA PÚBLICA EN SCHEMA PUBLIC - DCL CREE LED
-- Archivo: supabase/migrations/20260828_public_read_permissions.sql
-- Descripción: Otorga permisos GRANT SELECT explícitos sobre el esquema public 
--              para permitir lecturas públicas vía REST API sin errores 42501.
-- =============================================================================

-- 1. Permiso de uso sobre el esquema public
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 2. Permiso explícito de lectura (SELECT) en las 5 tablas principales
GRANT SELECT ON TABLE 
  public.products,
  public.promotions,
  public.vehicle_categories,
  public.site_settings,
  public.home_settings
TO anon, authenticated;

-- NOTA DE SEGURIDAD ABSOLUTA:
-- NO se otorgan permisos de INSERT, UPDATE ni DELETE para anon ni authenticated.
-- Las escrituras administrativas se realizarán exclusivamente desde las API Routes del servidor Next.js.
-- NO contiene sentencias DROP, DELETE ni TRUNCATE.
