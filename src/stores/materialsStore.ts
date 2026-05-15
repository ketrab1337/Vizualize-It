import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../lib/db";
import type { Material, MaterialCategory, CuttingRate, GlobalCuttingRate } from "../types";

interface MaterialsState {
  categories: MaterialCategory[];
  materials: Material[];
  cuttingRates: CuttingRate[];
  globalCuttingRates: GlobalCuttingRate[];
  photoCache: Record<string, string>;
  isLoading: boolean;
  refresh: () => Promise<void>;
  refreshGlobalRates: () => Promise<void>;
  ensurePhoto: (materialId: string, photoPath: string) => Promise<void>;
}

export const useMaterialsStore = create<MaterialsState>((set, get) => ({
  categories: [],
  materials: [],
  cuttingRates: [],
  globalCuttingRates: [],
  photoCache: {},
  isLoading: false,

  refreshGlobalRates: async () => {
    try {
      const db = await getDb();
      const globalCuttingRates = await db.select<GlobalCuttingRate[]>(
        "SELECT * FROM cutting_rates_global ORDER BY category ASC, thickness_mm ASC"
      );
      set({ globalCuttingRates });
    } catch {
      // Tabela jeszcze nie istnieje
    }
  },

  refresh: async () => {
    set({ isLoading: true });
    try {
      const db = await getDb();
      const [categories, materials] = await Promise.all([
        db.select<MaterialCategory[]>(
          "SELECT * FROM material_categories ORDER BY sort_order ASC, name ASC"
        ),
        db.select<Material[]>("SELECT * FROM materials ORDER BY name ASC"),
      ]);
      let cuttingRates: CuttingRate[] = [];
      try {
        cuttingRates = await db.select<CuttingRate[]>(
          "SELECT * FROM cutting_rates ORDER BY thickness_mm ASC"
        );
      } catch {
        // Tabela jeszcze nie istnieje (migracja 003 nie uruchomiona)
      }
      let globalCuttingRates: GlobalCuttingRate[] = [];
      try {
        globalCuttingRates = await db.select<GlobalCuttingRate[]>(
          "SELECT * FROM cutting_rates_global ORDER BY category ASC, thickness_mm ASC"
        );
      } catch {
        // Tabela jeszcze nie istnieje (migracja 009 nie uruchomiona)
      }
      set({ categories, materials, cuttingRates, globalCuttingRates });

      // Przeładuj zdjęcia dla materiałów które ich jeszcze nie mają w cache
      const { photoCache } = get();
      const toLoad = materials.filter((m) => m.photo_path && !photoCache[m.id]);
      if (toLoad.length > 0) {
        const entries = await Promise.all(
          toLoad.map(async (m) => {
            try {
              const url = await invoke<string>("get_material_photo", { path: m.photo_path });
              return [m.id, url] as [string, string];
            } catch {
              return null;
            }
          })
        );
        const newEntries = entries.filter(Boolean) as [string, string][];
        if (newEntries.length > 0) {
          set((s) => ({ photoCache: { ...s.photoCache, ...Object.fromEntries(newEntries) } }));
        }
      }
    } finally {
      set({ isLoading: false });
    }
  },

  ensurePhoto: async (materialId, photoPath) => {
    const { photoCache } = get();
    if (photoCache[materialId]) return;
    try {
      const url = await invoke<string>("get_material_photo", { path: photoPath });
      set((s) => ({ photoCache: { ...s.photoCache, [materialId]: url } }));
    } catch {
      // brak podglądu — ignoruj
    }
  },
}));
