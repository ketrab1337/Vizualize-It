import { useMemo } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useMaterialsStore } from "../stores/materialsStore";
import { calculatePricing, type PricingSummary } from "../lib/pricing";
import { buildElements } from "../lib/buildElements";

export function usePricing(): PricingSummary {
  const { nodeOverrides, boundsPerElement, ledConfig, parentMap } = useEditorStore();
  const { materials, globalCuttingRates } = useMaterialsStore();

  const labels = useMemo(() => {
    const els = buildElements(nodeOverrides, materials);
    return Object.fromEntries(els.map((el) => [el.nodeId, el.label]));
  }, [nodeOverrides, materials]);

  return useMemo(
    () => calculatePricing(nodeOverrides, boundsPerElement, materials, globalCuttingRates, labels, ledConfig, parentMap),
    [nodeOverrides, boundsPerElement, materials, globalCuttingRates, labels, ledConfig, parentMap]
  );
}
