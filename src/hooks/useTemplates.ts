import { useCallback } from "react";
import { getDb } from "../lib/db";
import type { Template } from "../types";
import type { LedConfig, AiModel, ImageFormat } from "../types";

export interface TemplateConfig {
  led: LedConfig;
  model: AiModel;
  format: ImageFormat;
  activePresetIds?: string[];
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
