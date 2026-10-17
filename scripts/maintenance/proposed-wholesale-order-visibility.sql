-- PROPUESTA NO APLICADA. Requiere autorización explícita. Solo visibilidad y auditoría.
-- Sigue el mecanismo minorista: archivo reversible, control de elegibilidad y registro histórico.
BEGIN;
CREATE TABLE public.wholesale_order_visibility (
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  viewer TEXT NOT NULL CHECK(viewer='admin' OR viewer LIKE 'customer:%'),
  archived_at TIMESTAMPTZ,
  PRIMARY KEY(order_id,viewer)
);
CREATE INDEX wholesale_visibility_viewer_idx ON public.wholesale_order_visibility(viewer) WHERE archived_at IS NOT NULL;
CREATE TABLE public.wholesale_order_visibility_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  viewer TEXT NOT NULL, actor_id UUID NOT NULL,
  action TEXT NOT NULL CHECK(action IN('archive','restore')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.wholesale_order_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_order_visibility_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wholesale_order_visibility,public.wholesale_order_visibility_history FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER wholesale_visibility_history_immutable BEFORE UPDATE OR DELETE ON public.wholesale_order_visibility_history
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_stock_history();

CREATE FUNCTION public.wholesale_order_can_archive(p_order UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM wholesale_orders o WHERE o.id=p_order
 AND (o.status IN('cancelled','rejected') OR (o.status='confirmed' AND
   (SELECT e.event_type FROM wholesale_order_events e WHERE e.order_id=o.id
    AND e.event_type IN('order_fully_delivered','order_delivery_completion_reversed') ORDER BY e.created_at DESC,e.id DESC LIMIT 1)='order_fully_delivered'))
 -- Never hide a monetary obligation. Identical signed read model to wholesale finance.
 AND NOT EXISTS(SELECT 1 FROM (
   SELECT currency,sum(amount) amount FROM (
     SELECT currency,amount FROM wholesale_sale_recognitions WHERE order_id=o.id
     UNION ALL SELECT currency,-amount FROM wholesale_sale_reversals WHERE order_id=o.id
     UNION ALL SELECT currency,CASE WHEN entry_type='payment' THEN -amount ELSE amount END FROM wholesale_payment_entries WHERE order_id=o.id
   ) entries GROUP BY currency HAVING abs(sum(amount))>0.000001
 ) balances)
 AND (o.status='confirmed' OR NOT EXISTS(
   SELECT 1 FROM wholesale_deliveries d JOIN wholesale_delivery_items i ON i.delivery_id=d.id WHERE d.order_id=o.id
   AND i.quantity > COALESCE((SELECT sum(ci.quantity) FROM wholesale_delivery_correction_items ci JOIN wholesale_delivery_corrections c ON c.id=ci.correction_id WHERE c.delivery_id=d.id AND ci.product_id=i.product_id),0)
     +COALESCE((SELECT sum(ri.quantity) FROM wholesale_physical_return_items ri JOIN wholesale_physical_returns r ON r.id=ri.return_id WHERE r.delivery_id=d.id AND ri.product_id=i.product_id),0)
 )))
$$;

CREATE FUNCTION public.list_wholesale_order_visibility(p_customer UUID,p_actor UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_viewer TEXT;
BEGIN
 IF (p_customer IS NULL)=(p_actor IS NULL) THEN RAISE EXCEPTION 'VISIBILITY_INVALID'; END IF;
 IF p_actor IS NOT NULL THEN PERFORM public.assert_wholesale_admin_actor(p_actor); v_viewer:='admin';
 ELSE
   IF NOT EXISTS(SELECT 1 FROM customers WHERE id=p_customer AND archived_at IS NULL AND wholesale_enabled AND wholesale_access_active) THEN RAISE EXCEPTION 'VISIBILITY_FORBIDDEN'; END IF;
   v_viewer:='customer:'||p_customer::text;
 END IF;
 RETURN COALESCE((SELECT jsonb_agg(v.order_id) FROM wholesale_order_visibility v JOIN wholesale_orders o ON o.id=v.order_id
   WHERE v.viewer=v_viewer AND v.archived_at IS NOT NULL AND (p_customer IS NULL OR o.customer_id=p_customer)
   AND public.wholesale_order_can_archive(o.id)),'[]'::jsonb);
END $$;

CREATE FUNCTION public.set_wholesale_order_visibility(p_order UUID,p_archived BOOLEAN,p_customer UUID,p_actor UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_viewer TEXT; v_order public.wholesale_orders%ROWTYPE; v_current BOOLEAN;
BEGIN
 IF p_archived IS NULL OR p_order IS NULL OR (p_customer IS NULL)=(p_actor IS NULL) THEN RAISE EXCEPTION 'VISIBILITY_INVALID'; END IF;
 IF p_actor IS NOT NULL THEN PERFORM public.assert_wholesale_admin_actor(p_actor); v_viewer:='admin';
 ELSE
   IF NOT EXISTS(SELECT 1 FROM customers WHERE id=p_customer AND archived_at IS NULL AND wholesale_enabled AND wholesale_access_active) THEN RAISE EXCEPTION 'VISIBILITY_FORBIDDEN'; END IF;
   v_viewer:='customer:'||p_customer::text;
 END IF;
 SELECT * INTO v_order FROM wholesale_orders WHERE id=p_order AND (p_customer IS NULL OR customer_id=p_customer) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VISIBILITY_NOT_FOUND'; END IF;
 IF p_archived AND NOT public.wholesale_order_can_archive(p_order) THEN RAISE EXCEPTION 'VISIBILITY_PENDING'; END IF;
 SELECT archived_at IS NOT NULL INTO v_current FROM wholesale_order_visibility WHERE order_id=p_order AND viewer=v_viewer;
 IF COALESCE(v_current,false)=p_archived THEN RETURN p_archived; END IF;
 INSERT INTO wholesale_order_visibility(order_id,viewer,archived_at) VALUES(p_order,v_viewer,CASE WHEN p_archived THEN clock_timestamp() END)
 ON CONFLICT(order_id,viewer) DO UPDATE SET archived_at=EXCLUDED.archived_at;
 INSERT INTO wholesale_order_visibility_history(order_id,viewer,actor_id,action)
 VALUES(p_order,v_viewer,COALESCE(p_actor,p_customer),CASE WHEN p_archived THEN 'archive' ELSE 'restore' END);
 RETURN p_archived;
END $$;
REVOKE ALL ON FUNCTION public.wholesale_order_can_archive(UUID),public.list_wholesale_order_visibility(UUID,UUID),public.set_wholesale_order_visibility(UUID,BOOLEAN,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_wholesale_order_visibility(UUID,UUID),public.set_wholesale_order_visibility(UUID,BOOLEAN,UUID,UUID) TO service_role;
COMMIT;
