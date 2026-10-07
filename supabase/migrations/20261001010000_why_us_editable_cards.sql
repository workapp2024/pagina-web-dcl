-- Incremental: the already-published users migration remains unchanged.
-- Legacy display_mode/text columns are retained for rollback; the UI uses cards only.
CREATE FUNCTION public.valid_why_us_cards(cards jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE card jsonb;
BEGIN
  IF jsonb_typeof(cards) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(cards) <> 3 THEN RETURN false; END IF;
  FOR card IN SELECT value FROM jsonb_array_elements(cards) LOOP
    IF jsonb_typeof(card) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(card)) <> 6
       OR NOT (card ?& ARRAY['id','enabled','icon','title','description','order'])
       OR jsonb_typeof(card->'id') IS DISTINCT FROM 'string'
       OR card->>'id' NOT IN ('vehicle','advice','purchase')
       OR jsonb_typeof(card->'enabled') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(card->'icon') IS DISTINCT FROM 'string'
       OR card->>'icon' NOT IN ('car','bulb','chat','package','truck','shield','tool')
       OR jsonb_typeof(card->'title') IS DISTINCT FROM 'string'
       OR length(btrim(card->>'title')) = 0 OR length(card->>'title') > 120
       OR jsonb_typeof(card->'description') IS DISTINCT FROM 'string'
       OR length(card->>'description') > 600
       OR jsonb_typeof(card->'order') IS DISTINCT FROM 'number'
       OR card->>'order' NOT IN ('1','2','3') THEN RETURN false;
    END IF;
  END LOOP;
  RETURN (SELECT count(DISTINCT value->>'id') = 3 AND count(DISTINCT value->>'order') = 3 FROM jsonb_array_elements(cards));
END;
$$;

ALTER TABLE public.site_settings
  ADD COLUMN why_us_cards jsonb NOT NULL DEFAULT '[{"id":"vehicle","enabled":true,"icon":"car","title":"Encontrá la luz para tu vehículo","description":"Buscá por vehículo o por conector y encontrá fácilmente opciones compatibles.","order":1},{"id":"advice","enabled":true,"icon":"chat","title":"Asesoramiento antes de comprar","description":"¿No sabés qué lámpara lleva tu vehículo? Te ayudamos a encontrar la indicada.","order":2},{"id":"purchase","enabled":true,"icon":"package","title":"Compra simple y segura","description":"Elegí tus productos, coordiná la entrega y contá con nosotros también después de tu compra.","order":3}]'::jsonb,
  ADD CONSTRAINT site_settings_why_us_cards_valid CHECK (public.valid_why_us_cards(why_us_cards));
