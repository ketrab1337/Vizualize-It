-- Typ produktu per projekt — używany w prompt assembler do podmienienia hardcoded
-- "szyld" na konkretny typ wybrany przez użytkownika (tabliczka informacyjna,
-- numer na dom, tablica weselna, dekoracja ścienna, litery 3D, inne + free-text).
--
-- Format: identyfikator z predefiniowanej listy LUB dowolny tekst dla "inne".
-- NULL = domyślnie "szyld" (zachowanie wstecz-kompatybilne).
ALTER TABLE projects ADD COLUMN product_type TEXT;
