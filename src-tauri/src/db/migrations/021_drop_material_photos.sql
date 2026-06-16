-- Usuwa zdjęcia referencyjne materiałów — funkcja wycofana.
-- `photo_path` (od migracji 001) i `use_photo_in_generation` (migracja 020) nie są już
-- używane w kodzie; zdjęcia materiałów nie lecą do generowania AI. DROP COLUMN usuwa je
-- z baz userów, żeby nie zalegały jako martwa schema (wzorzec jak 017_drop_cutting_rates).
--
-- Oba to zwykłe kolumny bez indeksu — SQLite 3.35+ wspiera ALTER TABLE DROP COLUMN.
ALTER TABLE materials DROP COLUMN use_photo_in_generation;
ALTER TABLE materials DROP COLUMN photo_path;
