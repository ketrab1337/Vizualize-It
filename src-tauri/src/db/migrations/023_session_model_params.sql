-- Parametry per-model zapisywane przy sesji generowania, żeby galeria mogła
-- pokazać w podglądzie jaki prompt i jakie ustawienie modelu zostało użyte:
--   - quality      → jakość gpt-image-2 (low/medium/high)
--   - temperature  → temperatura Nano Banana (0..1)
-- Oba nullable — wypełnia tylko dostawca, którego dotyczą; pozostałe ścieżki
-- (batch, edycja, zmiana kąta) zostawiają NULL.
ALTER TABLE generation_sessions ADD COLUMN quality TEXT;
ALTER TABLE generation_sessions ADD COLUMN temperature REAL;
