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

/** Jakość generowania gpt-image-2 — wpływa na koszt (high ≈ ~4× medium). */
export type GptImageQuality = "low" | "medium" | "high";

const KEYS = {
  EDIT_TEXT_MODEL: "edit_text_model",
  CHANGE_ANGLE_MODEL: "change_angle_model",
  GPT_IMAGE_QUALITY: "gpt_image_quality",
  NANO_BANANA_TEMPERATURE: "nano_banana_temperature",
} as const;

const DEFAULTS = {
  editTextModel: "nano-banana-2" as AiModel,
  changeAngleModel: "nano-banana-2" as AiModel,
  gptImageQuality: "medium" as GptImageQuality,
  nanoBananaTemperature: 0.35,
};

interface SettingsState {
  /** Model dla edycji tekstowej (gdy nie ma maski). */
  editTextModel: AiModel;
  /** Model dla zmiany kąta przez widget 3D. */
  changeAngleModel: AiModel;
  /** Jakość gpt-image-2 przy generowaniu (low/medium/high). */
  gptImageQuality: GptImageQuality;
  /** Temperatura Nano Banana (Gemini) przy generowaniu — 0..1. */
  nanoBananaTemperature: number;
  /** Czy ustawienia zostały wczytane z DB. */
  loaded: boolean;

  loadSettings: () => Promise<void>;
  setEditTextModel: (m: AiModel) => Promise<void>;
  setChangeAngleModel: (m: AiModel) => Promise<void>;
  setGptImageQuality: (q: GptImageQuality) => Promise<void>;
  setNanoBananaTemperature: (t: number) => Promise<void>;
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

function parseQuality(value: string | undefined, fallback: GptImageQuality): GptImageQuality {
  if (value === "low" || value === "medium" || value === "high") return value;
  return fallback;
}

function parseTemperature(value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
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
  gptImageQuality: DEFAULTS.gptImageQuality,
  nanoBananaTemperature: DEFAULTS.nanoBananaTemperature,
  loaded: false,

  loadSettings: async () => {
    try {
      const db = await getDb();
      const rows = await db.select<DbRow[]>(`SELECT key, value FROM app_settings`);
      const map = new Map(rows.map((r) => [r.key, r.value]));
      set({
        editTextModel: parseModel(map.get(KEYS.EDIT_TEXT_MODEL), DEFAULTS.editTextModel),
        changeAngleModel: parseModel(map.get(KEYS.CHANGE_ANGLE_MODEL), DEFAULTS.changeAngleModel),
        gptImageQuality: parseQuality(map.get(KEYS.GPT_IMAGE_QUALITY), DEFAULTS.gptImageQuality),
        nanoBananaTemperature: parseTemperature(
          map.get(KEYS.NANO_BANANA_TEMPERATURE),
          DEFAULTS.nanoBananaTemperature
        ),
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

  setGptImageQuality: async (q) => {
    await persist(KEYS.GPT_IMAGE_QUALITY, q);
    set({ gptImageQuality: q });
  },

  setNanoBananaTemperature: async (t) => {
    const clamped = Math.min(1, Math.max(0, t));
    await persist(KEYS.NANO_BANANA_TEMPERATURE, String(clamped));
    set({ nanoBananaTemperature: clamped });
  },
}));
