import { useMemo } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useMaterialsStore } from "../stores/materialsStore";
import { calculatePricing, isLedCategory, type PricingSummary } from "../lib/pricing";
import { buildElements } from "../lib/buildElements";

export function usePricing(): PricingSummary {
  const { nodeOverrides, boundsPerElement, ledConfig, parentMap, tapeBoundsMm } = useEditorStore();
  const { materials, globalCuttingRates, categories } = useMaterialsStore();

  const labels = useMemo(() => {
    const els = buildElements(nodeOverrides, materials);
    return Object.fromEntries(els.map((el) => [el.nodeId, el.label]));
  }, [nodeOverrides, materials]);

  // Kategorie LED — elementy z takim materiałem pomijane w wycenie (LED liczony z ledConfig).
  const ledCategorySlugs = useMemo(
    () => new Set(categories.filter(isLedCategory).map((c) => c.slug)),
    [categories]
  );

  return useMemo(
    () => calculatePricing(nodeOverrides, boundsPerElement, materials, globalCuttingRates, labels, ledConfig, parentMap, ledCategorySlugs, tapeBoundsMm),
    [nodeOverrides, boundsPerElement, materials, globalCuttingRates, labels, ledConfig, parentMap, ledCategorySlugs, tapeBoundsMm]
  );
}
