-- Usuwa starą tabelę `cutting_rates` (per-material) wprowadzoną migracją 003.
-- Po refactor wyceny w migracji 009 (cutting_rates_global per kategoria) tabela
-- per-material przestała być używana w kodzie — DROP usuwa ją z baz userów,
-- bo zalegała tylko jako legacy data.
--
-- IF EXISTS bo w świeżych instalacjach (gdzie 003 i 009 wykonywały się razem)
-- może istnieć, ale nie jest wymagane — migracje są zawsze sekwencyjne.
DROP TABLE IF EXISTS cutting_rates;
