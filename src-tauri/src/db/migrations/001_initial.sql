-- Schemat początkowy: projekty, materiały, sesje generowania, obrazy, szablony.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  material_type TEXT CHECK(material_type IN ('matowa', 'mleczna', 'polysk', 'lustro') OR material_type IS NULL),
  color_hex TEXT,
  photo_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);

CREATE TABLE IF NOT EXISTS generation_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  prompt_assembled TEXT,
  prompt_user TEXT,
  model TEXT NOT NULL,
  format TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  camera_rotate REAL NOT NULL DEFAULT 0,
  camera_tilt REAL NOT NULL DEFAULT 0,
  camera_distance REAL NOT NULL DEFAULT 0,
  led_backlit_enabled INTEGER NOT NULL DEFAULT 0,
  led_backlit_color TEXT,
  led_frontlit_enabled INTEGER NOT NULL DEFAULT 0,
  led_frontlit_color TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generation_sessions_project ON generation_sessions(project_id);

CREATE TABLE IF NOT EXISTS generated_images (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES generation_sessions(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generated_images_session ON generated_images(session_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_project ON generated_images(project_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_favorite ON generated_images(is_favorite);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
