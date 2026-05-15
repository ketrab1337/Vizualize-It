import { create } from "zustand";
import { getDb } from "../lib/db";
import type { AiModel } from "../types";

/**
 * Globalne ustawienia aplikacji — modele AI używane do różnych operacji.
 * Persystowane w tabeli `app_settings` (klucz-wartość).
 *
 * Modele:
 * - Edycja tekstowa (text-only): nano-banana-2, nano-banana-pro, gpt-image-2
 * - Edycja inpaintingowa (z maską): **tylko gpt-image-2** (Google Gemini nie obsługuje masek natywnie)
 * - Zmiana kąta: nano-banana-2, nano-banana-pro, gpt-image-2
 */

const KEYS = {
  EDIT_TEXT_MODEL: "edit_text_model",
  CHANGE_ANGLE_MODEL: "change_angle_model",
} as const;

const DEFAULTS = {
  editTextModel: "nano-banana-2" as AiModel,
  changeAngleModel: "nano-banana-2" as AiModel,
};

interface SettingsState {
  /** Model dla edycji tekstowej (gdy nie ma maski). */
  editTextModel: AiModel;
  /** Model dla zmiany kąta przez widget 3D. */
  changeAngleModel: AiModel;
  /** Czy ustawienia zostały wczytane z DB. */
  loaded: boolean;

  loadSettings: () => Promise<void>;
  setEditTextModel: (m: AiModel) => Promise<void>;
  setChangeAngleModel: (m: AiModel) => Promise<void>;
}

interface DbRow {
  key: string;
  value: string;
}

function parseModel(value: string | undefined, fallback: AiModel): AiModel {
  if (value === "nano-banana-2" || value === "nano-banana-pro" || value === "gpt-image-2") {
    return value;
  }
  return fallback;
}

async function persist(key: string, value: string) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now]
  );
}

export const useSettingsStore = create<SettingsState>((set) => ({
  editTextModel: DEFAULTS.editTextModel,
  changeAngleModel: DEFAULTS.changeAngleModel,
  loaded: false,

  loadSettings: async () => {
    try {
      const db = await getDb();
      const rows = await db.select<DbRow[]>(`SELECT key, value FROM app_settings`);
      const map = new Map(rows.map((r) => [r.key, r.value]));
      set({
        editTextModel: parseModel(map.get(KEYS.EDIT_TEXT_MODEL), DEFAULTS.editTextModel),
        changeAngleModel: parseModel(map.get(KEYS.CHANGE_ANGLE_MODEL), DEFAULTS.changeAngleModel),
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  setEditTextModel: async (m) => {
    await persist(KEYS.EDIT_TEXT_MODEL, m);
    set({ editTextModel: m });
  },

  setChangeAngleModel: async (m) => {
    await persist(KEYS.CHANGE_ANGLE_MODEL, m);
    set({ changeAngleModel: m });
  },
}));
