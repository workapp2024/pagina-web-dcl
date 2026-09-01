-- =============================================================================
-- COMPATIBILIDAD VEHÍCULO → CONECTOR - DCL CREE LED
-- Archivo: supabase/migrations/20260830_vehicle_compatibility.sql
-- Descripción: Estructura normalizada Marca → Modelo → Compatibilidad (año/conector),
--              inspirada en el esquema documentado en 20260827_initial_schema.sql
--              (sección "ESTRUCTURA FUTURA DOCUMENTADA") y en el sistema de referencia
--              CRLED V1 (campos marca, modelo, año, baja, alta, aux).
--
-- IMPORTANTE: Este archivo NO se ejecuta automáticamente. Debe aplicarse manualmente
-- desde el SQL Editor de Supabase, igual que las migraciones anteriores del proyecto.
-- No modifica ni elimina datos de las tablas existentes (products, promotions,
-- vehicle_categories, site_settings, home_settings).
-- =============================================================================

-- 1. TABLA VEHICLE_BRANDS (marcas de vehículos)
CREATE TABLE IF NOT EXISTS vehicle_brands (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_brands_active ON vehicle_brands(active);

-- 2. TABLA VEHICLE_MODELS (modelos por marca, con tipo de vehículo)
CREATE TABLE IF NOT EXISTS vehicle_models (
  id VARCHAR(64) PRIMARY KEY,
  brand_id VARCHAR(64) NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  -- Tipo de vehículo: Auto, Camioneta, Moto, Camión (coincide con las categorías de la Home)
  vehicle_type VARCHAR(50) NOT NULL DEFAULT 'Auto',
  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (brand_id, name)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_models_brand ON vehicle_models(brand_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_models_type ON vehicle_models(vehicle_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_models_active ON vehicle_models(active);

-- 3. TABLA VEHICLE_COMPATIBILITIES (rango de años + conectores por modelo)
-- Equivale a los campos anio/baja/alta/aux de CRLED V1, con "fog" (antiniebla) agregado
-- y un rango year_from/year_to para representar años sueltos o rangos ("2010-2017").
CREATE TABLE IF NOT EXISTS vehicle_compatibilities (
  id VARCHAR(64) PRIMARY KEY,
  model_id VARCHAR(64) NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,

  year_from INTEGER NOT NULL,
  year_to INTEGER, -- NULL = sigue vigente / año único
  version VARCHAR(100), -- versión o motorización opcional

  -- Códigos de conector/lámpara. Deben coincidir con products.connector_type
  connector_low VARCHAR(50),  -- luz baja
  connector_high VARCHAR(50), -- luz alta
  connector_fog VARCHAR(50),  -- antiniebla
  connector_aux VARCHAR(50),  -- posición / auxiliar

  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_compat_model ON vehicle_compatibilities(model_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_compat_active ON vehicle_compatibilities(active);
CREATE INDEX IF NOT EXISTS idx_vehicle_compat_years ON vehicle_compatibilities(year_from, year_to);

-- 4. TRIGGERS DE updated_at (reutiliza la función existente update_updated_at_column())
CREATE OR REPLACE TRIGGER set_updated_at_vehicle_brands
BEFORE UPDATE ON vehicle_brands
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER set_updated_at_vehicle_models
BEFORE UPDATE ON vehicle_models
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER set_updated_at_vehicle_compatibilities
BEFORE UPDATE ON vehicle_compatibilities
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 5. ROW LEVEL SECURITY Y LECTURA PÚBLICA (mismo patrón que las tablas existentes)
ALTER TABLE vehicle_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_compatibilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access for vehicle_brands"
  ON vehicle_brands FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public read access for vehicle_models"
  ON vehicle_models FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public read access for vehicle_compatibilities"
  ON vehicle_compatibilities FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON TABLE
  public.vehicle_brands,
  public.vehicle_models,
  public.vehicle_compatibilities
TO anon, authenticated;

-- Privilegios completos para el rol usado por la service role key (escrituras
-- administrativas vía /api/admin/vehicle-compatibility). Sin este GRANT, las
-- tablas nuevas quedan sin privilegios para service_role y las escrituras
-- fallan con "permission denied for table" aunque la service role key sea válida.
GRANT ALL ON TABLE
  public.vehicle_brands,
  public.vehicle_models,
  public.vehicle_compatibilities
TO service_role;

-- NOTA DE SEGURIDAD:
-- No se otorgan permisos de INSERT, UPDATE ni DELETE para anon ni authenticated.
-- Las escrituras se realizan exclusivamente desde /api/admin/vehicle-compatibility
-- utilizando la service role key, igual que el resto de las tablas administrativas.
