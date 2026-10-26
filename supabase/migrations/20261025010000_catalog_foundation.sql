-- PREPARED ONLY: separate authorization required before applying remotely.
-- No existing product or commercial row is updated. No legacy reader is switched.
BEGIN;
CREATE TABLE public.catalog_foundation_lock (
  id boolean PRIMARY KEY DEFAULT true CHECK (id)
);
INSERT INTO public.catalog_foundation_lock VALUES (true);
CREATE TABLE public.catalog_categories (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (description = btrim(description) AND length(description) <= 2000),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120),
  parent_id text REFERENCES public.catalog_categories(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  active boolean NOT NULL DEFAULT true,
  form_profile text NOT NULL DEFAULT 'general' CHECK (form_profile IN ('lighting','general')),
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX catalog_categories_navigation ON public.catalog_categories(parent_id,active,sort_order,id);
CREATE TABLE public.catalog_vehicle_types (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 120),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX catalog_vehicle_types_navigation ON public.catalog_vehicle_types(active,sort_order,id);
-- A row means explicitly assigned in the NEW system; absence means not migrated.
CREATE TABLE public.product_catalog_assignments (
  product_id varchar(64) PRIMARY KEY REFERENCES public.products(id) ON DELETE RESTRICT,
  category_id text NOT NULL REFERENCES public.catalog_categories(id) ON DELETE RESTRICT
);
CREATE INDEX product_catalog_assignments_category ON public.product_catalog_assignments(category_id,product_id);
CREATE TABLE public.product_catalog_vehicle_types (
  product_id varchar(64) NOT NULL REFERENCES public.product_catalog_assignments(product_id) ON DELETE RESTRICT,
  vehicle_type_id text NOT NULL REFERENCES public.catalog_vehicle_types(id) ON DELETE RESTRICT,
  PRIMARY KEY (product_id,vehicle_type_id)
);
CREATE INDEX product_catalog_vehicle_types_destination ON public.product_catalog_vehicle_types(vehicle_type_id,product_id);
-- Prepared alias registry, initially empty: no existing URL is redirected.
CREATE TABLE public.catalog_category_aliases (
  alias text PRIMARY KEY CHECK (length(btrim(alias)) BETWEEN 1 AND 120),
  category_id text NOT NULL REFERENCES public.catalog_categories(id) ON DELETE RESTRICT
);

CREATE INDEX catalog_category_aliases_category ON public.catalog_category_aliases(category_id);

CREATE FUNCTION public.guard_catalog_foundation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE parent_parent text;
BEGIN
  -- All NEW taxonomy writes share one lock; protects hierarchy and Universal
  -- checks from concurrent inserts/reparenting, without locking legacy products.
  PERFORM id FROM public.catalog_foundation_lock WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catalog configuration lock missing'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME IN ('catalog_categories','catalog_vehicle_types') THEN
    IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Catalog identifiers are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME='catalog_categories' THEN
    IF NEW.parent_id IS NOT NULL THEN
      SELECT parent_id INTO parent_parent FROM public.catalog_categories WHERE id=NEW.parent_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Parent category not found' USING ERRCODE='23503'; END IF;
      IF parent_parent IS NOT NULL THEN RAISE EXCEPTION 'Only one subcategory level is allowed' USING ERRCODE='23514'; END IF;
      IF EXISTS(SELECT 1 FROM public.catalog_categories WHERE parent_id=NEW.id) THEN
        RAISE EXCEPTION 'A category with children cannot become a subcategory' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='product_catalog_assignments' THEN
    IF TG_OP='UPDATE' AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      RAISE EXCEPTION 'Product identity is immutable' USING ERRCODE='23514';
    END IF;
    IF (TG_OP='INSERT' OR NEW.category_id IS DISTINCT FROM OLD.category_id)
      AND NOT EXISTS(SELECT 1 FROM public.catalog_categories c LEFT JOIN public.catalog_categories p ON p.id=c.parent_id
        WHERE c.id=NEW.category_id AND c.active AND (c.parent_id IS NULL OR p.active)) THEN
      RAISE EXCEPTION 'Category is inactive or missing' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='product_catalog_vehicle_types' THEN
    IF TG_OP='UPDATE' AND (NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.vehicle_type_id IS DISTINCT FROM OLD.vehicle_type_id) THEN
      RAISE EXCEPTION 'Replace a destination through explicit delete and insert' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.catalog_vehicle_types WHERE id=NEW.vehicle_type_id AND active) THEN
      RAISE EXCEPTION 'Vehicle destination is inactive or missing' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM public.product_catalog_vehicle_types WHERE product_id=NEW.product_id
      AND vehicle_type_id<>NEW.vehicle_type_id AND (vehicle_type_id='universal' OR NEW.vehicle_type_id='universal')) THEN
      RAISE EXCEPTION 'Universal excludes particular destinations' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_catalog_categories BEFORE INSERT OR UPDATE OR DELETE ON public.catalog_categories FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_foundation();
CREATE TRIGGER guard_catalog_vehicle_types BEFORE INSERT OR UPDATE OR DELETE ON public.catalog_vehicle_types FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_foundation();
CREATE TRIGGER guard_product_catalog_assignments BEFORE INSERT OR UPDATE OR DELETE ON public.product_catalog_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_foundation();
CREATE TRIGGER guard_product_catalog_vehicle_types BEFORE INSERT OR UPDATE OR DELETE ON public.product_catalog_vehicle_types FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_foundation();
CREATE TRIGGER guard_catalog_category_aliases BEFORE INSERT OR UPDATE OR DELETE ON public.catalog_category_aliases FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_foundation();

INSERT INTO public.catalog_categories(id,name,slug,sort_order,form_profile) VALUES
 ('lighting','Iluminación vehicular','iluminacion-vehicular',10,'lighting'),
 ('accessories','Accesorios','accesorios',20,'general');
INSERT INTO public.catalog_vehicle_types(id,name,sort_order) VALUES
 ('auto','Auto',10),('moto','Moto',20),('camioneta','Camioneta',30),
 ('camion','Camión',40),('utilitario','Utilitario',50),('universal','Universal',60);

-- No direct browser grants, including authenticated Supabase users. DCL admin
-- sessions must be checked in the server before using service_role.
ALTER TABLE public.catalog_foundation_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_vehicle_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_catalog_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_catalog_vehicle_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_category_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_foundation_lock,public.catalog_categories,public.catalog_vehicle_types,
 public.product_catalog_assignments,public.product_catalog_vehicle_types,public.catalog_category_aliases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,UPDATE ON public.catalog_foundation_lock TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.catalog_categories,public.catalog_vehicle_types,
 public.product_catalog_assignments,public.product_catalog_vehicle_types,public.catalog_category_aliases TO service_role;
REVOKE ALL ON FUNCTION public.guard_catalog_foundation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_catalog_foundation() TO service_role;
COMMIT;
