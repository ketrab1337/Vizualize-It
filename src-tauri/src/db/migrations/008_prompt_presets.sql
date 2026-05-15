-- Presety promptów doklejane do user_prompt podczas generowania.

CREATE TABLE IF NOT EXISTS prompt_presets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO prompt_presets (id, label, description, text, sort_order) VALUES
  ('preset-fotorealistyczna', 'Fotorealistyczna', 'Naturalne oświetlenie, wysoka jakość', 'fotorealistyczna aranżacja z naturalnym oświetleniem, profesjonalna fotografia reklamowa', 0),
  ('preset-nocny', 'Widok nocny', 'Ujęcie nocne z podświetlonym szyldem', 'ujęcie nocne, sztuczne oświetlenie miejskie, intensywne podświetlenie szyldu', 1),
  ('preset-neon', 'Efekt neonu', 'Neonowa poświata wokół liter', 'intensywny efekt neonu, widoczna poświata i aureola światła wokół liter', 2),
  ('preset-cegla', 'Na cegle', 'Szyld na ścianie z cegły', 'szyld zamontowany na ścianie z czerwonej cegły, industrialny klimat', 3),
  ('preset-mokry', 'Mokry asfalt', 'Efekt deszczu, refleksy', 'deszczowy efekt, mokry asfalt, refleksy szyldu na nawierzchni', 4),
  ('preset-nowoczesna', 'Nowoczesna fasada', 'Szklana fasada biurowca', 'nowoczesna szklana fasada biurowca, minimalistyczna architektura', 5);
