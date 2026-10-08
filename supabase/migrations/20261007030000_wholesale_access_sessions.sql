BEGIN;

CREATE TABLE public.wholesale_access_sessions (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  wholesale_code_updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT wholesale_access_sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX wholesale_access_sessions_customer_idx
  ON public.wholesale_access_sessions(customer_id, expires_at);
CREATE INDEX wholesale_access_sessions_expiry_idx
  ON public.wholesale_access_sessions(expires_at);

ALTER TABLE public.wholesale_access_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wholesale_access_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.wholesale_access_sessions TO service_role;

COMMIT;
