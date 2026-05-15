-- Wymuszenie unikalności nazw projektów.
-- Najpierw rozwiązujemy ewentualne duplikaty (dorzucamy sufiks " (2)", " (3)", ...),
-- potem tworzymy UNIQUE INDEX.
UPDATE projects
SET name = name || ' (' || rn || ')'
WHERE rowid IN (
  SELECT rowid FROM (
    SELECT rowid, ROW_NUMBER() OVER (PARTITION BY name ORDER BY rowid) AS rn
    FROM projects
  ) WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
