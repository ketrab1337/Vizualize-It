-- Dodaje flagę is_distance do kategorii materiałów.
-- Zamiast porównywać slug do hardcoded "dystans", używamy is_distance = 1.
-- Istniejące kategorie z slugiem zaczynającym się od "dystans" dostają is_distance = 1.
ALTER TABLE material_categories ADD COLUMN is_distance INTEGER NOT NULL DEFAULT 0;
UPDATE material_categories SET is_distance = 1 WHERE slug LIKE 'dystans%';
