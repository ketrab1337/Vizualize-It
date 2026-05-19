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
    return {
      id: nodeId,
      label: labels?.[nodeId] ?? nodeId,
      nodeId,
      material,
      colorHex: override.fill || null,
      colorName: override.fill || null,
      hasDistances: material?.category === "dystans",
      distanceMaterial: null,
    };
  });
}
