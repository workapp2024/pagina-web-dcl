-- =============================================================================
-- MIGRACIÓN INICIAL SUPABASE - DCL CREE LED
-- Archivo: supabase/migrations/20260827_initial_schema.sql
-- Descripción: Creación idempotente de tablas principales, índices, triggers RLS.
-- =============================================================================

-- 1. TABLA PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  previous_price NUMERIC(12,2),
  category VARCHAR(100) NOT NULL DEFAULT 'General',
  image_url TEXT NOT NULL DEFAULT '',
  cta_text VARCHAR(100) NOT NULL DEFAULT 'VER PRODUCTO',
  featured BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Campos de especificaciones técnicas para compatibilidad y filtros
  watts INTEGER,
  lumens INTEGER,
  voltage VARCHAR(50),
  color_temperature VARCHAR(50),
  connector_type VARCHAR(50),
  canbus BOOLEAN NOT NULL DEFAULT true,
  chip_type VARCHAR(100),
  warranty VARCHAR(100),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para optimización de consultas en productos
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_sort_order ON products(sort_order);

-- 2. TABLA PROMOTIONS
CREATE TABLE IF NOT EXISTS promotions (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  price VARCHAR(100),
  cta_text VARCHAR(100) NOT NULL DEFAULT 'APROVECHAR PROMO',
  cta_href TEXT NOT NULL DEFAULT '#contacto',
  start_date DATE,
  end_date DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para optimización de consultas en promociones
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(active);
CREATE INDEX IF NOT EXISTS idx_promotions_sort_order ON promotions(sort_order);
CREATE INDEX IF NOT EXISTS idx_promotions_start_date ON promotions(start_date);
CREATE INDEX IF NOT EXISTS idx_promotions_end_date ON promotions(end_date);

-- 3. TABLA VEHICLE_CATEGORIES
CREATE TABLE IF NOT EXISTS vehicle_categories (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '/vehiculos',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para optimización de consultas en categorías de vehículos
CREATE INDEX IF NOT EXISTS idx_vehicle_categories_active ON vehicle_categories(active);
CREATE INDEX IF NOT EXISTS idx_vehicle_categories_sort_order ON vehicle_categories(sort_order);

-- 4. TABLA SITE_SETTINGS (Registro único)
CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  logo_url TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  facebook TEXT NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(100) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT '',

  vehicle_section_title VARCHAR(255) NOT NULL DEFAULT '',
  needs_section_title VARCHAR(255) NOT NULL DEFAULT '',
  why_us_section_title VARCHAR(255) NOT NULL DEFAULT '',
  products_section_title VARCHAR(255) NOT NULL DEFAULT '',
  promotions_section_title VARCHAR(255) NOT NULL DEFAULT '',

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. TABLA HOME_SETTINGS (Registro único)
CREATE TABLE IF NOT EXISTS home_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  hero_title VARCHAR(255) NOT NULL DEFAULT '',
  hero_subtitle TEXT NOT NULL DEFAULT '',
  hero_primary_cta VARCHAR(100) NOT NULL DEFAULT '',
  hero_secondary_cta VARCHAR(100) NOT NULL DEFAULT '',
  hero_image_url TEXT NOT NULL DEFAULT '',

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. FUNCIÓN Y TRIGGERS PARA UPDATED_AT AUTOMÁTICO
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER set_updated_at_products
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER set_updated_at_promotions
BEFORE UPDATE ON promotions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER set_updated_at_vehicle_categories
BEFORE UPDATE ON vehicle_categories
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER set_updated_at_site_settings
BEFORE UPDATE ON site_settings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER set_updated_at_home_settings
BEFORE UPDATE ON home_settings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 7. SEGURIDAD Y POLÍTICAS ROW LEVEL SECURITY (RLS)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_settings ENABLE ROW LEVEL SECURITY;

-- Políticas de LECTURA PÚBLICA (Permite consulta anon/authenticated)
CREATE POLICY "Public read access for products"
  ON products FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public read access for promotions"
  ON promotions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public read access for vehicle_categories"
  ON vehicle_categories FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public read access for site_settings"
  ON site_settings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public read access for home_settings"
  ON home_settings FOR SELECT
  TO anon, authenticated
  USING (true);

-- NOTA DE SEGURIDAD:
-- No se crean políticas de INSERT, UPDATE ni DELETE para el rol anónimo (anon).
-- Las modificaciones se realizarán únicamente vía API en el servidor.

-- 8. ESTRUCTURA FUTURA DOCUMENTADA (SISTEMA DE COMPATIBILIDAD - NO EJECUTAR EN ESTA ETAPA)
/*
-- Tabla de Marcas de vehículos
CREATE TABLE IF NOT EXISTS vehicle_brands (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  logo_url TEXT
);

-- Tabla de Modelos por marca
CREATE TABLE IF NOT EXISTS vehicle_models (
  id VARCHAR(64) PRIMARY KEY,
  brand_id VARCHAR(64) REFERENCES vehicle_brands(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL
);

-- Tabla de Años por modelo
CREATE TABLE IF NOT EXISTS vehicle_years (
  id VARCHAR(64) PRIMARY KEY,
  model_id VARCHAR(64) REFERENCES vehicle_models(id) ON DELETE CASCADE,
  year_number INTEGER NOT NULL
);

-- Especificación de conectores/lámparas por vehículo y año
CREATE TABLE IF NOT EXISTS vehicle_lamps (
  id VARCHAR(64) PRIMARY KEY,
  year_id VARCHAR(64) REFERENCES vehicle_years(id) ON DELETE CASCADE,
  high_beam_connector VARCHAR(50),
  low_beam_connector VARCHAR(50),
  fog_connector VARCHAR(50)
);

-- Relación de compatibilidad directa producto-conector
CREATE TABLE IF NOT EXISTS product_compatibilities (
  product_id VARCHAR(64) REFERENCES products(id) ON DELETE CASCADE,
  connector_type VARCHAR(50) NOT NULL,
  PRIMARY KEY (product_id, connector_type)
);
*/
