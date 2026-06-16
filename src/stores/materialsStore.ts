import { create } from "zustand";
import { getDb } from "../lib/db";
import type { Material, MaterialCategory, GlobalCuttingRate } from "../types";

interface MaterialsState {
  categories: MaterialCategory[];
  materials: Material[];
  globalCuttingRates: GlobalCuttingRate[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  refreshGlobalRates: () => Promise<void>;
}

export const useMaterialsStore = create<MaterialsState>((set) => ({
  categories: [],
  materials: [],
  globalCuttingRates: [],
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
      let globalCuttingRates: GlobalCuttingRate[] = [];
      try {
        globalCuttingRates = await db.select<GlobalCuttingRate[]>(
          "SELECT * FROM cutting_rates_global ORDER BY category ASC, thickness_mm ASC"
        );
      } catch {
        // Tabela jeszcze nie istnieje (migracja 009 nie uruchomiona)
      }
      set({ categories, materials, globalCuttingRates });
    } finally {
      set({ isLoading: false });
    }
  },
}));
