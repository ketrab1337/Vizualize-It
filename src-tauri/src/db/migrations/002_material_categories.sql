-- Kategorie materiałów (Plexa, HDF, Dystanse, ...) — wcześniej hardcoded.

CREATE TABLE IF NOT EXISTS material_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO material_categories (id, name, slug, is_system, sort_order) VALUES
  ('cat-plexa', 'Plexa', 'plexa', 0, 0);
