import { useMemo } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useMaterialsStore } from "../stores/materialsStore";
import { calculatePricing, type PricingSummary } from "../lib/pricing";

export function usePricing(): PricingSummary {
  const { nodeOverrides, boundsPerElement } = useEditorStore();
  const { materials, globalCuttingRates } = useMaterialsStore();

  const labels = useMemo(
    () => Object.fromEntries(Object.keys(nodeOverrides).map((id) => [id, id])),
    [nodeOverrides]
  );

  return useMemo(
    () => calculatePricing(nodeOverrides, boundsPerElement, materials, globalCuttingRates, labels),
    [nodeOverrides, boundsPerElement, materials, globalCuttingRates, labels]
  );
}
