import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../lib/db";
import { fileToBlobUrl } from "../lib/imageBlob";
import type { BackgroundItem } from "../types";

interface AddBackgroundResult {
  path: string;
  mime: string;
  name: string;
}

interface BackgroundsState {
  backgrounds: BackgroundItem[];
  /** id → blob URL miniaturki (do <img src>). */
  thumbs: Record<string, string>;
  isLoading: boolean;
  refresh: () => Promise<void>;
  /** Dodaje plik z dysku do biblioteki (kopiuje do backgrounds/ + wpis w DB). */
  addBackground: (sourcePath: string) => Promise<void>;
  /** Usuwa tło z biblioteki (plik + wpis w DB). NIE rusza projektów (mają własne kopie). */
  removeBackground: (item: BackgroundItem) => Promise<void>;
}

export const useBackgroundsStore = create<BackgroundsState>((set, get) => ({
  backgrounds: [],
  thumbs: {},
  isLoading: false,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const db = await getDb();
      const backgrounds = await db.select<BackgroundItem[]>(
        "SELECT * FROM background_library ORDER BY created_at DESC"
      );
      set({ backgrounds });

      // Dobuduj miniaturki dla teł, których nie ma jeszcze w cache.
      const { thumbs } = get();
      const toLoad = backgrounds.filter((b) => !thumbs[b.id]);
      if (toLoad.length > 0) {
        const entries = await Promise.all(
          toLoad.map(async (b) => {
            try {
              return [b.id, await fileToBlobUrl(b.file_path)] as [string, string];
            } catch {
              return null;
            }
          })
        );
        const ok = entries.filter(Boolean) as [string, string][];
        if (ok.length > 0) {
          set((s) => ({ thumbs: { ...s.thumbs, ...Object.fromEntries(ok) } }));
        }
      }
    } finally {
      set({ isLoading: false });
    }
  },

  addBackground: async (sourcePath) => {
    const result = await invoke<AddBackgroundResult>("add_background", { sourcePath });
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      "INSERT INTO background_library (id, name, file_path, created_at) VALUES ($1,$2,$3,$4)",
      [id, result.name, result.path, now]
    );
    await get().refresh();
  },

  removeBackground: async (item) => {
    await invoke("delete_background", { path: item.file_path });
    const db = await getDb();
    await db.execute("DELETE FROM background_library WHERE id=$1", [item.id]);
    set((s) => {
      const thumb = s.thumbs[item.id];
      if (thumb?.startsWith("blob:")) URL.revokeObjectURL(thumb);
      const nextThumbs = { ...s.thumbs };
      delete nextThumbs[item.id];
      return {
        backgrounds: s.backgrounds.filter((b) => b.id !== item.id),
        thumbs: nextThumbs,
      };
    });
  },
}));
