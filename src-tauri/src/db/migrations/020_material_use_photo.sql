-- Per-materiał flaga: czy zdjęcie referencyjne materiału ma być wysyłane do AI
-- przy generowaniu (jako "Obraz N" opisujący prawdziwą fakturę/kolor/wykończenie).
--
-- Domyślnie 0 (wyłączone) — zdjęcia błyszczącej/lustrzanej plexi z odbiciami potrafią
-- mylić model, więc użytkownik świadomie włącza je tylko dla materiałów z dobrym,
-- reprezentatywnym zdjęciem. Bez tej flagi zdjęcia materiałów nie lecą do generowania.
ALTER TABLE materials ADD COLUMN use_photo_in_generation INTEGER NOT NULL DEFAULT 0;
