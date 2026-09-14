-- Archivado lógico de Pedidos. Preparada localmente; NO aplicar automáticamente.
-- Aplicar antes del código que usa p_archived/archived_at. No backfill comercial.
BEGIN;

ALTER TABLE public.orders ADD COLUMN archived_at TIMESTAMPTZ;
CREATE INDEX orders_archive_created_idx ON public.orders((archived_at IS NOT NULL),created_at DESC,id DESC);
ALTER TABLE public.order_operational_history
  ADD COLUMN action VARCHAR(16) NOT NULL DEFAULT 'status_change'
    CHECK(action IN ('status_change','archive','restore')),
  ADD CONSTRAINT order_history_archive_preserves_status CHECK(
    action='status_change' OR (previous_status IS NOT NULL AND previous_status=new_status)
  );

-- Una sola regla de lectura, reutilizada por la lista y la validación bloqueada.
-- No suponer conciliación de reembolsos ni de múltiples intentos de pago.
CREATE FUNCTION public.order_archive_block_reason(p_order UUID) RETURNS TEXT
LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT CASE
    WHEN o.operational_status NOT IN ('delivered','cancelled') THEN 'ORDER_NOT_TERMINAL'
    WHEN o.status NOT IN ('paid','completed','cancelled','rejected') THEN 'ORDER_REQUIRES_ATTENTION'
    WHEN (SELECT count(*) FROM payment_transactions WHERE order_id=o.id)<>1 THEN 'PAYMENT_AMBIGUOUS'
    WHEN EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=o.id AND status IN ('pending','error','refunded')) THEN 'PAYMENT_REQUIRES_ATTENTION'
    WHEN EXISTS(SELECT 1 FROM inventory_reservations WHERE order_id=o.id AND status='active' AND expires_at>statement_timestamp()) THEN 'RESERVATION_ACTIVE'
    WHEN EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=o.id AND (amount<>o.total OR currency<>o.currency)) THEN 'PAYMENT_MISMATCH'
    WHEN o.operational_status='delivered' AND (o.status<>'completed' OR NOT EXISTS(
      SELECT 1 FROM payment_transactions t JOIN sales s ON s.id=t.sale_id
      WHERE t.order_id=o.id AND t.status='approved' AND s.status='completed' AND s.total=o.total
    )) THEN 'DELIVERY_FINANCIAL_MISMATCH'
    WHEN o.operational_status='cancelled' AND (o.status NOT IN ('cancelled','rejected') OR EXISTS(
      SELECT 1 FROM payment_transactions WHERE order_id=o.id AND (status NOT IN ('cancelled','rejected') OR sale_id IS NOT NULL)
    )) THEN 'CANCELLATION_FINANCIAL_MISMATCH'
    ELSE NULL END
  FROM orders o WHERE o.id=p_order;
$$;

CREATE FUNCTION public.guard_order_archive() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_reason TEXT;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'ARCHIVE_NEW_ORDER_FORBIDDEN'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN RETURN NEW; END IF;
  -- Restaurar nunca exige resolver una incidencia: permite volver a atenderla.
  IF NEW.archived_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.archived_at IS NOT NULL THEN RAISE EXCEPTION 'ARCHIVE_TIMESTAMP_IMMUTABLE'; END IF;
  -- No permitir que un UPDATE combine el archivado con otro estado operativo.
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.operational_status IS DISTINCT FROM OLD.operational_status THEN
    RAISE EXCEPTION 'ARCHIVE_SEPARATE_ACTION_REQUIRED';
  END IF;
  PERFORM id FROM payment_transactions WHERE order_id=OLD.id ORDER BY id FOR UPDATE;
  PERFORM s.id FROM sales s WHERE s.id IN (SELECT sale_id FROM payment_transactions WHERE order_id=OLD.id) ORDER BY s.id FOR SHARE;
  SELECT order_archive_block_reason(OLD.id) INTO v_reason;
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION 'ARCHIVE_NOT_ALLOWED: %',v_reason; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_order_archive BEFORE INSERT OR UPDATE OF archived_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_archive();

CREATE FUNCTION public.record_order_archive() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    INSERT INTO order_operational_history(order_id,previous_status,new_status,source,actor,action)
    VALUES(NEW.id,NEW.operational_status,NEW.operational_status,
      COALESCE(NULLIF(current_setting('dcl.archive_source',TRUE),''),'database'),
      COALESCE(NULLIF(current_setting('dcl.archive_actor',TRUE),''),'server'),
      CASE WHEN NEW.archived_at IS NULL THEN 'restore' ELSE 'archive' END);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_order_archive AFTER UPDATE OF archived_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.record_order_archive();

CREATE FUNCTION public.set_order_archived(p_order UUID,p_archive BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_archived TIMESTAMPTZ;
BEGIN
  IF p_archive IS NULL THEN RAISE EXCEPTION 'ARCHIVE_INVALID_INPUT'; END IF;
  SELECT archived_at INTO v_archived FROM orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ARCHIVE_ORDER_NOT_FOUND'; END IF;
  IF (v_archived IS NOT NULL)=p_archive THEN RETURN p_archive; END IF;
  PERFORM set_config('dcl.archive_source','admin',TRUE);
  PERFORM set_config('dcl.archive_actor','admin',TRUE);
  UPDATE orders SET archived_at=CASE WHEN p_archive THEN clock_timestamp() ELSE NULL END WHERE id=p_order;
  PERFORM set_config('dcl.archive_source','',TRUE);
  PERFORM set_config('dcl.archive_actor','',TRUE);
  RETURN p_archive;
END $$;

-- La consulta paginada se define a continuación. La firma anterior se conserva
-- como acceso a Activos para mantener compatibilidad durante la publicación.

CREATE FUNCTION public.list_admin_operational_orders(p_q TEXT,p_status TEXT,p_since TIMESTAMPTZ,p_page INTEGER,p_limit INTEGER,p_operational TEXT,p_archived BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_archived IS NULL OR p_page<1 OR p_limit NOT BETWEEN 1 AND 100
    OR p_status NOT IN ('all','attention','pending','transfer','paid','delivery','completed','cancelled')
    OR p_operational NOT IN ('all','received','preparing','ready','delivered','cancelled') THEN RAISE EXCEPTION 'Filtro invalido.'; END IF;
  WITH filtered AS MATERIALIZED (
    SELECT o.* FROM orders o WHERE (o.archived_at IS NOT NULL)=p_archived AND (p_since IS NULL OR o.created_at>=p_since)
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
      'archive_block_reason',order_archive_block_reason(o.id),
      'customer',(SELECT jsonb_build_object('full_name',c.full_name,'phone',c.phone,'email',c.email) FROM customers c WHERE c.id=o.customer_id),
      'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('product_name',i.product_name,'quantity',i.quantity,'line_total',i.line_total) ORDER BY i.product_id) FROM order_items i WHERE i.order_id=o.id),'[]'::JSONB),
      'payment',(SELECT jsonb_build_object('sale_id',t.sale_id,'status',t.status,'provider',t.provider,'external_order_id',t.external_order_id,'sale_status',(SELECT s.status FROM sales s WHERE s.id=t.sale_id)) FROM payment_transactions t WHERE t.order_id=o.id ORDER BY t.created_at DESC,t.id DESC LIMIT 1),
      'internalNotes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'created_at',n.created_at) ORDER BY n.created_at DESC,n.id DESC) FROM order_notes n WHERE n.order_id=o.id),'[]'::JSONB),
      'operationalHistory',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id,'action',h.action,'previous_status',h.previous_status,'new_status',h.new_status,'created_at',h.created_at,'source',h.source,'actor',h.actor,'note',h.note) ORDER BY h.id DESC) FROM order_operational_history h WHERE h.order_id=o.id),'[]'::JSONB)
    ) ORDER BY o.created_at DESC,o.id DESC) FROM page_rows o),'[]'::JSONB),
    'pagination',jsonb_build_object('page',p_page,'limit',p_limit,'total',(SELECT count(*) FROM filtered))) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.list_admin_operational_orders(p_q TEXT DEFAULT '',p_status TEXT DEFAULT 'all',p_since TIMESTAMPTZ DEFAULT NULL,p_page INTEGER DEFAULT 1,p_limit INTEGER DEFAULT 50,p_operational TEXT DEFAULT 'all')
RETURNS JSONB LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT public.list_admin_operational_orders(p_q,p_status,p_since,p_page,p_limit,p_operational,FALSE);
$$;

REVOKE ALL ON FUNCTION public.order_archive_block_reason(UUID),public.guard_order_archive(),public.record_order_archive(),
  public.set_order_archived(UUID,BOOLEAN),public.list_admin_operational_orders(TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,TEXT,BOOLEAN)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.order_archive_block_reason(UUID),public.set_order_archived(UUID,BOOLEAN),
  public.list_admin_operational_orders(TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,TEXT,BOOLEAN) TO service_role;
-- Mantener el historial de sólo lectura para la aplicación; escriben los triggers.
REVOKE ALL ON public.order_operational_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.order_operational_history TO service_role;
COMMIT;
