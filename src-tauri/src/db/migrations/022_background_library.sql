-- Globalna biblioteka teł — użytkownik dodaje raz pliki JPG/PNG/WebP w Ustawieniach,
-- a potem wybiera je w edytorze jako tło projektu. Pliki leżą w data_dir/backgrounds/,
-- tutaj tylko metadane (nazwa wyświetlana + ścieżka pliku).
CREATE TABLE IF NOT EXISTS background_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
