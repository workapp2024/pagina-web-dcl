-- Append-only delivery corrections, physical returns, and wholesale payment ledger.
-- This does not post to retail sales, payment_transactions, cash_movements, or financial_pending_postings.
BEGIN;

ALTER TABLE public.wholesale_inventory_movements
  DROP CONSTRAINT wholesale_inventory_movements_movement_type_check,
  ADD CONSTRAINT wholesale_inventory_movements_movement_type_check
    CHECK (movement_type IN ('receipt','adjustment','reservation','release','delivery','delivery_correction','physical_return')),
  DROP CONSTRAINT wholesale_inventory_movements_shape,
  ADD CONSTRAINT wholesale_inventory_movements_shape CHECK (
    (movement_type = 'receipt' AND on_hand_delta > 0 AND reserved_delta = 0 AND order_id IS NULL AND delivery_id IS NULL)
    OR (movement_type = 'adjustment' AND on_hand_delta <> 0 AND reserved_delta = 0 AND order_id IS NULL AND delivery_id IS NULL)
    OR (movement_type = 'reservation' AND on_hand_delta = 0 AND reserved_delta > 0 AND order_id IS NOT NULL AND delivery_id IS NULL)
    OR (movement_type = 'release' AND on_hand_delta = 0 AND reserved_delta < 0 AND order_id IS NOT NULL AND delivery_id IS NULL)
    OR (movement_type = 'delivery' AND on_hand_delta < 0 AND reserved_delta < 0 AND order_id IS NOT NULL AND delivery_id IS NOT NULL)
    OR (movement_type = 'delivery_correction' AND on_hand_delta > 0 AND reserved_delta >= 0 AND order_id IS NOT NULL AND delivery_id IS NOT NULL)
    OR (movement_type = 'physical_return' AND on_hand_delta > 0 AND reserved_delta = 0 AND order_id IS NOT NULL AND delivery_id IS NOT NULL)
  );

ALTER TABLE public.wholesale_order_events
  DROP CONSTRAINT wholesale_order_events_event_type_check,
  ADD CONSTRAINT wholesale_order_events_event_type_check CHECK (event_type IN (
    'order_created','review_started','revision_created','revision_proposed','revision_approved','revision_rejected',
    'order_confirmed','order_rejected','order_cancelled','delivery_recorded','order_fully_delivered',
    'delivery_correction_recorded','physical_return_recorded','order_delivery_completion_reversed'
  ));
DROP INDEX public.wholesale_order_fully_delivered_once_idx;

CREATE TABLE public.wholesale_delivery_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID NOT NULL,
  delivery_id UUID NOT NULL,
  idempotency_key UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (order_id,id),
  FOREIGN KEY (order_id,revision_id) REFERENCES public.wholesale_order_revisions(order_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id,delivery_id) REFERENCES public.wholesale_deliveries(order_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.wholesale_delivery_correction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), correction_id UUID NOT NULL REFERENCES public.wholesale_delivery_corrections(id) ON DELETE RESTRICT,
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100), UNIQUE(correction_id,product_id)
);

CREATE TABLE public.wholesale_physical_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID NOT NULL,
  delivery_id UUID NOT NULL,
  idempotency_key UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  actor_id UUID NOT NULL,
  returned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(order_id,id),
  FOREIGN KEY (order_id,revision_id) REFERENCES public.wholesale_order_revisions(order_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id,delivery_id) REFERENCES public.wholesale_deliveries(order_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.wholesale_physical_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), return_id UUID NOT NULL REFERENCES public.wholesale_physical_returns(id) ON DELETE RESTRICT,
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100), UNIQUE(return_id,product_id)
);

CREATE TABLE public.wholesale_payment_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('payment','refund')),
  refund_of UUID REFERENCES public.wholesale_payment_entries(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank_transfer','mercadopago','debit_card','credit_card','other')),
  external_reference TEXT CHECK (external_reference IS NULL OR length(external_reference) <= 200),
  occurred_at TIMESTAMPTZ NOT NULL,
  idempotency_key UUID NOT NULL UNIQUE,
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_payment_entry_shape CHECK (
    (entry_type='payment' AND refund_of IS NULL) OR (entry_type='refund' AND refund_of IS NOT NULL)
  ),
  FOREIGN KEY (order_id,revision_id) REFERENCES public.wholesale_order_revisions(order_id,id) ON DELETE RESTRICT
);
CREATE INDEX wholesale_payment_entries_order_idx ON public.wholesale_payment_entries(order_id,occurred_at,id);
CREATE INDEX wholesale_payment_entries_refund_idx ON public.wholesale_payment_entries(refund_of) WHERE refund_of IS NOT NULL;
CREATE TABLE public.wholesale_payment_reconciliation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payment_entry_id UUID NOT NULL REFERENCES public.wholesale_payment_entries(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('reconciled','reconciliation_reversed')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  idempotency_key UUID NOT NULL UNIQUE, actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.record_wholesale_delivery(p_order UUID,p_revision UUID,p_items JSONB,p_key UUID,p_actor UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_delivery UUID:=gen_random_uuid(); v_fingerprint TEXT; v_existing public.wholesale_deliveries%ROWTYPE;
  v_item RECORD; v_ordered INTEGER; v_done BIGINT; v_corrected BIGINT; v_reserved BIGINT; v_digest TEXT; v_move_key UUID; v_was_complete BOOLEAN; v_all_complete BOOLEAN;
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
  SELECT NOT EXISTS(SELECT 1 FROM public.wholesale_order_revision_items ri WHERE ri.revision_id=p_revision AND
    (SELECT COALESCE(sum(di.quantity),0) FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=p_revision AND di.product_id=ri.product_id)
    -(SELECT COALESCE(sum(ci.quantity),0) FROM public.wholesale_delivery_correction_items ci JOIN public.wholesale_delivery_corrections c ON c.id=ci.correction_id WHERE c.order_id=p_order AND c.revision_id=p_revision AND ci.product_id=ri.product_id)<ri.quantity) INTO v_was_complete;
  INSERT INTO public.wholesale_deliveries(id,order_id,revision_id,idempotency_key,request_fingerprint,actor_id) VALUES(v_delivery,p_order,p_revision,p_key,v_fingerprint,p_actor);
  FOR v_item IN SELECT x->>'productId' product_id,sum((x->>'quantity')::int)::int quantity FROM jsonb_array_elements(p_items) x GROUP BY x->>'productId' ORDER BY x->>'productId' LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:' || v_item.product_id, 0));
    SELECT COALESCE(sum(reserved_delta),0) INTO v_reserved FROM public.wholesale_inventory_movements WHERE order_id=p_order AND product_id=v_item.product_id;
    SELECT quantity INTO v_ordered FROM public.wholesale_order_revision_items WHERE revision_id=p_revision AND product_id=v_item.product_id;
    SELECT COALESCE(sum(di.quantity),0) INTO v_done FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=p_revision AND di.product_id=v_item.product_id;
    SELECT COALESCE(sum(ci.quantity),0) INTO v_corrected FROM public.wholesale_delivery_correction_items ci JOIN public.wholesale_delivery_corrections c ON c.id=ci.correction_id WHERE c.order_id=p_order AND c.revision_id=p_revision AND ci.product_id=v_item.product_id;
    IF v_ordered IS NULL OR v_done-v_corrected+v_item.quantity>v_ordered OR v_item.quantity>v_reserved THEN RAISE EXCEPTION 'WHOLESALE_DELIVERY_QUANTITY_INVALID'; END IF;
    INSERT INTO public.wholesale_delivery_items(delivery_id,product_id,quantity) VALUES(v_delivery,v_item.product_id,v_item.quantity);
    v_digest:=md5(v_delivery::text||':'||v_item.product_id); v_move_key:=(substr(v_digest,1,8)||'-'||substr(v_digest,9,4)||'-'||substr(v_digest,13,4)||'-'||substr(v_digest,17,4)||'-'||substr(v_digest,21,12))::uuid;
    INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,on_hand_delta,reserved_delta,reason,order_id,revision_id,delivery_id,idempotency_key,actor_id)
      VALUES(v_item.product_id,'delivery',-v_item.quantity,-v_item.quantity,'Entrega mayorista',p_order,p_revision,v_delivery,v_move_key,p_actor);
  END LOOP;
  SELECT NOT EXISTS(SELECT 1 FROM public.wholesale_order_revision_items ri WHERE ri.revision_id=p_revision AND
    (SELECT COALESCE(sum(di.quantity),0) FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=p_revision AND di.product_id=ri.product_id)
    -(SELECT COALESCE(sum(ci.quantity),0) FROM public.wholesale_delivery_correction_items ci JOIN public.wholesale_delivery_corrections c ON c.id=ci.correction_id WHERE c.order_id=p_order AND c.revision_id=p_revision AND ci.product_id=ri.product_id)<ri.quantity) INTO v_all_complete;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source) VALUES(p_order,p_revision,'delivery_recorded','admin',p_actor,'admin');
  IF NOT v_was_complete AND v_all_complete THEN INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source) VALUES(p_order,p_revision,'order_fully_delivered','system',NULL,'system'); END IF;
  RETURN v_delivery;
END $$;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['wholesale_delivery_corrections','wholesale_delivery_correction_items','wholesale_physical_returns',
    'wholesale_physical_return_items','wholesale_payment_entries','wholesale_payment_reconciliation_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_stock_history()',t||'_immutable',t);
  END LOOP;
END $$;

CREATE FUNCTION public.record_wholesale_delivery_correction(
  p_order UUID,p_delivery UUID,p_items JSONB,p_reason TEXT,p_key UUID,p_actor UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_delivery public.wholesale_deliveries%ROWTYPE; v_existing public.wholesale_delivery_corrections%ROWTYPE;
  v_id UUID:=gen_random_uuid(); v_fingerprint TEXT; v_item RECORD; v_original INTEGER; v_corrected BIGINT; v_returned BIGINT; v_digest TEXT; v_move_key UUID;
  v_was_complete BOOLEAN; v_is_complete BOOLEAN; v_reserved INTEGER;
BEGIN
  IF p_order IS NULL OR p_delivery IS NULL OR p_key IS NULL OR p_actor IS NULL OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-correction-key:'||p_key::text,0));
  v_fingerprint:=encode(sha256(convert_to(jsonb_build_object('order',p_order,'delivery',p_delivery,'items',p_items,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_existing FROM public.wholesale_delivery_corrections WHERE idempotency_key=p_key;
  IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint OR v_existing.actor_id<>p_actor THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF; RETURN v_existing.id; END IF;
  SELECT * INTO v_delivery FROM public.wholesale_deliveries WHERE id=p_delivery AND order_id=p_order;
  IF NOT FOUND OR v_delivery.revision_id<>v_order.confirmed_revision_id THEN RAISE EXCEPTION 'WHOLESALE_DELIVERY_NOT_CORRECTABLE'; END IF;
  SELECT NOT EXISTS(SELECT 1 FROM public.wholesale_order_revision_items ri WHERE ri.revision_id=v_delivery.revision_id AND
    (SELECT COALESCE(sum(di.quantity),0) FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=v_delivery.revision_id AND di.product_id=ri.product_id)
    -(SELECT COALESCE(sum(ci.quantity),0) FROM public.wholesale_delivery_correction_items ci JOIN public.wholesale_delivery_corrections c ON c.id=ci.correction_id WHERE c.order_id=p_order AND c.revision_id=v_delivery.revision_id AND ci.product_id=ri.product_id)<ri.quantity) INTO v_was_complete;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>2 OR NOT x ? 'productId' OR NOT x ? 'quantity' OR jsonb_typeof(x->'productId')<>'string' OR COALESCE(x->>'quantity','') !~ '^[1-9][0-9]{0,2}$') THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  INSERT INTO public.wholesale_delivery_corrections(id,order_id,revision_id,delivery_id,idempotency_key,request_fingerprint,reason,actor_id)
    VALUES(v_id,p_order,v_delivery.revision_id,p_delivery,p_key,v_fingerprint,btrim(p_reason),p_actor);
  FOR v_item IN SELECT x->>'productId' product_id,sum((x->>'quantity')::int)::int quantity FROM jsonb_array_elements(p_items) x GROUP BY x->>'productId' ORDER BY x->>'productId' LOOP
    SELECT quantity INTO v_original FROM public.wholesale_delivery_items WHERE delivery_id=p_delivery AND product_id=v_item.product_id;
    SELECT COALESCE(sum(ci.quantity),0) INTO v_corrected FROM public.wholesale_delivery_correction_items ci JOIN public.wholesale_delivery_corrections c ON c.id=ci.correction_id WHERE c.delivery_id=p_delivery AND ci.product_id=v_item.product_id;
    SELECT COALESCE(sum(ri.quantity),0) INTO v_returned FROM public.wholesale_physical_return_items ri JOIN public.wholesale_physical_returns r ON r.id=ri.return_id WHERE r.delivery_id=p_delivery AND ri.product_id=v_item.product_id;
    IF v_original IS NULL OR v_corrected+v_returned+v_item.quantity>v_original THEN RAISE EXCEPTION 'WHOLESALE_CORRECTION_QUANTITY_INVALID'; END IF;
    INSERT INTO public.wholesale_delivery_correction_items(correction_id,product_id,quantity) VALUES(v_id,v_item.product_id,v_item.quantity);
    PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:'||v_item.product_id,0));
    v_reserved:=CASE WHEN v_order.status='confirmed' THEN v_item.quantity ELSE 0 END;
    v_digest:=md5(v_id::text||':'||v_item.product_id); v_move_key:=(substr(v_digest,1,8)||'-'||substr(v_digest,9,4)||'-'||substr(v_digest,13,4)||'-'||substr(v_digest,17,4)||'-'||substr(v_digest,21,12))::uuid;
    INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,on_hand_delta,reserved_delta,reason,order_id,revision_id,delivery_id,idempotency_key,actor_id)
      VALUES(v_item.product_id,'delivery_correction',v_item.quantity,v_reserved,btrim(p_reason),p_order,v_delivery.revision_id,p_delivery,v_move_key,p_actor);
  END LOOP;
  SELECT NOT EXISTS(SELECT 1 FROM public.wholesale_order_revision_items ri WHERE ri.revision_id=v_delivery.revision_id AND
    (SELECT COALESCE(sum(di.quantity),0) FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=v_delivery.revision_id AND di.product_id=ri.product_id)
    -(SELECT COALESCE(sum(ci.quantity),0) FROM public.wholesale_delivery_correction_items ci JOIN public.wholesale_delivery_corrections c ON c.id=ci.correction_id WHERE c.order_id=p_order AND c.revision_id=v_delivery.revision_id AND ci.product_id=ri.product_id)<ri.quantity) INTO v_is_complete;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES(p_order,v_delivery.revision_id,'delivery_correction_recorded','admin',p_actor,'admin');
  IF v_was_complete AND NOT v_is_complete THEN
    INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
      VALUES(p_order,v_delivery.revision_id,'order_delivery_completion_reversed','admin',p_actor,'admin');
  END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION public.record_wholesale_physical_return(
  p_order UUID,p_delivery UUID,p_items JSONB,p_reason TEXT,p_key UUID,p_actor UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_delivery public.wholesale_deliveries%ROWTYPE; v_existing public.wholesale_physical_returns%ROWTYPE;
  v_id UUID:=gen_random_uuid(); v_fingerprint TEXT; v_item RECORD; v_delivered BIGINT; v_corrected BIGINT; v_returned BIGINT; v_original INTEGER; v_digest TEXT; v_move_key UUID;
BEGIN
  IF p_order IS NULL OR p_delivery IS NULL OR p_key IS NULL OR p_actor IS NULL OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-return-key:'||p_key::text,0));
  v_fingerprint:=encode(sha256(convert_to(jsonb_build_object('order',p_order,'delivery',p_delivery,'items',p_items,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_existing FROM public.wholesale_physical_returns WHERE idempotency_key=p_key;
  IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint OR v_existing.actor_id<>p_actor THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF; RETURN v_existing.id; END IF;
  SELECT * INTO v_delivery FROM public.wholesale_deliveries WHERE id=p_delivery AND order_id=p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_DELIVERY_NOT_FOUND'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>2 OR NOT x ? 'productId' OR NOT x ? 'quantity' OR jsonb_typeof(x->'productId')<>'string' OR COALESCE(x->>'quantity','') !~ '^[1-9][0-9]{0,2}$') THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  INSERT INTO public.wholesale_physical_returns(id,order_id,revision_id,delivery_id,idempotency_key,request_fingerprint,reason,actor_id)
    VALUES(v_id,p_order,v_delivery.revision_id,p_delivery,p_key,v_fingerprint,btrim(p_reason),p_actor);
  FOR v_item IN SELECT x->>'productId' product_id,sum((x->>'quantity')::int)::int quantity FROM jsonb_array_elements(p_items) x GROUP BY x->>'productId' ORDER BY x->>'productId' LOOP
    SELECT quantity INTO v_original FROM public.wholesale_delivery_items WHERE delivery_id=p_delivery AND product_id=v_item.product_id;
    SELECT COALESCE(sum(di.quantity),0) INTO v_delivered FROM public.wholesale_delivery_items di JOIN public.wholesale_deliveries d ON d.id=di.delivery_id WHERE d.order_id=p_order AND d.revision_id=v_delivery.revision_id AND di.product_id=v_item.product_id;
    SELECT COALESCE(sum(ci.quantity),0) INTO v_corrected FROM public.wholesale_delivery_correction_items ci JOIN public.wholesale_delivery_corrections c ON c.id=ci.correction_id WHERE c.order_id=p_order AND c.revision_id=v_delivery.revision_id AND ci.product_id=v_item.product_id;
    SELECT COALESCE(sum(ri.quantity),0) INTO v_returned FROM public.wholesale_physical_return_items ri JOIN public.wholesale_physical_returns r ON r.id=ri.return_id WHERE r.order_id=p_order AND r.revision_id=v_delivery.revision_id AND ri.product_id=v_item.product_id;
    SELECT COALESCE(sum(ri.quantity),0) INTO v_returned FROM public.wholesale_physical_return_items ri JOIN public.wholesale_physical_returns r ON r.id=ri.return_id WHERE r.delivery_id=p_delivery AND ri.product_id=v_item.product_id;
    SELECT COALESCE(sum(ci.quantity),0) INTO v_corrected FROM public.wholesale_delivery_correction_items ci JOIN public.wholesale_delivery_corrections c ON c.id=ci.correction_id WHERE c.delivery_id=p_delivery AND ci.product_id=v_item.product_id;
    IF v_original IS NULL OR v_returned+v_item.quantity>v_original-v_corrected THEN RAISE EXCEPTION 'WHOLESALE_RETURN_QUANTITY_INVALID'; END IF;
    INSERT INTO public.wholesale_physical_return_items(return_id,product_id,quantity) VALUES(v_id,v_item.product_id,v_item.quantity);
    PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-stock:'||v_item.product_id,0));
    v_digest:=md5(v_id::text||':'||v_item.product_id); v_move_key:=(substr(v_digest,1,8)||'-'||substr(v_digest,9,4)||'-'||substr(v_digest,13,4)||'-'||substr(v_digest,17,4)||'-'||substr(v_digest,21,12))::uuid;
    INSERT INTO public.wholesale_inventory_movements(product_id,movement_type,on_hand_delta,reserved_delta,reason,order_id,revision_id,delivery_id,idempotency_key,actor_id)
      VALUES(v_item.product_id,'physical_return',v_item.quantity,0,btrim(p_reason),p_order,v_delivery.revision_id,p_delivery,v_move_key,p_actor);
  END LOOP;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES(p_order,v_delivery.revision_id,'physical_return_recorded','admin',p_actor,'admin');
  RETURN v_id;
END $$;

CREATE FUNCTION public.record_wholesale_payment(
  p_order UUID,p_revision UUID,p_amount NUMERIC,p_currency CHAR(3),p_method TEXT,p_external_reference TEXT,
  p_occurred_at TIMESTAMPTZ,p_key UUID,p_actor UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_revision public.wholesale_order_revisions%ROWTYPE; v_existing public.wholesale_payment_entries%ROWTYPE; v_id UUID:=gen_random_uuid(); v_paid NUMERIC(12,2);
BEGIN
  IF p_order IS NULL OR p_revision IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>9999999999.99 OR p_amount<>round(p_amount,2) OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
    OR p_method NOT IN ('cash','bank_transfer','mercadopago','debit_card','credit_card','other') OR p_key IS NULL OR p_actor IS NULL
    OR p_occurred_at IS NULL OR (p_external_reference IS NOT NULL AND length(p_external_reference)>200) THEN RAISE EXCEPTION 'WHOLESALE_INVALID_PAYMENT'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-payment-key:'||p_key::text,0));
  SELECT * INTO v_existing FROM public.wholesale_payment_entries WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF v_existing.order_id<>p_order OR v_existing.revision_id<>p_revision OR v_existing.entry_type<>'payment' OR v_existing.amount<>p_amount OR v_existing.currency<>p_currency OR v_existing.payment_method<>p_method OR v_existing.external_reference IS DISTINCT FROM NULLIF(btrim(p_external_reference),'') OR v_existing.occurred_at<>p_occurred_at OR v_existing.actor_id<>p_actor THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_existing.id;
  END IF;
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF v_order.status<>'confirmed' OR v_order.confirmed_revision_id<>p_revision THEN RAISE EXCEPTION 'WHOLESALE_PAYMENT_REVISION_INVALID'; END IF;
  SELECT * INTO v_revision FROM public.wholesale_order_revisions WHERE id=p_revision AND order_id=p_order;
  IF NOT FOUND OR v_revision.currency<>p_currency THEN RAISE EXCEPTION 'WHOLESALE_PAYMENT_REVISION_INVALID'; END IF;
  SELECT COALESCE(sum(CASE WHEN entry_type='payment' THEN amount ELSE -amount END),0) INTO v_paid FROM public.wholesale_payment_entries WHERE order_id=p_order;
  IF v_paid+p_amount>v_revision.total_amount THEN RAISE EXCEPTION 'WHOLESALE_PAYMENT_EXCEEDS_TOTAL'; END IF;
  INSERT INTO public.wholesale_payment_entries(id,order_id,revision_id,entry_type,amount,currency,payment_method,external_reference,occurred_at,idempotency_key,actor_id)
    VALUES(v_id,p_order,p_revision,'payment',p_amount,p_currency,p_method,NULLIF(btrim(p_external_reference),''),p_occurred_at,p_key,p_actor);
  RETURN v_id;
END $$;

CREATE FUNCTION public.refund_wholesale_payment(
  p_payment UUID,p_amount NUMERIC,p_method TEXT,p_external_reference TEXT,p_occurred_at TIMESTAMPTZ,p_key UUID,p_actor UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_original public.wholesale_payment_entries%ROWTYPE; v_existing public.wholesale_payment_entries%ROWTYPE; v_id UUID:=gen_random_uuid(); v_refunded NUMERIC(12,2);
BEGIN
  IF p_payment IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>9999999999.99 OR p_amount<>round(p_amount,2) OR p_method NOT IN ('cash','bank_transfer','mercadopago','debit_card','credit_card','other')
    OR p_key IS NULL OR p_actor IS NULL OR p_occurred_at IS NULL OR (p_external_reference IS NOT NULL AND length(p_external_reference)>200) THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REFUND'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-payment-key:'||p_key::text,0));
  SELECT * INTO v_existing FROM public.wholesale_payment_entries WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF v_existing.refund_of<>p_payment OR v_existing.entry_type<>'refund' OR v_existing.amount<>p_amount OR v_existing.payment_method<>p_method OR v_existing.external_reference IS DISTINCT FROM NULLIF(btrim(p_external_reference),'') OR v_existing.occurred_at<>p_occurred_at OR v_existing.actor_id<>p_actor THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_existing.id;
  END IF;
  SELECT * INTO v_original FROM public.wholesale_payment_entries WHERE id=p_payment FOR UPDATE;
  IF NOT FOUND OR v_original.entry_type<>'payment' THEN RAISE EXCEPTION 'WHOLESALE_PAYMENT_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.wholesale_orders WHERE id=v_original.order_id FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO v_refunded FROM public.wholesale_payment_entries WHERE refund_of=p_payment;
  IF v_refunded+p_amount>v_original.amount THEN RAISE EXCEPTION 'WHOLESALE_REFUND_EXCEEDS_PAYMENT'; END IF;
  INSERT INTO public.wholesale_payment_entries(id,order_id,revision_id,entry_type,refund_of,amount,currency,payment_method,external_reference,occurred_at,idempotency_key,actor_id)
    VALUES(v_id,v_original.order_id,v_original.revision_id,'refund',p_payment,p_amount,v_original.currency,p_method,NULLIF(btrim(p_external_reference),''),p_occurred_at,p_key,p_actor);
  RETURN v_id;
END $$;

CREATE FUNCTION public.record_wholesale_payment_reconciliation(
  p_entry UUID,p_event TEXT,p_reason TEXT,p_key UUID,p_actor UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_existing public.wholesale_payment_reconciliation_events%ROWTYPE; v_id UUID:=gen_random_uuid();
BEGIN
  IF p_entry IS NULL OR p_event NOT IN ('reconciled','reconciliation_reversed') OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 500 OR p_key IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-reconcile-key:'||p_key::text,0));
  SELECT * INTO v_existing FROM public.wholesale_payment_reconciliation_events WHERE idempotency_key=p_key;
  IF FOUND THEN IF v_existing.payment_entry_id<>p_entry OR v_existing.event_type<>p_event OR v_existing.reason<>btrim(p_reason) OR v_existing.actor_id<>p_actor THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF; RETURN v_existing.id; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.wholesale_payment_entries WHERE id=p_entry) THEN RAISE EXCEPTION 'WHOLESALE_PAYMENT_NOT_FOUND'; END IF;
  INSERT INTO public.wholesale_payment_reconciliation_events(id,payment_entry_id,event_type,reason,idempotency_key,actor_id)
    VALUES(v_id,p_entry,p_event,btrim(p_reason),p_key,p_actor);
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.record_wholesale_delivery_correction(UUID,UUID,JSONB,TEXT,UUID,UUID),
  public.record_wholesale_physical_return(UUID,UUID,JSONB,TEXT,UUID,UUID),
  public.record_wholesale_payment(UUID,UUID,NUMERIC,CHAR,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID),
  public.refund_wholesale_payment(UUID,NUMERIC,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID),
  public.record_wholesale_payment_reconciliation(UUID,TEXT,TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_wholesale_delivery_correction(UUID,UUID,JSONB,TEXT,UUID,UUID),
  public.record_wholesale_physical_return(UUID,UUID,JSONB,TEXT,UUID,UUID),
  public.record_wholesale_payment(UUID,UUID,NUMERIC,CHAR,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID),
  public.refund_wholesale_payment(UUID,NUMERIC,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID),
  public.record_wholesale_payment_reconciliation(UUID,TEXT,TEXT,UUID,UUID) TO service_role;

COMMIT;
