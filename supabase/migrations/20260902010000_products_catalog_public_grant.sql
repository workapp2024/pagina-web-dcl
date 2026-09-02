-- Corrige el grant público por columnas después de agregar campos de catálogo.
-- No habilita costo, margen ni stock para anon/authenticated.
GRANT SELECT (show_in_catalog, warranty_days) ON TABLE public.products TO anon, authenticated;
