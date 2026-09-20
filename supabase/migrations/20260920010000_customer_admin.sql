BEGIN;

ALTER TABLE public.customers ADD COLUMN archived_at TIMESTAMPTZ;
CREATE INDEX customers_archive_created_idx ON public.customers((archived_at IS NOT NULL), created_at DESC, id DESC);

CREATE TABLE public.customer_admin_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','edit','archive','restore')),
  before_data JSONB,
  after_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX customer_admin_history_customer_idx ON public.customer_admin_history(customer_id, changed_at DESC);
ALTER TABLE public.customer_admin_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.customer_admin_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.customer_admin_history_id_seq TO service_role;

CREATE FUNCTION public.admin_manage_customer(p_action TEXT, p_customer UUID DEFAULT NULL, p_data JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_customer public.customers%ROWTYPE;
  v_name TEXT; v_phone TEXT; v_email TEXT; v_document TEXT; v_notes TEXT;
  v_before JSONB;
BEGIN
  IF p_action='create' OR p_action='edit' THEN
    IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CUSTOMER_INVALID_INPUT'; END IF;
    v_name:=btrim(p_data->>'full_name');
    v_phone:=NULLIF(btrim(COALESCE(p_data->>'phone','')),'');
    v_email:=NULLIF(btrim(COALESCE(p_data->>'email','')),'');
    v_document:=NULLIF(btrim(COALESCE(p_data->>'document_number','')),'');
    v_notes:=btrim(COALESCE(p_data->>'notes',''));
    IF v_name IS NULL OR v_name='' OR length(v_name)>160 OR length(v_phone)>50
       OR length(v_email)>255 OR length(v_document)>40 OR length(v_notes)>1000
       OR p_data ? 'id' OR p_data ? 'archived_at' THEN RAISE EXCEPTION 'CUSTOMER_INVALID_INPUT'; END IF;
    IF p_action='create' THEN
      INSERT INTO public.customers(full_name,phone,email,document_number,notes)
      VALUES(v_name,v_phone,v_email,v_document,v_notes) RETURNING * INTO v_customer;
    ELSE
      IF p_customer IS NULL THEN RAISE EXCEPTION 'CUSTOMER_INVALID_INPUT'; END IF;
      SELECT to_jsonb(c) INTO v_before FROM public.customers c WHERE id=p_customer FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;
      UPDATE public.customers SET full_name=v_name,phone=v_phone,email=v_email,
        document_number=v_document,notes=v_notes WHERE id=p_customer RETURNING * INTO v_customer;
    END IF;
    INSERT INTO public.customer_admin_history(customer_id,action,before_data,after_data)
      VALUES(v_customer.id,p_action,v_before,to_jsonb(v_customer));
  ELSIF p_action IN ('archive','restore','delete') THEN
    IF p_customer IS NULL THEN RAISE EXCEPTION 'CUSTOMER_INVALID_INPUT'; END IF;
    SELECT * INTO v_customer FROM public.customers WHERE id=p_customer FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;
    v_before:=to_jsonb(v_customer);
    IF p_action='delete' THEN
      IF EXISTS(SELECT 1 FROM public.customer_vehicles WHERE customer_id=p_customer)
         OR EXISTS(SELECT 1 FROM public.orders WHERE customer_id=p_customer)
         OR EXISTS(SELECT 1 FROM public.sales WHERE customer_id=p_customer)
         OR EXISTS(SELECT 1 FROM public.warranties WHERE customer_id=p_customer) THEN
        RAISE EXCEPTION 'CUSTOMER_HAS_DEPENDENCIES';
      END IF;
      DELETE FROM public.customers WHERE id=p_customer;
      RETURN jsonb_build_object('id',p_customer,'deleted',true);
    END IF;
    IF (v_customer.archived_at IS NOT NULL) IS DISTINCT FROM (p_action='archive') THEN
      UPDATE public.customers SET archived_at=CASE WHEN p_action='archive' THEN clock_timestamp() ELSE NULL END
        WHERE id=p_customer RETURNING * INTO v_customer;
      INSERT INTO public.customer_admin_history(customer_id,action,before_data,after_data)
        VALUES(p_customer,p_action,v_before,to_jsonb(v_customer));
    END IF;
  ELSE
    RAISE EXCEPTION 'CUSTOMER_INVALID_ACTION';
  END IF;
  RETURN to_jsonb(v_customer);
END $$;

REVOKE ALL ON FUNCTION public.admin_manage_customer(TEXT,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_manage_customer(TEXT,UUID,JSONB) TO service_role;

-- Same order function as 20260904020000; only the selected customer is locked and restored.
CREATE OR REPLACE FUNCTION public.create_public_order(p_name TEXT,p_phone TEXT,p_email TEXT,p_fulfillment VARCHAR,p_address TEXT,p_notes TEXT,p_method VARCHAR,p_items JSONB,p_key UUID)
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
  RETURN v_order;
END $$;

COMMIT;
