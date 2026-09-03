-- REFERENCIA HISTÓRICA, NO EJECUTABLE POR SUPABASE CLI.
-- Este archivo estaba dentro de migrations con un nombre inválido y podía
-- haber sido aplicado manualmente en algún entorno. La migración válida
-- 20260903020000_vehicle_compatibility_service_role_grants.sql lo sustituye
-- de forma segura porque GRANT es idempotente.
GRANT ALL ON TABLE
  public.vehicle_brands,
  public.vehicle_models,
  public.vehicle_compatibilities
TO service_role;
