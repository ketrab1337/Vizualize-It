import { SVG } from "@svgdotjs/svg.js";
import type { NodeOverride } from "../types";

export const CUSTOM_ATTRS = [
  "data-material",
  "data-color",
] as const;
export type CustomAttr = (typeof CUSTOM_ATTRS)[number];

export function patchSvgLayerState(
  svgString: string,
  items: Array<{ id: string; locked: boolean; visible: boolean }>
): string {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  items.forEach(({ id, locked, visible }) => {
    const el = doc.querySelector(`#${CSS.escape(id)}`);
    if (!el) return;
    if (locked) el.setAttribute("data-locked", "1");
    else el.removeAttribute("data-locked");
    if (!visible) el.setAttribute("data-hidden", "1");
    else el.removeAttribute("data-hidden");
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function updateSvgWithOverrides(
  svgString: string,
  overrides: Record<string, NodeOverride>
): string {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  const draw = SVG(doc.documentElement as unknown as SVGSVGElement);

  Object.entries(overrides).forEach(([nodeId, override]) => {
    const el = draw.findOne(`#${CSS.escape(nodeId)}`);
    if (!el) return;

    if (override.fill && override.fill !== "none" && override.fill !== "inherit") {
      el.attr("fill", override.fill);
    }
    el.attr("data-color", override.fill || null);
    el.attr("data-material", override.materialId || null);
    el.attr("data-thickness-mm", override.thicknessMm != null ? String(override.thicknessMm) : null);
    el.attr("data-quantity", override.quantity != null ? String(override.quantity) : null);
    el.attr("data-led-length-m", override.ledLengthM != null ? String(override.ledLengthM) : null);
    el.attr("data-led-price-per-m", override.ledPricePerM != null ? String(override.ledPricePerM) : null);
    el.attr("data-has-power-supply", override.hasPowerSupply ? "1" : null);
    el.attr("data-power-supply-price", override.powerSupplyPrice != null ? String(override.powerSupplyPrice) : null);
    el.attr("data-role", override.role || null);
    el.attr("data-led-backlit", override.ledBacklit ? "1" : null);
    el.attr("data-led-frontlit", override.ledFrontlit ? "1" : null);
    el.attr("data-has-tape", override.hasTape ? "1" : null);
    el.attr("data-cutout-backing", override.cutoutBackingId || null);
  });

  return new XMLSerializer().serializeToString(doc.documentElement);
}
