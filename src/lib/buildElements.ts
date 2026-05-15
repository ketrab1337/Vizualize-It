import type { NodeOverride, SignElement, Material } from "../types";

export function buildElements(
  nodeOverrides: Record<string, NodeOverride>,
  materials: Material[]
): SignElement[] {
  return Object.entries(nodeOverrides).map(([nodeId, override]) => {
    const material = override.materialId
      ? (materials.find((m) => m.id === override.materialId) ?? null)
      : null;
    return {
      id: nodeId,
      label: nodeId,
      nodeId,
      material,
      colorHex: override.fill || null,
      colorName: override.fill || null,
      hasDistances: material?.category === "dystans",
      distanceMaterial: null,
    };
  });
}
