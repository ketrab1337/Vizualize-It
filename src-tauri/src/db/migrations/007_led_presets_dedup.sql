-- Deduplikacja presetów LED: usuń nadmiarowe rekordy o tym samym hex,
-- zostawiając zawsze ten z najniższym id.

DELETE FROM led_presets
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM led_presets GROUP BY hex
);
