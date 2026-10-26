-- Verification only. Execute this file, not the migration again.
BEGIN TRANSACTION READ ONLY;
SELECT c.relname AS table_name,c.relrowsecurity AS rls,
       c.relforcerowsecurity AS force_rls,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN
 ('catalog_foundation_lock','catalog_categories','catalog_vehicle_types','product_catalog_assignments','product_catalog_vehicle_types','catalog_category_aliases') ORDER BY 1;
SELECT 'categories' AS section,jsonb_agg(to_jsonb(c) ORDER BY sort_order,id) AS result FROM public.catalog_categories c
UNION ALL SELECT 'vehicle_types',jsonb_agg(to_jsonb(v) ORDER BY sort_order,id) FROM public.catalog_vehicle_types v
UNION ALL SELECT 'initial_counts',jsonb_build_object('lock',(SELECT count(*) FROM public.catalog_foundation_lock WHERE id),
 'assignments',(SELECT count(*) FROM public.product_catalog_assignments),
 'destinations',(SELECT count(*) FROM public.product_catalog_vehicle_types),
 'aliases',(SELECT count(*) FROM public.catalog_category_aliases));
SELECT conrelid::regclass AS relation,conname,pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid IN
 (SELECT c.oid FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN
 ('catalog_foundation_lock','catalog_categories','catalog_vehicle_types','product_catalog_assignments','product_catalog_vehicle_types','catalog_category_aliases')) ORDER BY 1,2;
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN
 ('catalog_foundation_lock','catalog_categories','catalog_vehicle_types','product_catalog_assignments','product_catalog_vehicle_types','catalog_category_aliases') ORDER BY 1,2;
SELECT tgrelid::regclass AS relation,tgname,tgenabled,pg_get_triggerdef(oid) AS definition FROM pg_trigger
WHERE NOT tgisinternal AND tgname IN ('guard_catalog_categories','guard_catalog_vehicle_types','guard_product_catalog_assignments','guard_product_catalog_vehicle_types','guard_catalog_category_aliases') ORDER BY 1;
SELECT c.relname,r.rolname,v.priv,has_table_privilege(r.rolname,c.oid,v.priv) AS allowed
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) v(priv)
WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN
 ('catalog_foundation_lock','catalog_categories','catalog_vehicle_types','product_catalog_assignments','product_catalog_vehicle_types','catalog_category_aliases')
AND r.rolname IN ('anon','authenticated','service_role') ORDER BY 1,2,3;
SELECT p.oid::regprocedure AS function,p.prosecdef AS security_definer,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
 pg_get_functiondef(p.oid) AS definition
FROM pg_proc p WHERE p.oid=to_regprocedure('public.guard_catalog_foundation()');
ROLLBACK;
