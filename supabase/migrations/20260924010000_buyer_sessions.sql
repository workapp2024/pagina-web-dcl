-- Navigation authorization only. No commercial RPC, order, stock or payment changes.
BEGIN;
CREATE TABLE public.buyer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at)
);

-- A claim is saved BEFORE commerce, with order_id NULL until creation succeeds.
-- This also recovers the gap between the commercial commit and its HTTP response.
-- No form data is stored here; request_hash is a SHA-256 digest.
CREATE TABLE public.buyer_session_orders (
  session_id UUID NOT NULL REFERENCES public.buyer_sessions(id) ON DELETE CASCADE,
  idempotency_key UUID PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  order_id UUID UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX buyer_session_orders_session_idx ON public.buyer_session_orders(session_id);
ALTER TABLE public.buyer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_session_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.buyer_sessions, public.buyer_session_orders FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.buyer_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.buyer_session_orders TO service_role;

CREATE FUNCTION public.claim_buyer_order_attempt(p_session UUID, p_key UUID, p_hash TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_claim RECORD;
BEGIN
  IF p_key IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
    OR NOT EXISTS (SELECT 1 FROM buyer_sessions WHERE id=p_session AND expires_at>clock_timestamp()) THEN RETURN FALSE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::TEXT,0));
  SELECT * INTO v_claim FROM buyer_session_orders WHERE idempotency_key=p_key;
  IF FOUND THEN RETURN v_claim.session_id=p_session AND v_claim.request_hash=p_hash; END IF;
  -- An existing order cannot be claimed retroactively by knowing its key.
  IF EXISTS (SELECT 1 FROM orders WHERE idempotency_key=p_key) THEN RETURN FALSE; END IF;
  INSERT INTO buyer_session_orders(session_id,idempotency_key,request_hash) VALUES(p_session,p_key,p_hash);
  RETURN TRUE;
END $$;

CREATE FUNCTION public.recover_buyer_order(p_session UUID, p_key UUID)
RETURNS TEXT LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order UUID; v_number TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM buyer_sessions WHERE id=p_session AND expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::TEXT,0));
  IF NOT EXISTS (SELECT 1 FROM buyer_session_orders WHERE session_id=p_session AND idempotency_key=p_key) THEN RETURN NULL; END IF;
  SELECT id,order_number INTO v_order,v_number FROM orders WHERE idempotency_key=p_key;
  IF v_order IS NULL THEN RETURN NULL; END IF;
  UPDATE buyer_session_orders SET order_id=v_order WHERE session_id=p_session AND idempotency_key=p_key;
  RETURN v_number;
END $$;
REVOKE ALL ON FUNCTION public.claim_buyer_order_attempt(UUID,UUID,TEXT), public.recover_buyer_order(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_buyer_order_attempt(UUID,UUID,TEXT), public.recover_buyer_order(UUID,UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
