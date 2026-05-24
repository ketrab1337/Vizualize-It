import { useCallback } from "react";
import { getDb } from "../lib/db";
import type { Template } from "../types";
import type { LedConfig, AiModel, ImageFormat, CameraConfig, TimeOfDay } from "../types";

/**
 * Konfiguracja szablonu zapisywana jako JSON w `templates.config_json`.
 *
 * Wszystkie pola POZA `led, model, format` są opcjonalne — dla wstecznej
 * kompatybilności ze starymi szablonami zapisanymi tylko z minimum.
 *
 * Świadomie POMINIĘTE:
 *   - `referenceImages` — duże base64 (MB), zawsze per-projekt, nigdy do szablonu
 *   - `nodeOverrides` / `svgContent` — to dane projektu, nie szablonu
 *   - `productType` — per projekt, nie per generowanie
 */
export interface TemplateConfig {
  led: LedConfig;
  model: AiModel;
  format: ImageFormat;
  activePresetIds?: string[];
  /** Override tekstowy promptu (gdy user przeszedł w tryb ręcznej edycji). */
  prompt?: string | null;
  /** Mapa presetId → anchor (pozycja preseta w prompcie). */
  presetAnchors?: Record<string, string>;
  /** Per-instancyjne edycje tekstu badge'ów presetów. */
  presetTextOverrides?: Record<string, string>;
  /** Konfiguracja kąta kamery. */
  camera?: CameraConfig;
  /** Czy kamera została zmodyfikowana z domyślnej (decyduje czy assembler dorzuca opis kamery). */
  cameraDirty?: boolean;
  /** Pora dnia / wnętrze (wpływa na styl światła). */
  timeOfDay?: TimeOfDay;
}

export function useTemplates() {
  const loadTemplates = useCallback(async (): Promise<Template[]> => {
    const db = await getDb();
    return db.select<Template[]>(
      "SELECT * FROM templates ORDER BY created_at DESC"
    );
  }, []);

  const createTemplate = useCallback(
    async (name: string, config: TemplateConfig): Promise<Template> => {
      const db = await getDb();
      const id = crypto.randomUUID();
      const config_json = JSON.stringify(config);
      await db.execute(
        "INSERT INTO templates (id, name, config_json) VALUES ($1, $2, $3)",
        [id, name, config_json]
      );
      const rows = await db.select<Template[]>(
        "SELECT * FROM templates WHERE id = $1",
        [id]
      );
      return rows[0];
    },
    []
  );

  const deleteTemplate = useCallback(async (id: string): Promise<void> => {
    const db = await getDb();
    await db.execute("DELETE FROM templates WHERE id = $1", [id]);
  }, []);

  const updateTemplate = useCallback(
    async (id: string, name: string, config: TemplateConfig): Promise<void> => {
      const db = await getDb();
      await db.execute(
        "UPDATE templates SET name = $1, config_json = $2 WHERE id = $3",
        [name.trim(), JSON.stringify(config), id]
      );
    },
    []
  );

  return { loadTemplates, createTemplate, deleteTemplate, updateTemplate };
}
