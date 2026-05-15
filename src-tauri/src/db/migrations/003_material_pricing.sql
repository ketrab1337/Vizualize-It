-- Pola wyceny materiałów: jednostka, cena bazowa, domyślna grubość.

ALTER TABLE materials ADD COLUMN pricing_unit TEXT CHECK(
  pricing_unit IN ('per_piece', 'per_m2', 'per_mb_cut') OR pricing_unit IS NULL
);

ALTER TABLE materials ADD COLUMN base_price REAL;

ALTER TABLE materials ADD COLUMN default_thickness_mm REAL;

CREATE TABLE IF NOT EXISTS cutting_rates (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  thickness_mm REAL NOT NULL,
  price_per_m REAL NOT NULL,
  UNIQUE(material_id, thickness_mm)
);

CREATE INDEX IF NOT EXISTS idx_cutting_rates_material ON cutting_rates(material_id);
