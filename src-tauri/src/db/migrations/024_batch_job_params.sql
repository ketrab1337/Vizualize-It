-- Zadanie batch tworzy sesję generowania dopiero przy odbiorze wyników (poll, do 24h),
-- a payload z promptem/parametrami jest na dysku i kasowany po sukcesie. Żeby galeria
-- mogła pokazać prompt i parametr modelu również dla obrazów z batcha, zapisujemy je
-- na samym zadaniu w chwili dodania do kolejki i przepisujemy do sesji przy poll.
--   - prompt_assembled → finalny prompt użyty do generowania
--   - quality          → jakość gpt-image-2 (low/medium/high)
--   - temperature      → temperatura Nano Banana (0..1)
ALTER TABLE batch_jobs ADD COLUMN prompt_assembled TEXT;
ALTER TABLE batch_jobs ADD COLUMN quality TEXT;
ALTER TABLE batch_jobs ADD COLUMN temperature REAL;
