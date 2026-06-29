-- Proporcja canvasu (ramki roboczej edytora = ramki wyjściowej do AI) per projekt.
-- Dzięki temu render do AI idzie w natywnych proporcjach ramki, a nie prostokątnego
-- viewportu — zdjęcie tła nie jest już przycinane do kształtu okna edytora.
--
-- Dozwolone wartości: '16:9' | '4:3' | '1:1' | '3:4' | '9:16'.
-- NULL = domyślnie '1:1' (zachowanie wstecz-kompatybilne, obsługiwane w froncie).
ALTER TABLE projects ADD COLUMN aspect_ratio TEXT;
