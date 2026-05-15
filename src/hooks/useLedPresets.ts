import { useCallback } from "react";
import type { LedPreset } from "../types";
import { getDb } from "../lib/db";

const DEFAULT_PRESETS = [
  { id: "default-warm-white", label: "Ciepła biel", hex: "#FFC87A", color_name: "ciepłobiały", lumens: null, kelvin: 3000 },
  { id: "default-cool-white", label: "Zimna biel",  hex: "#D6EEFF", color_name: "zimno-biały",  lumens: null, kelvin: 6500 },
];

export function useLedPresets() {
  const loadPresets = useCallback(async (): Promise<LedPreset[]> => {
    const db = await getDb();
    for (const p of DEFAULT_PRESETS) {
      await db.execute(
        "INSERT OR IGNORE INTO led_presets (id, label, hex, color_name, lumens, kelvin) VALUES ($1, $2, $3, $4, $5, $6)",
        [p.id, p.label, p.hex, p.color_name, p.lumens, p.kelvin]
      );
    }
    return db.select<LedPreset[]>(
      "SELECT * FROM led_presets ORDER BY created_at ASC"
    );
  }, []);

  const createPreset = useCallback(
    async (label: string, hex: string, colorName: string, lumens: number | null, kelvin: number | null): Promise<LedPreset> => {
      const db = await getDb();
      const id = crypto.randomUUID();
      await db.execute(
        "INSERT INTO led_presets (id, label, hex, color_name, lumens, kelvin) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, label, hex, colorName, lumens ?? null, kelvin ?? null]
      );
      const rows = await db.select<LedPreset[]>(
        "SELECT * FROM led_presets WHERE id = $1",
        [id]
      );
      return rows[0];
    },
    []
  );

  const updatePreset = useCallback(
    async (id: string, label: string, hex: string, colorName: string, lumens: number | null, kelvin: number | null): Promise<void> => {
      const db = await getDb();
      await db.execute(
        "UPDATE led_presets SET label = $1, hex = $2, color_name = $3, lumens = $4, kelvin = $5 WHERE id = $6",
        [label, hex, colorName, lumens ?? null, kelvin ?? null, id]
      );
    },
    []
  );

  const deletePreset = useCallback(async (id: string): Promise<void> => {
    const db = await getDb();
    await db.execute("DELETE FROM led_presets WHERE id = $1", [id]);
  }, []);

  return { loadPresets, createPreset, updatePreset, deletePreset };
}
