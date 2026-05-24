import type { SignConfig, CameraConfig, TimeOfDay, Material, SignElement, LedConfig } from "../types";
import { PRODUCT_TYPE_PRESETS } from "../types";

/**
 * Polskie odmiany rzeczownika dla typu produktu — mianownik + dopełniacz.
 * `productType` to wartość z `projects.product_type`: ID presetu z listy LUB
 * dowolny tekst (gdy user wybrał "Inne"). NULL/undefined → "szyld" jako default.
 *
 * Dla wartości spoza presetów (custom z "Inne") oba pola zwracają ten sam tekst —
 * AI dostaje surową frazę bez odmiany (lepsze niż żadna informacja).
 */
export function getProductNoun(productType: string | null | undefined): { nominative: string; genitive: string } {
  if (!productType) return { nominative: "szyld", genitive: "szyldu" };
  const preset = PRODUCT_TYPE_PRESETS.find((p) => p.id === productType);
  if (preset) return { nominative: preset.nounNominative, genitive: preset.nounGenitive };
  // Custom text z "Inne" — bez polskiej odmiany
  return { nominative: productType, genitive: productType };
}

export interface VisualInputs {
  hasBackground: boolean;
  hasSvg: boolean;
  /** Liczba zdjęć materiałów dołączonych do żądania — wpływa na opis "Obraz N" w prompcie. */
  materialImageCount?: number;
  /** Liczba zdjęć referencyjnych dołączonych do żądania. */
  referenceImageCount?: number;
  /**
   * Opisy zdjęć referencyjnych (user-defined). Indeks w tej tablicy odpowiada
   * indeksowi w `reference_images` wysyłanym do AI. Pusta tablica lub brak opisu
   * → generyczny "dodatkowa inspiracja stylistyczna".
   */
  referenceDescriptions?: string[];
  /** Teksty wyciągnięte z SVG (z <text> i <tspan>) — AI ma odwzorować DOSŁOWNIE. */
  svgTexts?: string[];
  /**
   * Mapa materialId → relatywny indeks w tablicy material_images (0-based).
   * Wykorzystywane do deduplikacji — wiele elementów z tym samym materiałem dzieli
   * jeden Image N, zamiast każdy mieć osobne zdjęcie.
   */
  materialIdToImageIdx?: Record<string, number>;
}

/**
 * Aktywny preset z anchorem — pozycją w prompcie. Anchor to ID auto-fragmentu
 * po którym preset ma być wstawiony, albo specjalna wartość:
 *   - `__start__` — przed pierwszym fragmentem
 *   - `__end__` — na samym końcu (default)
 * Jeśli anchor odnosi się do fragmentu który NIE istnieje w bieżącym składaniu
 * (np. preset ma anchor "led-backlit", ale LED jest wyłączone), preset spada
 * na koniec.
 */
export interface PresetEntry {
  id: string;
  label: string;
  text: string;
  anchor?: string;
}

export interface AssembleOptions {
  cameraDirty?: boolean;
  /** Teksty włączonych presetów — dołączane na końcu (legacy, gdy brak `presets`). */
  presetTexts?: string[];
  /** Aktywne presety z anchorami — wstawiane na konkretnych pozycjach. */
  presets?: PresetEntry[];
  /**
   * Pseudo-preset "Środowisko" — wstawiany jak zwykły preset (przeciągalny, edytowalny).
   * Null/undefined = brak środowiska w prompcie.
   */
  timeOfDayPreset?: { text: string; anchor?: string } | null;
}

/**
 * Element promptu — auto-generowany fragment lub wstawiony preset. UI używa tej
 * struktury do renderowania promptu jako sekwencji tekstu i klikalnych badges.
 */
export type PromptItem =
  | { kind: "fragment"; id: string; text: string }
  | { kind: "preset"; presetId: string; label: string; text: string };

/** Identyfikatory auto-fragmentów — stabilne między rerenderami (do anchorów presetów). */
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

/**
 * Polskie opisy powierzchni materiału. Wcześniejsze wersje były dwujęzyczne PL+EN —
 * założenie było, że modele lepiej rozumieją angielskie terminy techniczne. Przy
 * ujednoliceniu języka aplikacji zostają same polskie opisy (modele Gemini / GPT-Image
 * radzą sobie z polskim i odbiorca-użytkownik czyta podgląd promptu).
 */
const MATERIAL_TYPE_DESCRIPTIONS: Record<string, string> = {
  matowa: "matowy, nieprzezierny panel z akrylu o gładkim, aksamitnym wykończeniu",
  mleczna: "mleczny, półprzezroczysty panel z akrylu o miękkiej dyfuzji światła",
  polysk: "panel z akrylu z połyskiem, polerowany, z gładkimi lustrzanymi odbiciami",
  lustro: "panel z akrylu o wykończeniu lustrzanym, w pełni refleksyjny, odbijający otoczenie",
};

/** Opisy materiału po kategorii — używane gdy material_type jest puste. */
const MATERIAL_CATEGORY_HINTS: Record<string, string> = {
  pleksa: "panel z plexy (szkła akrylowego)",
  dibond: "panel Dibond — szczotkowany aluminiowy kompozyt",
  hdf: "panel HDF — twarda płyta drewnopochodna o gładkiej, lakierowanej powierzchni",
  metal: "polerowany panel metalowy o subtelnej, szczotkowanej fakturze",
  dystans: "polerowane metalowe dystanse montażowe",
  inne: "sztywny materiał konstrukcyjny szyldu",
};

/**
 * Mapowanie grubości materiału w mm → opis względny dla AI.
 *
 * KRYTYCZNE: modele generatywne NIE rozumieją milimetrów jako jednostki fizycznej —
 * "3mm thick" to dla nich tylko fraza. Reagują na PROPORCJE na obrazie. Dlatego
 * mapujemy wartość liczbową na opis względny ("cienki", "średni", "gruby"), który
 * AI rozumie wizualnie. Wartość mm zostaje dorzucona jako wskazówka liczbowa
 * (`(3mm)`) ale głównym sygnałem jest słowo opisowe.
 */
function describeThickness(thicknessMm: number | null): string | null {
  if (thicknessMm == null || thicknessMm <= 0) return null;
  if (thicknessMm < 5) {
    return `cienki profil (${thicknessMm}mm), subtelnie widoczna krawędź boczna`;
  }
  if (thicknessMm < 15) {
    return `średnia grubość (${thicknessMm}mm), wyraźnie widoczna krawędź boczna jako pasek`;
  }
  if (thicknessMm < 30) {
    return `gruby profil (${thicknessMm}mm), wyraźna trójwymiarowa głębia, mocno widoczna krawędź boczna`;
  }
  return `bardzo gruby, masywny profil (${thicknessMm}mm), dominująca głębia 3D, krawędź boczna jako duży pas`;
}

/**
 * Buduje opis warstwowości produktu dla AI. Bez tego model dostaje płaską mapę
 * kolorów i renderuje napisy w jednej płaszczyźnie z tłem, bez głębi.
 *
 * Struktura: backplate na spodzie, dekoracje, logo, napisy na wierzchu (z głębią).
 * Jeśli są dystanse — cały produkt stoi na nich, oddalony od ściany.
 */
function buildLayerStructure(elements: SignElement[], productNoun: { nominative: string; genitive: string }): string | null {
  const byRole: Record<string, SignElement[]> = {
    backplate: [],
    decoration: [],
    logo: [],
    text: [],
    distance: [],
    cutout: [],
  };
  for (const el of elements) {
    if (el.role) byRole[el.role]?.push(el);
  }

  // Mapa nodeId → element (do rozwiązywania cutoutBackingId → kolor warstwy pod spodem)
  const byNodeId = new Map(elements.map((el) => [el.nodeId, el]));

  const lines: string[] = [];

  const nn = productNoun.nominative;
  const gg = productNoun.genitive;

  if (byRole.distance.length > 0) {
    lines.push(
      `- Dystanse: cały ${nn} zamontowany na metalowych dystansach, odsunięty od ściany ` +
      `o około 20–30 mm, rzucający miękki cień na ścianę za ${gg}`
    );
  }

  if (byRole.backplate.length > 0) {
    const colors = [...new Set(byRole.backplate.map((e) => e.colorHex ?? "domyślny"))].join(", ");
    lines.push(`- Tło ${gg} (backplate, warstwa najgłębsza): regiony ${colors} w SVG, płaski panel bazowy`);
  }

  if (byRole.decoration.length > 0) {
    const colors = [...new Set(byRole.decoration.map((e) => e.colorHex ?? "domyślny"))].join(", ");
    lines.push(
      `- Dekoracje (warstwa nad tłem): regiony ${colors} w SVG, nałożone NA tło ${gg}, ` +
      `delikatnie wystające, rzucające subtelny cień na backplate poniżej`
    );
  }

  if (byRole.logo.length > 0) {
    const colors = [...new Set(byRole.logo.map((e) => e.colorHex ?? "domyślny"))].join(", ");
    lines.push(
      `- Logo (warstwa nad tłem): regiony ${colors} w SVG, zamontowane NA tle ${gg} jako ` +
      `wystający, przestrzenny element, rzucające widoczny cień na backplate poniżej`
    );
  }

  if (byRole.text.length > 0) {
    const colors = [...new Set(byRole.text.map((e) => e.colorHex ?? "domyślny"))].join(", ");
    lines.push(
      `- Napisy (warstwa wierzchnia): regiony ${colors} w SVG, litery jako OSOBNE wystające ` +
      `elementy zamontowane NA tle ${gg} (nie wtopione w tło), rzucające wyraźny cień na ` +
      `backplate pod nimi — głębia liter musi być wizualnie widoczna`
    );
  }

  // CUTOUT — warstwa z fizycznie wyciętymi otworami, przez które widać warstwę
  // pod spodem. Krytyczne dla typowych szyldów wielowarstwowych (np. niebieska
  // plexa z wyciętymi literami, przez które widać czerwoną plexę spodnią).
  if (byRole.cutout.length > 0) {
    for (const el of byRole.cutout) {
      const myColor = el.colorHex ?? "domyślny";
      const backing = el.cutoutBackingId ? byNodeId.get(el.cutoutBackingId) : null;
      const backingColor = backing?.colorHex ?? "warstwy pod spodem";
      lines.push(
        `- Warstwa z wycięciem: region ${myColor} w SVG to plexa nałożona NA inną plexę ` +
        `(${backingColor}) z FIZYCZNIE WYCIĘTYMI otworami w kształcie widocznych w niej elementów. ` +
        `Krawędzie wycięć są ostre (cięte laserem), wyraźne. Przez wycięte otwory widać ` +
        `dolną plexę w kolorze ${backingColor}. Warstwa górna (${myColor}) ma własną grubość — ` +
        `wycięcia wyglądają jak okienka z widoczną głębią ścianek bocznych, lekki cień rzucany ` +
        `od krawędzi wycięcia na warstwę dolną.`
      );
    }
  }

  if (lines.length === 0) return null;
  return `Warstwy ${gg} (od spodu do wierzchu):\n${lines.join("\n")}`;
}

/**
 * Buduje techniczny opis materiału dla AI — BEZ polskiej nazwy z biblioteki.
 *
 * KRYTYCZNE: NIE używać `m.name`. Polskie nazwy typu "Plexa czerwona" / "Niebieska"
 * były interpretowane przez Gemini jako TEKST do narysowania na szyldzie (zobaczone
 * w generowanych obrazach: "CZERWONA NIEBIESKA" jako wielkie litery).
 */
function describeMaterial(m: Material): string {
  const surface = m.material_type ? MATERIAL_TYPE_DESCRIPTIONS[m.material_type] : null;
  const categoryHint = MATERIAL_CATEGORY_HINTS[m.category];
  return surface ?? categoryHint ?? "sztywny materiał konstrukcyjny szyldu";
}

/**
 * Buduje opis elementu szyldu dla AI: kolor hex + typ powierzchni + grubość +
 * ewentualne zdjęcie referencyjne + ewentualny opis refleksji.
 *
 * Kolejność priorytetów (KRYTYCZNE — wcześniej zdjęcie zawsze wygrywało, co
 * łamało lustro/połysk: zdjęcie referencyjne lustra to płaski "tint hue", a AI
 * traktowała go jako "tak ma wyglądać powierzchnia"):
 *
 *   1. material_type=lustro/polysk → ścieżka refleksyjna ZAWSZE wygrywa; ewentualne
 *      zdjęcie idzie tylko jako "tint hue reference"
 *   2. inne typy + zdjęcie referencyjne → zdjęcie ma PRIORYTET
 *   3. inne typy + brak zdjęcia → opis materiału + kolor hex
 */
function describeElementMaterial(
  m: Material,
  colorHex: string | null,
  thicknessMm: number | null,
  hasReferencePhoto: boolean,
  referenceImageIndex: number | null,
  hasBackground: boolean
): string {
  const color = colorHex ?? "domyślny";
  const thicknessDesc = describeThickness(thicknessMm);
  const thicknessSuffix = thicknessDesc ? `, ${thicknessDesc}` : "";

  // ── Ścieżka 1: lustro / połysk — refleksyjne powierzchnie ──────────────
  // Zdjęcie referencyjne (jeśli jest) służy tu TYLKO jako wskazówka koloru tintu,
  // NIE jako tekstura powierzchni. Lustro odbija otoczenie, nie ma "własnej" faktury.
  if (m.material_type === "lustro" || m.material_type === "polysk") {
    const isLustro = m.material_type === "lustro";
    const surface = isLustro
      ? "wysokopolerowany, lustrzany panel akrylowy, w pełni refleksyjny"
      : "panel z akrylu o wysokim połysku, polerowany, z silnymi lustrzanymi odbiciami";

    // Źródło refleksji — kompozyt (Obraz 1) lub fallback dla monochromatycznego tła
    const reflectionDesc = hasBackground
      ? `odbijający otoczenie widoczne na Obrazie 1 (ściana, sufit, światła, meble, wystrój) ` +
        `— refleksy powinny pasować do tej konkretnej sceny`
      : `z subtelnymi miękkimi rozbłyskami światła otoczenia (soft ambient highlights), ` +
        `bez wyraźnych, szczegółowych odbić — neutralne studyjne otoczenie`;

    const tintRef = hasReferencePhoto && referenceImageIndex != null
      ? `, z subtelnym przebarwieniem (tint) w tonie z Obrazu ${referenceImageIndex} ` +
        `(Obraz ${referenceImageIndex} pokazuje DOMINUJĄCY ODCIEŃ refleksji — NIE jest teksturą powierzchni)`
      : colorHex
        ? `, z subtelnym przebarwieniem (tint) w tonie ${color}`
        : "";

    return (
      `region o kolorze ${color} w SVG → ${surface}, ${reflectionDesc}${tintRef}${thicknessSuffix} ` +
      `(kolor ${color} to identyfikator regionu w SVG — większość powierzchni pokazuje REFLEKSY, ` +
      `nie ten kolor)`
    );
  }

  // ── Ścieżka 2: zdjęcie referencyjne ma PRIORYTET (nie-lustro/połysk) ───
  if (hasReferencePhoto && referenceImageIndex != null) {
    return (
      `region o kolorze ${color} w SVG → użyj dokładnie tej samej tekstury, koloru i wykończenia, ` +
      `co na Obrazie ${referenceImageIndex} (zdjęcie referencyjne materiału)${thicknessSuffix}. ` +
      `Kolor hex ${color} jest tu wyłącznie identyfikatorem regionu w SVG, NIE rzeczywistym kolorem materiału`
    );
  }

  // ── Ścieżka 3: standard ────────────────────────────────────────────────
  return `region o kolorze ${color} w SVG → ${describeMaterial(m)} w kolorze ${color}${thicknessSuffix}`;
}

/**
 * Opis pory dnia / oświetlenia. Gdy `hasBackground = true`, opisy są wyłączone dla
 * "wnętrza" i mocno przycięte dla pozostałych — istniejące tło już DEFINIUJE scenę,
 * a dorzucanie "profesjonalnej aranżacji architektonicznej" sprawia, że AI generuje
 * nową scenę zamiast zachować tę z input image.
 */
export function buildTimeOfDayPrompt(
  timeOfDay: TimeOfDay,
  ledActive: boolean,
  hasBackground: boolean = false,
  productNoun: { nominative: string; genitive: string } = { nominative: "szyld", genitive: "szyldu" }
): string {
  const gg = productNoun.genitive;
  const nn = productNoun.nominative;
  const capNn = nn.charAt(0).toUpperCase() + nn.slice(1);
  switch (timeOfDay) {
    case "brak":
      return "";
    case "dzien":
      if (hasBackground) {
        return "Styl renderowania: jasne dzienne światło naturalne, ostre cienie spójne z istniejącą sceną.";
      }
      return (
        "Zdjęcie wykonane w ciągu dnia przy pełnym naturalnym świetle słonecznym. " +
        "Błękitne niebo, wyraźne ostre cienie, jasna i kontrastowa ekspozycja."
      );
    case "wieczor":
      if (hasBackground) {
        return (
          "Styl renderowania: ciepłe światło złotej godziny. " +
          (ledActive
            ? `Podświetlenie LED ${gg} jest wyraźnie widoczne i kontrastuje z ciepłym światłem otoczenia.`
            : "Miękkie, ciepłe światło otoczenia spójne z istniejącą sceną.")
        );
      }
      return (
        "Ujęcie o zmierzchu podczas złotej godziny zachodzącego słońca. " +
        "Niebo w odcieniach pomarańczu, różu i fioletu. Miękkie, ciepłe oświetlenie otoczenia. " +
        (ledActive
          ? `Oświetlenie ${gg} wyraźnie widoczne i kontrastowe na tle ciemniejącego nieba.`
          : "Fasada budynku oświetlona ciepłą, zmierzchową poświatą.")
      );
    case "noc":
      if (hasBackground) {
        return (
          "Styl renderowania: noc, ciemne otoczenie. " +
          (ledActive
            ? `Podświetlenie LED ${gg} jest głównym źródłem światła — rzuca miękką poświatę na sąsiednie powierzchnie.`
            : "Subtelne światło sztuczne spójne z istniejącą sceną.")
        );
      }
      return (
        "Ujęcie nocne. Ciemne niebo, sztuczne oświetlenie miejskie — latarnie, refleksy okien. " +
        (ledActive
          ? `${capNn} intensywnie podświetlony LED, wyraźna poświata i aureola światła wokół liter, ` +
            "refleksy na mokrym asfalcie poniżej."
          : `${capNn} widoczny w świetle ulicznym, ciemne, dramatyczne otoczenie nocnego miasta.`)
      );
    case "wnetrze":
      // KRYTYCZNE: gdy jest tło, NIE generujemy idealnego wnętrza. Tło z input image
      // już DEFINIUJE wnętrze; dodanie "profesjonalnej aranżacji architektonicznej"
      // powodowało, że AI tworzyła nową scenę (recepcję zamiast biura użytkownika).
      if (hasBackground) {
        return "";
      }
      return (
        "Szyld zamontowany wewnątrz pomieszczenia — przestrzeń biurowa, sklep lub reprezentacyjny " +
        "hall wejściowy. Sztuczne oświetlenie sufitowe, neutralne lub ciepłe światło wnętrza, " +
        "czyste tło architektoniczne, profesjonalna aranżacja."
      );
  }
}

/**
 * Imperatywny opis ustawienia kamery — wzorowany na Qwen-Image-Edit-Angles, ale po
 * polsku. Granularność co 15° dla rotacji, opisy intensywności dla forward i tilt.
 */
export function buildCameraPrompt(
  rotateDeg: CameraConfig["rotateDeg"],
  moveForward: CameraConfig["moveForward"],
  verticalTilt: CameraConfig["verticalTilt"]
): string {
  const parts: string[] = [];

  // ── Rotacja ─────────────────────────────────────────────────────────────
  const absR = Math.abs(rotateDeg);
  if (absR >= 1) {
    const dirPl = rotateDeg > 0 ? "lewo" : "prawo";
    parts.push(`Obróć kamerę o ${absR}° w ${dirPl}.`);
  }

  // ── Forward (odległość / zoom) ──────────────────────────────────────────
  if (moveForward >= 9) {
    parts.push("Przesuń kamerę bardzo blisko — bardzo bliskie zbliżenie.");
  } else if (moveForward >= 7) {
    parts.push("Przesuń kamerę blisko — zbliżenie.");
  } else if (moveForward >= 5) {
    parts.push("Ujęcie z bliska, kamera lekko przybliżona.");
  } else if (moveForward >= 3) {
    parts.push("Średnia odległość kamery.");
  } else if (moveForward >= 1) {
    parts.push("Większa odległość kamery, ujęcie szersze.");
  } else {
    parts.push("Kamera z daleka, perspektywa uliczna.");
  }

  // ── Pochylenie pionowe ──────────────────────────────────────────────────
  if (verticalTilt <= -0.7) {
    parts.push("Mocno pochyl kamerę z góry — widok ptasi.");
  } else if (verticalTilt <= -0.3) {
    parts.push("Lekko pochyl kamerę z góry.");
  } else if (verticalTilt >= 0.7) {
    parts.push("Mocno pochyl kamerę z dołu — widok żabi.");
  } else if (verticalTilt >= 0.3) {
    parts.push("Lekko pochyl kamerę z dołu.");
  }

  return parts.join(" ");
}

/**
 * Buduje listę auto-fragmentów promptu (bez presetów). Każdy fragment ma stabilne
 * ID — używane do anchorowania presetów ("wstaw po fragmencie X"). Brak fragmentu
 * (np. LED wyłączone) → presety z tym anchorem spadają na koniec.
 *
 * @internal — zewnętrznie używaj `assemblePromptItems` (zwraca listę z presetami
 * w odpowiednich miejscach) lub `assemblePrompt` (zwraca string).
 */
export function assemblePromptFragments(
  config: SignConfig,
  visualInputs?: VisualInputs,
  options?: AssembleOptions
): Array<{ id: string; text: string }> {
  const fragments: Array<{ id: string; text: string }> = [];

  const CATEGORY_ORDER: Record<string, number> = {
    pleksa: 0,
    dibond: 1,
    hdf: 2,
    metal: 3,
    inne: 4,
    dystans: 5,
  };

  const elementsWithMaterial = config.elements
    .filter((el) => el.material)
    .sort((a, b) => {
      const oa = CATEGORY_ORDER[a.material!.category] ?? 4;
      const ob = CATEGORY_ORDER[b.material!.category] ?? 4;
      return oa - ob;
    });

  // Polskie odmiany nazwy produktu — używane w opisach dla AI ("szyldu" →
  // "tabliczki informacyjnej", "numeru na dom", ...). Default = "szyld".
  const productNoun = getProductNoun(config.productType);

  // ── STRUKTURA PROMPTU ───────────────────────────────────────────────────
  // Wzorzec mockup od Google Cloud (oficjalny guide Nano Banana, 2026):
  //   "Using the attached [sketch] as the structure and the attached [sample]
  //    as the texture, transform this into a high-fidelity [object] render."
  //
  // KRYTYCZNE: pozytywny język ("Zachowaj X dokładnie jak widać"), NIE negatywny
  // ("Nie zmieniaj X"). Modele transformerowe gorzej radzą sobie z negacjami.
  // ────────────────────────────────────────────────────────────────────────

  // Mapowanie: nodeId → numer "Obraz N" w prompcie (dla elementów ze zdjęciem materiału).
  const elementToImageIdx: Record<string, number> = {};

  if (visualInputs) {
    const imgRefs: string[] = [];
    let imgIdx = 1;

    if (visualInputs.hasSvg && visualInputs.hasBackground) {
      // KOMPOZYT — najczęstszy przypadek (tło + schematyczny SVG nałożony)
      imgRefs.push(
        `ZADANIE: fotorealistyczna wizualizacja ${productNoun.genitive} (mockup). ` +
          `Obraz ${imgIdx} to PRAWDZIWE ZDJĘCIE wnętrza z nałożoną schematyczną nakładką SVG ` +
          `(płaskie, kolorowe kształty pokazujące planowane położenie, rozmiar i kształt ${productNoun.genitive} na ścianie).` +
          `\n\n` +
          `Biorąc Obraz ${imgIdx} jako bazową scenę i kolorowe kształty SVG jako strukturę ` +
          `umieszczenia, przekształć schematyczne kształty w fotorealistyczny ${productNoun.nominative} wykonany ` +
          `z materiałów opisanych poniżej.` +
          `\n\n` +
          `Zachowaj CAŁĄ scenę z Obrazu ${imgIdx} dokładnie tak, jak jest widoczna — tę samą fakturę ścian, ` +
          `ten sam sufit, tę samą podłogę, te same meble i wystrój, te same osoby i ich pozy, ` +
          `te same rośliny i przedmioty, to samo światło z okien i oświetlenie otoczenia, ` +
          `ten sam kąt kamery i perspektywę. Wynik musi wyglądać jak to samo zdjęcie, ` +
          `tylko ze schematycznym regionem SVG zastąpionym gotowym renderem ${productNoun.genitive}.` +
          `\n\n` +
          `Wyrenderowany ${productNoun.nominative} powinien zajmować dokładnie tę samą pozycję i skalę co schematyczne ` +
          `kształty SVG na Obrazie ${imgIdx}, rzucać naturalne cienie zgodne z istniejącym oświetleniem sceny ` +
          `oraz realistycznie odbijać światło otoczenia z widocznego środowiska.`
      );
      imgIdx++;
    } else if (visualInputs.hasSvg) {
      imgRefs.push(
        `ZADANIE: fotorealistyczny render ${productNoun.genitive}. ` +
          `Obraz ${imgIdx} to schematyczny projekt SVG (płaskie, kolorowe kształty pokazujące układ ${productNoun.genitive}). ` +
          `Wyrenderuj go jako fotorealistyczny ${productNoun.nominative} wykonany z materiałów opisanych poniżej, ` +
          `z naturalnym studyjnym oświetleniem i czystym, neutralnym tłem.`
      );
      imgIdx++;
    } else if (visualInputs.hasBackground) {
      imgRefs.push(
        `ZADANIE: dodaj ${productNoun.nominative} do istniejącego zdjęcia. ` +
          `Obraz ${imgIdx} to PRAWDZIWE ZDJĘCIE ściany wnętrza. ` +
          `Zachowaj CAŁĄ scenę dokładnie tak, jak jest widoczna — tę samą ścianę, ten sam sufit, tę samą podłogę, ` +
          `te same meble, to samo światło i cienie. ` +
          `Dodaj opisany poniżej ${productNoun.nominative} na ścianę — z naturalnymi cieniami zgodnymi z istniejącym ` +
          `oświetleniem i z realistycznymi refleksami światła otoczenia.`
      );
      imgIdx++;
    }

    // DEDUPLIKACJA materiałów: jedna wzmianka per unikalny materiał (zamiast per element).
    const matIdMap = visualInputs.materialIdToImageIdx ?? {};
    if (elementsWithMaterial.length > 0 && Object.keys(matIdMap).length > 0) {
      const materialGroups = new Map<
        string,
        { material: typeof elementsWithMaterial[number]["material"]; regions: string[]; nodeIds: string[] }
      >();
      for (const el of elementsWithMaterial) {
        const mat = el.material;
        if (!mat?.id || !mat.photo_path) continue;
        const existing = materialGroups.get(mat.id);
        const region = el.colorHex ?? "domyślny";
        if (existing) {
          if (!existing.regions.includes(region)) existing.regions.push(region);
          existing.nodeIds.push(el.nodeId);
        } else {
          materialGroups.set(mat.id, { material: mat, regions: [region], nodeIds: [el.nodeId] });
        }
      }

      const matRefs: string[] = [];
      for (const [matId, group] of materialGroups) {
        const relativeIdx = matIdMap[matId];
        if (relativeIdx == null) continue;
        const thisImgIdx = imgIdx + relativeIdx;
        const regions = group.regions.join(", ");
        const elementToken = group.regions.length > 1 ? "elementów" : "elementu";
        // KRYTYCZNE: dla materiałów połysk/lustro NIE pisz "nałóż dokładnie tę teksturę" —
        // ten opis JEST SPRZECZNY z opisem w `describeElementMaterial`, który mówi że
        // zdjęcie to tylko "tint hue reference" (większość powierzchni to refleksy
        // otoczenia, nie tekstura ze zdjęcia). Dwie sprzeczne instrukcje powodowały
        // że AI losowo wybierała jedną interpretację. Dla połysku/lustra zostawiamy
        // tylko opis z `describeElementMaterial` (pełniejszy i spójny).
        const mat = group.material;
        if (mat?.material_type === "lustro" || mat?.material_type === "polysk") {
          // Mapowanie nodeId → imgIdx zachowane (potrzebne w describeElementMaterial),
          // ale wzmianki w `imgRefs` (sekcji wprowadzającej) pomijamy.
          for (const nid of group.nodeIds) {
            elementToImageIdx[nid] = thisImgIdx;
          }
          continue;
        }
        matRefs.push(
          `Obraz ${thisImgIdx} to próbka tekstury materiału — nałóż dokładnie tę teksturę, kolor i ` +
            `wykończenie na ${elementToken} odpowiadającego regionowi SVG ${regions}`
        );
        for (const nid of group.nodeIds) {
          elementToImageIdx[nid] = thisImgIdx;
        }
      }
      if (matRefs.length > 0) {
        imgRefs.push(matRefs.join("; "));
      }
      imgIdx += Object.keys(matIdMap).length;
    }
    const refCount = visualInputs.referenceImageCount ?? 0;
    if (refCount > 0) {
      const descs = visualInputs.referenceDescriptions ?? [];
      const refStart = imgIdx;
      // Jeśli user dał choć jeden opis, opisujemy każdą referencję osobno z jej opisem.
      // Inaczej zbiorczy fallback "dodatkowe inspiracje stylistyczne".
      const hasAnyDesc = descs.some((d) => d && d.trim().length > 0);
      if (hasAnyDesc) {
        const refLines: string[] = [];
        for (let i = 0; i < refCount; i++) {
          const idx = refStart + i;
          const desc = (descs[i] ?? "").trim();
          if (desc) {
            refLines.push(`Obraz ${idx}: ${desc}`);
          } else {
            refLines.push(`Obraz ${idx}: dodatkowa inspiracja stylistyczna`);
          }
        }
        imgRefs.push(refLines.join("; "));
      } else {
        const refEnd = refStart + refCount - 1;
        const range = refStart === refEnd ? `Obraz ${refStart}` : `Obrazy ${refStart}–${refEnd}`;
        imgRefs.push(
          `${range} to dodatkowe inspiracje stylistyczne (użyj jako referencji dla jakości wykończenia i światła)`
        );
      }
    }
    if (imgRefs.length > 0) {
      fragments.push({ id: FRAGMENT_IDS.TASK, text: imgRefs.join(". ") + "." });
    }
  }

  // TEKSTY z SVG — pozytywny format, bez negacji.
  const svgTexts = visualInputs?.svgTexts ?? [];
  if (svgTexts.length > 0) {
    const quoted = svgTexts.map((t) => `„${t}"`).join(", ");
    fragments.push({
      id: FRAGMENT_IDS.SVG_TEXTS,
      text:
        `Wyrenderuj widoczne teksty dokładnie tak, jak widać w projekcie SVG, znak po znaku: ${quoted}. ` +
        `Użyj tych samych krojów pisma, odstępów i wielkości liter co w SVG.`,
    });
  }

  // Materiały elementów — trzy ścieżki w `describeElementMaterial`.
  // Deduplikacja po (colorHex + thicknessMm + role): te trzy razem identyfikują
  // unikalny "wariant elementu". Dwa napisy w tym samym kolorze i grubości mają
  // identyczny opis — jeden wystarczy. Ale ten sam kolor w innej grubości lub
  // innej roli (np. czerwone tło vs czerwone litery) zasługuje na osobny opis.
  const hasBg = !!visualInputs?.hasBackground;
  const seenKeys = new Set<string>();
  const materialDescriptions: string[] = [];
  for (const el of elementsWithMaterial) {
    const colorKey = el.colorHex ?? "domyślny";
    const dedupKey = `${colorKey}|${el.thicknessMm ?? ""}|${el.role ?? ""}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    const hasPhoto = !!el.material!.photo_path;
    const imageIdx = elementToImageIdx[el.nodeId] ?? null;
    materialDescriptions.push(
      describeElementMaterial(el.material!, el.colorHex, el.thicknessMm, hasPhoto, imageIdx, hasBg)
    );
  }
  if (materialDescriptions.length > 0) {
    fragments.push({
      id: FRAGMENT_IDS.MATERIALS,
      text:
        `Materiały elementów ${productNoun.genitive} (identyfikuj każdy element po jego kolorze hex w SVG): ` +
        materialDescriptions.join("; ") +
        ".",
    });
  }

  // Warstwowość: jeśli user przypisał role, dorzuć opis hierarchii warstw
  // (backplate → dekoracje → logo → napisy). Bez tego AI dostaje płaską mapę
  // kolorów i napisy lądują w jednej płaszczyźnie z tłem.
  const layerStructure = buildLayerStructure(config.elements, productNoun);
  if (layerStructure) {
    fragments.push({ id: FRAGMENT_IDS.LAYERS, text: layerStructure });
  }

  const distanceEl = elementsWithMaterial.find((el) => el.material?.category === "dystans");
  // Pierwsza litera dużą — zaczyna nowe zdanie. Reszta zostaje w nominative.
  const capProductNoun = productNoun.nominative.charAt(0).toUpperCase() + productNoun.nominative.slice(1);
  if (distanceEl?.material) {
    fragments.push({
      id: FRAGMENT_IDS.DISTANCE,
      text: `${capProductNoun} montowany na dystansach: ${describeMaterial(distanceEl.material)}.`,
    });
  } else if (config.hasDistances) {
    fragments.push({ id: FRAGMENT_IDS.DISTANCE, text: `${capProductNoun} montowany na dystansach.` });
  }

  // ── LED ─────────────────────────────────────────────────────────────────
  // Logika: per-element flagi wygrywają z globalnym toggle. Gdy CHOĆ JEDEN element
  // ma ustawiony `ledBacklit` lub `ledFrontlit`, opisujemy LED jako listę konkretnych
  // elementów (po hex). Gdy żaden element nie ma per-element flag, działa globalny
  // toggle `config.led.backlit.enabled` / `frontlit.enabled` (backward-compat).
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
    // Per-element: lista konkretnych elementów świecących backlit
    const hexes = [...new Set(perElementBacklit.map((el) => el.colorHex!))].join(", ");
    fragments.push({
      id: FRAGMENT_IDS.LED_BACKLIT,
      text:
        `Podświetlenie LED od TYŁU (backlit) świeci tylko w elementach o kolorach SVG: ${hexes} ` +
        `(${ledSpec(config.led.backlit)}). Pozostałe elementy NIE są podświetlone od tyłu.`,
    });
  } else if (!anyPerElementLed && config.led.backlit.enabled) {
    // Fallback: globalny toggle backlit dla całego produktu
    fragments.push({
      id: FRAGMENT_IDS.LED_BACKLIT,
      text: `Podświetlenie od tyłu LED (${ledSpec(config.led.backlit)}).`,
    });
  }

  if (perElementFrontlit.length > 0) {
    const hexes = [...new Set(perElementFrontlit.map((el) => el.colorHex!))].join(", ");
    fragments.push({
      id: FRAGMENT_IDS.LED_FRONTLIT,
      text:
        `Podświetlenie LED od PRZODU (front-lit) świeci tylko w elementach o kolorach SVG: ${hexes} ` +
        `(${ledSpec(config.led.frontlit)}). Pozostałe elementy NIE są podświetlone od przodu.`,
    });
  } else if (!anyPerElementLed && config.led.frontlit.enabled) {
    fragments.push({
      id: FRAGMENT_IDS.LED_FRONTLIT,
      text: `Litery podświetlone LED od frontu (${ledSpec(config.led.frontlit)}).`,
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
 * Składa pełną listę elementów promptu (auto-fragmenty + presety w odpowiednich
 * pozycjach). UI używa tej funkcji do renderowania promptu z badgami presetów
 * wstawionymi między fragmenty. Brak `presets`/`presetTexts` → tylko fragmenty.
 *
 * Mapowanie anchorów:
 *   - anchor = ID fragmentu → preset wstawia się PO tym fragmencie
 *   - anchor = "__start__" → przed pierwszym fragmentem
 *   - anchor = "__end__" lub brak fragmentu o tym ID → na końcu
 */
export function assemblePromptItems(
  config: SignConfig,
  visualInputs?: VisualInputs,
  options?: AssembleOptions
): PromptItem[] {
  const fragments = assemblePromptFragments(config, visualInputs, options);
  const presets = options?.presets ?? [];
  const legacyTexts = options?.presetTexts ?? [];

  // Mapa: anchor → lista presetów do wstawienia PO fragmencie o tym ID.
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

  // Pseudo-preset "Środowisko" — wstawiany jak prawdziwy preset (przeciągalny, edytowalny).
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

  // Legacy: presetTexts bez anchorów lecą na koniec.
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

  // Preset z anchorem "__start__" → przed wszystkimi fragmentami
  for (const p of presetsByAnchor.get("__start__") ?? []) items.push(p);

  for (const frag of fragments) {
    items.push({ kind: "fragment", id: frag.id, text: frag.text });
    for (const p of presetsByAnchor.get(frag.id) ?? []) items.push(p);
  }

  // Preset z anchorem "__end__" → po wszystkich fragmentach
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
