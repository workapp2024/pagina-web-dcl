-- ETAPA 1. Preparada localmente; NO aplicar automáticamente al proyecto remoto.
-- Aplicar antes de publicar el código que consulta estos campos/RPC.
-- Rollback lógico: volver al código anterior y conservar columnas, secuencia e
-- historial. No borrar referencias emitidas ni reiniciar/reutilizar la secuencia.
BEGIN;

CREATE SEQUENCE public.order_commercial_number_seq AS BIGINT NO CYCLE;
CREATE FUNCTION public.next_order_commercial_number() RETURNS TEXT
LANGUAGE sql VOLATILE SET search_path=public AS $$
  SELECT 'DCL-' || lpad(n, GREATEST(6,length(n)), '0')
  FROM (SELECT nextval('public.order_commercial_number_seq')::TEXT AS n) numbered;
$$;

-- El default volátil asigna un número distinto también a cada fila existente.
-- No implica orden cronológico histórico. nextval admite huecos tras rollback.
ALTER TABLE public.orders
  ADD COLUMN order_number TEXT NOT NULL DEFAULT public.next_order_commercial_number(),
  ADD COLUMN operational_status VARCHAR(16) NOT NULL DEFAULT 'received',
  ADD CONSTRAINT orders_order_number_unique UNIQUE(order_number),
  ADD CONSTRAINT orders_order_number_format CHECK(order_number ~ '^DCL-[0-9]{6,}$'),
  ADD CONSTRAINT orders_operational_status_check
    CHECK(operational_status IN ('received','preparing','ready','delivered','cancelled'));
ALTER SEQUENCE public.order_commercial_number_seq OWNED BY public.orders.order_number;
CREATE INDEX orders_operational_status_created_idx ON public.orders(operational_status,created_at DESC);

CREATE TABLE public.order_operational_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  previous_status VARCHAR(16) CHECK(previous_status IN ('received','preparing','ready','delivered','cancelled')),
  new_status VARCHAR(16) NOT NULL CHECK(new_status IN ('received','preparing','ready','delivered','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  source VARCHAR(40) NOT NULL,
  actor VARCHAR(80) NOT NULL,
  note VARCHAR(1000) NOT NULL DEFAULT ''
);
CREATE INDEX order_operational_history_order_idx ON public.order_operational_history(order_id,id DESC);
CREATE UNIQUE INDEX order_operational_history_initial_once
  ON public.order_operational_history(order_id) WHERE previous_status IS NULL;
ALTER TABLE public.order_operational_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_operational_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.order_operational_history TO service_role;
REVOKE ALL ON SEQUENCE public.order_operational_history_id_seq FROM PUBLIC,anon,authenticated,service_role;

-- Backfill exclusivamente histórico, antes de instalar los triggers operativos.
-- Preservar updated_at: esta inicialización no es una nueva operación comercial.
-- El ALTER TABLE anterior mantiene el bloqueo hasta COMMIT; el trigger de fecha
-- se restablece en esta misma transacción, sin desactivar otros triggers.
ALTER TABLE public.orders DISABLE TRIGGER set_updated_at_orders;
UPDATE public.orders o SET operational_status='cancelled'
WHERE o.status IN ('cancelled','rejected')
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_transactions t
    WHERE t.order_id=o.id AND t.status='approved'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_transactions t JOIN public.sales s ON s.id=t.sale_id
    WHERE t.order_id=o.id AND s.status='completed'
  );
ALTER TABLE public.orders ENABLE TRIGGER set_updated_at_orders;

-- completed y cualquier contradicción permanecen received; nunca inferir entrega.
-- Registrar el estado realmente asignado por el backfill, no una transición ficticia.
INSERT INTO public.order_operational_history(order_id,previous_status,new_status,source,actor,note)
SELECT id,NULL,operational_status,'migration','system',
  CASE WHEN operational_status='cancelled'
    THEN 'Inicialización histórica: pedido cancelado o rechazado sin pago aprobado ni venta vigente asociada.'
    ELSE 'Inicialización conservadora de pedido existente. No acredita preparación ni entrega; consultar estado técnico original.' END
FROM public.orders;

CREATE FUNCTION public.guard_order_operations() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.operational_status IS DISTINCT FROM 'received' THEN RAISE EXCEPTION 'OPERATIONAL_INITIAL_STATE'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN RAISE EXCEPTION 'ORDER_NUMBER_IMMUTABLE'; END IF;
  IF NEW.operational_status IS NOT DISTINCT FROM OLD.operational_status THEN RETURN NEW; END IF;
  IF OLD.operational_status IN ('delivered','cancelled') THEN RAISE EXCEPTION 'OPERATIONAL_INVALID_TRANSITION'; END IF;

  -- El UPDATE ya bloquea el pedido. Mismo orden que las confirmaciones actuales.
  PERFORM id FROM payment_transactions WHERE order_id=OLD.id ORDER BY id FOR UPDATE;
  PERFORM s.id FROM sales s WHERE s.id IN
    (SELECT sale_id FROM payment_transactions WHERE order_id=OLD.id) ORDER BY s.id FOR SHARE;

  IF NEW.operational_status='cancelled' THEN
    IF NEW.status IN ('paid','completed') OR EXISTS(
      SELECT 1 FROM payment_transactions WHERE order_id=OLD.id
      AND (status IN ('approved','refunded') OR sale_id IS NOT NULL)
    ) THEN RAISE EXCEPTION 'OPERATIONAL_FINANCIAL_REVERSAL_REQUIRED'; END IF;
    -- Una cancelación meramente operativa NO debe dejar un cobro/reserva activos.
    -- Primero debe haber terminado el flujo existente; aquí no se lo invoca.
    IF NEW.status NOT IN ('cancelled','rejected')
      OR NOT EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=OLD.id)
      OR EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=OLD.id AND status NOT IN ('cancelled','rejected','error'))
    THEN RAISE EXCEPTION 'OPERATIONAL_CLOSE_PAYMENT_FIRST'; END IF;
  ELSE
    IF NOT ((OLD.operational_status='received' AND NEW.operational_status='preparing')
      OR (OLD.operational_status='preparing' AND NEW.operational_status='ready')
      OR (OLD.operational_status='ready' AND NEW.operational_status='delivered'))
    THEN RAISE EXCEPTION 'OPERATIONAL_INVALID_TRANSITION'; END IF;
    IF NEW.status NOT IN ('paid','completed') OR NOT EXISTS(
      SELECT 1 FROM payment_transactions t JOIN sales s ON s.id=t.sale_id
      WHERE t.order_id=OLD.id AND t.status='approved' AND s.status='completed'
    ) THEN RAISE EXCEPTION 'OPERATIONAL_PAYMENT_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_order_operations BEFORE INSERT OR UPDATE OF operational_status,order_number ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_operations();

-- SECURITY DEFINER sólo para anexar auditoría desde el trigger. La aplicación no
-- recibe INSERT/UPDATE/DELETE sobre el historial ni puede invocar esta función.
CREATE FUNCTION public.record_order_operation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO order_operational_history(order_id,previous_status,new_status,source,actor)
    VALUES(NEW.id,NULL,NEW.operational_status,'order_creation','server');
  ELSIF NEW.operational_status IS DISTINCT FROM OLD.operational_status THEN
    INSERT INTO order_operational_history(order_id,previous_status,new_status,source,actor,note)
    VALUES(NEW.id,OLD.operational_status,NEW.operational_status,
      COALESCE(NULLIF(current_setting('dcl.operation_source',TRUE),''),'database'),
      COALESCE(NULLIF(current_setting('dcl.operation_actor',TRUE),''),'server'),
      COALESCE(current_setting('dcl.operation_note',TRUE),''));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_order_operation AFTER INSERT OR UPDATE OF operational_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.record_order_operation();

CREATE FUNCTION public.set_order_operational_status(p_order UUID,p_expected TEXT,p_status TEXT,p_note TEXT DEFAULT '')
RETURNS TEXT LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_current TEXT;
BEGIN
  IF p_expected IS NULL OR p_expected NOT IN ('received','preparing','ready','delivered','cancelled')
    OR p_status IS NULL OR p_status NOT IN ('received','preparing','ready','delivered','cancelled')
    OR length(COALESCE(p_note,''))>1000 THEN RAISE EXCEPTION 'OPERATIONAL_INVALID_INPUT'; END IF;
  SELECT operational_status INTO v_current FROM orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATIONAL_ORDER_NOT_FOUND'; END IF;
  -- Reintento del mismo destino: no produce efectos ni una segunda entrada.
  IF v_current=p_status THEN RETURN v_current; END IF;
  IF v_current<>p_expected THEN RAISE EXCEPTION 'OPERATIONAL_STALE_STATE'; END IF;
  PERFORM set_config('dcl.operation_source','admin',TRUE);
  -- La autenticación actual identifica un rol compartido, no una persona.
  PERFORM set_config('dcl.operation_actor','admin',TRUE);
  PERFORM set_config('dcl.operation_note',btrim(COALESCE(p_note,'')),TRUE);
  UPDATE orders SET operational_status=p_status WHERE id=p_order;
  PERFORM set_config('dcl.operation_source','',TRUE);
  PERFORM set_config('dcl.operation_actor','',TRUE);
  PERFORM set_config('dcl.operation_note','',TRUE);
  RETURN p_status;
END $$;

-- RPC nueva: conserva list_admin_orders para rollback de la aplicación anterior.
CREATE FUNCTION public.list_admin_operational_orders(p_q TEXT DEFAULT '',p_status TEXT DEFAULT 'all',p_since TIMESTAMPTZ DEFAULT NULL,p_page INTEGER DEFAULT 1,p_limit INTEGER DEFAULT 50,p_operational TEXT DEFAULT 'all')
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_page<1 OR p_limit NOT BETWEEN 1 AND 100
    OR p_status NOT IN ('all','attention','pending','transfer','paid','delivery','completed','cancelled')
    OR p_operational NOT IN ('all','received','preparing','ready','delivered','cancelled') THEN RAISE EXCEPTION 'Filtro invalido.'; END IF;
  WITH filtered AS MATERIALIZED (
    SELECT o.* FROM orders o WHERE (p_since IS NULL OR o.created_at>=p_since)
    AND (p_operational='all' OR o.operational_status=p_operational)
    AND CASE p_status
      WHEN 'attention' THEN o.status IN ('pending_manual_verification','stock_unavailable')
      WHEN 'pending' THEN EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=o.id AND t.status='pending')
      WHEN 'transfer' THEN o.payment_method='transfer' AND o.status='pending_manual_verification'
      WHEN 'paid' THEN EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=o.id AND t.status='approved')
      WHEN 'delivery' THEN o.fulfillment_method='delivery' AND o.operational_status IN ('received','preparing','ready')
        AND o.status IN ('paid','completed')
        AND EXISTS(SELECT 1 FROM payment_transactions t JOIN sales s ON s.id=t.sale_id WHERE t.order_id=o.id AND t.status='approved' AND s.status='completed')
      WHEN 'completed' THEN o.status='completed'
      WHEN 'cancelled' THEN o.status IN ('cancelled','rejected') ELSE TRUE END
    AND (COALESCE(btrim(p_q),'')='' OR strpos(lower(o.order_number),lower(btrim(p_q)))>0
      OR strpos(lower(o.id::TEXT),lower(btrim(p_q)))>0
      OR EXISTS(SELECT 1 FROM customers c WHERE c.id=o.customer_id AND (strpos(lower(c.full_name),lower(btrim(p_q)))>0 OR strpos(lower(COALESCE(c.phone,'')),lower(btrim(p_q)))>0))
      OR EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND strpos(lower(i.product_name),lower(btrim(p_q)))>0))
  ), page_rows AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT p_limit OFFSET (p_page-1)::BIGINT*p_limit)
  SELECT jsonb_build_object('data',COALESCE((SELECT jsonb_agg(
    (to_jsonb(o)-'request_fingerprint'-'idempotency_key') || jsonb_build_object(
      'customer',(SELECT jsonb_build_object('full_name',c.full_name,'phone',c.phone,'email',c.email) FROM customers c WHERE c.id=o.customer_id),
      'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('product_name',i.product_name,'quantity',i.quantity,'line_total',i.line_total) ORDER BY i.product_id) FROM order_items i WHERE i.order_id=o.id),'[]'::JSONB),
      'payment',(SELECT jsonb_build_object('sale_id',t.sale_id,'status',t.status,'provider',t.provider,'external_order_id',t.external_order_id,'sale_status',(SELECT s.status FROM sales s WHERE s.id=t.sale_id)) FROM payment_transactions t WHERE t.order_id=o.id ORDER BY t.created_at DESC,t.id DESC LIMIT 1),
      'internalNotes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'created_at',n.created_at) ORDER BY n.created_at DESC,n.id DESC) FROM order_notes n WHERE n.order_id=o.id),'[]'::JSONB),
      'operationalHistory',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id,'previous_status',h.previous_status,'new_status',h.new_status,'created_at',h.created_at,'source',h.source,'actor',h.actor,'note',h.note) ORDER BY h.id DESC) FROM order_operational_history h WHERE h.order_id=o.id),'[]'::JSONB)
    ) ORDER BY o.created_at DESC,o.id DESC) FROM page_rows o),'[]'::JSONB),
    'pagination',jsonb_build_object('page',p_page,'limit',p_limit,'total',(SELECT count(*) FROM filtered))) INTO v_result;
  RETURN v_result;
END $$;

REVOKE ALL ON SEQUENCE public.order_commercial_number_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SEQUENCE public.order_commercial_number_seq TO service_role;
REVOKE ALL ON FUNCTION public.next_order_commercial_number(),public.guard_order_operations(),public.record_order_operation(),
  public.set_order_operational_status(UUID,TEXT,TEXT,TEXT),public.list_admin_operational_orders(TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.next_order_commercial_number(),public.set_order_operational_status(UUID,TEXT,TEXT,TEXT),
  public.list_admin_operational_orders(TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,TEXT) TO service_role;
COMMIT;
