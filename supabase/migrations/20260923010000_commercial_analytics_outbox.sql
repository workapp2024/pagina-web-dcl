BEGIN;

-- Specific to commercial Analytics. No customer data and no network inside SQL.
CREATE FUNCTION public.valid_analytics_properties(p_event TEXT,p_properties JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v_keys TEXT[]; v_key TEXT; v_ids JSONB; v_id JSONB;
BEGIN
  IF jsonb_typeof(p_properties) IS DISTINCT FROM 'object' OR octet_length(p_properties::TEXT)>16384 THEN RETURN FALSE; END IF;
  v_keys:=CASE p_event
    WHEN 'order_created' THEN ARRAY['order_id','order_number','payment_method','total','currency','item_count','product_ids']
    WHEN 'payment_approved' THEN ARRAY['order_id','order_number','payment_method','provider','amount','currency','payment_transaction_id','resulting_order_status']
    WHEN 'purchase_completed' THEN ARRAY['order_id','order_number','sale_id','total','currency','payment_method','product_ids','item_count']
    ELSE NULL END;
  IF v_keys IS NULL OR NOT p_properties ?& v_keys THEN RETURN FALSE; END IF;
  IF p_event<>'order_created' THEN v_keys:=v_keys||ARRAY['checkout_session_id']; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_properties) k WHERE NOT k=ANY(v_keys)) THEN RETURN FALSE; END IF;
  FOREACH v_key IN ARRAY ARRAY['order_id','sale_id','payment_transaction_id','checkout_session_id'] LOOP
    IF p_properties ? v_key AND (jsonb_typeof(p_properties->v_key)<>'string' OR
      (p_properties->>v_key)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RETURN FALSE; END IF;
  END LOOP;
  IF jsonb_typeof(p_properties->'order_number')<>'string' OR (p_properties->>'order_number')!~'^[A-Za-z0-9-]{1,40}$'
    OR jsonb_typeof(p_properties->'payment_method')<>'string' OR jsonb_typeof(p_properties->'currency')<>'string'
    OR p_properties->>'payment_method' NOT IN ('mercadopago','card','transfer')
    OR p_properties->>'currency' !~ '^[A-Z]{3}$' THEN RETURN FALSE; END IF;
  v_key:=CASE WHEN p_event='payment_approved' THEN 'amount' ELSE 'total' END;
  IF jsonb_typeof(p_properties->v_key)<>'number' OR (p_properties->>v_key)::NUMERIC<0 THEN RETURN FALSE; END IF;
  IF p_event='payment_approved' THEN
    RETURN jsonb_typeof(p_properties->'provider')='string' AND jsonb_typeof(p_properties->'resulting_order_status')='string'
      AND p_properties->>'provider' IN ('mercadopago','transfer')
      AND p_properties->>'resulting_order_status' IN ('completed','stock_unavailable','refund_required');
  END IF;
  IF jsonb_typeof(p_properties->'item_count')<>'number' OR (p_properties->>'item_count')!~'^[0-9]+$'
    OR (p_properties->>'item_count')::NUMERIC NOT BETWEEN 1 AND 5000 THEN RETURN FALSE; END IF;
  v_ids:=p_properties->'product_ids';
  IF jsonb_typeof(v_ids)<>'array' THEN RETURN FALSE; END IF;
  IF jsonb_array_length(v_ids) NOT BETWEEN 1 AND 50 THEN RETURN FALSE; END IF;
  FOR v_id IN SELECT value FROM jsonb_array_elements(v_ids) LOOP
    IF jsonb_typeof(v_id)<>'string' OR (v_id#>>'{}')!~'^[a-zA-Z0-9_-]{1,64}$' THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN v_ids=(SELECT jsonb_agg(id ORDER BY id) FROM (SELECT DISTINCT value AS id FROM jsonb_array_elements_text(v_ids)) ids);
END $$;

CREATE TABLE public.analytics_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK(event_type IN ('order_created','payment_approved','purchase_completed')),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_transaction_id UUID REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES public.sales(id) ON DELETE RESTRICT,
  distinct_id TEXT NOT NULL,
  session_id TEXT CHECK(session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  environment TEXT NOT NULL CHECK(environment IN ('production','preview','development')),
  properties JSONB NOT NULL CHECK(public.valid_analytics_properties(event_type,properties) IS TRUE),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  sent_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_token UUID,
  locked_until TIMESTAMPTZ,
  last_error TEXT CHECK(last_error IN ('transport_error','dispatch_error') OR last_error ~ '^http_[1-5][0-9]{2}$'),
  UNIQUE(event_type,order_id),
  CHECK(distinct_id='order:'||order_id::TEXT OR distinct_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CHECK(properties->>'order_id'=order_id::TEXT),
  CHECK(event_type<>'purchase_completed' OR (sale_id IS NOT NULL AND properties->>'sale_id'=sale_id::TEXT)),
  CHECK(event_type<>'payment_approved' OR (payment_transaction_id IS NOT NULL AND properties->>'payment_transaction_id'=payment_transaction_id::TEXT)),
  CHECK((lease_token IS NULL)=(locked_until IS NULL))
);
CREATE INDEX analytics_outbox_pending ON public.analytics_outbox(environment,next_attempt_at,occurred_at) WHERE sent_at IS NULL;
ALTER TABLE public.analytics_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_outbox FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.analytics_outbox TO service_role;

CREATE FUNCTION public.guard_analytics_outbox() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ANALYTICS_EVENT_IMMUTABLE'; END IF;
  IF ROW(NEW.id,NEW.event_type,NEW.order_id,NEW.payment_transaction_id,NEW.sale_id,NEW.distinct_id,NEW.session_id,NEW.environment,NEW.properties,NEW.occurred_at,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.event_type,OLD.order_id,OLD.payment_transaction_id,OLD.sale_id,OLD.distinct_id,OLD.session_id,OLD.environment,OLD.properties,OLD.occurred_at,OLD.created_at)
    OR (OLD.sent_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'ANALYTICS_EVENT_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_analytics_outbox BEFORE UPDATE OR DELETE ON public.analytics_outbox FOR EACH ROW EXECUTE FUNCTION public.guard_analytics_outbox();

CREATE FUNCTION public.enqueue_commercial_analytics(p_event TEXT,p_order UUID,p_environment TEXT,p_context JSONB DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_payment RECORD; v_origin RECORD; v_sale RECORD; v_props JSONB;
  v_distinct TEXT; v_session TEXT; v_environment TEXT; v_ids JSONB; v_count INTEGER;
  v_uuid TEXT:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  SELECT * INTO STRICT v_order FROM orders WHERE id=p_order;
  SELECT * INTO STRICT v_payment FROM payment_transactions WHERE order_id=p_order;
  SELECT * INTO v_origin FROM analytics_outbox WHERE order_id=p_order AND event_type='order_created';
  v_distinct:='order:'||p_order::TEXT;
  v_environment:=CASE WHEN p_environment IN ('production','preview','development') THEN p_environment ELSE 'preview' END;
  IF FOUND THEN
    v_distinct:=v_origin.distinct_id; v_session:=v_origin.session_id; v_environment:=v_origin.environment;
  ELSIF p_event='order_created' AND jsonb_typeof(p_context)='object' THEN
    -- Reject the entire optional context if any field is unexpected or malformed.
    IF NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p_context) k WHERE k NOT IN ('distinct_id','session_id'))
      AND jsonb_typeof(p_context->'distinct_id')='string' AND (p_context->>'distinct_id')~*v_uuid
      AND (NOT p_context ? 'session_id' OR (jsonb_typeof(p_context->'session_id')='string' AND (p_context->>'session_id')~*v_uuid)) THEN
      v_distinct:=p_context->>'distinct_id'; v_session:=p_context->>'session_id';
    END IF;
  END IF;
  v_props:=jsonb_build_object('order_id',p_order,'order_number',v_order.order_number,'payment_method',v_order.payment_method,'currency',v_order.currency);
  IF p_event='payment_approved' THEN
    v_props:=v_props||jsonb_build_object('provider',v_payment.provider,'amount',v_payment.amount,
      'payment_transaction_id',v_payment.id,'resulting_order_status',v_order.status);
  ELSE
    IF p_event='purchase_completed' THEN
      SELECT * INTO STRICT v_sale FROM sales WHERE id=v_payment.sale_id AND status='completed';
      SELECT jsonb_agg(product_id ORDER BY product_id),SUM(quantity)::INTEGER INTO v_ids,v_count
        FROM (SELECT product_id,SUM(quantity) quantity FROM sale_items WHERE sale_id=v_sale.id GROUP BY product_id) items;
      v_props:=v_props||jsonb_build_object('sale_id',v_sale.id,'total',v_sale.total);
    ELSE
      SELECT jsonb_agg(product_id ORDER BY product_id),SUM(quantity)::INTEGER INTO v_ids,v_count
        FROM (SELECT product_id,SUM(quantity) quantity FROM order_items WHERE order_id=p_order GROUP BY product_id) items;
      v_props:=v_props||jsonb_build_object('total',v_order.total);
    END IF;
    v_props:=v_props||jsonb_build_object('product_ids',v_ids,'item_count',v_count);
  END IF;
  IF p_event<>'order_created' AND v_session IS NOT NULL THEN v_props:=v_props||jsonb_build_object('checkout_session_id',v_session); END IF;
  INSERT INTO analytics_outbox(event_type,order_id,payment_transaction_id,sale_id,distinct_id,session_id,environment,properties)
    VALUES(p_event,p_order,v_payment.id,CASE WHEN p_event='purchase_completed' THEN v_payment.sale_id END,v_distinct,v_session,v_environment,v_props)
    ON CONFLICT(event_type,order_id) DO NOTHING;
END $$;

CREATE FUNCTION public.claim_analytics_outbox(p_environment TEXT,p_limit INTEGER DEFAULT 5) RETURNS SETOF public.analytics_outbox
LANGUAGE sql SET search_path=public AS $$
  WITH pending AS (
    SELECT id FROM analytics_outbox WHERE sent_at IS NULL AND environment=p_environment
      AND next_attempt_at<=clock_timestamp() AND (locked_until IS NULL OR locked_until<=clock_timestamp())
    ORDER BY occurred_at,id LIMIT LEAST(GREATEST(COALESCE(p_limit,5),1),5) FOR UPDATE SKIP LOCKED
  ) UPDATE analytics_outbox a SET lease_token=gen_random_uuid(),locked_until=clock_timestamp()+INTERVAL '60 seconds',attempts=attempts+1
    FROM pending WHERE a.id=pending.id RETURNING a.*;
$$;
CREATE FUNCTION public.ack_analytics_outbox(p_id UUID,p_lease UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  UPDATE analytics_outbox SET sent_at=clock_timestamp(),lease_token=NULL,locked_until=NULL,last_error=NULL
    WHERE id=p_id AND lease_token=p_lease AND locked_until>clock_timestamp() AND sent_at IS NULL;
  RETURN FOUND;
END $$;
CREATE FUNCTION public.fail_analytics_outbox(p_id UUID,p_lease UUID,p_error TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  UPDATE analytics_outbox SET lease_token=NULL,locked_until=NULL,
    next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(attempts-1,7)))::INTEGER),
    last_error=CASE WHEN p_error='transport_error' OR p_error~'^http_[1-5][0-9]{2}$' THEN p_error ELSE 'dispatch_error' END
    WHERE id=p_id AND lease_token=p_lease AND locked_until>clock_timestamp() AND sent_at IS NULL;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.valid_analytics_properties(TEXT,JSONB),public.guard_analytics_outbox(),
  public.enqueue_commercial_analytics(TEXT,UUID,TEXT,JSONB),public.claim_analytics_outbox(TEXT,INTEGER),
  public.ack_analytics_outbox(UUID,UUID),public.fail_analytics_outbox(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valid_analytics_properties(TEXT,JSONB),public.guard_analytics_outbox(),
  public.enqueue_commercial_analytics(TEXT,UUID,TEXT,JSONB),public.claim_analytics_outbox(TEXT,INTEGER),
  public.ack_analytics_outbox(UUID,UUID),public.fail_analytics_outbox(UUID,UUID,TEXT) TO service_role;

-- Commercial functions below retain the latest local business logic verbatim,
-- with optional parameters and enqueue calls as the only changes.

DROP FUNCTION public.create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID);
CREATE OR REPLACE FUNCTION public.create_public_order(p_name TEXT,p_phone TEXT,p_email TEXT,p_fulfillment VARCHAR,p_address TEXT,p_notes TEXT,p_method VARCHAR,p_items JSONB,p_key UUID,p_analytics_context JSONB DEFAULT NULL,p_analytics_environment TEXT DEFAULT 'preview')
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_customer UUID; v_order UUID:=gen_random_uuid(); v_existing RECORD;
  v_item JSONB; v_product RECORD; v_quantity INTEGER; v_total NUMERIC(12,2):=0;
  v_reserved BIGINT; v_expires TIMESTAMPTZ; v_items JSONB; v_fingerprint TEXT;
BEGIN
  v_items:=normalize_inventory_items(p_items);
  IF p_key IS NULL OR p_method IS NULL OR p_method NOT IN ('mercadopago','card','transfer')
     OR COALESCE(btrim(p_name),'')='' OR COALESCE(btrim(p_phone),'')=''
     OR p_fulfillment IS NULL OR p_fulfillment NOT IN ('pickup','delivery')
     OR (p_fulfillment='delivery' AND COALESCE(btrim(p_address),'')='') THEN RAISE EXCEPTION 'ORDER_CREATION_ERROR'; END IF;
  v_fingerprint:=encode(sha256(convert_to(jsonb_build_object('items',v_items,'method',p_method,
    'name',btrim(p_name),'phone',btrim(p_phone),'email',COALESCE(btrim(p_email),''),
    'fulfillment',p_fulfillment,'address',CASE WHEN p_fulfillment='delivery' THEN btrim(p_address) ELSE '' END,
    'notes',COALESCE(btrim(p_notes),''))::TEXT,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::TEXT,0));
  SELECT * INTO v_existing FROM orders WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    IF v_existing.status NOT IN ('pending_payment','pending_manual_verification') OR EXISTS (
      SELECT 1 FROM order_items i LEFT JOIN inventory_reservations r ON r.order_id=i.order_id AND r.product_id=i.product_id
      WHERE i.order_id=v_existing.id AND (r.id IS NULL OR r.status<>'active' OR r.expires_at<=clock_timestamp() OR r.quantity<>i.quantity)
    ) THEN RAISE EXCEPTION 'RESERVATION_EXPIRED'; END IF;
    RETURN v_existing.id;
  END IF;
  IF p_method='transfer' AND NOT EXISTS(SELECT 1 FROM site_settings WHERE id=1
    AND (COALESCE(btrim(transfer_alias),'')<>'' OR COALESCE(btrim(transfer_cbu_cvu),'')<>'')
    AND COALESCE(btrim(transfer_holder),'')<>'' AND COALESCE(btrim(transfer_institution),'')<>'') THEN
    RAISE EXCEPTION 'TRANSFER_NOT_CONFIGURED';
  END IF;
  PERFORM p.id FROM products p WHERE p.id IN (SELECT i->>'productId' FROM jsonb_array_elements(v_items) i) ORDER BY p.id FOR UPDATE;
  v_expires:=clock_timestamp()+CASE WHEN p_method='transfer' THEN INTERVAL '48 hours' ELSE INTERVAL '30 minutes' END;
  SELECT id INTO v_customer FROM customers WHERE phone=btrim(p_phone) ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF v_customer IS NULL THEN
    INSERT INTO customers(full_name,phone,email) VALUES(btrim(p_name),btrim(p_phone),NULLIF(btrim(p_email),'')) RETURNING id INTO v_customer;
  ELSE
    UPDATE customers SET archived_at=NULL WHERE id=v_customer AND archived_at IS NOT NULL;
  END IF;
  INSERT INTO orders(id,customer_id,idempotency_key,request_fingerprint,fulfillment_method,shipping_address,notes,payment_method,status)
    VALUES(v_order,v_customer,p_key,v_fingerprint,p_fulfillment,CASE WHEN p_fulfillment='delivery' THEN btrim(p_address) END,
    COALESCE(btrim(p_notes),''),p_method,CASE WHEN p_method='transfer' THEN 'pending_manual_verification' ELSE 'pending_payment' END);
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_quantity:=(v_item->>'quantity')::INTEGER;
    SELECT * INTO v_product FROM products WHERE id=v_item->>'productId';
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    IF NOT v_product.active THEN RAISE EXCEPTION 'PRODUCT_INACTIVE'; END IF;
    IF v_product.price IS NULL OR v_product.price<=0 THEN RAISE EXCEPTION 'PRICE_ERROR'; END IF;
    SELECT COALESCE(SUM(quantity),0) INTO v_reserved FROM inventory_reservations
      WHERE product_id=v_product.id AND status='active' AND expires_at>clock_timestamp();
    IF v_product.stock-v_reserved<v_quantity THEN RAISE EXCEPTION 'OUT_OF_STOCK'; END IF;
    INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,line_total)
      VALUES(v_order,v_product.id,v_product.name,v_quantity,v_product.price,ROUND(v_product.price*v_quantity,2));
    INSERT INTO inventory_reservations(order_id,product_id,quantity,expires_at) VALUES(v_order,v_product.id,v_quantity,v_expires);
    v_total:=v_total+ROUND(v_product.price*v_quantity,2);
  END LOOP;
  UPDATE orders SET subtotal=v_total,total=v_total WHERE id=v_order;
  INSERT INTO payment_transactions(order_id,provider,amount,currency,external_idempotency_key)
    VALUES(v_order,CASE WHEN p_method='transfer' THEN 'transfer' ELSE 'mercadopago' END,v_total,'ARS',gen_random_uuid());
  PERFORM enqueue_commercial_analytics('order_created',v_order,p_analytics_environment,p_analytics_context);
  RETURN v_order;
END $$;
REVOKE ALL ON FUNCTION public.create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID,JSONB,TEXT) TO service_role;

DROP FUNCTION public.complete_manual_transfer(UUID);
CREATE OR REPLACE FUNCTION public.complete_manual_transfer(p_order UUID,p_analytics_environment TEXT DEFAULT 'preview')
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_transaction RECORD; v_item RECORD; v_product RECORD;
  v_sale UUID:=gen_random_uuid(); v_total NUMERIC(12,2):=0; v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order AND payment_method='transfer' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido de transferencia no verificable.'; END IF;
  SELECT * INTO STRICT v_transaction FROM payment_transactions WHERE order_id=p_order AND provider='transfer' FOR UPDATE;
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  IF v_order.status<>'pending_manual_verification' OR v_order.transfer_declared_at IS NULL THEN RAISE EXCEPTION 'Pedido de transferencia no verificable.'; END IF;
  PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM order_items WHERE order_id=p_order) ORDER BY p.id FOR UPDATE;
  v_now:=clock_timestamp();
  IF NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=p_order) OR EXISTS (
    SELECT 1 FROM order_items i JOIN products p ON p.id=i.product_id
    LEFT JOIN inventory_reservations r ON r.order_id=i.order_id AND r.product_id=i.product_id
    WHERE i.order_id=p_order AND (r.id IS NULL OR r.status<>'active' OR r.expires_at<=v_now OR r.quantity<>i.quantity
      OR p.stock-i.quantity<COALESCE((SELECT SUM(other.quantity) FROM inventory_reservations other WHERE other.product_id=i.product_id AND other.order_id<>p_order AND other.status='active' AND other.expires_at>v_now),0))
  ) THEN RETURN NULL; END IF;
  INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method) VALUES(v_sale,v_order.customer_id,'completed',concat('Transferencia verificada. Pedido ',p_order),0,0,'transfer');
  UPDATE inventory_reservations SET status='consumed' WHERE order_id=p_order AND status='active';
  FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order ORDER BY product_id LOOP
    SELECT * INTO v_product FROM products WHERE id=v_item.product_id;
    INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total);
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_item.quantity,'Venta por transferencia verificada','sale',v_sale::TEXT);
    v_total:=v_total+v_item.line_total;
  END LOOP;
  UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale;
  UPDATE orders SET status='completed' WHERE id=p_order;
  UPDATE payment_transactions SET sale_id=v_sale,status='approved',approved_at=COALESCE(approved_at,v_now) WHERE id=v_transaction.id;
  IF v_transaction.status<>'approved' THEN PERFORM enqueue_commercial_analytics('payment_approved',p_order,p_analytics_environment); END IF;
  PERFORM enqueue_commercial_analytics('purchase_completed',p_order,p_analytics_environment);
  RETURN v_sale;
END $$;
REVOKE ALL ON FUNCTION public.complete_manual_transfer(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_manual_transfer(UUID,TEXT) TO service_role;

DROP FUNCTION public.complete_mercadopago_order(UUID,TEXT,TEXT,NUMERIC,CHAR,VARCHAR);
CREATE OR REPLACE FUNCTION public.complete_mercadopago_order(p_order UUID,p_external_order TEXT,p_payment TEXT,p_amount NUMERIC,p_currency CHAR(3),p_status VARCHAR,p_analytics_environment TEXT DEFAULT 'preview')
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_transaction RECORD; v_item RECORD; v_product RECORD;
  v_sale UUID:=gen_random_uuid(); v_total NUMERIC(12,2):=0; v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order AND payment_method IN ('mercadopago','card') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operacion externa invalida.'; END IF;
  SELECT * INTO STRICT v_transaction FROM payment_transactions WHERE order_id=p_order AND provider='mercadopago' FOR UPDATE;
  IF COALESCE(p_external_order,'')='' OR COALESCE(p_payment,'')='' OR p_amount IS NULL OR p_currency IS NULL OR p_status IS NULL
    OR v_transaction.external_order_id IS DISTINCT FROM p_external_order THEN RAISE EXCEPTION 'Operacion externa invalida.'; END IF;
  IF v_transaction.status='refunded' OR v_order.status='refunded' THEN RETURN v_transaction.sale_id; END IF;
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  IF v_order.status='refund_required' THEN RETURN NULL; END IF;
  -- Never downgrade an already received payment, including paid-but-unfulfilled.
  IF v_transaction.status='approved' AND p_status<>'processed' THEN RETURN NULL; END IF;
  IF p_amount<>v_order.total OR p_currency<>v_order.currency THEN
    IF v_transaction.status<>'approved' THEN UPDATE payment_transactions SET status='error' WHERE id=v_transaction.id; END IF;
    RETURN NULL;
  END IF;
  IF p_status='processed' AND v_order.status='cancelled' AND v_order.operational_status='cancelled' THEN
    UPDATE payment_transactions SET status='approved',external_payment_id=p_payment,
      approved_at=COALESCE(approved_at,clock_timestamp()) WHERE id=v_transaction.id;
    UPDATE orders SET status='refund_required' WHERE id=p_order;
    IF v_transaction.status<>'approved' THEN PERFORM enqueue_commercial_analytics('payment_approved',p_order,p_analytics_environment); END IF;
    INSERT INTO order_notes(order_id,note) VALUES(p_order,
      'Pago de Mercado Pago aprobado despues de cancelar el pedido. No se genero venta ni se desconto stock. Requiere devolucion externa verificada.');
    RETURN NULL;
  END IF;
  PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM order_items WHERE order_id=p_order) ORDER BY p.id FOR UPDATE;
  v_now:=clock_timestamp();
  IF p_status<>'processed' THEN
    IF p_status IN ('rejected','cancelled') THEN
      UPDATE payment_transactions SET status='rejected',external_payment_id=p_payment WHERE id=v_transaction.id;
      IF v_order.status NOT IN ('cancelled','stock_unavailable') THEN UPDATE orders SET status='rejected' WHERE id=p_order; END IF;
      UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
    END IF;
    RETURN NULL;
  END IF;
  UPDATE payment_transactions SET status='approved',external_payment_id=p_payment,approved_at=COALESCE(approved_at,v_now) WHERE id=v_transaction.id;
  -- Strict late-payment policy: NO automatic re-reservation, even if stock is free.
  IF v_order.status<>'pending_payment' OR NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=p_order) OR EXISTS (
    SELECT 1 FROM order_items i JOIN products p ON p.id=i.product_id
    LEFT JOIN inventory_reservations r ON r.order_id=i.order_id AND r.product_id=i.product_id
    WHERE i.order_id=p_order AND (r.id IS NULL OR r.status<>'active' OR r.expires_at<=v_now OR r.quantity<>i.quantity
      OR p.stock-i.quantity<COALESCE((SELECT SUM(other.quantity) FROM inventory_reservations other WHERE other.product_id=i.product_id AND other.order_id<>p_order AND other.status='active' AND other.expires_at>v_now),0))
  ) THEN
    UPDATE orders SET status='stock_unavailable' WHERE id=p_order;
    IF v_transaction.status<>'approved' THEN PERFORM enqueue_commercial_analytics('payment_approved',p_order,p_analytics_environment); END IF;
    UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
    IF v_order.status<>'stock_unavailable' OR v_transaction.status<>'approved' THEN
      INSERT INTO order_notes(order_id,note) VALUES(p_order,'Pago recibido sin reserva valida. No se genero venta ni se desconto stock. Requiere revision y eventual devolucion manual.');
    END IF;
    RETURN NULL;
  END IF;
  INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method) VALUES(v_sale,v_order.customer_id,'completed',concat('Pedido publico ',p_order),0,0,'mercadopago');
  UPDATE inventory_reservations SET status='consumed' WHERE order_id=p_order AND status='active';
  FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order ORDER BY product_id LOOP
    SELECT * INTO v_product FROM products WHERE id=v_item.product_id;
    INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total);
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_item.quantity,'Venta de pedido publico','sale',v_sale::TEXT);
    v_total:=v_total+v_item.line_total;
  END LOOP;
  UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale;
  UPDATE orders SET status='completed' WHERE id=p_order;
  UPDATE payment_transactions SET sale_id=v_sale WHERE id=v_transaction.id;
  IF v_transaction.status<>'approved' THEN PERFORM enqueue_commercial_analytics('payment_approved',p_order,p_analytics_environment); END IF;
  PERFORM enqueue_commercial_analytics('purchase_completed',p_order,p_analytics_environment);
  RETURN v_sale;
END $$;
REVOKE ALL ON FUNCTION public.complete_mercadopago_order(UUID,TEXT,TEXT,NUMERIC,CHAR,VARCHAR,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mercadopago_order(UUID,TEXT,TEXT,NUMERIC,CHAR,VARCHAR,TEXT) TO service_role;

DROP FUNCTION public.resolve_order(UUID,TEXT,TEXT,TEXT,UUID);
CREATE FUNCTION public.resolve_order(p_order UUID,p_resolution TEXT,p_external_reference TEXT,p_note TEXT,p_idempotency_key UUID,p_analytics_environment TEXT DEFAULT 'preview')
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_payment RECORD; v_sale RECORD; v_item RECORD; v_product RECORD;
  v_income RECORD; v_previous RECORD; v_resolution UUID; v_sale_id UUID; v_total NUMERIC(12,2):=0;
  v_now TIMESTAMPTZ:=clock_timestamp(); v_available BIGINT;
BEGIN
  IF p_order IS NULL OR p_idempotency_key IS NULL OR p_resolution IS NULL OR p_resolution NOT IN (
    'CANCEL_PENDING','REFUND_VERIFIED','TRANSFER_APPROVAL_ERROR',
    'COMPLETE_STOCK_UNAVAILABLE','REFUND_STOCK_UNAVAILABLE'
  ) OR length(btrim(COALESCE(p_note,''))) NOT BETWEEN 1 AND 1000
    OR (p_resolution IN ('REFUND_VERIFIED','REFUND_STOCK_UNAVAILABLE')
      AND length(btrim(COALESCE(p_external_reference,''))) NOT BETWEEN 1 AND 160)
    OR length(COALESCE(p_external_reference,''))>160 THEN RAISE EXCEPTION 'ORDER_RESOLUTION_INVALID_INPUT'; END IF;

  SELECT * INTO v_order FROM orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_RESOLUTION_NOT_FOUND'; END IF;
  SELECT * INTO v_previous FROM order_resolutions WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_previous.order_id<>p_order OR v_previous.resolution_type<>p_resolution
      OR v_previous.external_reference IS DISTINCT FROM NULLIF(btrim(COALESCE(p_external_reference,'')),'')
      OR v_previous.note<>btrim(p_note) THEN RAISE EXCEPTION 'ORDER_RESOLUTION_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN to_jsonb(v_previous);
  END IF;
  IF EXISTS(SELECT 1 FROM order_resolutions WHERE order_id=p_order AND resolution_type=p_resolution) THEN
    RAISE EXCEPTION 'ORDER_RESOLUTION_ALREADY_APPLIED';
  END IF;
  IF v_order.operational_status='delivered' THEN RAISE EXCEPTION 'ORDER_RESOLUTION_DELIVERED'; END IF;
  IF v_order.operational_status='cancelled'
    AND NOT (p_resolution='REFUND_STOCK_UNAVAILABLE' AND v_order.status='refund_required')
    THEN RAISE EXCEPTION 'ORDER_RESOLUTION_CLOSED'; END IF;
  SELECT * INTO v_payment FROM payment_transactions WHERE order_id=p_order ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=p_order AND id<>v_payment.id) THEN
    RAISE EXCEPTION 'ORDER_RESOLUTION_PAYMENT_AMBIGUOUS';
  END IF;
  IF v_payment.sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales WHERE id=v_payment.sale_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_RESOLUTION_SALE_MISSING'; END IF;
  END IF;

  IF p_resolution='CANCEL_PENDING' THEN
    IF v_order.status NOT IN ('pending_payment','pending_manual_verification','rejected')
      OR v_payment.status NOT IN ('pending','rejected','cancelled','error') OR v_payment.sale_id IS NOT NULL THEN
      RAISE EXCEPTION 'ORDER_RESOLUTION_NOT_PENDING';
    END IF;
    IF NOT cancel_public_order(p_order) THEN RAISE EXCEPTION 'ORDER_RESOLUTION_NOT_PENDING'; END IF;
    PERFORM set_config('dcl.operation_source','order_resolution',TRUE);
    PERFORM set_config('dcl.operation_note',btrim(p_note),TRUE);
    UPDATE orders SET operational_status='cancelled' WHERE id=p_order;

  ELSIF p_resolution='COMPLETE_STOCK_UNAVAILABLE' THEN
    IF v_order.status<>'stock_unavailable' OR v_payment.status<>'approved' OR v_payment.sale_id IS NOT NULL
      OR v_payment.provider<>'mercadopago' THEN RAISE EXCEPTION 'ORDER_RESOLUTION_INVALID_STATE'; END IF;
    PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM order_items WHERE order_id=p_order) ORDER BY p.id FOR UPDATE;
    IF NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=p_order) THEN RAISE EXCEPTION 'ORDER_RESOLUTION_NO_ITEMS'; END IF;
    FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order ORDER BY product_id LOOP
      SELECT * INTO v_product FROM products WHERE id=v_item.product_id;
      SELECT v_product.stock-COALESCE(SUM(r.quantity),0) INTO v_available FROM inventory_reservations r
        WHERE r.product_id=v_item.product_id AND r.order_id<>p_order AND r.status='active' AND r.expires_at>v_now;
      IF v_product.id IS NULL OR NOT v_product.active OR v_available<v_item.quantity THEN
        RAISE EXCEPTION 'ORDER_RESOLUTION_INSUFFICIENT_STOCK';
      END IF;
    END LOOP;
    v_sale_id:=gen_random_uuid();
    INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method)
      VALUES(v_sale_id,v_order.customer_id,'completed',concat('Resolución de pedido ',p_order),0,0,'mercadopago');
    UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
    FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order ORDER BY product_id LOOP
      SELECT * INTO v_product FROM products WHERE id=v_item.product_id;
      INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total)
        VALUES(v_sale_id,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total);
      INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id)
        VALUES(v_product.id,'venta',-v_item.quantity,'Venta tras resolver reserva vencida','sale',v_sale_id::TEXT);
      v_total:=v_total+v_item.line_total;
    END LOOP;
    UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale_id;
    UPDATE orders SET status='completed' WHERE id=p_order;
    UPDATE payment_transactions SET sale_id=v_sale_id WHERE id=v_payment.id;

  ELSIF p_resolution IN ('REFUND_VERIFIED','TRANSFER_APPROVAL_ERROR','REFUND_STOCK_UNAVAILABLE') THEN
    IF p_resolution='TRANSFER_APPROVAL_ERROR' AND (v_order.payment_method<>'transfer' OR v_payment.provider<>'transfer') THEN
      RAISE EXCEPTION 'ORDER_RESOLUTION_TRANSFER_ONLY';
    END IF;
    IF p_resolution='REFUND_STOCK_UNAVAILABLE' THEN
      -- Also resolves a late approved payment on an already cancelled order.
      IF v_order.status NOT IN ('stock_unavailable','refund_required') OR v_payment.status<>'approved' OR v_payment.sale_id IS NOT NULL
        OR v_payment.provider<>'mercadopago' THEN
        RAISE EXCEPTION 'ORDER_RESOLUTION_INVALID_STATE';
      END IF;
    ELSE
      IF v_order.status<>'completed' OR v_payment.status<>'approved' OR v_payment.sale_id IS NULL
        OR v_sale.id IS NULL OR v_sale.status<>'completed' OR v_sale.customer_id<>v_order.customer_id
        THEN RAISE EXCEPTION 'ORDER_RESOLUTION_INVALID_STATE'; END IF;
    END IF;
    IF p_resolution<>'REFUND_STOCK_UNAVAILABLE' THEN
      PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM sale_items WHERE sale_id=v_sale.id) ORDER BY p.id FOR UPDATE;
      FOR v_item IN SELECT product_id,SUM(quantity)::INTEGER AS quantity FROM sale_items WHERE sale_id=v_sale.id GROUP BY product_id ORDER BY product_id LOOP
        INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id)
          VALUES(v_item.product_id,'ajuste',v_item.quantity,concat('Resolución de pedido: ',btrim(p_note)),'sale_reversal',v_sale.id::TEXT);
      END LOOP;
      UPDATE sales SET status='cancelled',cancelled_at=v_now,cancellation_reason=btrim(p_note) WHERE id=v_sale.id;
      SELECT * INTO v_income FROM cash_movements WHERE sale_id=v_sale.id AND movement_type='sale_income' FOR UPDATE;
      IF FOUND THEN
        INSERT INTO cash_movements(movement_type,amount,description,sale_id,account_id,period_id)
          VALUES('sale_reversal',-v_income.amount,concat('Reversión de venta ',v_sale.id),v_sale.id,v_income.account_id,v_income.period_id)
          ON CONFLICT(sale_id) WHERE movement_type='sale_reversal' DO NOTHING;
      END IF;
      UPDATE installations SET status='cancelled' WHERE sale_id=v_sale.id AND status='pending';
      UPDATE warranties SET status='void' WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id=v_sale.id) AND status='active';
      v_sale_id:=v_sale.id;
    END IF;
    UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
    UPDATE payment_transactions SET status=CASE WHEN p_resolution='TRANSFER_APPROVAL_ERROR' THEN 'cancelled' ELSE 'refunded' END WHERE id=v_payment.id;
    PERFORM set_config('dcl.operation_source','order_resolution',TRUE);
    PERFORM set_config('dcl.operation_note',btrim(p_note),TRUE);
    PERFORM set_config('dcl.order_resolution',p_order::TEXT,TRUE);
    UPDATE orders SET status=CASE WHEN p_resolution='TRANSFER_APPROVAL_ERROR' THEN 'cancelled' ELSE 'refunded' END,
      operational_status='cancelled' WHERE id=p_order;
    PERFORM set_config('dcl.order_resolution','',TRUE);
  END IF;
  PERFORM set_config('dcl.operation_source','',TRUE);
  PERFORM set_config('dcl.operation_note','',TRUE);

  INSERT INTO order_resolutions(order_id,payment_transaction_id,sale_id,resolution_type,external_reference,note,idempotency_key)
    VALUES(p_order,v_payment.id,COALESCE(v_sale_id,v_payment.sale_id),p_resolution,
      NULLIF(btrim(COALESCE(p_external_reference,'')),''),btrim(p_note),p_idempotency_key)
    RETURNING id INTO v_resolution;
  IF p_resolution='COMPLETE_STOCK_UNAVAILABLE' THEN PERFORM enqueue_commercial_analytics('purchase_completed',p_order,p_analytics_environment); END IF;
  RETURN (SELECT to_jsonb(r) FROM order_resolutions r WHERE r.id=v_resolution);
END $$;
REVOKE ALL ON FUNCTION public.resolve_order(UUID,TEXT,TEXT,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_order(UUID,TEXT,TEXT,TEXT,UUID,TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
