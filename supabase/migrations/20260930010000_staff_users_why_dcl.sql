-- Additive only: no commercial tables or existing titles/cards are changed.
ALTER TABLE public.site_settings
  ADD COLUMN why_us_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN why_us_display_mode text NOT NULL DEFAULT 'cards' CHECK (why_us_display_mode IN ('cards', 'text')),
  ADD COLUMN why_us_text text NOT NULL DEFAULT '' CHECK (length(why_us_text) <= 4000);

CREATE TABLE public.admin_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('ADMIN', 'VENDEDOR')),
  active boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_profiles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_profiles TO service_role;
-- No browser policies: roles are read and written exclusively by server APIs.

CREATE FUNCTION public.invalidate_admin_profile_sessions() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.active IS DISTINCT FROM OLD.active OR NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.session_version := OLD.session_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_admin_profile_sessions BEFORE UPDATE ON public.admin_profiles
FOR EACH ROW EXECUTE FUNCTION public.invalidate_admin_profile_sessions();

-- Permanent completion marker: deleting/disabling the first account must not
-- reopen bootstrap. No passwords, tokens or commercial data are stored here.
CREATE TABLE public.admin_bootstrap (
  id integer PRIMARY KEY CHECK (id = 1),
  user_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_bootstrap ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_bootstrap FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_bootstrap TO service_role;

CREATE FUNCTION public.complete_admin_bootstrap(p_user uuid, p_email text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Serialize the check and both inserts, including concurrent HTTP requests.
  PERFORM pg_advisory_xact_lock(20260930, 1);
  IF EXISTS (SELECT 1 FROM public.admin_bootstrap)
     OR EXISTS (SELECT 1 FROM public.admin_profiles WHERE role = 'ADMIN' AND active) THEN
    RAISE EXCEPTION 'BOOTSTRAP_CLOSED';
  END IF;
  INSERT INTO public.admin_profiles(id, email, display_name, role, active)
    VALUES (p_user, p_email, p_name, 'ADMIN', true);
  INSERT INTO public.admin_bootstrap(id, user_id) VALUES (1, p_user);
  RETURN p_user;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_admin_bootstrap(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_admin_bootstrap(uuid, text, text) TO service_role;
