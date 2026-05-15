-- Globalne stawki cięcia laserem per kategoria + grubość.

CREATE TABLE IF NOT EXISTS cutting_rates_global (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  thickness_mm REAL NOT NULL,
  price_per_m REAL NOT NULL,
  UNIQUE(category, thickness_mm)
);

CREATE INDEX IF NOT EXISTS idx_cutting_rates_global_category ON cutting_rates_global(category);
