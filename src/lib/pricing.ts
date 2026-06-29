import type { NodeOverride, Material, GlobalCuttingRate } from "../types";
import type { SelectedItemBounds, LedProjectConfig } from "../stores/editorStore";

export interface ElementCostItem {
  nodeId: string;
  label: string;
  lineType: "material" | "dystans" | "led";
  materialName: string | null;
  /** Slug kategorii materiału (pleksa/dibond/...) — do pokazania typu w podsumowaniu PDF. */
  category: string | null;
  thicknessMm: number | null;
  areaCm2: number | null;
  pathLengthM: number | null;
  quantity: number | null;
  unitCost: number;
  totalCost: number;
}

export interface GroupedCostItem {
  key: string;
  lineType: "material" | "dystans" | "led";
  materialName: string | null;
  category: string | null;
  thicknessMm: number | null;
  unitCost: number;
  totalCost: number;
  totalAreaCm2: number | null;
  totalPathLengthM: number | null;
  totalQuantity: number | null;
  elements: ElementCostItem[];
}

export interface PricingSummary {
  items: ElementCostItem[];
  groupedItems: GroupedCostItem[];
  totalMaterial: number;
  totalCutting: number;
  totalLed: number;
  grandTotal: number;
}

function resolveThickness(override: NodeOverride, material: Material | null): number | null {
  if (override.thicknessMm != null) return override.thicknessMm;
  return material?.default_thickness_mm ?? null;
}

function findGlobalCuttingRate(
  category: string,
  thicknessMm: number | null,
  rates: GlobalCuttingRate[]
): number | null {
  const catRates = rates.filter((r) => r.category === category);
  if (catRates.length === 0) return null;
  if (thicknessMm != null) {
    const exact = catRates.find((r) => r.thickness_mm === thicknessMm);
    if (exact) return exact.price_per_m;
  }
  catRates.sort((a, b) => a.thickness_mm - b.thickness_mm);
  return catRates[0].price_per_m;
}

/** Zwraca true gdy którykolwiek przodek nodeId ma przypisany materiał. */
function hasAncestorWithMaterial(
  nodeId: string,
  parentMap: Record<string, string>,
  overrides: Record<string, NodeOverride>
): boolean {
  let current = parentMap[nodeId];
  while (current) {
    if (overrides[current]?.materialId) return true;
    current = parentMap[current];
  }
  return false;
}

function buildGroupedItems(items: ElementCostItem[]): GroupedCostItem[] {
  const groups = new Map<string, GroupedCostItem>();
  for (const item of items) {
    const key = `${item.lineType}__${item.materialName ?? ""}__${item.thicknessMm ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        lineType: item.lineType,
        materialName: item.materialName,
        category: item.category,
        thicknessMm: item.thicknessMm,
        unitCost: item.unitCost,
        totalCost: 0,
        totalAreaCm2: null,
        totalPathLengthM: null,
        totalQuantity: null,
        elements: [],
      });
    }
    const g = groups.get(key)!;
    g.totalCost += item.totalCost;
    g.elements.push(item);
    if (item.areaCm2 != null) g.totalAreaCm2 = (g.totalAreaCm2 ?? 0) + item.areaCm2;
    if (item.pathLengthM != null) g.totalPathLengthM = (g.totalPathLengthM ?? 0) + item.pathLengthM;
    if (item.quantity != null) g.totalQuantity = (g.totalQuantity ?? 0) + item.quantity;
  }
  return [...groups.values()];
}

export function calculatePricing(
  nodeOverrides: Record<string, NodeOverride>,
  boundsPerElement: Record<string, SelectedItemBounds>,
  materials: Material[],
  globalCuttingRates: GlobalCuttingRate[],
  labels: Record<string, string>,
  ledConfig: LedProjectConfig,
  parentMap: Record<string, string> = {}
): PricingSummary {
  const items: ElementCostItem[] = [];
  let totalMaterial = 0;
  let totalCutting = 0;
  let totalLed = 0;

  // ── LED (projekt-poziom) ──
  if (ledConfig.materialId && ledConfig.lengthM && ledConfig.lengthM > 0) {
    const ledMaterial = materials.find((m) => m.id === ledConfig.materialId);
    if (ledMaterial) {
      const ledCost = ledConfig.lengthM * (ledMaterial.base_price ?? 0);
      items.push({
        nodeId: "__led__",
        label: ledMaterial.name,
        lineType: "led",
        materialName: ledMaterial.name,
        category: ledMaterial.category,
        thicknessMm: null,
        areaCm2: null,
        pathLengthM: ledConfig.lengthM,
        quantity: null,
        unitCost: ledMaterial.base_price ?? 0,
        totalCost: ledCost,
      });
      totalLed += ledCost;

      // Zasilacz — osobna pozycja w podsumowaniu (nie doliczany do linii taśmy LED)
      if (ledConfig.hasPowerSupply) {
        const supplyCost = ledConfig.powerSupplyPrice ?? 0;
        items.push({
          nodeId: "__led_psu__",
          label: "Zasilacz LED",
          lineType: "led",
          materialName: "Zasilacz",
          category: null,
          thicknessMm: null,
          areaCm2: null,
          pathLengthM: null,
          quantity: 1,
          unitCost: supplyCost,
          totalCost: supplyCost,
        });
        totalLed += supplyCost;
      }
    }
  }

  for (const [nodeId, override] of Object.entries(nodeOverrides)) {
    // Pomiń element jeśli którykolwiek jego przodek ma już przypisany materiał —
    // zapobiega podwójnemu liczeniu gdy grupa i jej dzieci mają override jednocześnie.
    if (hasAncestorWithMaterial(nodeId, parentMap, nodeOverrides)) continue;

    const material = override.materialId
      ? (materials.find((m) => m.id === override.materialId) ?? null)
      : null;
    const bounds = boundsPerElement[nodeId] ?? null;
    const label = labels[nodeId] ?? nodeId;

    if (!material) continue;

    const thickness = resolveThickness(override, material);

    // ── Dystans — liczony od sztuki ──
    if (material.pricing_unit === "per_piece") {
      const qty = override.quantity ?? 1;
      const unitCost = material.base_price ?? 0;
      const total = qty * unitCost;
      items.push({
        nodeId,
        label,
        lineType: "dystans",
        materialName: material.name,
        category: material.category,
        thicknessMm: null,
        areaCm2: null,
        pathLengthM: null,
        quantity: qty,
        unitCost,
        totalCost: total,
      });
      totalMaterial += total;
      continue;
    }

    // ── Materiał per m² ──
    if (material.pricing_unit === "per_m2") {
      const areaMm2 = bounds?.areaMm2 ?? 0;
      const areaM2 = areaMm2 / 1_000_000;
      const areaCm2 = areaMm2 / 100;
      const total = areaM2 * (material.base_price ?? 0);
      items.push({
        nodeId,
        label,
        lineType: "material",
        materialName: material.name,
        category: material.category,
        thicknessMm: thickness,
        areaCm2,
        pathLengthM: null,
        quantity: null,
        unitCost: material.base_price ?? 0,
        totalCost: total,
      });
      totalMaterial += total;

      // Koszt cięcia z globalnych stawek — osobna linia jeśli wybrano grubość i istnieją stawki
      const cuttingRate = thickness != null
        ? findGlobalCuttingRate(material.category, thickness, globalCuttingRates)
        : null;
      if (cuttingRate != null && bounds) {
        const pathLengthM = bounds.pathLengthMm / 1000;
        if (pathLengthM > 0) {
          const cuttingTotal = pathLengthM * cuttingRate;
          items.push({
            nodeId,
            label,
            lineType: "material",
            materialName: `${material.name} — cięcie`,
            category: material.category,
            thicknessMm: thickness,
            areaCm2: null,
            pathLengthM,
            quantity: null,
            unitCost: cuttingRate,
            totalCost: cuttingTotal,
          });
          totalCutting += cuttingTotal;
        }
      }
      continue;
    }

    // ── Materiał per mb cięcia ──
    if (material.pricing_unit === "per_mb_cut") {
      const pathLengthMm = bounds?.pathLengthMm ?? 0;
      const pathLengthM = pathLengthMm / 1000;
      const areaCm2 = bounds ? bounds.areaMm2 / 100 : null;
      const cuttingRate =
        findGlobalCuttingRate(material.category, thickness, globalCuttingRates) ??
        material.base_price ?? 0;
      const total = pathLengthM * cuttingRate;
      items.push({
        nodeId,
        label,
        lineType: "material",
        materialName: material.name,
        category: material.category,
        thicknessMm: thickness,
        areaCm2,
        pathLengthM,
        quantity: null,
        unitCost: cuttingRate,
        totalCost: total,
      });
      totalCutting += total;
      continue;
    }
  }

  const groupedItems = buildGroupedItems(items);
  const grandTotal = totalMaterial + totalCutting + totalLed;
  return { items, groupedItems, totalMaterial, totalCutting, totalLed, grandTotal };
}
