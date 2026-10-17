-- PROPUESTA DEL BLOQUE 2. NO APLICADA. Requiere autorización explícita.
-- Clasifica solamente el cliente nuevo y conserva la creación y auditoría existentes.
-- No habilita acceso, no asigna código y no reclasifica clientes existentes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE FUNCTION public.admin_create_wholesale_customer(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_customer jsonb; v_classified jsonb;
BEGIN
  v_customer := public.admin_manage_customer('create', NULL, p_data);
  IF v_customer->>'id' IS NULL THEN RAISE EXCEPTION 'CUSTOMER_INVALID_INPUT'; END IF;
  UPDATE public.customers c SET wholesale_enabled=true
  WHERE c.id=(v_customer->>'id')::uuid
  RETURNING to_jsonb(c) - 'wholesale_code_hash' INTO v_classified;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;
  -- La creación original permanece íntegra. La clasificación agrega otro evento.
  -- No se requiere UPDATE sobre el historial ni se amplían permisos existentes.
  INSERT INTO public.customer_admin_history(customer_id,action,before_data,after_data)
  VALUES ((v_customer->>'id')::uuid,'edit',v_customer,v_classified);
  RETURN v_classified;
END $$;
ALTER FUNCTION public.admin_create_wholesale_customer(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_create_wholesale_customer(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_wholesale_customer(jsonb) TO service_role;
COMMIT;
