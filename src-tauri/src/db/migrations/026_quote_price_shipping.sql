-- Druga, osobna cena materiału: kwota wliczana do WYCENY dla klienta.
-- `base_price` zostaje kosztem własnym (ile materiał kosztuje szyldiarza),
-- `quote_price` to cena tego samego materiału pokazywana w wycenie. Marża z
-- panelu edytora jest naliczana NA TO dodatkowo. NULL = brak osobnej ceny
-- wycenowej → wycena używa `base_price` (wstecz-kompatybilne).
ALTER TABLE materials ADD COLUMN quote_price REAL;

-- Koszt wysyłki per projekt — doliczany PŁASKO (bez marży) do sumy wyceny.
-- NULL = brak wysyłki. Trzymany w kolumnie projektu obok led_config_json.
ALTER TABLE projects ADD COLUMN shipping_cost REAL;
