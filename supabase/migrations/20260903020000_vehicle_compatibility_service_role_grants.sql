-- Regulariza el archivo histórico inválido 20260830b_*. GRANT es idempotente:
-- volver a otorgar un privilegio ya presente no duplica ni altera datos.
GRANT ALL ON TABLE
  public.vehicle_brands,
  public.vehicle_models,
  public.vehicle_compatibilities
TO service_role;
