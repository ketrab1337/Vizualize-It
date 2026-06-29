import type { NodeOverride, Material, GlobalCuttingRate } from "../types";
import type { SelectedItemBounds, LedProjectConfig } from "../stores/editorStore";

export interface ElementCostItem {
  nodeId: string;
  label: string;
  lineType: "material" | "dystans" | "led" | "tape";
  /** Kubełek podsumowania PDF: materiał / cięcie / dystans / led / tape — żeby podsumy zgadzały się z wierszami. */
  costKind: "material" | "cutting" | "dystans" | "led" | "tape";
  materialName: string | null;
  /** Slug kategorii materiału (pleksa/dibond/...) — do pokazania typu w podsumowaniu PDF. */
  category: string | null;
  thicknessMm: number | null;
  areaCm2: number | null;
  pathLengthM: number | null;
  quantity: number | null;
  unitCost: number;
  totalCost: number;
  /** Koszt tej pozycji liczony po cenie WYCENOWEJ materiału (quote_price ?? base_price). */
  quoteUnitCost: number;
  quoteTotalCost: number;
}

export interface GroupedCostItem {
  key: string;
  lineType: "material" | "dystans" | "led" | "tape";
  costKind: "material" | "cutting" | "dystans" | "led" | "tape";
  materialName: string | null;
  category: string | null;
  thicknessMm: number | null;
  unitCost: number;
  totalCost: number;
  /** Suma cen wycenowych w grupie (do wyceny dla klienta). */
  quoteUnitCost: number;
  quoteTotalCost: number;
  totalAreaCm2: number | null;
  totalPathLengthM: number | null;
  totalQuantity: number | null;
  elements: ElementCostItem[];
}

export interface PricingSummary {
  items: ElementCostItem[];
  groupedItems: GroupedCostItem[];
  totalMaterial: number;
  /** Dystanse (per sztuka) — osobno od materiałów płytowych, by „Materiały" = same plexy. */
  totalDystans: number;
  totalCutting: number;
  totalLed: number;
  /** Taśma (oklejanie) — TYLKO koszty własne, nie wchodzi do quoteGrandTotal/wyceny. */
  totalTape: number;
  /** Suma kosztów WŁASNYCH (po cenach zakupu). */
  grandTotal: number;
  /** Suma po cenach WYCENOWYCH (przed marżą i wysyłką) — baza wyceny dla klienta. */
  quoteGrandTotal: number;
}

/**
 * Czy kategoria materiału to LED (po slug/nazwie). LED rozliczamy WYŁĄCZNIE przez
 * `ledConfig` (projekt-poziom) — nie per element — więc materiały LED przypisane do
 * elementu są pomijane w pętli materiałów (inaczej LED wpadałby i do „Materiały", i do „LED").
 */
export function isLedCategory(cat: { slug: string; name: string }): boolean {
  const hay = (cat.slug + " " + cat.name).toLowerCase();
  return hay.includes("led");
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
        costKind: item.costKind,
        materialName: item.materialName,
        category: item.category,
        thicknessMm: item.thicknessMm,
        unitCost: item.unitCost,
        totalCost: 0,
        quoteUnitCost: item.quoteUnitCost,
        quoteTotalCost: 0,
        totalAreaCm2: null,
        totalPathLengthM: null,
        totalQuantity: null,
        elements: [],
      });
    }
    const g = groups.get(key)!;
    g.totalCost += item.totalCost;
    g.quoteTotalCost += item.quoteTotalCost;
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
  parentMap: Record<string, string> = {},
  /** Slugi kategorii LED — elementy z takim materiałem są pomijane (LED liczony tylko z ledConfig). */
  ledCategorySlugs: Set<string> = new Set(),
  /** Wymiary wspólnego prostokąta oklejanego taśmą (mm) — z Canvas. null = brak taśmy. */
  tapeBoundsMm: { widthMm: number; heightMm: number } | null = null
): PricingSummary {
  const items: ElementCostItem[] = [];
  let totalMaterial = 0;
  let totalDystans = 0;
  let totalCutting = 0;
  let totalLed = 0;
  let totalTape = 0;

  // ── LED (projekt-poziom) ──
  if (ledConfig.materialId && ledConfig.lengthM && ledConfig.lengthM > 0) {
    const ledMaterial = materials.find((m) => m.id === ledConfig.materialId);
    if (ledMaterial) {
      const ledUnit = ledMaterial.base_price ?? 0;
      const ledQuoteUnit = ledMaterial.quote_price ?? ledMaterial.base_price ?? 0;
      const ledCost = ledConfig.lengthM * ledUnit;
      items.push({
        nodeId: "__led__",
        label: ledMaterial.name,
        lineType: "led",
        costKind: "led",
        materialName: ledMaterial.name,
        category: ledMaterial.category,
        thicknessMm: null,
        areaCm2: null,
        pathLengthM: ledConfig.lengthM,
        quantity: null,
        unitCost: ledUnit,
        totalCost: ledCost,
        quoteUnitCost: ledQuoteUnit,
        quoteTotalCost: ledConfig.lengthM * ledQuoteUnit,
      });
      totalLed += ledCost;

      // Zasilacz — osobna pozycja w podsumowaniu (nie doliczany do linii taśmy LED)
      if (ledConfig.hasPowerSupply) {
        const supplyCost = ledConfig.powerSupplyPrice ?? 0;
        items.push({
          nodeId: "__led_psu__",
          label: "Zasilacz LED",
          lineType: "led",
          costKind: "led",
          materialName: "Zasilacz",
          category: null,
          thicknessMm: null,
          areaCm2: null,
          pathLengthM: null,
          quantity: 1,
          unitCost: supplyCost,
          totalCost: supplyCost,
          // Zasilacz nie ma osobnej ceny wycenowej — w wycenie wchodzi po koszcie.
          quoteUnitCost: supplyCost,
          quoteTotalCost: supplyCost,
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

    // LED rozliczane WYŁĄCZNIE przez ledConfig (projekt-poziom). Element z materiałem
    // LED — albo dokładnie tym wybranym jako taśma projektu — NIE jest liczony jako
    // materiał, by LED nie wpadał jednocześnie do „Materiały" i do „LED".
    if (ledCategorySlugs.has(material.category) || material.id === ledConfig.materialId) continue;

    const thickness = resolveThickness(override, material);

    // ── Dystans — liczony od sztuki ──
    if (material.pricing_unit === "per_piece") {
      const qty = override.quantity ?? 1;
      const unitCost = material.base_price ?? 0;
      const quoteUnitCost = material.quote_price ?? material.base_price ?? 0;
      const total = qty * unitCost;
      items.push({
        nodeId,
        label,
        lineType: "dystans",
        costKind: "dystans",
        materialName: material.name,
        category: material.category,
        thicknessMm: null,
        areaCm2: null,
        pathLengthM: null,
        quantity: qty,
        unitCost,
        totalCost: total,
        quoteUnitCost,
        quoteTotalCost: qty * quoteUnitCost,
      });
      totalDystans += total;
      continue;
    }

    // ── Materiał per m² ──
    if (material.pricing_unit === "per_m2") {
      const areaMm2 = bounds?.areaMm2 ?? 0;
      const areaM2 = areaMm2 / 1_000_000;
      const areaCm2 = areaMm2 / 100;
      const unitCost = material.base_price ?? 0;
      const quoteUnitCost = material.quote_price ?? material.base_price ?? 0;
      const total = areaM2 * unitCost;
      items.push({
        nodeId,
        label,
        lineType: "material",
        costKind: "material",
        materialName: material.name,
        category: material.category,
        thicknessMm: thickness,
        areaCm2,
        pathLengthM: null,
        quantity: null,
        unitCost,
        totalCost: total,
        quoteUnitCost,
        quoteTotalCost: areaM2 * quoteUnitCost,
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
            costKind: "cutting",
            materialName: `${material.name} — cięcie`,
            category: material.category,
            thicknessMm: thickness,
            areaCm2: null,
            pathLengthM,
            quantity: null,
            unitCost: cuttingRate,
            totalCost: cuttingTotal,
            // Cięcie nie ma osobnej ceny wycenowej (stawka globalna) — w wycenie po koszcie.
            quoteUnitCost: cuttingRate,
            quoteTotalCost: cuttingTotal,
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
      const globalRate = findGlobalCuttingRate(material.category, thickness, globalCuttingRates);
      const cuttingRate = globalRate ?? material.base_price ?? 0;
      // Quote: stawka globalna nie ma wariantu wycenowego → po koszcie. Gdy ceną jest
      // sam materiał (brak stawki globalnej) → użyj quote_price materiału.
      const quoteRate = globalRate ?? material.quote_price ?? material.base_price ?? 0;
      const total = pathLengthM * cuttingRate;
      items.push({
        nodeId,
        label,
        lineType: "material",
        costKind: "cutting",
        materialName: material.name,
        category: material.category,
        thicknessMm: thickness,
        areaCm2,
        pathLengthM,
        quantity: null,
        unitCost: cuttingRate,
        totalCost: total,
        quoteUnitCost: quoteRate,
        quoteTotalCost: pathLengthM * quoteRate,
      });
      totalCutting += total;
      continue;
    }
  }

  // ── Taśma (oklejanie) — WSPÓLNY prostokąt otaczający oklejane elementy ──
  // Liczona z bounding boxa (szer.×wys.), NIE z pól liter. Materiał wykryty po nazwie
  // „Taśma". TYLKO koszty własne — quoteTotalCost=0, więc nie wchodzi do wyceny dla klienta.
  if (tapeBoundsMm && tapeBoundsMm.widthMm > 0 && tapeBoundsMm.heightMm > 0) {
    // Materiał taśmy po nazwie „taśma", ale NIE z kategorii LED — taśmy LED (np. „Taśma LED")
    // też zawierają to słowo, a są rozliczane jako LED, nie jako oklejanie.
    const tapeMaterial = materials.find(
      (m) => m.name.toLowerCase().includes("taśma") && !ledCategorySlugs.has(m.category)
    );
    if (tapeMaterial) {
      const tapeAreaM2 = (tapeBoundsMm.widthMm / 1000) * (tapeBoundsMm.heightMm / 1000);
      const tapePrice = tapeMaterial.base_price ?? 0;
      const tapeCost = tapeAreaM2 * tapePrice;
      if (tapeCost > 0) {
        items.push({
          nodeId: "__tape__",
          label: tapeMaterial.name,
          lineType: "tape",
          costKind: "tape",
          materialName: tapeMaterial.name,
          category: tapeMaterial.category,
          thicknessMm: null,
          areaCm2: tapeBoundsMm.widthMm * tapeBoundsMm.heightMm / 100,
          pathLengthM: null,
          quantity: null,
          unitCost: tapePrice,
          totalCost: tapeCost,
          // Taśma NIE wchodzi do wyceny dla klienta — tylko koszty własne.
          quoteUnitCost: 0,
          quoteTotalCost: 0,
        });
        totalTape += tapeCost;
      }
    }
  }

  const groupedItems = buildGroupedItems(items);
  const grandTotal = totalMaterial + totalDystans + totalCutting + totalLed + totalTape;
  const quoteGrandTotal = items.reduce((sum, i) => sum + i.quoteTotalCost, 0);
  return { items, groupedItems, totalMaterial, totalDystans, totalCutting, totalLed, totalTape, grandTotal, quoteGrandTotal };
}
