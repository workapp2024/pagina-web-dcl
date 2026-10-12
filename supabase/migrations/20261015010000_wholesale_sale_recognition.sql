-- Wholesale revenue recognition is separate from retail sales and payment postings.
-- Revenue is recognized once per full-delivery event and reversed by a linked event.
BEGIN;

CREATE TABLE public.wholesale_sale_recognitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID NOT NULL,
  completion_event_id BIGINT NOT NULL UNIQUE REFERENCES public.wholesale_order_events(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  recognized_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_sale_recognitions_order_revision_fk
    FOREIGN KEY (order_id, revision_id) REFERENCES public.wholesale_order_revisions(order_id, id) ON DELETE RESTRICT,
  CONSTRAINT wholesale_sale_recognitions_id_order_revision_unique UNIQUE (id, order_id, revision_id)
);
CREATE INDEX wholesale_sale_recognitions_order_idx ON public.wholesale_sale_recognitions(order_id, completion_event_id);

CREATE TABLE public.wholesale_sale_recognition_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recognition_id UUID NOT NULL REFERENCES public.wholesale_sale_recognitions(id) ON DELETE RESTRICT,
  product_id VARCHAR(64) NOT NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (line_total = round(unit_price * quantity, 2)),
  UNIQUE (recognition_id, product_id)
);

CREATE TABLE public.wholesale_sale_recognition_deliveries (
  recognition_id UUID NOT NULL,
  delivery_id UUID NOT NULL REFERENCES public.wholesale_deliveries(id) ON DELETE RESTRICT,
  product_id VARCHAR(64) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (recognition_id, delivery_id, product_id),
  FOREIGN KEY (recognition_id, product_id)
    REFERENCES public.wholesale_sale_recognition_items(recognition_id, product_id) ON DELETE RESTRICT
);

CREATE TABLE public.wholesale_sale_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recognition_id UUID NOT NULL UNIQUE,
  order_id UUID NOT NULL,
  revision_id UUID NOT NULL,
  reversal_event_id BIGINT NOT NULL UNIQUE REFERENCES public.wholesale_order_events(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  actor_id UUID NOT NULL,
  reversed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_sale_reversals_recognition_fk
    FOREIGN KEY (recognition_id, order_id, revision_id)
    REFERENCES public.wholesale_sale_recognitions(id, order_id, revision_id) ON DELETE RESTRICT
);
CREATE INDEX wholesale_sale_reversals_order_idx ON public.wholesale_sale_reversals(order_id, reversal_event_id);

ALTER TABLE public.wholesale_sale_recognitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_sale_recognition_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_sale_recognition_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_sale_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wholesale_sale_recognitions, public.wholesale_sale_recognition_items,
  public.wholesale_sale_recognition_deliveries, public.wholesale_sale_reversals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.wholesale_sale_recognitions, public.wholesale_sale_recognition_items,
  public.wholesale_sale_recognition_deliveries, public.wholesale_sale_reversals TO service_role;

CREATE FUNCTION public.guard_wholesale_recognition_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'WHOLESALE_RECOGNITION_IMMUTABLE';
END;
$$;
CREATE TRIGGER wholesale_sale_recognitions_immutable BEFORE UPDATE OR DELETE ON public.wholesale_sale_recognitions
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_recognition_history();
CREATE TRIGGER wholesale_sale_recognition_items_immutable BEFORE UPDATE OR DELETE ON public.wholesale_sale_recognition_items
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_recognition_history();
CREATE TRIGGER wholesale_sale_recognition_deliveries_immutable BEFORE UPDATE OR DELETE ON public.wholesale_sale_recognition_deliveries
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_recognition_history();
CREATE TRIGGER wholesale_sale_reversals_immutable BEFORE UPDATE OR DELETE ON public.wholesale_sale_reversals
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_recognition_history();
REVOKE ALL ON FUNCTION public.guard_wholesale_recognition_history() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.process_wholesale_sale_recognition_event(p_event_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_event public.wholesale_order_events%ROWTYPE;
  v_order public.wholesale_orders%ROWTYPE;
  v_revision public.wholesale_order_revisions%ROWTYPE;
  v_recognition public.wholesale_sale_recognitions%ROWTYPE;
  v_id UUID;
  v_currency CHAR(3);
BEGIN
  SELECT * INTO v_event FROM public.wholesale_order_events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_RECOGNITION_EVENT_NOT_FOUND'; END IF;

  IF v_event.event_type = 'order_fully_delivered' THEN
    SELECT * INTO v_order FROM public.wholesale_orders WHERE id = v_event.order_id;
    SELECT * INTO v_revision FROM public.wholesale_order_revisions
      WHERE id = v_event.revision_id AND order_id = v_event.order_id;
    IF NOT FOUND OR v_order.confirmed_revision_id IS DISTINCT FROM v_event.revision_id
      OR v_revision.status <> 'confirmed' THEN
      RAISE EXCEPTION 'WHOLESALE_RECOGNITION_REVISION_INVALID';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.wholesale_order_revision_items ri
      WHERE ri.revision_id = v_revision.id AND ri.currency <> v_revision.currency
    ) OR NOT EXISTS (SELECT 1 FROM public.wholesale_order_revision_items WHERE revision_id = v_revision.id) THEN
      RAISE EXCEPTION 'WHOLESALE_RECOGNITION_SNAPSHOT_INVALID';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.wholesale_order_revision_items ri
      WHERE ri.revision_id = v_revision.id AND ri.quantity <>
        (SELECT COALESCE(sum(di.quantity), 0) FROM public.wholesale_delivery_items di
         JOIN public.wholesale_deliveries d ON d.id = di.delivery_id
         WHERE d.order_id = v_order.id AND d.revision_id = v_revision.id AND di.product_id = ri.product_id)
        -(SELECT COALESCE(sum(ci.quantity), 0) FROM public.wholesale_delivery_correction_items ci
          JOIN public.wholesale_delivery_corrections c ON c.id = ci.correction_id
          WHERE c.order_id = v_order.id AND c.revision_id = v_revision.id AND ci.product_id = ri.product_id)
    ) THEN RAISE EXCEPTION 'WHOLESALE_RECOGNITION_DELIVERY_INCOMPLETE'; END IF;

    v_currency := v_revision.currency;
    INSERT INTO public.wholesale_sale_recognitions(
      order_id, revision_id, completion_event_id, idempotency_key, amount, currency, recognized_at
    ) VALUES (
      v_order.id, v_revision.id, v_event.id, 'completion-event:' || v_event.id::TEXT,
      v_revision.total_amount, v_currency, v_event.created_at
    ) ON CONFLICT (completion_event_id) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN; END IF;
    INSERT INTO public.wholesale_sale_recognition_items(
      recognition_id, product_id, product_name_snapshot, quantity, unit_price, line_total, currency
    ) SELECT v_id, product_id, product_name_snapshot, quantity, unit_price, line_total, currency
      FROM public.wholesale_order_revision_items WHERE revision_id = v_revision.id;
    INSERT INTO public.wholesale_sale_recognition_deliveries(recognition_id, delivery_id, product_id, quantity)
    SELECT v_id, d.id, di.product_id, di.quantity - COALESCE(c.corrected, 0)
    FROM public.wholesale_deliveries d
    JOIN public.wholesale_delivery_items di ON di.delivery_id = d.id
    LEFT JOIN LATERAL (
      SELECT sum(ci.quantity)::INTEGER AS corrected
      FROM public.wholesale_delivery_correction_items ci
      JOIN public.wholesale_delivery_corrections dc ON dc.id = ci.correction_id
      WHERE dc.delivery_id = d.id AND ci.product_id = di.product_id
    ) c ON TRUE
    WHERE d.order_id = v_order.id AND d.revision_id = v_revision.id
      AND di.quantity - COALESCE(c.corrected, 0) > 0;
    RETURN;
  END IF;

  IF v_event.event_type = 'order_delivery_completion_reversed' THEN
    SELECT r.* INTO v_recognition FROM public.wholesale_sale_recognitions r
    WHERE r.order_id = v_event.order_id AND r.revision_id = v_event.revision_id
      AND r.completion_event_id < v_event.id
      AND NOT EXISTS (SELECT 1 FROM public.wholesale_sale_reversals x WHERE x.recognition_id = r.id)
    ORDER BY r.completion_event_id DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_RECOGNITION_NOT_REVERSIBLE'; END IF;
    INSERT INTO public.wholesale_sale_reversals(
      recognition_id, order_id, revision_id, reversal_event_id, idempotency_key,
      amount, currency, reason, actor_id, reversed_at
    ) VALUES (
      v_recognition.id, v_event.order_id, v_event.revision_id, v_event.id,
      'reversal-event:' || v_event.id::TEXT, v_recognition.amount, v_recognition.currency,
      'Reconocimiento revertido porque se corrigió la finalización de la entrega.',
      v_event.actor_id, v_event.created_at
    ) ON CONFLICT (reversal_event_id) DO NOTHING;
  END IF;
END;
$$;

CREATE FUNCTION public.capture_wholesale_sale_recognition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.event_type IN ('order_fully_delivered', 'order_delivery_completion_reversed') THEN
    PERFORM public.process_wholesale_sale_recognition_event(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wholesale_sale_recognition_event_capture
AFTER INSERT ON public.wholesale_order_events
FOR EACH ROW EXECUTE FUNCTION public.capture_wholesale_sale_recognition();
REVOKE ALL ON FUNCTION public.process_wholesale_sale_recognition_event(BIGINT),
  public.capture_wholesale_sale_recognition() FROM PUBLIC, anon, authenticated, service_role;

-- Seed recognition/reversal history for completions recorded before this migration.
DO $$
DECLARE v_event RECORD;
BEGIN
  FOR v_event IN
    SELECT id FROM public.wholesale_order_events
    WHERE event_type IN ('order_fully_delivered', 'order_delivery_completion_reversed')
    ORDER BY id
  LOOP
    PERFORM public.process_wholesale_sale_recognition_event(v_event.id);
  END LOOP;
END;
$$;

COMMIT;
