import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getDb } from "../lib/db";
import type { Material, MaterialCategory, CuttingRate } from "../types";

export interface MaterialInput {
  name: string;
  category: string;
  material_type: "matowa" | "mleczna" | "polysk" | "lustro" | null;
  color_hex: string | null;
  photo_path: string | null;
  pricing_unit: "per_piece" | "per_m2" | "per_mb_cut" | null;
  base_price: number | null;
  default_thickness_mm: number | null;
}

export function useCategories() {
  const loadCategories = useCallback(async (): Promise<MaterialCategory[]> => {
    const db = await getDb();
    return db.select<MaterialCategory[]>(
      "SELECT * FROM material_categories ORDER BY sort_order ASC, name ASC"
    );
  }, []);

  const createCategory = useCallback(async (name: string): Promise<MaterialCategory> => {
    const db = await getDb();
    const id = `cat-${crypto.randomUUID()}`;
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const now = new Date().toISOString();
    const maxOrder = await db.select<{ max_order: number | null }[]>(
      "SELECT MAX(sort_order) as max_order FROM material_categories"
    );
    const nextOrder = (maxOrder[0]?.max_order ?? 1) + 1;
    await db.execute(
      "INSERT INTO material_categories (id, name, slug, is_system, sort_order, created_at) VALUES ($1,$2,$3,0,$4,$5)",
      [id, name.trim(), slug, nextOrder, now]
    );
    return { id, name: name.trim(), slug, is_system: 0, sort_order: nextOrder, created_at: now };
  }, []);

  const deleteCategory = useCallback(async (id: string): Promise<void> => {
    const db = await getDb();
    await db.execute("DELETE FROM material_categories WHERE id=$1", [id]);
  }, []);

  return { loadCategories, createCategory, deleteCategory };
}

export function useMaterials() {
  const loadMaterials = useCallback(
    async (category?: string): Promise<Material[]> => {
      const db = await getDb();
      if (category) {
        return db.select<Material[]>(
          "SELECT * FROM materials WHERE category = $1 ORDER BY name ASC",
          [category]
        );
      }
      return db.select<Material[]>("SELECT * FROM materials ORDER BY name ASC");
    },
    []
  );

  const createMaterial = useCallback(async (input: MaterialInput): Promise<Material> => {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      "INSERT INTO materials (id, name, category, material_type, color_hex, photo_path, pricing_unit, base_price, default_thickness_mm, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [id, input.name, input.category, input.material_type, input.color_hex, input.photo_path, input.pricing_unit, input.base_price, input.default_thickness_mm, now]
    );
    return { id, ...input, created_at: now };
  }, []);

  const updateMaterial = useCallback(async (id: string, input: MaterialInput): Promise<void> => {
    const db = await getDb();
    await db.execute(
      "UPDATE materials SET name=$1, category=$2, material_type=$3, color_hex=$4, photo_path=$5, pricing_unit=$6, base_price=$7, default_thickness_mm=$8 WHERE id=$9",
      [input.name, input.category, input.material_type, input.color_hex, input.photo_path, input.pricing_unit, input.base_price, input.default_thickness_mm, id]
    );
  }, []);

  const deleteMaterial = useCallback(async (id: string): Promise<void> => {
    const db = await getDb();
    await db.execute("DELETE FROM materials WHERE id=$1", [id]);
  }, []);

  /** Otwiera dialog wyboru pliku, kopiuje do plexylibrary/ i zwraca pełną ścieżkę. */
  const pickAndCopyPhoto = useCallback(async (): Promise<string | null> => {
    const filePath = await open({
      multiple: false,
      filters: [{ name: "Zdjęcie", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (!filePath || typeof filePath !== "string") return null;
    const destPath = await invoke<string>("copy_material_photo", { sourcePath: filePath });
    return destPath;
  }, []);

  /** Zwraca base64 data URL zdjęcia do wyświetlenia w <img>. */
  const getPhotoDataUrl = useCallback(async (photoPath: string): Promise<string> => {
    return invoke<string>("get_material_photo", { path: photoPath });
  }, []);

  return {
    loadMaterials,
    createMaterial,
    updateMaterial,
    deleteMaterial,
    pickAndCopyPhoto,
    getPhotoDataUrl,
  };
}

export function useCuttingRates() {
  const loadRates = useCallback(async (materialId: string): Promise<CuttingRate[]> => {
    const db = await getDb();
    return db.select<CuttingRate[]>(
      "SELECT * FROM cutting_rates WHERE material_id=$1 ORDER BY thickness_mm ASC",
      [materialId]
    );
  }, []);

  const upsertRate = useCallback(
    async (materialId: string, thicknessMm: number, pricePerM: number): Promise<CuttingRate> => {
      const db = await getDb();
      const id = crypto.randomUUID();
      await db.execute(
        `INSERT INTO cutting_rates (id, material_id, thickness_mm, price_per_m)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT(material_id, thickness_mm) DO UPDATE SET price_per_m=$4`,
        [id, materialId, thicknessMm, pricePerM]
      );
      const rows = await db.select<CuttingRate[]>(
        "SELECT * FROM cutting_rates WHERE material_id=$1 AND thickness_mm=$2",
        [materialId, thicknessMm]
      );
      return rows[0];
    },
    []
  );

  const deleteRate = useCallback(async (id: string): Promise<void> => {
    const db = await getDb();
    await db.execute("DELETE FROM cutting_rates WHERE id=$1", [id]);
  }, []);

  return { loadRates, upsertRate, deleteRate };
}
