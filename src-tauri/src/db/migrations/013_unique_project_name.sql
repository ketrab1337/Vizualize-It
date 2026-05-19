-- Wymuszenie unikalności nazw projektów.
-- Najpierw rozwiązujemy ewentualne duplikaty (dorzucamy sufiks " (2)", " (3)", ...),
-- potem tworzymy UNIQUE INDEX.
WITH ranked AS (
  SELECT rowid, ROW_NUMBER() OVER (PARTITION BY name ORDER BY rowid) AS rn
  FROM projects
)
UPDATE projects
SET name = name || ' (' || (SELECT rn FROM ranked WHERE ranked.rowid = projects.rowid) || ')'
WHERE rowid IN (SELECT rowid FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
