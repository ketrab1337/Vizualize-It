-- Generyczna tabela key-value do globalnych ustawień aplikacji
-- (defaults modeli AI dla edycji/zmiany kąta, itp.).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
