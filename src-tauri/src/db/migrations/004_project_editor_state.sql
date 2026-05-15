-- Stan edytora trzymany w rekordzie projektu: zawartość SVG, override'y, tło.

ALTER TABLE projects ADD COLUMN svg_content TEXT;
ALTER TABLE projects ADD COLUMN node_overrides_json TEXT;
ALTER TABLE projects ADD COLUMN background_path TEXT;
ALTER TABLE projects ADD COLUMN background_mime TEXT;
