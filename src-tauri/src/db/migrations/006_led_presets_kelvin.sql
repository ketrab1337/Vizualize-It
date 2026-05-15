-- Dodaj temperaturę barwową (Kelvin) do presetów LED.

ALTER TABLE led_presets ADD COLUMN kelvin INTEGER;
