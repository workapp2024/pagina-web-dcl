-- Inventario mayorista independiente y entregas parciales auditables.
-- No escribe en products.stock ni en tablas minoristas.
BEGIN;
DO $guard$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>49 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261012010000' THEN RAISE EXCEPTION 'Unexpected migration history'; END IF; END $guard$;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s';
CREATE TEMP TABLE dcl_before(name text PRIMARY KEY,fingerprint text) ON COMMIT DROP;
DO $snapshot$ DECLARE r record; h text; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP EXECUTE format('SELECT md5(COALESCE(string_agg(row_json, %L ORDER BY row_json),%L)) FROM (SELECT to_jsonb(t)::text row_json FROM public.%I t) x', E'\n','',r.tablename) INTO h; INSERT INTO dcl_before VALUES(r.tablename,h); END LOOP; END $snapshot$;



ALTER TABLE public.wholesale_order_events
  DROP CONSTRAINT wholesale_order_events_event_type_check,
  ADD CONSTRAINT wholesale_order_events_event_type_check CHECK (event_type IN (
    'order_created','review_started','revision_created','revision_proposed','revision_approved',
    'revision_rejected','order_confirmed','order_rejected','order_cancelled','delivery_recorded','order_fully_delivered'
  ));

CREATE TABLE public.wholesale_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('receipt','adjustment','reservation','release','delivery')),
  on_hand_delta INTEGER NOT NULL DEFAULT 0,
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  order_id UUID REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID,
  delivery_id UUID,
  idempotency_key UUID NOT NULL,
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_inventory_movements_key_unique UNIQUE (idempotency_key),
  CONSTRAINT wholesale_inventory_movements_revision_fk FOREIGN KEY (order_id, revision_id)
    REFERENCES public.wholesale_order_revisions(order_id, id) ON DELETE RESTRICT,
  CONSTRAINT wholesale_inventory_movements_shape CHECK (
    (movement_type = 'receipt' AND on_hand_delta > 0 AND reserved_delta = 0 AND order_id IS NULL AND delivery_id IS NULL)
    OR (movement_type = 'adjustment' AND on_hand_delta <> 0 AND reserved_delta = 0 AND order_id IS NULL AND delivery_id IS NULL)
    OR (movement_type = 'reservation' AND on_hand_delta = 0 AND reserved_delta > 0 AND order_id IS NOT NULL AND delivery_id IS NULL)
    OR (movement_type = 'release' AND on_hand_delta = 0 AND reserved_delta < 0 AND order_id IS NOT NULL AND delivery_id IS NULL)
    OR (movement_type = 'delivery' AND on_hand_delta < 0 AND reserved_delta < 0 AND order_id IS NOT NULL AND delivery_id IS NOT NULL)
  )
);
CREATE INDEX wholesale_inventory_movements_product_idx ON public.wholesale_inventory_movements(product_id, created_at, id);
CREATE INDEX wholesale_inventory_movements_order_idx ON public.wholesale_inventory_movements(order_id, product_id);

CREATE TABLE public.wholesale_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_id UUID NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_deliveries_order_id_id_unique UNIQUE (order_id, id),
  CONSTRAINT wholesale_deliveries_order_key_unique UNIQUE (order_id, idempotency_key),
  CONSTRAINT wholesale_deliveries_revision_fk FOREIGN KEY (order_id, revision_id)
    REFERENCES public.wholesale_order_revisions(order_id, id) ON DELETE RESTRICT
);
CREATE TABLE public.wholesale_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.wholesale_deliveries(id) ON DELETE RESTRICT,
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (delivery_id, product_id)
);
ALTER TABLE public.wholesale_inventory_movements
  ADD CONSTRAINT wholesale_inventory_movements_delivery_fk
  FOREIGN KEY (order_id, delivery_id) REFERENCES public.wholesale_deliveries(order_id, id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX wholesale_order_fully_delivered_once_idx
  ON public.wholesale_order_events(order_id) WHERE event_type = 'order_fully_delivered';

CREATE FUNCTION public.guard_wholesale_stock_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'WHOLESALE_HISTORY_IMMUTABLE'; END; $$;
CREATE TRIGGER wholesale_inventory_movements_immutable BEFORE UPDATE OR DELETE ON public.wholesale_inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_stock_history();
CREATE TRIGGER wholesale_deliveries_immutable BEFORE UPDATE OR DELETE ON public.wholesale_deliveries
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_stock_history();
CREATE TRIGGER wholesale_delivery_items_immutable BEFORE UPDATE OR DELETE ON public.wholesale_delivery_items
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_stock_history();
ALTER TABLE public.wholesale_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_delivery_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wholesale_inventory_movements, public.wholesale_deliveries, public.wholesale_delivery_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.wholesale_inventory_movements, public.wholesale_deliveries, public.wholesale_delivery_items TO service_role;

CREATE FUNCTION public.record_wholesale_stock_movement(
  p_product_id VARCHAR, p_movement_type TEXT, p_quantity INTEGER, p_reason TEXT, p_key UUID, p_actor UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID; v_on_hand BIGINT; v_reserved BIGINT; v_existing public.wholesale_inventory_movements%ROWTYPE;
BEGIN
  IF p_product_id IS NULL OR p_movement_type NOT IN ('receipt','adjustment') OR p_quantity = 0
    OR abs(p_quantity) > 100000 OR p_key IS NULL OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST';
  END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-movement-key:' || p_key::text, 0));
  SELECT * INTO v_existing FROM public.wholesale_inventory_movements WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF v_existing.product_id<>p_product_id OR v_existing.movement_type<>p_movement_type OR v_existing.on_hand_delta<>p_quantity OR v_existing.reason<>btrim(p_reason) OR v_existing.actor_id<>p_actor THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_existing.id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || p_product_id, 0));
  SELECT COALESCE(sum(on_hand_delta),0), COALESCE(sum(reserved_delta),0) INTO v_on_hand, v_reserved
    FROM public.wholesale_inventory_movements WHERE product_id=p_product_id;
  IF p_movement_type='receipt' AND p_quantity < 1 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  IF p_movement_type='adjustment' AND v_on_hand + p_quantity < v_reserved THEN RAISE EXCEPTION 'WHOLESALE_STOCK_BELOW_RESERVED'; END IF;
  INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,on_hand_delta,reason,idempotency_key,actor_id)
    VALUES (p_product_id,p_movement_type,p_quantity,btrim(p_reason),p_key,p_actor) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE FUNCTION public.reserve_wholesale_order_inventory(p_order UUID,p_revision UUID,p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_item RECORD; v_available BIGINT; v_key UUID;
BEGIN
  FOR v_item IN SELECT product_id,quantity FROM public.wholesale_order_revision_items WHERE revision_id=p_revision ORDER BY product_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
    SELECT COALESCE(sum(on_hand_delta),0)-COALESCE(sum(reserved_delta),0) INTO v_available
      FROM public.wholesale_inventory_movements WHERE product_id=v_item.product_id;
    IF v_available < v_item.quantity THEN RAISE EXCEPTION 'WHOLESALE_INSUFFICIENT_STOCK'; END IF;
    v_key := (substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),1,8)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),9,4)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),13,4)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),17,4)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),21,12))::uuid;
    INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,reserved_delta,reason,order_id,revision_id,idempotency_key,actor_id)
      VALUES (v_item.product_id,'reservation',v_item.quantity,'Reserva por confirmación del pedido',p_order,p_revision,v_key,p_actor);
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_wholesale_order_revision(p_order UUID,p_revision UUID,p_actor UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_revision public.wholesale_order_revisions%ROWTYPE;
BEGIN
  IF p_order IS NULL OR p_revision IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF v_order.status='confirmed' AND v_order.confirmed_revision_id=p_revision THEN RETURN p_order; END IF;
  SELECT * INTO v_revision FROM public.wholesale_order_revisions WHERE id=p_revision AND order_id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.current_revision_id<>p_revision OR v_order.status<>'in_review'
    OR (v_revision.requires_customer_approval AND v_revision.status<>'approved')
    OR (NOT v_revision.requires_customer_approval AND v_revision.status<>'ready_for_confirmation') THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_CONFIRMABLE';
  END IF;
  PERFORM public.reserve_wholesale_order_inventory(p_order,p_revision,p_actor);
  UPDATE public.wholesale_order_revisions SET status='confirmed' WHERE id=p_revision;
  UPDATE public.wholesale_orders SET status='confirmed',confirmed_revision_id=p_revision,confirmed_at=clock_timestamp() WHERE id=p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES (p_order,p_revision,'order_confirmed','admin',p_actor,'admin');
  RETURN p_order;
END; $$;

CREATE OR REPLACE FUNCTION public.close_wholesale_order(p_order UUID,p_action TEXT,p_actor UUID,p_internal_note TEXT DEFAULT '')
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_status TEXT; v_event TEXT; v_item RECORD; v_remaining BIGINT; v_key UUID; v_digest TEXT;
BEGIN
  IF p_order IS NULL OR p_actor IS NULL OR p_action IS NULL OR p_action NOT IN ('reject','cancel') OR length(COALESCE(p_internal_note,''))>1000 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF (p_action='reject' AND v_order.status='rejected') OR (p_action='cancel' AND v_order.status='cancelled') THEN RETURN v_order.status; END IF;
  IF p_action='reject' AND v_order.status NOT IN ('received','in_review','awaiting_customer') THEN RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE'; END IF;
  IF p_action='cancel' AND v_order.status NOT IN ('received','in_review','awaiting_customer','confirmed') THEN RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE'; END IF;
  IF p_action='cancel' AND v_order.confirmed_revision_id IS NOT NULL THEN
    FOR v_item IN SELECT product_id FROM public.wholesale_order_revision_items WHERE revision_id=v_order.confirmed_revision_id ORDER BY product_id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
      SELECT COALESCE(sum(reserved_delta),0) INTO v_remaining FROM public.wholesale_inventory_movements
        WHERE order_id=p_order AND product_id=v_item.product_id;
      IF v_remaining>0 THEN
        v_digest:=md5(p_order::text||':cancel:'||v_item.product_id);
        v_key:=(substr(v_digest,1,8)||'-'||substr(v_digest,9,4)||'-'||substr(v_digest,13,4)||'-'||substr(v_digest,17,4)||'-'||substr(v_digest,21,12))::uuid;
        INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,reserved_delta,reason,order_id,revision_id,idempotency_key,actor_id)
          VALUES(v_item.product_id,'release',-v_remaining,'Liberación por cancelación del pedido',p_order,v_order.confirmed_revision_id,v_key,p_actor);
      END IF;
    END LOOP;
  END IF;
  v_status:=CASE WHEN p_action='reject' THEN 'rejected' ELSE 'cancelled' END;
  v_event:=CASE WHEN p_action='reject' THEN 'order_rejected' ELSE 'order_cancelled' END;
  UPDATE public.wholesale_orders SET status=v_status,closed_at=clock_timestamp() WHERE id=p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source,internal_note)
    VALUES(p_order,v_order.current_revision_id,v_event,'admin',p_actor,'admin',btrim(COALESCE(p_internal_note,'')));
  RETURN v_status;
END; $$;

CREATE FUNCTION public.record_wholesale_delivery(p_order UUID,p_revision UUID,p_items JSONB,p_key UUID,p_actor UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_delivery UUID:=gen_random_uuid(); v_fingerprint TEXT; v_existing public.wholesale_deliveries%ROWTYPE; v_item RECORD; v_ordered INTEGER; v_done BIGINT; v_reserved BIGINT; v_digest TEXT; v_move_key UUID; v_all_complete BOOLEAN;
BEGIN
  IF p_order IS NULL OR p_revision IS NULL OR p_key IS NULL OR p_actor IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  v_fingerprint:=encode(sha256(convert_to(p_items::text,'UTF8')),'hex');
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_existing FROM public.wholesale_deliveries WHERE order_id=p_order AND idempotency_key=p_key;
  IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF; RETURN v_existing.id; END IF;
  IF v_order.status<>'confirmed' OR v_order.confirmed_revision_id<>p_revision OR v_order.current_revision_id<>p_revision THEN RAISE EXCEPTION 'WHOLESALE_REVISION_STALE'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>2 OR NOT x ? 'productId' OR NOT x ? 'quantity' OR jsonb_typeof(x->'productId')<>'string' OR COALESCE(x->>'quantity','') !~ '^[1-9][0-9]{0,2}$') THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'productId' HAVING sum((x->>'quantity')::int)>100) THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  INSERT INTO public.wholesale_deliveries(id,order_id,revision_id,idempotency_key,request_fingerprint,actor_id) VALUES(v_delivery,p_order,p_revision,p_key,v_fingerprint,p_actor);
  FOR v_item IN SELECT x->>'productId' product_id,sum((x->>'quantity')::int)::int quantity FROM jsonb_array_elements(p_items) x GROUP BY x->>'productId' ORDER BY x->>'productId' LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
    SELECT COALESCE(sum(reserved_delta),0) INTO v_reserved FROM public.wholesale_inventory_movements WHERE order_id=p_order AND product_id=v_item.product_id;
    SELECT quantity INTO v_ordered FROM public.wholesale_order_revision_items WHERE revision_id=p_revision AND product_id=v_item.product_id;
    SELECT COALESCE(sum(di.quantity),0) INTO v_done FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=p_revision AND di.product_id=v_item.product_id;
    IF v_ordered IS NULL OR v_done+v_item.quantity>v_ordered OR v_item.quantity>v_reserved THEN RAISE EXCEPTION 'WHOLESALE_DELIVERY_QUANTITY_INVALID'; END IF;
    INSERT INTO public.wholesale_delivery_items(delivery_id,product_id,quantity) VALUES(v_delivery,v_item.product_id,v_item.quantity);
    v_digest:=md5(v_delivery::text||':'||v_item.product_id);
    v_move_key:=(substr(v_digest,1,8)||'-'||substr(v_digest,9,4)||'-'||substr(v_digest,13,4)||'-'||substr(v_digest,17,4)||'-'||substr(v_digest,21,12))::uuid;
    INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,on_hand_delta,reserved_delta,reason,order_id,revision_id,delivery_id,idempotency_key,actor_id)
      VALUES(v_item.product_id,'delivery',-v_item.quantity,-v_item.quantity,'Entrega mayorista',p_order,p_revision,v_delivery,v_move_key,p_actor);
  END LOOP;
  SELECT NOT EXISTS(SELECT 1 FROM public.wholesale_order_revision_items ri WHERE ri.revision_id=p_revision AND
    (SELECT COALESCE(sum(di.quantity),0) FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=p_revision AND di.product_id=ri.product_id)<ri.quantity) INTO v_all_complete;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES(p_order,p_revision,'delivery_recorded','admin',p_actor,'admin');
  IF v_all_complete THEN INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES(p_order,p_revision,'order_fully_delivered','system',NULL,'system') ON CONFLICT DO NOTHING; END IF;
  RETURN v_delivery;
END; $$;

CREATE FUNCTION public.list_wholesale_inventory()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_products JSONB; v_movements JSONB;
BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'name',p.name,'onHand',COALESCE(m.on_hand,0),'reserved',COALESCE(m.reserved,0),'available',COALESCE(m.on_hand,0)-COALESCE(m.reserved,0)) ORDER BY p.name),'[]'::jsonb)
 INTO v_products FROM public.products p LEFT JOIN (SELECT product_id,sum(on_hand_delta) on_hand,sum(reserved_delta) reserved FROM public.wholesale_inventory_movements GROUP BY product_id) m ON m.product_id=p.id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',m.product_id,'productName',p.name,'type',m.movement_type,'onHandDelta',m.on_hand_delta,'reservedDelta',m.reserved_delta,'reason',m.reason,'orderId',m.order_id,'deliveryId',m.delivery_id,'actorId',m.actor_id,'createdAt',m.created_at) ORDER BY m.created_at DESC,m.id DESC),'[]'::jsonb)
 INTO v_movements FROM (SELECT * FROM public.wholesale_inventory_movements ORDER BY created_at DESC,id DESC LIMIT 100) m JOIN public.products p ON p.id=m.product_id;
 RETURN jsonb_build_object('products',v_products,'movements',v_movements);
END; $$;

REVOKE ALL ON FUNCTION public.guard_wholesale_stock_history() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_wholesale_stock_movement(VARCHAR,TEXT,INTEGER,TEXT,UUID,UUID), public.reserve_wholesale_order_inventory(UUID,UUID,UUID), public.record_wholesale_delivery(UUID,UUID,JSONB,UUID,UUID), public.list_wholesale_inventory() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_wholesale_stock_movement(VARCHAR,TEXT,INTEGER,TEXT,UUID,UUID), public.record_wholesale_delivery(UUID,UUID,JSONB,UUID,UUID), public.list_wholesale_inventory() TO service_role;
DO $verify$ DECLARE r record; h text; BEGIN FOR r IN SELECT * FROM dcl_before LOOP EXECUTE format('SELECT md5(COALESCE(string_agg(row_json, %L ORDER BY row_json),%L)) FROM (SELECT to_jsonb(t)::text row_json FROM public.%I t) x', E'\n','',r.name) INTO h; IF h IS DISTINCT FROM r.fingerprint THEN RAISE EXCEPTION 'Commercial data changed; rolling back'; END IF; END LOOP;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.guard_wholesale_stock_history()'::regprocedure AND prosrc=$expected$
BEGIN RAISE EXCEPTION 'WHOLESALE_HISTORY_IMMUTABLE'; END; $expected$ AND prosecdef=false AND proconfig=ARRAY['search_path=pg_catalog, public'] AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'Function mismatch: guard_wholesale_stock_history'; END IF;
IF has_function_privilege('service_role','public.guard_wholesale_stock_history()','EXECUTE')<>false OR has_function_privilege('anon','public.guard_wholesale_stock_history()','EXECUTE') OR has_function_privilege('authenticated','public.guard_wholesale_stock_history()','EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.guard_wholesale_stock_history()'::regprocedure AND a.grantee=0) THEN RAISE EXCEPTION 'Function privilege mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.record_wholesale_stock_movement(character varying,text,integer,text,uuid,uuid)'::regprocedure AND prosrc=$expected$
DECLARE v_id UUID; v_on_hand BIGINT; v_reserved BIGINT; v_existing public.wholesale_inventory_movements%ROWTYPE;
BEGIN
  IF p_product_id IS NULL OR p_movement_type NOT IN ('receipt','adjustment') OR p_quantity = 0
    OR abs(p_quantity) > 100000 OR p_key IS NULL OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST';
  END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-movement-key:' || p_key::text, 0));
  SELECT * INTO v_existing FROM public.wholesale_inventory_movements WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF v_existing.product_id<>p_product_id OR v_existing.movement_type<>p_movement_type OR v_existing.on_hand_delta<>p_quantity OR v_existing.reason<>btrim(p_reason) OR v_existing.actor_id<>p_actor THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_existing.id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || p_product_id, 0));
  SELECT COALESCE(sum(on_hand_delta),0), COALESCE(sum(reserved_delta),0) INTO v_on_hand, v_reserved
    FROM public.wholesale_inventory_movements WHERE product_id=p_product_id;
  IF p_movement_type='receipt' AND p_quantity < 1 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  IF p_movement_type='adjustment' AND v_on_hand + p_quantity < v_reserved THEN RAISE EXCEPTION 'WHOLESALE_STOCK_BELOW_RESERVED'; END IF;
  INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,on_hand_delta,reason,idempotency_key,actor_id)
    VALUES (p_product_id,p_movement_type,p_quantity,btrim(p_reason),p_key,p_actor) RETURNING id INTO v_id;
  RETURN v_id;
END; $expected$ AND prosecdef=true AND proconfig=ARRAY['search_path=pg_catalog, public'] AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'Function mismatch: record_wholesale_stock_movement'; END IF;
IF has_function_privilege('service_role','public.record_wholesale_stock_movement(character varying,text,integer,text,uuid,uuid)','EXECUTE')<>true OR has_function_privilege('anon','public.record_wholesale_stock_movement(character varying,text,integer,text,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.record_wholesale_stock_movement(character varying,text,integer,text,uuid,uuid)','EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.record_wholesale_stock_movement(character varying,text,integer,text,uuid,uuid)'::regprocedure AND a.grantee=0) THEN RAISE EXCEPTION 'Function privilege mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.reserve_wholesale_order_inventory(uuid,uuid,uuid)'::regprocedure AND prosrc=$expected$
DECLARE v_item RECORD; v_available BIGINT; v_key UUID;
BEGIN
  FOR v_item IN SELECT product_id,quantity FROM public.wholesale_order_revision_items WHERE revision_id=p_revision ORDER BY product_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
    SELECT COALESCE(sum(on_hand_delta),0)-COALESCE(sum(reserved_delta),0) INTO v_available
      FROM public.wholesale_inventory_movements WHERE product_id=v_item.product_id;
    IF v_available < v_item.quantity THEN RAISE EXCEPTION 'WHOLESALE_INSUFFICIENT_STOCK'; END IF;
    v_key := (substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),1,8)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),9,4)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),13,4)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),17,4)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),21,12))::uuid;
    INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,reserved_delta,reason,order_id,revision_id,idempotency_key,actor_id)
      VALUES (v_item.product_id,'reservation',v_item.quantity,'Reserva por confirmación del pedido',p_order,p_revision,v_key,p_actor);
  END LOOP;
END; $expected$ AND prosecdef=true AND proconfig=ARRAY['search_path=pg_catalog, public'] AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'Function mismatch: reserve_wholesale_order_inventory'; END IF;
IF has_function_privilege('service_role','public.reserve_wholesale_order_inventory(uuid,uuid,uuid)','EXECUTE')<>false OR has_function_privilege('anon','public.reserve_wholesale_order_inventory(uuid,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.reserve_wholesale_order_inventory(uuid,uuid,uuid)','EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.reserve_wholesale_order_inventory(uuid,uuid,uuid)'::regprocedure AND a.grantee=0) THEN RAISE EXCEPTION 'Function privilege mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.confirm_wholesale_order_revision(uuid,uuid,uuid)'::regprocedure AND prosrc=$expected$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_revision public.wholesale_order_revisions%ROWTYPE;
BEGIN
  IF p_order IS NULL OR p_revision IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF v_order.status='confirmed' AND v_order.confirmed_revision_id=p_revision THEN RETURN p_order; END IF;
  SELECT * INTO v_revision FROM public.wholesale_order_revisions WHERE id=p_revision AND order_id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.current_revision_id<>p_revision OR v_order.status<>'in_review'
    OR (v_revision.requires_customer_approval AND v_revision.status<>'approved')
    OR (NOT v_revision.requires_customer_approval AND v_revision.status<>'ready_for_confirmation') THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_CONFIRMABLE';
  END IF;
  PERFORM public.reserve_wholesale_order_inventory(p_order,p_revision,p_actor);
  UPDATE public.wholesale_order_revisions SET status='confirmed' WHERE id=p_revision;
  UPDATE public.wholesale_orders SET status='confirmed',confirmed_revision_id=p_revision,confirmed_at=clock_timestamp() WHERE id=p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES (p_order,p_revision,'order_confirmed','admin',p_actor,'admin');
  RETURN p_order;
END; $expected$ AND prosecdef=true AND proconfig=ARRAY['search_path=pg_catalog, public'] AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'Function mismatch: confirm_wholesale_order_revision'; END IF;
IF has_function_privilege('service_role','public.confirm_wholesale_order_revision(uuid,uuid,uuid)','EXECUTE')<>true OR has_function_privilege('anon','public.confirm_wholesale_order_revision(uuid,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.confirm_wholesale_order_revision(uuid,uuid,uuid)','EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.confirm_wholesale_order_revision(uuid,uuid,uuid)'::regprocedure AND a.grantee=0) THEN RAISE EXCEPTION 'Function privilege mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.close_wholesale_order(uuid,text,uuid,text)'::regprocedure AND prosrc=$expected$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_status TEXT; v_event TEXT; v_item RECORD; v_remaining BIGINT; v_key UUID; v_digest TEXT;
BEGIN
  IF p_order IS NULL OR p_actor IS NULL OR p_action IS NULL OR p_action NOT IN ('reject','cancel') OR length(COALESCE(p_internal_note,''))>1000 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF (p_action='reject' AND v_order.status='rejected') OR (p_action='cancel' AND v_order.status='cancelled') THEN RETURN v_order.status; END IF;
  IF p_action='reject' AND v_order.status NOT IN ('received','in_review','awaiting_customer') THEN RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE'; END IF;
  IF p_action='cancel' AND v_order.status NOT IN ('received','in_review','awaiting_customer','confirmed') THEN RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE'; END IF;
  IF p_action='cancel' AND v_order.confirmed_revision_id IS NOT NULL THEN
    FOR v_item IN SELECT product_id FROM public.wholesale_order_revision_items WHERE revision_id=v_order.confirmed_revision_id ORDER BY product_id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
      SELECT COALESCE(sum(reserved_delta),0) INTO v_remaining FROM public.wholesale_inventory_movements
        WHERE order_id=p_order AND product_id=v_item.product_id;
      IF v_remaining>0 THEN
        v_digest:=md5(p_order::text||':cancel:'||v_item.product_id);
        v_key:=(substr(v_digest,1,8)||'-'||substr(v_digest,9,4)||'-'||substr(v_digest,13,4)||'-'||substr(v_digest,17,4)||'-'||substr(v_digest,21,12))::uuid;
        INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,reserved_delta,reason,order_id,revision_id,idempotency_key,actor_id)
          VALUES(v_item.product_id,'release',-v_remaining,'Liberación por cancelación del pedido',p_order,v_order.confirmed_revision_id,v_key,p_actor);
      END IF;
    END LOOP;
  END IF;
  v_status:=CASE WHEN p_action='reject' THEN 'rejected' ELSE 'cancelled' END;
  v_event:=CASE WHEN p_action='reject' THEN 'order_rejected' ELSE 'order_cancelled' END;
  UPDATE public.wholesale_orders SET status=v_status,closed_at=clock_timestamp() WHERE id=p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source,internal_note)
    VALUES(p_order,v_order.current_revision_id,v_event,'admin',p_actor,'admin',btrim(COALESCE(p_internal_note,'')));
  RETURN v_status;
END; $expected$ AND prosecdef=true AND proconfig=ARRAY['search_path=pg_catalog, public'] AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'Function mismatch: close_wholesale_order'; END IF;
IF has_function_privilege('service_role','public.close_wholesale_order(uuid,text,uuid,text)','EXECUTE')<>true OR has_function_privilege('anon','public.close_wholesale_order(uuid,text,uuid,text)','EXECUTE') OR has_function_privilege('authenticated','public.close_wholesale_order(uuid,text,uuid,text)','EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.close_wholesale_order(uuid,text,uuid,text)'::regprocedure AND a.grantee=0) THEN RAISE EXCEPTION 'Function privilege mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.record_wholesale_delivery(uuid,uuid,jsonb,uuid,uuid)'::regprocedure AND prosrc=$expected$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_delivery UUID:=gen_random_uuid(); v_fingerprint TEXT; v_existing public.wholesale_deliveries%ROWTYPE; v_item RECORD; v_ordered INTEGER; v_done BIGINT; v_reserved BIGINT; v_digest TEXT; v_move_key UUID; v_all_complete BOOLEAN;
BEGIN
  IF p_order IS NULL OR p_revision IS NULL OR p_key IS NULL OR p_actor IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  v_fingerprint:=encode(sha256(convert_to(p_items::text,'UTF8')),'hex');
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_existing FROM public.wholesale_deliveries WHERE order_id=p_order AND idempotency_key=p_key;
  IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF; RETURN v_existing.id; END IF;
  IF v_order.status<>'confirmed' OR v_order.confirmed_revision_id<>p_revision OR v_order.current_revision_id<>p_revision THEN RAISE EXCEPTION 'WHOLESALE_REVISION_STALE'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>2 OR NOT x ? 'productId' OR NOT x ? 'quantity' OR jsonb_typeof(x->'productId')<>'string' OR COALESCE(x->>'quantity','') !~ '^[1-9][0-9]{0,2}$') THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'productId' HAVING sum((x->>'quantity')::int)>100) THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  INSERT INTO public.wholesale_deliveries(id,order_id,revision_id,idempotency_key,request_fingerprint,actor_id) VALUES(v_delivery,p_order,p_revision,p_key,v_fingerprint,p_actor);
  FOR v_item IN SELECT x->>'productId' product_id,sum((x->>'quantity')::int)::int quantity FROM jsonb_array_elements(p_items) x GROUP BY x->>'productId' ORDER BY x->>'productId' LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
    SELECT COALESCE(sum(reserved_delta),0) INTO v_reserved FROM public.wholesale_inventory_movements WHERE order_id=p_order AND product_id=v_item.product_id;
    SELECT quantity INTO v_ordered FROM public.wholesale_order_revision_items WHERE revision_id=p_revision AND product_id=v_item.product_id;
    SELECT COALESCE(sum(di.quantity),0) INTO v_done FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=p_revision AND di.product_id=v_item.product_id;
    IF v_ordered IS NULL OR v_done+v_item.quantity>v_ordered OR v_item.quantity>v_reserved THEN RAISE EXCEPTION 'WHOLESALE_DELIVERY_QUANTITY_INVALID'; END IF;
    INSERT INTO public.wholesale_delivery_items(delivery_id,product_id,quantity) VALUES(v_delivery,v_item.product_id,v_item.quantity);
    v_digest:=md5(v_delivery::text||':'||v_item.product_id);
    v_move_key:=(substr(v_digest,1,8)||'-'||substr(v_digest,9,4)||'-'||substr(v_digest,13,4)||'-'||substr(v_digest,17,4)||'-'||substr(v_digest,21,12))::uuid;
    INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,on_hand_delta,reserved_delta,reason,order_id,revision_id,delivery_id,idempotency_key,actor_id)
      VALUES(v_item.product_id,'delivery',-v_item.quantity,-v_item.quantity,'Entrega mayorista',p_order,p_revision,v_delivery,v_move_key,p_actor);
  END LOOP;
  SELECT NOT EXISTS(SELECT 1 FROM public.wholesale_order_revision_items ri WHERE ri.revision_id=p_revision AND
    (SELECT COALESCE(sum(di.quantity),0) FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=p_revision AND di.product_id=ri.product_id)<ri.quantity) INTO v_all_complete;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES(p_order,p_revision,'delivery_recorded','admin',p_actor,'admin');
  IF v_all_complete THEN INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES(p_order,p_revision,'order_fully_delivered','system',NULL,'system') ON CONFLICT DO NOTHING; END IF;
  RETURN v_delivery;
END; $expected$ AND prosecdef=true AND proconfig=ARRAY['search_path=pg_catalog, public'] AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'Function mismatch: record_wholesale_delivery'; END IF;
IF has_function_privilege('service_role','public.record_wholesale_delivery(uuid,uuid,jsonb,uuid,uuid)','EXECUTE')<>true OR has_function_privilege('anon','public.record_wholesale_delivery(uuid,uuid,jsonb,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.record_wholesale_delivery(uuid,uuid,jsonb,uuid,uuid)','EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.record_wholesale_delivery(uuid,uuid,jsonb,uuid,uuid)'::regprocedure AND a.grantee=0) THEN RAISE EXCEPTION 'Function privilege mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.list_wholesale_inventory()'::regprocedure AND prosrc=$expected$
DECLARE v_products JSONB; v_movements JSONB;
BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'name',p.name,'onHand',COALESCE(m.on_hand,0),'reserved',COALESCE(m.reserved,0),'available',COALESCE(m.on_hand,0)-COALESCE(m.reserved,0)) ORDER BY p.name),'[]'::jsonb)
 INTO v_products FROM public.products p LEFT JOIN (SELECT product_id,sum(on_hand_delta) on_hand,sum(reserved_delta) reserved FROM public.wholesale_inventory_movements GROUP BY product_id) m ON m.product_id=p.id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',m.product_id,'productName',p.name,'type',m.movement_type,'onHandDelta',m.on_hand_delta,'reservedDelta',m.reserved_delta,'reason',m.reason,'orderId',m.order_id,'deliveryId',m.delivery_id,'actorId',m.actor_id,'createdAt',m.created_at) ORDER BY m.created_at DESC,m.id DESC),'[]'::jsonb)
 INTO v_movements FROM (SELECT * FROM public.wholesale_inventory_movements ORDER BY created_at DESC,id DESC LIMIT 100) m JOIN public.products p ON p.id=m.product_id;
 RETURN jsonb_build_object('products',v_products,'movements',v_movements);
END; $expected$ AND prosecdef=true AND proconfig=ARRAY['search_path=pg_catalog, public'] AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'Function mismatch: list_wholesale_inventory'; END IF;
IF has_function_privilege('service_role','public.list_wholesale_inventory()','EXECUTE')<>true OR has_function_privilege('anon','public.list_wholesale_inventory()','EXECUTE') OR has_function_privilege('authenticated','public.list_wholesale_inventory()','EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.list_wholesale_inventory()'::regprocedure AND a.grantee=0) THEN RAISE EXCEPTION 'Function privilege mismatch'; END IF;
IF EXISTS(SELECT 1 FROM public.wholesale_inventory_movements) THEN RAISE EXCEPTION 'Unexpected inventory or delivery rows'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.wholesale_inventory_movements'::regclass AND relrowsecurity AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'Table security mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.wholesale_inventory_movements'::regclass AND tgname='wholesale_inventory_movements_immutable' AND tgfoid='public.guard_wholesale_stock_history()'::regprocedure AND tgenabled='O') THEN RAISE EXCEPTION 'Immutable trigger mismatch'; END IF;
IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.wholesale_inventory_movements'::regclass AND NOT convalidated) OR EXISTS(SELECT 1 FROM pg_index WHERE indrelid='public.wholesale_inventory_movements'::regclass AND NOT indisvalid) THEN RAISE EXCEPTION 'Invalid constraint or index'; END IF;
IF NOT has_table_privilege('service_role','public.wholesale_inventory_movements','SELECT') OR has_table_privilege('service_role','public.wholesale_inventory_movements','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('anon','public.wholesale_inventory_movements','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated','public.wholesale_inventory_movements','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'Table privileges mismatch'; END IF;
IF EXISTS(SELECT 1 FROM public.wholesale_deliveries) THEN RAISE EXCEPTION 'Unexpected inventory or delivery rows'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.wholesale_deliveries'::regclass AND relrowsecurity AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'Table security mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.wholesale_deliveries'::regclass AND tgname='wholesale_deliveries_immutable' AND tgfoid='public.guard_wholesale_stock_history()'::regprocedure AND tgenabled='O') THEN RAISE EXCEPTION 'Immutable trigger mismatch'; END IF;
IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.wholesale_deliveries'::regclass AND NOT convalidated) OR EXISTS(SELECT 1 FROM pg_index WHERE indrelid='public.wholesale_deliveries'::regclass AND NOT indisvalid) THEN RAISE EXCEPTION 'Invalid constraint or index'; END IF;
IF NOT has_table_privilege('service_role','public.wholesale_deliveries','SELECT') OR has_table_privilege('service_role','public.wholesale_deliveries','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('anon','public.wholesale_deliveries','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated','public.wholesale_deliveries','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'Table privileges mismatch'; END IF;
IF EXISTS(SELECT 1 FROM public.wholesale_delivery_items) THEN RAISE EXCEPTION 'Unexpected inventory or delivery rows'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.wholesale_delivery_items'::regclass AND relrowsecurity AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'Table security mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.wholesale_delivery_items'::regclass AND tgname='wholesale_delivery_items_immutable' AND tgfoid='public.guard_wholesale_stock_history()'::regprocedure AND tgenabled='O') THEN RAISE EXCEPTION 'Immutable trigger mismatch'; END IF;
IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.wholesale_delivery_items'::regclass AND NOT convalidated) OR EXISTS(SELECT 1 FROM pg_index WHERE indrelid='public.wholesale_delivery_items'::regclass AND NOT indisvalid) THEN RAISE EXCEPTION 'Invalid constraint or index'; END IF;
IF NOT has_table_privilege('service_role','public.wholesale_delivery_items','SELECT') OR has_table_privilege('service_role','public.wholesale_delivery_items','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('anon','public.wholesale_delivery_items','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated','public.wholesale_delivery_items','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'Table privileges mismatch'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.wholesale_order_fully_delivered_once_idx'::regclass AND indisunique AND indisvalid) OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.wholesale_order_events'::regclass AND conname='wholesale_order_events_event_type_check' AND convalidated AND position('order_fully_delivered' in pg_get_constraintdef(oid))>0) THEN RAISE EXCEPTION 'Event contract mismatch'; END IF;
END $verify$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261013010000','wholesale_stock_deliveries',ARRAY[$migration$-- Inventario mayorista independiente y entregas parciales auditables.
-- No escribe en products.stock ni en tablas minoristas.
BEGIN;

ALTER TABLE public.wholesale_order_events
  DROP CONSTRAINT wholesale_order_events_event_type_check,
  ADD CONSTRAINT wholesale_order_events_event_type_check CHECK (event_type IN (
    'order_created','review_started','revision_created','revision_proposed','revision_approved',
    'revision_rejected','order_confirmed','order_rejected','order_cancelled','delivery_recorded','order_fully_delivered'
  ));

CREATE TABLE public.wholesale_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('receipt','adjustment','reservation','release','delivery')),
  on_hand_delta INTEGER NOT NULL DEFAULT 0,
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  order_id UUID REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID,
  delivery_id UUID,
  idempotency_key UUID NOT NULL,
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_inventory_movements_key_unique UNIQUE (idempotency_key),
  CONSTRAINT wholesale_inventory_movements_revision_fk FOREIGN KEY (order_id, revision_id)
    REFERENCES public.wholesale_order_revisions(order_id, id) ON DELETE RESTRICT,
  CONSTRAINT wholesale_inventory_movements_shape CHECK (
    (movement_type = 'receipt' AND on_hand_delta > 0 AND reserved_delta = 0 AND order_id IS NULL AND delivery_id IS NULL)
    OR (movement_type = 'adjustment' AND on_hand_delta <> 0 AND reserved_delta = 0 AND order_id IS NULL AND delivery_id IS NULL)
    OR (movement_type = 'reservation' AND on_hand_delta = 0 AND reserved_delta > 0 AND order_id IS NOT NULL AND delivery_id IS NULL)
    OR (movement_type = 'release' AND on_hand_delta = 0 AND reserved_delta < 0 AND order_id IS NOT NULL AND delivery_id IS NULL)
    OR (movement_type = 'delivery' AND on_hand_delta < 0 AND reserved_delta < 0 AND order_id IS NOT NULL AND delivery_id IS NOT NULL)
  )
);
CREATE INDEX wholesale_inventory_movements_product_idx ON public.wholesale_inventory_movements(product_id, created_at, id);
CREATE INDEX wholesale_inventory_movements_order_idx ON public.wholesale_inventory_movements(order_id, product_id);

CREATE TABLE public.wholesale_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_id UUID NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_deliveries_order_id_id_unique UNIQUE (order_id, id),
  CONSTRAINT wholesale_deliveries_order_key_unique UNIQUE (order_id, idempotency_key),
  CONSTRAINT wholesale_deliveries_revision_fk FOREIGN KEY (order_id, revision_id)
    REFERENCES public.wholesale_order_revisions(order_id, id) ON DELETE RESTRICT
);
CREATE TABLE public.wholesale_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.wholesale_deliveries(id) ON DELETE RESTRICT,
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (delivery_id, product_id)
);
ALTER TABLE public.wholesale_inventory_movements
  ADD CONSTRAINT wholesale_inventory_movements_delivery_fk
  FOREIGN KEY (order_id, delivery_id) REFERENCES public.wholesale_deliveries(order_id, id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX wholesale_order_fully_delivered_once_idx
  ON public.wholesale_order_events(order_id) WHERE event_type = 'order_fully_delivered';

CREATE FUNCTION public.guard_wholesale_stock_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'WHOLESALE_HISTORY_IMMUTABLE'; END; $$;
CREATE TRIGGER wholesale_inventory_movements_immutable BEFORE UPDATE OR DELETE ON public.wholesale_inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_stock_history();
CREATE TRIGGER wholesale_deliveries_immutable BEFORE UPDATE OR DELETE ON public.wholesale_deliveries
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_stock_history();
CREATE TRIGGER wholesale_delivery_items_immutable BEFORE UPDATE OR DELETE ON public.wholesale_delivery_items
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_stock_history();
ALTER TABLE public.wholesale_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_delivery_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wholesale_inventory_movements, public.wholesale_deliveries, public.wholesale_delivery_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.wholesale_inventory_movements, public.wholesale_deliveries, public.wholesale_delivery_items TO service_role;

CREATE FUNCTION public.record_wholesale_stock_movement(
  p_product_id VARCHAR, p_movement_type TEXT, p_quantity INTEGER, p_reason TEXT, p_key UUID, p_actor UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id UUID; v_on_hand BIGINT; v_reserved BIGINT; v_existing public.wholesale_inventory_movements%ROWTYPE;
BEGIN
  IF p_product_id IS NULL OR p_movement_type NOT IN ('receipt','adjustment') OR p_quantity = 0
    OR abs(p_quantity) > 100000 OR p_key IS NULL OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST';
  END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-movement-key:' || p_key::text, 0));
  SELECT * INTO v_existing FROM public.wholesale_inventory_movements WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF v_existing.product_id<>p_product_id OR v_existing.movement_type<>p_movement_type OR v_existing.on_hand_delta<>p_quantity OR v_existing.reason<>btrim(p_reason) OR v_existing.actor_id<>p_actor THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_existing.id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || p_product_id, 0));
  SELECT COALESCE(sum(on_hand_delta),0), COALESCE(sum(reserved_delta),0) INTO v_on_hand, v_reserved
    FROM public.wholesale_inventory_movements WHERE product_id=p_product_id;
  IF p_movement_type='receipt' AND p_quantity < 1 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  IF p_movement_type='adjustment' AND v_on_hand + p_quantity < v_reserved THEN RAISE EXCEPTION 'WHOLESALE_STOCK_BELOW_RESERVED'; END IF;
  INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,on_hand_delta,reason,idempotency_key,actor_id)
    VALUES (p_product_id,p_movement_type,p_quantity,btrim(p_reason),p_key,p_actor) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE FUNCTION public.reserve_wholesale_order_inventory(p_order UUID,p_revision UUID,p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_item RECORD; v_available BIGINT; v_key UUID;
BEGIN
  FOR v_item IN SELECT product_id,quantity FROM public.wholesale_order_revision_items WHERE revision_id=p_revision ORDER BY product_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
    SELECT COALESCE(sum(on_hand_delta),0)-COALESCE(sum(reserved_delta),0) INTO v_available
      FROM public.wholesale_inventory_movements WHERE product_id=v_item.product_id;
    IF v_available < v_item.quantity THEN RAISE EXCEPTION 'WHOLESALE_INSUFFICIENT_STOCK'; END IF;
    v_key := (substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),1,8)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),9,4)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),13,4)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),17,4)||'-'||
      substr(md5(p_order::text || ':' || p_revision::text || ':' || v_item.product_id),21,12))::uuid;
    INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,reserved_delta,reason,order_id,revision_id,idempotency_key,actor_id)
      VALUES (v_item.product_id,'reservation',v_item.quantity,'Reserva por confirmación del pedido',p_order,p_revision,v_key,p_actor);
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_wholesale_order_revision(p_order UUID,p_revision UUID,p_actor UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_revision public.wholesale_order_revisions%ROWTYPE;
BEGIN
  IF p_order IS NULL OR p_revision IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF v_order.status='confirmed' AND v_order.confirmed_revision_id=p_revision THEN RETURN p_order; END IF;
  SELECT * INTO v_revision FROM public.wholesale_order_revisions WHERE id=p_revision AND order_id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.current_revision_id<>p_revision OR v_order.status<>'in_review'
    OR (v_revision.requires_customer_approval AND v_revision.status<>'approved')
    OR (NOT v_revision.requires_customer_approval AND v_revision.status<>'ready_for_confirmation') THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_CONFIRMABLE';
  END IF;
  PERFORM public.reserve_wholesale_order_inventory(p_order,p_revision,p_actor);
  UPDATE public.wholesale_order_revisions SET status='confirmed' WHERE id=p_revision;
  UPDATE public.wholesale_orders SET status='confirmed',confirmed_revision_id=p_revision,confirmed_at=clock_timestamp() WHERE id=p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES (p_order,p_revision,'order_confirmed','admin',p_actor,'admin');
  RETURN p_order;
END; $$;

CREATE OR REPLACE FUNCTION public.close_wholesale_order(p_order UUID,p_action TEXT,p_actor UUID,p_internal_note TEXT DEFAULT '')
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_status TEXT; v_event TEXT; v_item RECORD; v_remaining BIGINT; v_key UUID; v_digest TEXT;
BEGIN
  IF p_order IS NULL OR p_actor IS NULL OR p_action IS NULL OR p_action NOT IN ('reject','cancel') OR length(COALESCE(p_internal_note,''))>1000 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF (p_action='reject' AND v_order.status='rejected') OR (p_action='cancel' AND v_order.status='cancelled') THEN RETURN v_order.status; END IF;
  IF p_action='reject' AND v_order.status NOT IN ('received','in_review','awaiting_customer') THEN RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE'; END IF;
  IF p_action='cancel' AND v_order.status NOT IN ('received','in_review','awaiting_customer','confirmed') THEN RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE'; END IF;
  IF p_action='cancel' AND v_order.confirmed_revision_id IS NOT NULL THEN
    FOR v_item IN SELECT product_id FROM public.wholesale_order_revision_items WHERE revision_id=v_order.confirmed_revision_id ORDER BY product_id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
      SELECT COALESCE(sum(reserved_delta),0) INTO v_remaining FROM public.wholesale_inventory_movements
        WHERE order_id=p_order AND product_id=v_item.product_id;
      IF v_remaining>0 THEN
        v_digest:=md5(p_order::text||':cancel:'||v_item.product_id);
        v_key:=(substr(v_digest,1,8)||'-'||substr(v_digest,9,4)||'-'||substr(v_digest,13,4)||'-'||substr(v_digest,17,4)||'-'||substr(v_digest,21,12))::uuid;
        INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,reserved_delta,reason,order_id,revision_id,idempotency_key,actor_id)
          VALUES(v_item.product_id,'release',-v_remaining,'Liberación por cancelación del pedido',p_order,v_order.confirmed_revision_id,v_key,p_actor);
      END IF;
    END LOOP;
  END IF;
  v_status:=CASE WHEN p_action='reject' THEN 'rejected' ELSE 'cancelled' END;
  v_event:=CASE WHEN p_action='reject' THEN 'order_rejected' ELSE 'order_cancelled' END;
  UPDATE public.wholesale_orders SET status=v_status,closed_at=clock_timestamp() WHERE id=p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source,internal_note)
    VALUES(p_order,v_order.current_revision_id,v_event,'admin',p_actor,'admin',btrim(COALESCE(p_internal_note,'')));
  RETURN v_status;
END; $$;

CREATE FUNCTION public.record_wholesale_delivery(p_order UUID,p_revision UUID,p_items JSONB,p_key UUID,p_actor UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_delivery UUID:=gen_random_uuid(); v_fingerprint TEXT; v_existing public.wholesale_deliveries%ROWTYPE; v_item RECORD; v_ordered INTEGER; v_done BIGINT; v_reserved BIGINT; v_digest TEXT; v_move_key UUID; v_all_complete BOOLEAN;
BEGIN
  IF p_order IS NULL OR p_revision IS NULL OR p_key IS NULL OR p_actor IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  v_fingerprint:=encode(sha256(convert_to(p_items::text,'UTF8')),'hex');
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_existing FROM public.wholesale_deliveries WHERE order_id=p_order AND idempotency_key=p_key;
  IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF; RETURN v_existing.id; END IF;
  IF v_order.status<>'confirmed' OR v_order.confirmed_revision_id<>p_revision OR v_order.current_revision_id<>p_revision THEN RAISE EXCEPTION 'WHOLESALE_REVISION_STALE'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>2 OR NOT x ? 'productId' OR NOT x ? 'quantity' OR jsonb_typeof(x->'productId')<>'string' OR COALESCE(x->>'quantity','') !~ '^[1-9][0-9]{0,2}$') THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'productId' HAVING sum((x->>'quantity')::int)>100) THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  INSERT INTO public.wholesale_deliveries(id,order_id,revision_id,idempotency_key,request_fingerprint,actor_id) VALUES(v_delivery,p_order,p_revision,p_key,v_fingerprint,p_actor);
  FOR v_item IN SELECT x->>'productId' product_id,sum((x->>'quantity')::int)::int quantity FROM jsonb_array_elements(p_items) x GROUP BY x->>'productId' ORDER BY x->>'productId' LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
    SELECT COALESCE(sum(reserved_delta),0) INTO v_reserved FROM public.wholesale_inventory_movements WHERE order_id=p_order AND product_id=v_item.product_id;
    SELECT quantity INTO v_ordered FROM public.wholesale_order_revision_items WHERE revision_id=p_revision AND product_id=v_item.product_id;
    SELECT COALESCE(sum(di.quantity),0) INTO v_done FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=p_revision AND di.product_id=v_item.product_id;
    IF v_ordered IS NULL OR v_done+v_item.quantity>v_ordered OR v_item.quantity>v_reserved THEN RAISE EXCEPTION 'WHOLESALE_DELIVERY_QUANTITY_INVALID'; END IF;
    INSERT INTO public.wholesale_delivery_items(delivery_id,product_id,quantity) VALUES(v_delivery,v_item.product_id,v_item.quantity);
    v_digest:=md5(v_delivery::text||':'||v_item.product_id);
    v_move_key:=(substr(v_digest,1,8)||'-'||substr(v_digest,9,4)||'-'||substr(v_digest,13,4)||'-'||substr(v_digest,17,4)||'-'||substr(v_digest,21,12))::uuid;
    INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,on_hand_delta,reserved_delta,reason,order_id,revision_id,delivery_id,idempotency_key,actor_id)
      VALUES(v_item.product_id,'delivery',-v_item.quantity,-v_item.quantity,'Entrega mayorista',p_order,p_revision,v_delivery,v_move_key,p_actor);
  END LOOP;
  SELECT NOT EXISTS(SELECT 1 FROM public.wholesale_order_revision_items ri WHERE ri.revision_id=p_revision AND
    (SELECT COALESCE(sum(di.quantity),0) FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=p_revision AND di.product_id=ri.product_id)<ri.quantity) INTO v_all_complete;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES(p_order,p_revision,'delivery_recorded','admin',p_actor,'admin');
  IF v_all_complete THEN INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES(p_order,p_revision,'order_fully_delivered','system',NULL,'system') ON CONFLICT DO NOTHING; END IF;
  RETURN v_delivery;
END; $$;

CREATE FUNCTION public.list_wholesale_inventory()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_products JSONB; v_movements JSONB;
BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'name',p.name,'onHand',COALESCE(m.on_hand,0),'reserved',COALESCE(m.reserved,0),'available',COALESCE(m.on_hand,0)-COALESCE(m.reserved,0)) ORDER BY p.name),'[]'::jsonb)
 INTO v_products FROM public.products p LEFT JOIN (SELECT product_id,sum(on_hand_delta) on_hand,sum(reserved_delta) reserved FROM public.wholesale_inventory_movements GROUP BY product_id) m ON m.product_id=p.id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',m.product_id,'productName',p.name,'type',m.movement_type,'onHandDelta',m.on_hand_delta,'reservedDelta',m.reserved_delta,'reason',m.reason,'orderId',m.order_id,'deliveryId',m.delivery_id,'actorId',m.actor_id,'createdAt',m.created_at) ORDER BY m.created_at DESC,m.id DESC),'[]'::jsonb)
 INTO v_movements FROM (SELECT * FROM public.wholesale_inventory_movements ORDER BY created_at DESC,id DESC LIMIT 100) m JOIN public.products p ON p.id=m.product_id;
 RETURN jsonb_build_object('products',v_products,'movements',v_movements);
END; $$;

REVOKE ALL ON FUNCTION public.guard_wholesale_stock_history() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_wholesale_stock_movement(VARCHAR,TEXT,INTEGER,TEXT,UUID,UUID), public.reserve_wholesale_order_inventory(UUID,UUID,UUID), public.record_wholesale_delivery(UUID,UUID,JSONB,UUID,UUID), public.list_wholesale_inventory() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_wholesale_stock_movement(VARCHAR,TEXT,INTEGER,TEXT,UUID,UUID), public.record_wholesale_delivery(UUID,UUID,JSONB,UUID,UUID), public.list_wholesale_inventory() TO service_role;
COMMIT;
$migration$]);
DO $history$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>50 THEN RAISE EXCEPTION 'Unexpected final history'; END IF; END $history$;
COMMIT;
SELECT 'MIGRATION_APPLIED_DATA_UNCHANGED_NEW_TABLES_EMPTY' AS result;