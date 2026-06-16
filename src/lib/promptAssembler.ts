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
}

function imgLabel(n: number): string {
  return `Obraz ${n}`;
}

/** Polska odmiana liczebnika: 1 → one, 2–4 (poza 12–14) → few, reszta → many. */
function plPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
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
  matowa: "matowy panel akrylowy, gładkie aksamitne wykończenie, rozproszone światło, brak refleksów",
  mleczna: "mleczny/opalowy panel akrylowy, półprzezroczysty, jednorodnie rozpraszający światło, miękka opalowa faktura",
  polysk: "akryl wysoko połyskowy, szklista wypolerowana powierzchnia z mokrym połyskiem i punktowymi refleksami",
  lustro: "akryl lustrzany, wypolerowana powierzchnia odbijająca otoczenie jak lustro, charakterystyczne refleksy polerowanego akrylu",
};

const MATERIAL_CATEGORY_HINTS: Record<string, string> = {
  pleksa: "panel akrylowy (z pleksi)",
  dibond: "panel Dibond — kompozyt aluminiowy o szczotkowanej powierzchni",
  hdf: "panel HDF — twarda płyta pilśniowa z gładką lakierowaną powierzchnią",
  metal: "panel metalowy z delikatną szczotkowaną fakturą",
  dystans: "polerowane metalowe dystanse montażowe",
  inne: "sztywny materiał konstrukcyjny na szyld",
};

/**
 * Maps material thickness in mm to a relative visual description.
 * AI models don't interpret mm as physical units — they react to proportions.
 * The relative descriptor is the primary signal; the mm value is a secondary hint.
 */
function describeThickness(thicknessMm: number | null): string | null {
  if (thicknessMm == null || thicknessMm <= 0) return null;
  if (thicknessMm < 5) return `cienki profil (${thicknessMm}mm), subtelnie widoczna krawędź boczna`;
  if (thicknessMm < 15) return `średnia grubość (${thicknessMm}mm), wyraźnie widoczna krawędź boczna`;
  if (thicknessMm < 30) return `gruby profil (${thicknessMm}mm), wyraźna głębia 3D, szeroka widoczna krawędź boczna`;
  return `bardzo gruby profil (${thicknessMm}mm), dominująca głębia 3D, duża widoczna krawędź boczna`;
}

function hasReflectiveThin(elements: SignElement[]): boolean {
  return elements.some(
    (e) => e.material?.material_type === "lustro" || (e.thicknessMm != null && e.thicknessMm < 5)
  );
}

function hasLustro(elements: SignElement[]): boolean {
  return elements.some((e) => e.material?.material_type === "lustro");
}

function buildLayerStructure(
  elements: SignElement[],
  productNoun: string
): string | null {
  const byRole: Record<string, SignElement[]> = {
    backplate: [], decoration: [], logo: [], text: [], distance: [], cutout: [],
  };
  for (const el of elements) {
    if (el.role) byRole[el.role]?.push(el);
  }
  const byNodeId = new Map(elements.map((el) => [el.nodeId, el]));
  const lines: string[] = [];
  const nn = productNoun;

  if (byRole.distance.length > 0) {
    lines.push(
      `- Dystanse: cały ${nn} jest zamontowany na metalowych dystansach, odsunięty od ściany o ok. 20–30 mm, rzucający miękki cień na ścianę za sobą`
    );
  }
  if (byRole.backplate.length > 0) {
    const colors = [...new Set(byRole.backplate.map((e) => e.colorHex ?? "domyślny"))].join(", ");
    lines.push(`- Płyta bazowa (tło, najgłębsza warstwa): regiony SVG ${colors}, płaska płyta bazowa`);
  }
  if (byRole.decoration.length > 0) {
    const colors = [...new Set(byRole.decoration.map((e) => e.colorHex ?? "domyślny"))].join(", ");
    const shadow = hasReflectiveThin(byRole.decoration)
      ? "z delikatnym cieniem przy krawędziach"
      : "rzucające subtelny cień na płytę poniżej";
    lines.push(
      `- Dekoracje (warstwa nad płytą bazową): regiony SVG ${colors}, nałożone NA płytę bazową, lekko uniesione, ${shadow}`
    );
  }
  if (byRole.logo.length > 0) {
    const colors = [...new Set(byRole.logo.map((e) => e.colorHex ?? "domyślny"))].join(", ");
    if (hasLustro(byRole.logo)) {
      lines.push(
        `- Logo (warstwa nad płytą bazową): regiony SVG ${colors}, kształty logotypu wycięte z lustrzanego akrylu, zamontowane NA płycie bazowej — każdy kształt ma lustrzaną powierzchnię odbijającą otoczenie`
      );
    } else {
      const shadow = hasReflectiveThin(byRole.logo)
        ? "z delikatnym cieniem przy podstawie"
        : "rzucające widoczny cień na płytę poniżej";
      lines.push(
        `- Logo (warstwa nad płytą bazową): regiony SVG ${colors}, zamontowane NA płycie bazowej jako uniesiony element przestrzenny, ${shadow}`
      );
    }
  }
  if (byRole.text.length > 0) {
    const colors = [...new Set(byRole.text.map((e) => e.colorHex ?? "domyślny"))].join(", ");
    if (hasLustro(byRole.text)) {
      lines.push(
        `- Tekst (warstwa wierzchnia): regiony SVG ${colors}, kształty liter wycięte z lustrzanego akrylu, zamontowane NA płycie bazowej — każdy kształt ma lustrzaną powierzchnię odbijającą otoczenie`
      );
    } else {
      const shadow = hasReflectiveThin(byRole.text)
        ? "z delikatnym cieniem przy podstawie liter"
        : "rzucające wyraźne cienie na płytę poniżej — wyraźnie widoczna głębia liter";
      lines.push(
        `- Tekst (warstwa wierzchnia): regiony SVG ${colors}, litery jako OSOBNE uniesione elementy zamontowane NA płycie bazowej, ${shadow}`
      );
    }
  }
  if (byRole.cutout.length > 0) {
    for (const el of byRole.cutout) {
      const myColor = el.colorHex ?? "domyślny";
      const backing = el.cutoutBackingId ? byNodeId.get(el.cutoutBackingId) : null;
      const backingColor = backing?.colorHex ?? "warstwy poniżej";
      lines.push(
        `- Warstwa z wycięciami: region SVG ${myColor} to panel akrylowy nałożony NA inny panel akrylowy (${backingColor}) z FIZYCZNIE WYCIĘTYMI otworami. ` +
        `Krawędzie cięcia są ostre (cięte laserem). Przez wycięcia widoczny jest dolny akryl w kolorze ${backingColor}. ` +
        `Górna warstwa (${myColor}) ma własną grubość — wycięcia wyglądają jak okna z widoczną głębią ścianki bocznej, z lekkim cieniem rzucanym przez krawędzie cięcia na warstwę poniżej.`
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
      ? `${capNn} — struktura warstw (od dołu do góry, ${totalEls} ${plPlural(totalEls, "element", "elementy", "elementów")} w ${uniqueColors.size} ${plPlural(uniqueColors.size, "kolorze", "kolorach", "kolorach")}):`
      : `${capNn} — struktura warstw (od dołu do góry):`;
  return `${header}\n${lines.join("\n")}`;
}

function describeMaterial(m: Material): string {
  const surface = m.material_type ? MATERIAL_TYPE_DESCRIPTIONS[m.material_type] : null;
  const categoryHint = MATERIAL_CATEGORY_HINTS[m.category];
  return surface ?? categoryHint ?? "sztywny materiał konstrukcyjny na szyld";
}

/**
 * Builds the material description for a single sign element.
 *
 * Cases (in priority order):
 *  - mirror: the dominant visual effect is environmental reflection; hex acts as tint only
 *  - glossy: hex IS the material color; AI adds specular highlights on top
 *  - everything else: hex is material color + surface description from material type
 *
 * Materials are always described by hex color + surface type (no reference photos).
 */
function describeElementMaterial(
  m: Material,
  colorHex: string | null,
  thicknessMm: number | null
): string {
  const color = colorHex ?? "domyślny";
  const thicknessDesc = describeThickness(thicknessMm);
  const thicknessSuffix = thicknessDesc ? `, ${thicknessDesc}` : "";

  if (m.material_type === "lustro") {
    const tintDesc = colorHex ? ` z jedynie delikatnym odcieniem ${color}` : "";
    return `Region SVG ${color} → akryl o lustrzanym wykończeniu, jak czyste lustro${tintDesc}, wyraźnie odbijający otoczenie ze sceny — w ostrym ujęciu, z jasnymi smugami odbitego światła i refleksami o wysokim kontraście${thicknessSuffix}; kolor ${color} zabarwia odbicia jak filtr na czystym lustrze`;
  }

  if (m.material_type === "polysk") {
    return (
      `Region SVG ${color} → akryl wysoko połyskowy w kolorze ${color} — szklista wypolerowana powierzchnia ` +
      `z mokrym połyskiem i punktowymi refleksami oświetlenia sceny leżącymi na licu${thicknessSuffix}`
    );
  }

  return `Region SVG ${color} → ${describeMaterial(m)}, kolor ${color}${thicknessSuffix}`;
}

export function buildTimeOfDayPrompt(
  timeOfDay: TimeOfDay,
  ledActive: boolean,
  hasBackground: boolean = false,
  productNoun: { nominative: string; genitive: string; en: string } = { nominative: "szyld", genitive: "szyldu", en: "sign" }
): string {
  const nom = productNoun.nominative;
  const gen = productNoun.genitive;
  const capNn = nom.charAt(0).toUpperCase() + nom.slice(1);
  switch (timeOfDay) {
    case "brak":
      return "";
    case "dzien":
      if (hasBackground) {
        return "Styl renderowania: jasne naturalne światło dzienne, ostre cienie spójne z istniejącą sceną.";
      }
      return "Ujęcie w ciągu dnia, w pełnym naturalnym świetle słonecznym. Niebieskie niebo, ostre cienie, jasna ekspozycja o wysokim kontraście.";
    case "wieczor":
      if (hasBackground) {
        return (
          "Styl renderowania: ciepłe światło złotej godziny. " +
          (ledActive
            ? `Oświetlenie LED ${gen} jest wyraźnie widoczne i kontrastuje z ciepłym światłem otoczenia.`
            : "Miękkie, ciepłe światło otoczenia spójne z istniejącą sceną.")
        );
      }
      return (
        "Ujęcie o zmierzchu, podczas złotej godziny. Niebo w odcieniach pomarańczu, różu i fioletu. Miękkie, ciepłe światło otoczenia. " +
        (ledActive
          ? `Podświetlenie ${gen} jest wyraźnie widoczne i kontrastuje z ciemniejącym niebem.`
          : `${capNn} oświetlony miękkim, ciepłym światłem zmierzchu.`)
      );
    case "noc":
      if (hasBackground) {
        return (
          "Styl renderowania: noc, ciemne otoczenie. " +
          (ledActive
            ? `Oświetlenie LED ${gen} jest głównym źródłem światła — rzuca miękką poświatę na sąsiednie powierzchnie.`
            : "Subtelne sztuczne światło spójne z istniejącą sceną.")
        );
      }
      return (
        "Ujęcie nocne. Ciemne niebo, sztuczne oświetlenie miejskie — latarnie, odbicia w oknach. " +
        (ledActive
          ? `${capNn} intensywnie podświetlony LED-ami, wyraźna poświata i aureola światła wokół liter, odbicia na mokrej nawierzchni poniżej.`
          : `${capNn} widoczny w świetle ulicznych latarni, ciemne, dramatyczne miejskie otoczenie nocne.`)
      );
    case "wnetrze":
      // CRITICAL: when a background photo is present, it already defines the interior.
      // Adding "professional architectural arrangement" causes AI to generate a new scene.
      if (hasBackground) return "";
      return (
        `${capNn} zamontowany wewnątrz pomieszczenia — biuro, sklep lub reprezentacyjny hol wejściowy. ` +
        "Sztuczne oświetlenie sufitowe, neutralne lub ciepłe światło wnętrza, czyste architektoniczne tło."
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
    const dir = rotateDeg > 0 ? "w lewo" : "w prawo";
    parts.push(`Obróć kamerę o ${absR}° ${dir}.`);
  }

  if (moveForward >= 9) {
    parts.push("Przysuń kamerę bardzo blisko — ekstremalne zbliżenie.");
  } else if (moveForward >= 7) {
    parts.push("Przysuń kamerę blisko — ujęcie z bliska.");
  } else if (moveForward >= 5) {
    parts.push("Bliskie ujęcie, kamera lekko przybliżona.");
  } else if (moveForward >= 3) {
    parts.push("Średnia odległość kamery.");
  } else if (moveForward >= 1) {
    parts.push("Większa odległość kamery, szersze ujęcie.");
  } else {
    parts.push("Kamera daleko, szeroka perspektywa.");
  }

  if (verticalTilt <= -0.7) {
    parts.push("Pochyl kamerę mocno w dół — widok z lotu ptaka.");
  } else if (verticalTilt <= -0.3) {
    parts.push("Pochyl kamerę lekko w dół.");
  } else if (verticalTilt >= 0.7) {
    parts.push("Pochyl kamerę mocno w górę — widok z żabiej perspektywy.");
  } else if (verticalTilt >= 0.3) {
    parts.push("Pochyl kamerę lekko w górę.");
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
  const nn = productNoun.nominative;
  const gen = productNoun.genitive;
  const capNn = nn.charAt(0).toUpperCase() + nn.slice(1);

  if (visualInputs) {
    const imgRefs: string[] = [];
    let imgIdx = 1;

    // ── A: różnice promptu per dostawca ────────────────────────────────────────
    // Gałąź Gemini (Nano Banana) zostaje dopracowana jak dotąd. GPT Image 2 (live)
    // edytuje Obraz 1 jako obraz wejściowy przez /v1/images/edits, więc dla scen z tłem
    // dokładamy krótkie wzmocnienie semantyki edycji. TU dostosowujesz różnice per dostawca
    // (np. inne sformułowania ZADANIA dla OpenAI vs Google).
    const isOpenai = options?.targetModel === "openai";
    const openaiEditClause = isOpenai
      ? ` Potraktuj ${imgLabel(1)} jako obraz wejściowy do edycji — zmień wyłącznie obszar ${gen}, a wszystkie pozostałe piksele pozostaw nienaruszone.`
      : "";

    if (visualInputs.hasSvg && visualInputs.hasBackground) {
      const sceneLabel = imgLabel(imgIdx);
      imgRefs.push(
        `ZADANIE: fotorealistyczna wizualizacja ${gen} (mockup). ` +
        `${sceneLabel} to PRAWDZIWE ZDJĘCIE lokalizacji z półprzezroczystą nakładką SVG pokazującą, gdzie ma znaleźć się ${nn}, jego kształt oraz kolor przypisany do każdego regionu.` +
        `\n\n` +
        `Wygeneruj obraz identyczny jak ${sceneLabel}, ale z nakładką SVG zastąpioną fotorealistycznym, trójwymiarowym renderem ${gen}. ` +
        `Cała reszta fotografii pozostaje bez zmian — tło, otoczenie, oświetlenie, perspektywa i kąt kamery.` +
        `\n\n` +
        `${capNn} to TRÓJWYMIAROWY, fizyczny obiekt zamontowany na powierzchni: ma głębię, rzuca miękki cień kontaktowy oraz jest oświetlony i odbija światło otoczenia tak samo jak reszta sceny. ` +
        `${capNn} musi zajmować DOKŁADNIE ten sam obszar co nakładka SVG w ${sceneLabel} — odwzoruj identyczną pozycję i proporcje nakładki, ale wyrenderuj go z perspektywą i kątem ściany widocznym w fotografii. ` +
        `Wyrenderuj napisy i logo jako wyraźne, czyste, ostro zdefiniowane elementy o takiej samej ostrości, oświetleniu i fotograficznym realizmie jak tło — ma wyglądać jak naprawdę sfotografowany w tej scenie, a nie jak płaska grafika wklejona na zdjęcie. ` +
        `Zachowaj pozycję, układ i kolor każdego regionu wiernie wobec nakładki SVG; zmienia się tylko jego wygląd — z płaskiego, kolorowego kształtu w prawdziwy, fotorealistyczny materiał.` +
        openaiEditClause
      );
      imgIdx++;
    } else if (visualInputs.hasSvg) {
      const sceneLabel = imgLabel(imgIdx);
      imgRefs.push(
        `ZADANIE: fotorealistyczny render ${gen}. ` +
        `${sceneLabel} to schematyczny projekt SVG (płaskie, kolorowe kształty pokazujące układ ${gen}). ` +
        `Wyrenderuj go jako fotorealistyczny ${nn} wykonany z opisanych poniżej materiałów, z naturalnym oświetleniem studyjnym i czystym, neutralnym tłem.`
      );
      imgIdx++;
    } else if (visualInputs.hasBackground) {
      const sceneLabel = imgLabel(imgIdx);
      imgRefs.push(
        `ZADANIE: dodaj ${nn} do istniejącego zdjęcia. ` +
        `${sceneLabel} to PRAWDZIWE ZDJĘCIE lokalizacji. ` +
        `Cała reszta fotografii pozostaje bez zmian — tło, otoczenie, oświetlenie i perspektywa. ` +
        `Dodaj na powierzchnię opisany poniżej ${nn} — z naturalnymi cieniami pasującymi do istniejącego oświetlenia i realistycznymi odbiciami światła otoczenia.` +
        openaiEditClause
      );
      imgIdx++;
    }

    // Zdjęcia referencyjne — numerowane PO scenie (zgodnie z kolejnością wysyłki
    // w useGeneration: scena → referencje).
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
          refLines.push(desc ? `${lbl}: ${desc}` : `${lbl}: dodatkowa referencja stylu`);
        }
        imgRefs.push(refLines.join("; "));
      } else {
        const refEnd = refStart + refCount - 1;
        const range =
          refStart === refEnd ? imgLabel(refStart) : `${imgLabel(refStart)}–${imgLabel(refEnd)}`;
        imgRefs.push(`${range}: dodatkowe referencje stylu (użyj jako wzorzec jakości wykończenia i oświetlenia)`);
      }
    }

    if (imgRefs.length > 0) {
      const taskText = imgRefs.join(". ");
      fragments.push({ id: FRAGMENT_IDS.TASK, text: taskText.endsWith(".") ? taskText : taskText + "." });
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
        `Teksty na szyldzie (przepisz DOSŁOWNIE, znak po znaku): ${quoted}. ` +
        `Zachowaj identyczną pisownię, wielkość liter, myślniki i znaki interpunkcyjne. ` +
        `Użyj krojów pisma i wielkości liter zgodnych z projektem SVG.`,
    });
  }

  // Layer structure before materials — model must know WHAT it's building
  // (backplate → text → logo → standoffs) before learning WHAT it's made of.
  const layerStructure = buildLayerStructure(config.elements, nn);
  if (layerStructure) {
    fragments.push({ id: FRAGMENT_IDS.LAYERS, text: layerStructure });
  }

  // Material descriptions — deduplicated by (colorHex + thicknessMm).
  const seenKeys = new Set<string>();
  const materialDescriptions: string[] = [];
  for (const el of elementsWithMaterial) {
    const colorKey = el.colorHex ?? "default";
    const dedupKey = `${colorKey}|${el.thicknessMm ?? ""}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    materialDescriptions.push(
      describeElementMaterial(el.material!, el.colorHex, el.thicknessMm)
    );
  }
  if (materialDescriptions.length > 0) {
    fragments.push({
      id: FRAGMENT_IDS.MATERIALS,
      text:
        `Materiały elementów ${gen} (każdy element rozpoznaj po jego kolorze hex w SVG): ` +
        materialDescriptions.join("; ") + ".",
    });
  }

  const distanceEl = elementsWithMaterial.find((el) => el.hasDistances);
  if (distanceEl?.material) {
    fragments.push({
      id: FRAGMENT_IDS.DISTANCE,
      text: `${capNn} zamontowany na dystansach: ${describeMaterial(distanceEl.material)}.`,
    });
  } else if (config.hasDistances) {
    fragments.push({ id: FRAGMENT_IDS.DISTANCE, text: `${capNn} zamontowany na dystansach.` });
  }

  // LED — per-element flags take priority over global toggle.
  const perElementBacklit = config.elements.filter((el) => el.ledBacklit && el.colorHex);
  const perElementFrontlit = config.elements.filter((el) => el.ledFrontlit && el.colorHex);
  const anyPerElementLed = perElementBacklit.length > 0 || perElementFrontlit.length > 0;

  function ledSpec(cfg: LedConfig["backlit"]): string {
    const parts2: string[] = [`kolor ${cfg.color}`];
    if (cfg.kelvin != null) parts2.push(`${cfg.kelvin}K`);
    if (cfg.lumens != null) parts2.push(`${cfg.lumens} lm`);
    return parts2.join(", ");
  }

  if (perElementBacklit.length > 0) {
    const hexes = [...new Set(perElementBacklit.map((el) => el.colorHex!))].join(", ");
    fragments.push({
      id: FRAGMENT_IDS.LED_BACKLIT,
      text:
        `Tylne podświetlenie LED aktywne tylko na elementach SVG w kolorach: ${hexes} (${ledSpec(config.led.backlit)}). Pozostałe elementy NIE są podświetlone od tyłu.`,
    });
  } else if (!anyPerElementLed && config.led.backlit.enabled) {
    fragments.push({
      id: FRAGMENT_IDS.LED_BACKLIT,
      text: `Tylne podświetlenie LED (${ledSpec(config.led.backlit)}).`,
    });
  }

  if (perElementFrontlit.length > 0) {
    const hexes = [...new Set(perElementFrontlit.map((el) => el.colorHex!))].join(", ");
    fragments.push({
      id: FRAGMENT_IDS.LED_FRONTLIT,
      text:
        `Przednie oświetlenie LED aktywne tylko na elementach SVG w kolorach: ${hexes} (${ledSpec(config.led.frontlit)}). Pozostałe elementy NIE są oświetlone od przodu.`,
    });
  } else if (!anyPerElementLed && config.led.frontlit.enabled) {
    fragments.push({
      id: FRAGMENT_IDS.LED_FRONTLIT,
      text: `Przednie oświetlenie LED (${ledSpec(config.led.frontlit)}).`,
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
