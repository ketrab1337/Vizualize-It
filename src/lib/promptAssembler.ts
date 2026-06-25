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
  /** Scena (Obraz 1) zawiera produkty/przedmioty postawione przez użytkownika do wtopienia. */
  hasProducts?: boolean;
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
  LED_UNLIT: "led-unlit",
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
 * Nazwa koloru z hexa (najbliższy z palety). Hex zostaje precyzyjnym identyfikatorem;
 * nazwa to tylko podpowiedź renderu. „żółty" świadomie pominięty — na szyldach #ffd700/
 * #D4AF37 to praktycznie zawsze ZŁOTY (żółć i złoto są w RGB blisko siebie). Gdy hex jest
 * daleko od każdej kotwicy → zwraca null (zostaje sam hex, bez ryzykownej nazwy).
 */
const NAMED_COLORS: { name: string; r: number; g: number; b: number }[] = [
  { name: "czarny", r: 0, g: 0, b: 0 },
  { name: "biały", r: 255, g: 255, b: 255 },
  { name: "szary", r: 128, g: 128, b: 128 },
  { name: "srebrny", r: 192, g: 192, b: 192 },
  { name: "czerwony", r: 204, g: 34, b: 34 },
  { name: "pomarańczowy", r: 255, g: 128, b: 0 },
  { name: "złoty", r: 224, g: 176, b: 0 },
  { name: "brązowy", r: 122, g: 74, b: 40 },
  { name: "zielony", r: 42, g: 170, b: 60 },
  { name: "turkusowy", r: 48, g: 180, b: 170 },
  { name: "niebieski", r: 40, g: 90, b: 200 },
  { name: "granatowy", r: 20, g: 34, b: 90 },
  { name: "fioletowy", r: 128, g: 48, b: 160 },
  { name: "różowy", r: 240, g: 105, b: 160 },
];

function colorName(hex: string | null): string | null {
  if (!hex) return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of NAMED_COLORS) {
    const d = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
    if (d < bestD) { bestD = d; best = c.name; }
  }
  // Próg pewności (~55/kanał). Dalej → sam hex bez nazwy.
  return bestD <= 9000 ? best : null;
}

/** „#hex (nazwa)" gdy nazwa pewna, inaczej sam „#hex". */
function hexLabel(hex: string | null): string {
  if (!hex) return "domyślny kolor";
  const name = colorName(hex);
  return name ? `${hex} (${name})` : hex;
}

/** Krótka, jednolinijkowa „Budowa": płyta bazowa + naklejone wypukłe litery/logo (+ wycięcia). */
function buildLayerStructure(
  elements: SignElement[],
  productNoun: string
): string | null {
  const roles = new Set<string>();
  for (const el of elements) {
    if (el.role && el.role !== "distance") roles.add(el.role);
  }
  const parts: string[] = [];
  if (roles.has("backplate")) parts.push("płaska płyta bazowa (najgłębsza warstwa)");
  const raised: string[] = [];
  if (roles.has("decoration")) raised.push("dekoracje");
  if (roles.has("logo")) raised.push("logo");
  if (roles.has("text")) raised.push("litery");
  if (raised.length > 0) {
    parts.push(`a NA niej naklejone ${raised.join(" i ")} (warstwa wierzchnia)`);
  }
  if (roles.has("cutout")) {
    parts.push("oraz panel z fizycznie wyciętymi (laserowo) otworami, przez które widać warstwę pod spodem");
  }
  if (parts.length === 0) return null;
  return `Budowa ${productNoun}: ${parts.join(", ")}.`;
}

function describeMaterial(m: Material): string {
  const surface = m.material_type ? MATERIAL_TYPE_DESCRIPTIONS[m.material_type] : null;
  const categoryHint = MATERIAL_CATEGORY_HINTS[m.category];
  return surface ?? categoryHint ?? "sztywny materiał konstrukcyjny na szyld";
}

/**
 * Opis wykończenia łbów dystansów na podstawie ich MATERIAŁU, nie koloru-placeholdera
 * w SVG. Trzy rodzaje: złote i srebrne (chrom metaliczny, połysk) oraz czarne (mat).
 * Barwa z `material.color_hex` (np. złota/srebrna/czarna), wykończenie z `material_type`
 * (`matowa` → mat; `polysk`/`lustro`/null → polerowany metal).
 */
function describeDistanceFinish(m: Material): string {
  // Realne łby dystansów to SATYNOWY/szczotkowany metal (mosiądz/stal), nie chrom-lustro.
  // matowa → mat (czarny); reszta (złoty/srebrny) → satynowy metal. Barwa z material.color_hex.
  const tail = m.color_hex ? ` w odcieniu ${hexLabel(m.color_hex)}` : "";
  if (m.material_type === "matowa") {
    return `matowy metal${tail} — gładki, nielśniący`;
  }
  return `satynowy, szczotkowany metal${tail} — miękki, matowo-metaliczny połysk i subtelna szczotkowana faktura`;
}

/**
 * Color-INDEPENDENT opis wykończenia elementu. Kolor (hex + nazwa) dokleja fragment
 * MATERIALS, grupując elementy o tym samym wykończeniu (zamiast powtarzać akapit per kolor).
 * Drobne elementy pierwszoplanowe (litery/logo/dekoracje/wycięcia) na lustrze/połysku →
 * czyste, błyszczące litery, NIE pełne lustro odbijające pokój (to brudziło małe litery).
 * Pełne lustro zostaje dla dużej płyty (`backplate`).
 */
function finishPhrase(m: Material, role?: SignElement["role"]): string {
  const isForegroundDetail =
    role === "text" || role === "logo" || role === "decoration" || role === "cutout";
  if (isForegroundDetail && (m.material_type === "lustro" || m.material_type === "polysk")) {
    return "wypukłe litery/kształty z lustrzanego akrylu — premium wykończenie";
  }
  if (m.material_type === "lustro") {
    return "akryl o wykończeniu lustrzanym — wyraźnie odbija otoczenie";
  }
  if (m.material_type === "polysk") {
    return "akryl wysokopołyskowy — szklista, wypolerowana powierzchnia z mokrym połyskiem i refleksami światła";
  }
  if (m.material_type === "matowa") {
    return "akryl matowy — gładka, nielśniąca powierzchnia, rozproszone światło";
  }
  if (m.material_type === "mleczna") {
    return "akryl mleczny/opalowy — półprzezroczysty, miękko rozpraszający światło";
  }
  return describeMaterial(m);
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
  // Opisujemy WYNIKOWY widok (z której strony / odległości / wysokości widać szyld),
  // nie tylko relatywną komendę "obróć kamerę" — przy generowaniu od zera model nie ma
  // punktu odniesienia dla rotacji. Tylko po polsku — Gemini/GPT Image są wielojęzyczne,
  // a reszta promptu jest PL (spójność + brak ryzyka obcych artefaktów w tekście na szyldzie).
  const parts: string[] = [];

  const absR = Math.abs(rotateDeg);
  if (absR >= 1) {
    const dir = rotateDeg > 0 ? "lewej" : "prawej";
    parts.push(`Pokaż szyld w ujęciu trzy-czwarte z ${dir} strony, pod kątem ~${absR}°.`);
  }

  // Środek suwaka (5 = "Średnio") jest neutralny → nie wymuszamy kadrowania (brak frazy),
  // żeby sama zmiana kąta nie wstawiała przypadkowej odległości. Fraza tylko gdy realnie
  // przesunięto kamerę bliżej/dalej.
  if (moveForward >= 9) {
    parts.push("Bardzo bliskie ujęcie — kadr niemal wypełniony szyldem.");
  } else if (moveForward >= 7) {
    parts.push("Ujęcie z bliska.");
  } else if (moveForward >= 6) {
    parts.push("Lekko przybliżone ujęcie.");
  } else if (moveForward === 5) {
    // neutralny środek — bez frazy
  } else if (moveForward >= 3) {
    parts.push("Ujęcie z nieco większej odległości.");
  } else if (moveForward >= 1) {
    parts.push("Szersze ujęcie z większej odległości.");
  } else {
    parts.push("Szeroka perspektywa z daleka, ujęcie uliczne.");
  }

  // Progi dopasowane do kroków suwaka (TILT_STEPS co 0.2) — każdy niezerowy krok już od
  // 0.2 (=„20%") daje frazę. Wcześniej próg startował od 0.3, więc krok ±0.2 połykany był
  // po cichu (nic nie trafiało do promptu). Znak: t>0 → z dołu (żabi), t<0 → z góry (ptasi).
  const absT = Math.abs(verticalTilt);
  if (absT >= 0.15) {
    const strong = absT >= 0.7;
    const mag = strong ? "mocno" : "lekko";
    if (verticalTilt > 0) {
      parts.push(`Widok ${mag} z dołu${strong ? ", żabia perspektywa" : ""}.`);
    } else {
      parts.push(`Widok ${mag} z góry${strong ? ", z lotu ptaka" : ""}.`);
    }
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
      // KOMPOZYT (nakładka SVG wtopiona w zdjęcie) — sprawdzona formuła z 22.06: nakładka
      // wyznacza pozycję/kształt/regiony/kolory, ale NIE kąt; model kładzie szyld w perspektywie
      // ściany. Rozmiar i proporcje masz z nakładki (pixel-perfect), bez footprintu-kotwicy.
      // Kluczowe było USUNIĘCIE sprzeczności "ten sam obszar + identyczne proporcje" (kotwiczyła
      // frontalnie) na rzecz "odwzoruj pozycję/regiony, ale wyrenderuj w perspektywie ściany".
      const sceneLabel = imgLabel(imgIdx);
      imgRefs.push(
        `ZADANIE: edytuj ${sceneLabel}. To PRAWDZIWE ZDJĘCIE lokalizacji z półprzezroczystą nakładką SVG pokazującą układ ${gen}. Zastąp SAMĄ nakładkę fotorealistycznym, trójwymiarowym renderem ${gen}; cała reszta fotografii pozostaje bez zmian — tło, otoczenie, oświetlenie, perspektywa i kąt kamery.\n\n` +
        `${capNn} to TRÓJWYMIAROWY, fizyczny obiekt zamontowany na powierzchni: jest oświetlony i odbija światło otoczenia jak reszta sceny.\n\n` +
        `Nakładka SVG to płaski, FRONTALNY schemat (rzut prostopadły) — wyznacza WYŁĄCZNIE położenie środka ${gen} na ścianie, jego kształt, podział na regiony i kolory; NIE wyznacza finalnego kąta patrzenia. Ściana jest widziana pod kątem, więc ${nn} LEŻY na płaszczyźnie tej ściany; jego sylwetka MUSI być skrócona/zwężona perspektywicznie zgodnie ze zbiegiem i kątem ściany — jak rama czy plakat wiszący w tym miejscu (krawędź bliższa kamery dłuższa, dalsza krótsza). NIE renderuj go jako idealnego frontalnego prostokąta; dopasuj krawędzie do perspektywy ściany.\n\n` +
        `Wyrenderuj napisy i logo jako wyraźne, czyste, ostre elementy o tej samej ostrości i realizmie co tło — ma wyglądać jak naprawdę sfotografowany w tej scenie.\n\n` +
        `Zachowaj wzajemny układ, proporcje i kolor regionów względem siebie wiernie wobec nakładki; zmienia się tylko ich wygląd (z płaskiego kształtu w fotorealistyczny materiał) oraz rzut całości na perspektywę ściany. Dopasuj oświetlenie i perspektywę ${gen} do zdjęcia i zachowaj perspektywę oraz krawędzie otoczenia nienaruszone.` +
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
      if (visualInputs.hasProducts) {
        // Tło + produkt(y), BEZ szyldu (wizualizacja produktu na ladzie/półce).
        // Samo „zachowaj zdjęcie"; właściwą robotę robi klauzula produktowa niżej.
        imgRefs.push(
          `ZADANIE: edycja zdjęcia. ${sceneLabel} to PRAWDZIWE ZDJĘCIE lokalizacji — ` +
          `zachowaj je pixel-perfect: tło, otoczenie, oświetlenie i perspektywa bez zmian.` +
          openaiEditClause
        );
      } else {
        imgRefs.push(
          `ZADANIE: dodaj ${nn} do istniejącego zdjęcia. ` +
          `${sceneLabel} to PRAWDZIWE ZDJĘCIE lokalizacji. ` +
          `Cała reszta fotografii pozostaje bez zmian — tło, otoczenie, oświetlenie i perspektywa. ` +
          `Dodaj na powierzchnię opisany poniżej ${nn} — z naturalnymi cieniami pasującymi do istniejącego oświetlenia i realistycznymi odbiciami światła otoczenia.` +
          openaiEditClause
        );
      }
      imgIdx++;
    }

    // Produkty wtapiane w scenę — są CZĘŚCIĄ Obrazu 1 (kompozyt), nie osobnym obrazem,
    // więc nie zwiększają numeracji „Obraz N". Instrukcja, by model osadził je realistycznie.
    if (visualInputs.hasProducts && (visualInputs.hasSvg || visualInputs.hasBackground)) {
      imgRefs.push(
        `Na scenie (Obraz 1) znajdują się dodatkowe PRZEDMIOTY/PRODUKTY postawione przez użytkownika (np. na ladzie, półce lub blacie). ` +
        `Wtop każdy z nich fotorealistycznie tak, jakby fizycznie stał w tym miejscu: dodaj kontaktowy cień, miękkie odbicie na powierzchni pod spodem, oraz oświetlenie i perspektywę spójne z resztą sceny. ` +
        `Zachowaj kształt, kolory, etykiety/napisy i proporcje tych przedmiotów dokładnie takie, jakie są, i naturalnie osadź je w otoczeniu.`
      );
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
      text: `Tekst dokładnie taki: ${quoted} — zachowaj pisownię, wielkość liter i interpunkcję, kroje pisma jak w SVG.`,
    });
  }

  // Layer structure before materials — model must know WHAT it's building
  // (backplate → text → logo → standoffs) before learning WHAT it's made of.
  const layerStructure = buildLayerStructure(config.elements, gen);
  if (layerStructure) {
    fragments.push({ id: FRAGMENT_IDS.LAYERS, text: layerStructure });
  }

  // Materiały — grupowane po WYKOŃCZENIU (jeden opis na finisz, kolory zebrane w linii),
  // zamiast powtarzać akapit per kolor. Dystanse pomijamy (osobny fragment DISTANCE) — ich
  // kolor w SVG to placeholder roli montażowej, nie powierzchnia szyldu.
  const byFinish = new Map<string, string[]>();
  const seenColors = new Set<string>();
  for (const el of elementsWithMaterial) {
    if (el.role === "distance" || el.hasDistances) continue;
    const colorKey = el.colorHex ?? "default";
    if (seenColors.has(colorKey)) continue;
    seenColors.add(colorKey);
    const phrase = finishPhrase(el.material!, el.role);
    const arr = byFinish.get(phrase) ?? [];
    arr.push(hexLabel(el.colorHex));
    byFinish.set(phrase, arr);
  }
  if (byFinish.size > 0) {
    const lines = [...byFinish.entries()].map(([phrase, labels]) => `${labels.join(", ")} → ${phrase}`);
    fragments.push({
      id: FRAGMENT_IDS.MATERIALS,
      text: `Materiały (rozpoznaj element po jego kolorze hex z SVG): ${lines.join("; ")}.`,
    });
  }

  // Dystanse — całość opisu w jednym fragmencie: montaż (odsunięcie od ściany) + wykończenie
  // łbów z MATERIAŁU (satynowy złoty/srebrny metal lub czarny mat). Barwa z material.color_hex.
  const distanceEl =
    elementsWithMaterial.find((el) => el.hasDistances) ??
    elementsWithMaterial.find((el) => el.role === "distance");
  if (distanceEl?.material) {
    fragments.push({
      id: FRAGMENT_IDS.DISTANCE,
      text:
        `${capNn} zamontowany na metalowych dystansach, odsunięty od ściany o ok. 20–30 mm. ` +
        `Widoczne w narożnikach łby dystansów: ${describeDistanceFinish(distanceEl.material)}.`,
    });
  } else if (config.hasDistances) {
    fragments.push({
      id: FRAGMENT_IDS.DISTANCE,
      text: `${capNn} zamontowany na metalowych dystansach, odsunięty od ściany o ok. 20–30 mm.`,
    });
  }

  // LED — per-element flags take priority over global toggle.
  const perElementBacklit = config.elements.filter((el) => el.ledBacklit && el.colorHex);
  const perElementFrontlit = config.elements.filter((el) => el.ledFrontlit && el.colorHex);
  const anyPerElementLed = perElementBacklit.length > 0 || perElementFrontlit.length > 0;

  function ledSpec(cfg: LedConfig["backlit"]): string {
    const parts2: string[] = [`kolor ${cfg.color}`];
    // Czytelna nazwa barwy ("ciepłobiały"/"zimno-biały") to dla modelu obrazowego
    // dużo silniejszy sygnał temperatury światła niż sam hex czy goła liczba K.
    // Pomijamy generyczne "niestandardowy" (color picker) — nie niesie informacji.
    if (cfg.colorName && cfg.colorName !== "niestandardowy") parts2.push(cfg.colorName);
    if (cfg.kelvin != null) parts2.push(`${cfg.kelvin}K`);
    if (cfg.lumens != null) parts2.push(`${cfg.lumens} lm`);
    return parts2.join(", ");
  }

  if (perElementBacklit.length > 0) {
    const hexes = [...new Set(perElementBacklit.map((el) => el.colorHex!))].join(", ");
    fragments.push({
      id: FRAGMENT_IDS.LED_BACKLIT,
      text:
        `Tylne podświetlenie LED obejmuje wyłącznie elementy SVG w kolorach: ${hexes} (${ledSpec(config.led.backlit)}) — świeci tylko za nimi.`,
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
        `Przednie oświetlenie LED obejmuje wyłącznie elementy SVG w kolorach: ${hexes} (${ledSpec(config.led.frontlit)}) — oświetla od przodu tylko je.`,
    });
  } else if (!anyPerElementLed && config.led.frontlit.enabled) {
    fragments.push({
      id: FRAGMENT_IDS.LED_FRONTLIT,
      text: `Przednie oświetlenie LED (${ledSpec(config.led.frontlit)}).`,
    });
  }

  // JAWNY NEGATYW — bez tego model rozświetla CAŁY szyld i ignoruje wybór per-element.
  // Image-modele traktują "to podświetlany szyld LED" jako sygnał globalny; sam pozytyw
  // ("świecą tylko te") jest za słaby — trzeba wprost wyliczyć które kolory są wyłączone
  // (ta sama mechanika co negatywy w fixie perspektywy). Kolory współdzielone z elementami
  // świecącymi pomijamy, by nie tworzyć sprzeczności (model nie odróżni dwóch elementów
  // o identycznym kolorze — to ograniczenie identyfikacji po hex).
  if (anyPerElementLed) {
    const litHexes = new Set(
      [...perElementBacklit, ...perElementFrontlit].map((el) => el.colorHex!)
    );
    const unlitHexes = [
      ...new Set(
        config.elements
          .filter((el) => el.colorHex && !el.ledBacklit && !el.ledFrontlit)
          .map((el) => el.colorHex!)
      ),
    ].filter((h) => !litHexes.has(h));
    if (unlitHexes.length > 0) {
      fragments.push({
        id: FRAGMENT_IDS.LED_UNLIT,
        text:
          `WAŻNE — pozostałe elementy SVG (kolory: ${unlitHexes.join(", ")}) NIE są podświetlone: ` +
          `nie emitują światła, nie mają poświaty, halo ani efektu glow, diody przy nich są wyłączone. ` +
          `Renderuj je jako zwykłą, nieświecącą plexę oświetloną wyłącznie światłem otoczenia.`,
      });
    }
  }

  // Kamerę pomijamy gdy jest TŁO — perspektywę dyktuje wtedy zdjęcie (gałąź ZADANIA
  // blokuje "perspektywa i kąt kamery bez zmian"), więc "obróć kamerę o X°" tworzyłoby
  // sprzeczność i model i tak trzyma się kąta fotografii. Kąt dla projektów z tłem
  // zmienia się przez edit_background_angle ("Zastosuj kąt do tła" w CameraAngleSection).
  if (options?.cameraDirty && !visualInputs?.hasBackground) {
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
