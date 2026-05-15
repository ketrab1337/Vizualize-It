import { useState, useCallback } from "react";
import { getDb } from "../lib/db";

export interface PromptPreset {
  id: string;
  label: string;
  description: string | null;
  text: string;
  sort_order: number;
}

export function usePromptPresets() {
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPresets = useCallback(async (): Promise<PromptPreset[]> => {
    setLoading(true);
    try {
      const db = await getDb();
      const rows = await db.select<PromptPreset[]>(
        "SELECT id, label, description, text, sort_order FROM prompt_presets ORDER BY sort_order ASC"
      );
      setPresets(rows);
      return rows;
    } finally {
      setLoading(false);
    }
  }, []);

  const createPreset = useCallback(
    async (label: string, text: string, description?: string): Promise<boolean> => {
      const trimLabel = label.trim();
      const trimText = text.trim();
      if (!trimLabel || !trimText) return false;
      try {
        const db = await getDb();
        const id = crypto.randomUUID();
        const maxOrder = presets.length > 0 ? Math.max(...presets.map((p) => p.sort_order)) + 1 : 0;
        await db.execute(
          "INSERT INTO prompt_presets (id, label, description, text, sort_order) VALUES ($1,$2,$3,$4,$5)",
          [id, trimLabel, description?.trim() || null, trimText, maxOrder]
        );
        setPresets((prev) => [
          ...prev,
          { id, label: trimLabel, description: description?.trim() || null, text: trimText, sort_order: maxOrder },
        ]);
        return true;
      } catch {
        return false;
      }
    },
    [presets]
  );

  const deletePreset = useCallback(async (id: string): Promise<void> => {
    const db = await getDb();
    await db.execute("DELETE FROM prompt_presets WHERE id = $1", [id]);
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const updatePreset = useCallback(
    async (id: string, label: string, text: string, description?: string): Promise<boolean> => {
      const trimLabel = label.trim();
      const trimText = text.trim();
      if (!trimLabel || !trimText) return false;
      const trimDesc = description?.trim() || null;
      try {
        const db = await getDb();
        await db.execute(
          "UPDATE prompt_presets SET label = $1, description = $2, text = $3 WHERE id = $4",
          [trimLabel, trimDesc, trimText, id]
        );
        setPresets((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, label: trimLabel, description: trimDesc, text: trimText } : p
          )
        );
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  return { presets, loading, loadPresets, createPreset, updatePreset, deletePreset };
}
