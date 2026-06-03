import type { SignConfig, CameraConfig, TimeOfDay, Material, SignElement, LedConfig } from "../types";
import { PRODUCT_TYPE_PRESETS } from "../types";

const PRODUCT_TYPE_NOUN_EN: Record<string, string> = {
  szyld: "sign",
  tabliczka_informacyjna: "information plaque",
  numer_na_dom: "house number sign",
  tablica_weselna: "wedding board",
  dekoracja_scienna: "wall decoration",
  litery_3d: "3D letters",
};

export function getProductNoun(productType: string | null | undefined): {
  nominative: string;
  genitive: string;
  en: string;
} {
  if (!productType) return { nominative: "szyld", genitive: "szyldu", en: "sign" };
  const preset = PRODUCT_TYPE_PRESETS.find((p) => p.id === productType);
  const en = PRODUCT_TYPE_NOUN_EN[productType] ?? productType;
  if (preset) return { nominative: preset.nounNominative, genitive: preset.nounGenitive, en };
  return { nominative: productType, genitive: productType, en: productType };
}

export interface VisualInputs {
  hasBackground: boolean;
  hasSvg: boolean;
  referenceImageCount?: number;
  referenceDescriptions?: string[];
  svgTexts?: string[];
}

export interface PresetEntry {
  id: string;
  label: string;
  text: string;
  anchor?: string;
}

export interface AssembleOptions {
  cameraDirty?: boolean;
  /** Preset texts without anchors — appended at end (legacy). */
  presetTexts?: string[];
  presets?: PresetEntry[];
  timeOfDayPreset?: { text: string; anchor?: string } | null;
  targetModel?: "gemini" | "openai";
  /** True when SVG was perspective-warped to match the wall quad before compositing. */
  hasPerspective?: boolean;
}

function imgLabel(n: number): string {
  return `Image ${n}`;
}

export type PromptItem =
  | { kind: "fragment"; id: string; text: string }
  | { kind: "preset"; presetId: string; label: string; text: string };

export const FRAGMENT_IDS = {
  TASK: "task",
  SVG_TEXTS: "svg-texts",
  MATERIALS: "materials",
  LAYERS: "layers",
  DISTANCE: "distance",
  LED_BACKLIT: "led-backlit",
  LED_FRONTLIT: "led-frontlit",
  CAMERA: "camera",
  TIME_OF_DAY: "time-of-day",
} as const;

const MATERIAL_TYPE_DESCRIPTIONS: Record<string, string> = {
  matowa: "matte acrylic panel, smooth velvety finish, diffuse light, no specular highlights",
  mleczna: "frosted/opal acrylic panel, semi-transparent, soft diffused light, gentle internal glow",
  polysk: "high-gloss acrylic panel, polished smooth surface, sharp specular highlights and crisp reflections",
  lustro: "mirror-finish acrylic panel, fully reflective, reflects surrounding environment",
};

const MATERIAL_CATEGORY_HINTS: Record<string, string> = {
  pleksa: "acrylic (plexiglass) panel",
  dibond: "Dibond panel — brushed aluminum composite",
  hdf: "HDF panel — hard fiberboard with smooth lacquered surface",
  metal: "polished metal panel with subtle brushed texture",
  dystans: "polished metal standoff mounts",
  inne: "rigid structural sign material",
};

/**
 * Maps material thickness in mm to a relative visual description.
 * AI models don't interpret mm as physical units — they react to proportions.
 * The relative descriptor is the primary signal; the mm value is a secondary hint.
 */
function describeThickness(thicknessMm: number | null): string | null {
  if (thicknessMm == null || thicknessMm <= 0) return null;
  if (thicknessMm < 5) return `thin profile (${thicknessMm}mm), subtle visible side edge`;
  if (thicknessMm < 15) return `medium thickness (${thicknessMm}mm), clearly visible side edge`;
  if (thicknessMm < 30) return `thick profile (${thicknessMm}mm), prominent 3D depth, wide visible side edge`;
  return `very thick profile (${thicknessMm}mm), dominant 3D depth, large visible side edge`;
}

function buildLayerStructure(
  elements: SignElement[],
  productNounEn: string
): string | null {
  const byRole: Record<string, SignElement[]> = {
    backplate: [], decoration: [], logo: [], text: [], distance: [], cutout: [],
  };
  for (const el of elements) {
    if (el.role) byRole[el.role]?.push(el);
  }
  const byNodeId = new Map(elements.map((el) => [el.nodeId, el]));
  const lines: string[] = [];
  const nn = productNounEn;

  if (byRole.distance.length > 0) {
    lines.push(
      `- Standoffs: the entire ${nn} is mounted on metal standoffs, offset from the wall by approx. 20–30 mm, casting a soft shadow on the wall behind it`
    );
  }
  if (byRole.backplate.length > 0) {
    const colors = [...new Set(byRole.backplate.map((e) => e.colorHex ?? "default"))].join(", ");
    lines.push(`- Base panel (backplate, deepest layer): SVG regions ${colors}, flat base panel`);
  }
  if (byRole.decoration.length > 0) {
    const colors = [...new Set(byRole.decoration.map((e) => e.colorHex ?? "default"))].join(", ");
    lines.push(
      `- Decorations (layer above backplate): SVG regions ${colors}, layered ON TOP of the backplate, slightly raised, casting a subtle shadow on the backplate below`
    );
  }
  if (byRole.logo.length > 0) {
    const colors = [...new Set(byRole.logo.map((e) => e.colorHex ?? "default"))].join(", ");
    lines.push(
      `- Logo (layer above backplate): SVG regions ${colors}, mounted ON the backplate as a raised spatial element, casting a visible shadow on the backplate below`
    );
  }
  if (byRole.text.length > 0) {
    const colors = [...new Set(byRole.text.map((e) => e.colorHex ?? "default"))].join(", ");
    lines.push(
      `- Text (top layer): SVG regions ${colors}, letters as SEPARATE raised elements mounted ON the backplate, casting clear shadows on the backplate below — pronounced letter depth clearly visible`
    );
  }
  if (byRole.cutout.length > 0) {
    for (const el of byRole.cutout) {
      const myColor = el.colorHex ?? "default";
      const backing = el.cutoutBackingId ? byNodeId.get(el.cutoutBackingId) : null;
      const backingColor = backing?.colorHex ?? "the layer below";
      lines.push(
        `- Cutout layer: SVG region ${myColor} is an acrylic panel layered ON another acrylic panel (${backingColor}) with PHYSICALLY CUT openings. ` +
        `Cut edges are sharp (laser-cut). Through the cutouts, the lower acrylic in color ${backingColor} is visible. ` +
        `The upper layer (${myColor}) has its own thickness — cutouts look like windows with visible side wall depth, slight shadow cast from cut edges onto the lower layer.`
      );
    }
  }

  if (lines.length === 0) return null;

  const countedRoles = elements.filter((el) => el.role && el.role !== "distance");
  const totalEls = countedRoles.length;
  const uniqueColors = new Set(
    countedRoles.map((el) => el.colorHex).filter((c): c is string => !!c)
  );
  const capNn = nn.charAt(0).toUpperCase() + nn.slice(1);
  const header =
    totalEls > 0
      ? `${capNn} layer structure (bottom to top, ${totalEls} element${totalEls === 1 ? "" : "s"} in ${uniqueColors.size} color${uniqueColors.size === 1 ? "" : "s"}):`
      : `${capNn} layer structure (bottom to top):`;
  return `${header}\n${lines.join("\n")}`;
}

function describeMaterial(m: Material): string {
  const surface = m.material_type ? MATERIAL_TYPE_DESCRIPTIONS[m.material_type] : null;
  const categoryHint = MATERIAL_CATEGORY_HINTS[m.category];
  return surface ?? categoryHint ?? "rigid structural sign material";
}

/**
 * Builds the material description for a single sign element.
 *
 * Two special cases:
 *  - mirror: the dominant visual effect is environmental reflection; hex acts as tint only
 *  - glossy: hex IS the material color; AI adds specular highlights on top
 * Everything else: hex is material color + surface description from material type.
 *
 * Reference photos removed — glossy/mirror acrylic photos contain reflections and
 * lighting artifacts that confuse the model. Pure hex + physical description is more reliable.
 */
function describeElementMaterial(
  m: Material,
  colorHex: string | null,
  thicknessMm: number | null,
  hasBackground: boolean
): string {
  const color = colorHex ?? "default";
  const thicknessDesc = describeThickness(thicknessMm);
  const thicknessSuffix = thicknessDesc ? `, ${thicknessDesc}` : "";
  const sceneRef = imgLabel(1);

  if (m.material_type === "lustro") {
    const reflectionDesc = hasBackground
      ? `reflecting the surroundings from ${sceneRef} (wall, ceiling, lights, furniture) — reflections consistent with the scene`
      : "with soft ambient light reflections, neutral studio background";
    const tintDesc = colorHex ? ` with a subtle ${color} tint` : "";
    return `SVG region ${color} → mirror-finish acrylic, fully reflective${tintDesc}, ${reflectionDesc}${thicknessSuffix} (surface is predominantly reflections, ${color} acts as tint only)`;
  }

  if (m.material_type === "polysk") {
    const reflectionDesc = hasBackground
      ? `sharp specular highlights and reflections matching the scene lighting from ${sceneRef}`
      : "sharp specular highlights, neutral studio lighting";
    return `SVG region ${color} → high-gloss acrylic, material color ${color}, polished smooth surface, ${reflectionDesc}${thicknessSuffix}`;
  }

  return `SVG region ${color} → ${describeMaterial(m)}, color ${color}${thicknessSuffix}`;
}

export function buildTimeOfDayPrompt(
  timeOfDay: TimeOfDay,
  ledActive: boolean,
  hasBackground: boolean = false,
  productNoun: { nominative: string; genitive: string; en: string } = { nominative: "szyld", genitive: "szyldu", en: "sign" }
): string {
  const nn = productNoun.en;
  const capNn = nn.charAt(0).toUpperCase() + nn.slice(1);
  switch (timeOfDay) {
    case "brak":
      return "";
    case "dzien":
      if (hasBackground) {
        return "Rendering style: bright natural daylight, sharp shadows consistent with the existing scene.";
      }
      return "Shot during daytime in full natural sunlight. Blue sky, sharp shadows, bright and high-contrast exposure.";
    case "wieczor":
      if (hasBackground) {
        return (
          "Rendering style: warm golden hour light. " +
          (ledActive
            ? `The ${nn}'s LED lighting is clearly visible and contrasts with the warm ambient light.`
            : "Soft warm ambient light consistent with the existing scene.")
        );
      }
      return (
        "Shot at dusk during golden hour. Sky in shades of orange, pink, and purple. Soft warm ambient lighting. " +
        (ledActive
          ? `The ${nn}'s illumination is clearly visible and contrasts against the darkening sky.`
          : `${capNn} lit by soft warm twilight.`)
      );
    case "noc":
      if (hasBackground) {
        return (
          "Rendering style: night, dark surroundings. " +
          (ledActive
            ? `The ${nn}'s LED lighting is the main light source — casting a soft glow on adjacent surfaces.`
            : "Subtle artificial light consistent with the existing scene.")
        );
      }
      return (
        "Night shot. Dark sky, artificial urban lighting — streetlights, window reflections. " +
        (ledActive
          ? `${capNn} intensely illuminated by LED, pronounced glow and halo of light around letters, reflections on wet pavement below.`
          : `${capNn} visible in street light, dark dramatic urban night surroundings.`)
      );
    case "wnetrze":
      // CRITICAL: when a background photo is present, it already defines the interior.
      // Adding "professional architectural arrangement" causes AI to generate a new scene.
      if (hasBackground) return "";
      return (
        `${capNn} mounted inside a room — office space, shop or representative entrance hall. ` +
        "Artificial ceiling lighting, neutral or warm interior light, clean architectural background."
      );
  }
}

/**
 * Imperative camera direction prompt.
 * Granularity: 15° steps for rotation, relative descriptors for forward/tilt.
 */
export function buildCameraPrompt(
  rotateDeg: CameraConfig["rotateDeg"],
  moveForward: CameraConfig["moveForward"],
  verticalTilt: CameraConfig["verticalTilt"]
): string {
  const parts: string[] = [];

  const absR = Math.abs(rotateDeg);
  if (absR >= 1) {
    const dir = rotateDeg > 0 ? "left" : "right";
    parts.push(`Rotate camera ${absR}° to the ${dir}.`);
  }

  if (moveForward >= 9) {
    parts.push("Move camera very close — extreme close-up.");
  } else if (moveForward >= 7) {
    parts.push("Move camera close — close-up shot.");
  } else if (moveForward >= 5) {
    parts.push("Close shot, camera slightly zoomed in.");
  } else if (moveForward >= 3) {
    parts.push("Medium camera distance.");
  } else if (moveForward >= 1) {
    parts.push("Wider camera distance, broader shot.");
  } else {
    parts.push("Camera far away, wide perspective.");
  }

  if (verticalTilt <= -0.7) {
    parts.push("Tilt camera strongly downward — bird's eye view.");
  } else if (verticalTilt <= -0.3) {
    parts.push("Tilt camera slightly downward.");
  } else if (verticalTilt >= 0.7) {
    parts.push("Tilt camera strongly upward — worm's eye view.");
  } else if (verticalTilt >= 0.3) {
    parts.push("Tilt camera slightly upward.");
  }

  return parts.join(" ");
}

/**
 * Builds the list of auto-generated prompt fragments (without presets).
 * Each fragment has a stable ID used for preset anchoring.
 */
export function assemblePromptFragments(
  config: SignConfig,
  visualInputs?: VisualInputs,
  options?: AssembleOptions
): Array<{ id: string; text: string }> {
  const fragments: Array<{ id: string; text: string }> = [];

  const CATEGORY_ORDER: Record<string, number> = {
    pleksa: 0, dibond: 1, hdf: 2, metal: 3, inne: 4, dystans: 5,
  };

  const elementsWithMaterial = config.elements
    .filter((el) => el.material)
    .sort((a, b) => {
      const oa = CATEGORY_ORDER[a.material!.category] ?? 4;
      const ob = CATEGORY_ORDER[b.material!.category] ?? 4;
      return oa - ob;
    });

  const productNoun = getProductNoun(config.productType);
  const nn = productNoun.en;
  const capNn = nn.charAt(0).toUpperCase() + nn.slice(1);

  if (visualInputs) {
    const imgRefs: string[] = [];
    let imgIdx = 1;

    if (visualInputs.hasSvg && visualInputs.hasBackground) {
      const sceneLabel = imgLabel(imgIdx);
      const perspectiveNote = options?.hasPerspective
        ? `The SVG overlay is already perspective-warped to match the wall plane — preserve this perspective exactly as shown in ${sceneLabel}.`
        : `The ${nn} is mounted flat on the wall — render it with correct perspective matching the wall visible in ${sceneLabel}.`;
      imgRefs.push(
        `TASK: photorealistic ${nn} visualization (mockup). ` +
        `${sceneLabel} is a REAL PHOTO of an interior with a semi-transparent SVG overlay showing where the ${nn} should be placed, its shape, and the color assigned to each region.` +
        `\n\n` +
        `Render an image identical to ${sceneLabel}, but with the SVG overlay replaced by a photorealistic, three-dimensional render of the ${nn}. ` +
        `The rest of the scene remains IDENTICAL (pixel-perfect): wall, ceiling, floor, furniture, people, plants, lighting, perspective, camera angle.` +
        `\n\n` +
        `The ${nn} is a THREE-DIMENSIONAL physical object mounted on the wall: it has depth, casts natural shadows, realistically reflects the scene's light. ` +
        `${perspectiveNote} ` +
        `The color map on the SVG overlay shows the EXACT color assignment for each region — every region keeps its position, shape and color (only the form changes: from flat shape to photorealistic material).`
      );
      imgIdx++;
    } else if (visualInputs.hasSvg) {
      const sceneLabel = imgLabel(imgIdx);
      imgRefs.push(
        `TASK: photorealistic ${nn} render. ` +
        `${sceneLabel} is a schematic SVG design (flat colored shapes showing the ${nn} layout). ` +
        `Render it as a photorealistic ${nn} made from the materials described below, with natural studio lighting and a clean neutral background.`
      );
      imgIdx++;
    } else if (visualInputs.hasBackground) {
      const sceneLabel = imgLabel(imgIdx);
      imgRefs.push(
        `TASK: add a ${nn} to an existing photo. ` +
        `${sceneLabel} is a REAL PHOTO of an interior wall. ` +
        `Keep the entire scene exactly as shown — same wall, ceiling, floor, furniture, lighting and shadows. ` +
        `Add the ${nn} described below onto the wall — with natural shadows matching the existing lighting and realistic reflections of ambient light.`
      );
      imgIdx++;
    }

    const refCount = visualInputs.referenceImageCount ?? 0;
    if (refCount > 0) {
      const descs = visualInputs.referenceDescriptions ?? [];
      const refStart = imgIdx;
      const hasAnyDesc = descs.some((d) => d && d.trim().length > 0);
      if (hasAnyDesc) {
        const refLines: string[] = [];
        for (let i = 0; i < refCount; i++) {
          const lbl = imgLabel(refStart + i);
          const desc = (descs[i] ?? "").trim();
          refLines.push(desc ? `${lbl}: ${desc}` : `${lbl}: additional style reference`);
        }
        imgRefs.push(refLines.join("; "));
      } else {
        const refEnd = refStart + refCount - 1;
        const range =
          refStart === refEnd ? imgLabel(refStart) : `${imgLabel(refStart)}–${imgLabel(refEnd)}`;
        imgRefs.push(`${range}: additional style references (use for finishing quality and lighting reference)`);
      }
    }

    if (imgRefs.length > 0) {
      fragments.push({ id: FRAGMENT_IDS.TASK, text: imgRefs.join(". ") + "." });
    }
  }

  // SVG texts — AI models often mutate text ("Green-partners.pl" → "GREEN PARTNER INTL").
  // Literal copy instruction with quoted examples is the most reliable fix.
  const svgTexts = visualInputs?.svgTexts ?? [];
  if (svgTexts.length > 0) {
    const quoted = svgTexts.map((t) => `"${t}"`).join(", ");
    fragments.push({
      id: FRAGMENT_IDS.SVG_TEXTS,
      text:
        `Sign texts (copy LITERALLY, character by character): ${quoted}. ` +
        `Preserve identical spelling, capitalization, hyphens and punctuation marks. ` +
        `Use typefaces and letter sizes matching the SVG design.`,
    });
  }

  // Layer structure before materials — model must know WHAT it's building
  // (backplate → text → logo → standoffs) before learning WHAT it's made of.
  const layerStructure = buildLayerStructure(config.elements, nn);
  if (layerStructure) {
    fragments.push({ id: FRAGMENT_IDS.LAYERS, text: layerStructure });
  }

  // Material descriptions — deduplicated by (colorHex + thicknessMm).
  const hasBg = !!visualInputs?.hasBackground;
  const seenKeys = new Set<string>();
  const materialDescriptions: string[] = [];
  for (const el of elementsWithMaterial) {
    const colorKey = el.colorHex ?? "default";
    const dedupKey = `${colorKey}|${el.thicknessMm ?? ""}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    materialDescriptions.push(
      describeElementMaterial(el.material!, el.colorHex, el.thicknessMm, hasBg)
    );
  }
  if (materialDescriptions.length > 0) {
    fragments.push({
      id: FRAGMENT_IDS.MATERIALS,
      text:
        `Sign element materials (identify each element by its hex color in the SVG): ` +
        materialDescriptions.join("; ") + ".",
    });
  }

  const distanceEl = elementsWithMaterial.find((el) => el.hasDistances);
  if (distanceEl?.material) {
    fragments.push({
      id: FRAGMENT_IDS.DISTANCE,
      text: `${capNn} mounted on standoffs: ${describeMaterial(distanceEl.material)}.`,
    });
  } else if (config.hasDistances) {
    fragments.push({ id: FRAGMENT_IDS.DISTANCE, text: `${capNn} mounted on standoffs.` });
  }

  // LED — per-element flags take priority over global toggle.
  const perElementBacklit = config.elements.filter((el) => el.ledBacklit && el.colorHex);
  const perElementFrontlit = config.elements.filter((el) => el.ledFrontlit && el.colorHex);
  const anyPerElementLed = perElementBacklit.length > 0 || perElementFrontlit.length > 0;

  function ledSpec(cfg: LedConfig["backlit"]): string {
    const parts2: string[] = [`color ${cfg.color}`];
    if (cfg.kelvin != null) parts2.push(`${cfg.kelvin}K`);
    if (cfg.lumens != null) parts2.push(`${cfg.lumens} lm`);
    return parts2.join(", ");
  }

  if (perElementBacklit.length > 0) {
    const hexes = [...new Set(perElementBacklit.map((el) => el.colorHex!))].join(", ");
    fragments.push({
      id: FRAGMENT_IDS.LED_BACKLIT,
      text:
        `Rear LED backlighting active only on SVG color elements: ${hexes} (${ledSpec(config.led.backlit)}). All other elements are NOT rear-lit.`,
    });
  } else if (!anyPerElementLed && config.led.backlit.enabled) {
    fragments.push({
      id: FRAGMENT_IDS.LED_BACKLIT,
      text: `Rear LED backlighting (${ledSpec(config.led.backlit)}).`,
    });
  }

  if (perElementFrontlit.length > 0) {
    const hexes = [...new Set(perElementFrontlit.map((el) => el.colorHex!))].join(", ");
    fragments.push({
      id: FRAGMENT_IDS.LED_FRONTLIT,
      text:
        `Front LED lighting active only on SVG color elements: ${hexes} (${ledSpec(config.led.frontlit)}). All other elements are NOT front-lit.`,
    });
  } else if (!anyPerElementLed && config.led.frontlit.enabled) {
    fragments.push({
      id: FRAGMENT_IDS.LED_FRONTLIT,
      text: `Front LED lighting (${ledSpec(config.led.frontlit)}).`,
    });
  }

  if (options?.cameraDirty) {
    const cameraPrompt = buildCameraPrompt(
      config.camera.rotateDeg,
      config.camera.moveForward,
      config.camera.verticalTilt
    );
    if (cameraPrompt) fragments.push({ id: FRAGMENT_IDS.CAMERA, text: cameraPrompt });
  }

  return fragments;
}

/**
 * Assembles the full prompt item list (auto-fragments + presets at their anchor positions).
 * UI uses this to render the prompt with preset badges between fragments.
 *
 * Anchor mapping:
 *   - anchor = fragment ID → preset inserted AFTER that fragment
 *   - anchor = "__start__" → before all fragments
 *   - anchor = "__end__" or missing fragment → at end
 */
export function assemblePromptItems(
  config: SignConfig,
  visualInputs?: VisualInputs,
  options?: AssembleOptions
): PromptItem[] {
  const fragments = assemblePromptFragments(config, visualInputs, options);
  const presets = options?.presets ?? [];
  const legacyTexts = options?.presetTexts ?? [];

  const presetsByAnchor = new Map<string, PromptItem[]>();
  const validAnchors = new Set(fragments.map((f) => f.id));
  validAnchors.add("__start__");

  for (const p of presets) {
    const item: PromptItem = {
      kind: "preset",
      presetId: p.id,
      label: p.label,
      text: p.text,
    };
    const anchor = p.anchor && validAnchors.has(p.anchor) ? p.anchor : "__end__";
    const existing = presetsByAnchor.get(anchor) ?? [];
    existing.push(item);
    presetsByAnchor.set(anchor, existing);
  }

  const todPreset = options?.timeOfDayPreset;
  if (todPreset?.text) {
    const todItem: PromptItem = {
      kind: "preset",
      presetId: "__tod__",
      label: "Środowisko",
      text: todPreset.text,
    };
    const todAnchor =
      todPreset.anchor && validAnchors.has(todPreset.anchor) ? todPreset.anchor : "__end__";
    const existing = presetsByAnchor.get(todAnchor) ?? [];
    existing.push(todItem);
    presetsByAnchor.set(todAnchor, existing);
  }

  for (const t of legacyTexts) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    const item: PromptItem = {
      kind: "preset",
      presetId: `__legacy_${Math.random()}`,
      label: "preset",
      text: trimmed,
    };
    const existing = presetsByAnchor.get("__end__") ?? [];
    existing.push(item);
    presetsByAnchor.set("__end__", existing);
  }

  const items: PromptItem[] = [];
  for (const p of presetsByAnchor.get("__start__") ?? []) items.push(p);
  for (const frag of fragments) {
    items.push({ kind: "fragment", id: frag.id, text: frag.text });
    for (const p of presetsByAnchor.get(frag.id) ?? []) items.push(p);
  }
  for (const p of presetsByAnchor.get("__end__") ?? []) items.push(p);

  return items;
}

export function assemblePrompt(
  config: SignConfig,
  visualInputs?: VisualInputs,
  options?: AssembleOptions
): string {
  return assemblePromptItems(config, visualInputs, options)
    .map((i) => i.text)
    .join(" ");
}
