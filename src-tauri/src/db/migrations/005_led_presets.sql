-- Presety LED — kolor, nazwa, jasność (lumens).

CREATE TABLE IF NOT EXISTS led_presets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color_name TEXT NOT NULL,
  hex TEXT NOT NULL,
  lumens INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
