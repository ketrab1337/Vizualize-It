import type { NodeOverride, SignElement, Material } from "../types";

/**
 * Buduje listę elementów szyldu z nodeOverrides + materials.
 *
 * @param labels opcjonalna mapa nodeId → etykieta widoczna na eksporcie kanwy
 *   (np. dorysowana etykieta "litera_A"). Jeśli podana, używana jako `label`.
 *   Inaczej label = nodeId.
 */
export function buildElements(
  nodeOverrides: Record<string, NodeOverride>,
  materials: Material[],
  labels?: Record<string, string>
): SignElement[] {
  return Object.entries(nodeOverrides).map(([nodeId, override]) => {
    const material = override.materialId
      ? (materials.find((m) => m.id === override.materialId) ?? null)
      : null;
    // Rola "distance" jest implikowana przez kategorię materiału — user nie musi
    // jej wybierać ręcznie dla dystansów. Pozostałe role wybiera w ElementPanel.
    const effectiveRole = override.role
      ?? (material?.category === "dystans" ? "distance" : null);
    // Grubość: override > default_thickness_mm materiału > null.
    const thicknessMm = override.thicknessMm ?? material?.default_thickness_mm ?? null;
    return {
      id: nodeId,
      label: labels?.[nodeId] ?? nodeId,
      nodeId,
      material,
      colorHex: override.fill || null,
      colorName: override.fill || null,
      hasDistances: material?.category === "dystans",
      distanceMaterial: null,
      thicknessMm,
      role: effectiveRole,
      ledBacklit: override.ledBacklit === true,
      ledFrontlit: override.ledFrontlit === true,
      cutoutBackingId: override.cutoutBackingId ?? null,
    };
  });
}
