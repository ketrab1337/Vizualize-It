import type { NodeOverride, SignElement, Material, MaterialCategory } from "../types";

/**
 * Buduje listę elementów szyldu z nodeOverrides + materials.
 *
 * @param categories lista kategorii z materialsStore — używana do sprawdzenia flagi
 *   `is_distance`. Domyślnie `[]` (bezpieczny fallback gdy store jeszcze nie wczytany).
 * @param labels opcjonalna mapa nodeId → etykieta widoczna na eksporcie kanwy.
 */
export function buildElements(
  nodeOverrides: Record<string, NodeOverride>,
  materials: Material[],
  categories: MaterialCategory[] = [],
  labels?: Record<string, string>
): SignElement[] {
  return Object.entries(nodeOverrides).map(([nodeId, override]) => {
    const material = override.materialId
      ? (materials.find((m) => m.id === override.materialId) ?? null)
      : null;
    const cat = material ? categories.find((c) => c.slug === material.category) : null;
    const isDistance = cat?.is_distance === 1;
    // Rola "distance" jest implikowana przez flagę is_distance kategorii — user nie musi
    // jej wybierać ręcznie dla dystansów. Pozostałe role wybiera w ElementPanel.
    const effectiveRole = override.role ?? (isDistance ? "distance" : null);
    // Grubość: override > default_thickness_mm materiału > null.
    const thicknessMm = override.thicknessMm ?? material?.default_thickness_mm ?? null;
    return {
      id: nodeId,
      label: labels?.[nodeId] ?? nodeId,
      nodeId,
      material,
      colorHex: override.fill || null,
      colorName: override.fill || null,
      hasDistances: isDistance,
      distanceMaterial: null,
      thicknessMm,
      role: effectiveRole,
      ledBacklit: override.ledBacklit === true,
      ledFrontlit: override.ledFrontlit === true,
      cutoutBackingId: override.cutoutBackingId ?? null,
    };
  });
}
