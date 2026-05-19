import type { SignConfig, CameraConfig, TimeOfDay, Material } from "../types";

export interface VisualInputs {
  hasBackground: boolean;
  hasSvg: boolean;
  /** Liczba zdjęć materiałów dołączonych do żądania — wpływa na opis "Obraz N" w prompcie. */
  materialImageCount?: number;
  /** Liczba zdjęć referencyjnych dołączonych do żądania. */
  referenceImageCount?: number;
  /** Teksty wyciągnięte z SVG (z <text> i <tspan>) — AI ma odwzorować DOSŁOWNIE. */
  svgTexts?: string[];
  /**
   * Mapa materialId → relatywny indeks w tablicy material_images (0-based).
   * Wykorzystywane do deduplikacji — wiele elementów z tym samym materiałem dzieli
   * jeden Image N, zamiast każdy mieć osobne zdjęcie.
   */
  materialIdToImageIdx?: Record<string, number>;
}

export interface AssembleOptions {
  cameraDirty?: boolean;
  /** Teksty włączonych presetów — dołączane na końcu assembled promptu. */
  presetTexts?: string[];
}

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
 * Buduje opis elementu szyldu dla AI: kolor hex + typ powierzchni + ewentualne
 * zdjęcie referencyjne.
 *
 *   - jest zdjęcie referencyjne → zdjęcie ma PRIORYTET, kolor hex tylko jako identyfikator regionu
 *   - brak zdjęcia + material_type=lustro → kolor jako TINT (lustro nie ma "własnego koloru")
 *   - brak zdjęcia + inne typy → kolor jako kolor materiału
 */
function describeElementMaterial(
  m: Material,
  colorHex: string | null,
  hasReferencePhoto: boolean,
  referenceImageIndex: number | null
): string {
  const color = colorHex ?? "domyślny";

  if (hasReferencePhoto && referenceImageIndex != null) {
    return (
      `region o kolorze ${color} w SVG → użyj dokładnie tej samej tekstury, koloru i wykończenia, ` +
      `co na Obrazie ${referenceImageIndex} (zdjęcie referencyjne materiału). ` +
      `Kolor hex ${color} jest tu wyłącznie identyfikatorem regionu w SVG, NIE rzeczywistym kolorem materiału`
    );
  }

  if (m.material_type === "lustro" && colorHex) {
    return (
      `region o kolorze ${color} w SVG → ${describeMaterial(m)} z subtelnym przebarwieniem ` +
      `w tonie ${color}, w którym dominują odbicia otoczenia (kolor ${color} to jedynie ` +
      `nuta podbarwienia, NIE dominujący kolor powierzchni — większość panelu pokazuje refleksy sceny)`
    );
  }

  return `region o kolorze ${color} w SVG → ${describeMaterial(m)} w kolorze ${color}`;
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
  hasBackground: boolean = false
): string {
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
            ? "Podświetlenie LED szyldu jest wyraźnie widoczne i kontrastuje z ciepłym światłem otoczenia."
            : "Miękkie, ciepłe światło otoczenia spójne z istniejącą sceną.")
        );
      }
      return (
        "Ujęcie o zmierzchu podczas złotej godziny zachodzącego słońca. " +
        "Niebo w odcieniach pomarańczu, różu i fioletu. Miękkie, ciepłe oświetlenie otoczenia. " +
        (ledActive
          ? "Oświetlenie szyldu wyraźnie widoczne i kontrastowe na tle ciemniejącego nieba."
          : "Fasada budynku oświetlona ciepłą, zmierzchową poświatą.")
      );
    case "noc":
      if (hasBackground) {
        return (
          "Styl renderowania: noc, ciemne otoczenie. " +
          (ledActive
            ? "Podświetlenie LED szyldu jest głównym źródłem światła — rzuca miękką poświatę na sąsiednie powierzchnie."
            : "Subtelne światło sztuczne spójne z istniejącą sceną.")
        );
      }
      return (
        "Ujęcie nocne. Ciemne niebo, sztuczne oświetlenie miejskie — latarnie, refleksy okien. " +
        (ledActive
          ? "Szyld intensywnie podświetlony LED, wyraźna poświata i aureola światła wokół liter, " +
            "refleksy na mokrym asfalcie poniżej."
          : "Szyld widoczny w świetle ulicznym, ciemne, dramatyczne otoczenie nocnego miasta.")
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

export function assemblePrompt(
  config: SignConfig,
  visualInputs?: VisualInputs,
  options?: AssembleOptions
): string {
  const parts: string[] = [];

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
        `ZADANIE: fotorealistyczna wizualizacja szyldu (mockup). ` +
          `Obraz ${imgIdx} to PRAWDZIWE ZDJĘCIE wnętrza z nałożoną schematyczną nakładką SVG ` +
          `(płaskie, kolorowe kształty pokazujące planowane położenie, rozmiar i kształt szyldu na ścianie).` +
          `\n\n` +
          `Biorąc Obraz ${imgIdx} jako bazową scenę i kolorowe kształty SVG jako strukturę ` +
          `umieszczenia, przekształć schematyczne kształty w fotorealistyczny szyld wykonany ` +
          `z materiałów opisanych poniżej.` +
          `\n\n` +
          `Zachowaj CAŁĄ scenę z Obrazu ${imgIdx} dokładnie tak, jak jest widoczna — tę samą fakturę ścian, ` +
          `ten sam sufit, tę samą podłogę, te same meble i wystrój, te same osoby i ich pozy, ` +
          `te same rośliny i przedmioty, to samo światło z okien i oświetlenie otoczenia, ` +
          `ten sam kąt kamery i perspektywę. Wynik musi wyglądać jak to samo zdjęcie, ` +
          `tylko ze schematycznym regionem SVG zastąpionym gotowym szyldem.` +
          `\n\n` +
          `Wyrenderowany szyld powinien zajmować dokładnie tę samą pozycję i skalę co schematyczne ` +
          `kształty SVG na Obrazie ${imgIdx}, rzucać naturalne cienie zgodne z istniejącym oświetleniem sceny ` +
          `oraz realistycznie odbijać światło otoczenia z widocznego środowiska.`
      );
      imgIdx++;
    } else if (visualInputs.hasSvg) {
      imgRefs.push(
        `ZADANIE: fotorealistyczny render szyldu. ` +
          `Obraz ${imgIdx} to schematyczny projekt SVG (płaskie, kolorowe kształty pokazujące układ szyldu). ` +
          `Wyrenderuj go jako fotorealistyczny szyld wykonany z materiałów opisanych poniżej, ` +
          `z naturalnym studyjnym oświetleniem i czystym, neutralnym tłem.`
      );
      imgIdx++;
    } else if (visualInputs.hasBackground) {
      imgRefs.push(
        `ZADANIE: dodaj szyld do istniejącego zdjęcia. ` +
          `Obraz ${imgIdx} to PRAWDZIWE ZDJĘCIE ściany wnętrza. ` +
          `Zachowaj CAŁĄ scenę dokładnie tak, jak jest widoczna — tę samą ścianę, ten sam sufit, tę samą podłogę, ` +
          `te same meble, to samo światło i cienie. ` +
          `Dodaj opisany poniżej szyld na ścianę — z naturalnymi cieniami zgodnymi z istniejącym ` +
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
    if ((visualInputs.referenceImageCount ?? 0) > 0) {
      const refStart = imgIdx;
      const refEnd = imgIdx + (visualInputs.referenceImageCount ?? 0) - 1;
      const range = refStart === refEnd ? `Obraz ${refStart}` : `Obrazy ${refStart}–${refEnd}`;
      imgRefs.push(
        `${range} to dodatkowe inspiracje stylistyczne (użyj jako referencji dla jakości wykończenia i światła)`
      );
    }
    if (imgRefs.length > 0) {
      parts.push(imgRefs.join(". ") + ".");
    }
  }

  // TEKSTY z SVG — pozytywny format, bez negacji.
  const svgTexts = visualInputs?.svgTexts ?? [];
  if (svgTexts.length > 0) {
    const quoted = svgTexts.map((t) => `„${t}"`).join(", ");
    parts.push(
      `Wyrenderuj tekst na szyldzie dokładnie tak, jak widać w projekcie SVG, znak po znaku: ${quoted}. ` +
        `Użyj tych samych krojów pisma, odstępów i wielkości liter co w SVG.`
    );
  }

  // Materiały elementów — trzy ścieżki w `describeElementMaterial`.
  const materialDescriptions = elementsWithMaterial.map((el) => {
    const hasPhoto = !!el.material!.photo_path;
    const imageIdx = elementToImageIdx[el.nodeId] ?? null;
    return describeElementMaterial(el.material!, el.colorHex, hasPhoto, imageIdx);
  });
  if (materialDescriptions.length > 0) {
    parts.push(
      "Materiały elementów szyldu (identyfikuj każdy element po jego kolorze hex w SVG): " +
        materialDescriptions.join("; ") +
        "."
    );
  }

  const distanceEl = elementsWithMaterial.find((el) => el.material?.category === "dystans");
  if (distanceEl?.material) {
    parts.push(`Szyld montowany na dystansach: ${describeMaterial(distanceEl.material)}.`);
  } else if (config.hasDistances) {
    parts.push("Szyld montowany na dystansach.");
  }

  if (config.led.backlit.enabled) {
    const b = config.led.backlit;
    const parts2: string[] = [`kolor ${b.color}`];
    if (b.kelvin != null) parts2.push(`${b.kelvin}K`);
    if (b.lumens != null) parts2.push(`${b.lumens} lm`);
    parts.push(`Podświetlenie od tyłu LED (${parts2.join(", ")}).`);
  }
  if (config.led.frontlit.enabled) {
    const f = config.led.frontlit;
    const parts2: string[] = [`kolor ${f.color}`];
    if (f.kelvin != null) parts2.push(`${f.kelvin}K`);
    if (f.lumens != null) parts2.push(`${f.lumens} lm`);
    parts.push(`Litery podświetlone LED od frontu (${parts2.join(", ")}).`);
  }

  if (options?.cameraDirty) {
    const cameraPrompt = buildCameraPrompt(
      config.camera.rotateDeg,
      config.camera.moveForward,
      config.camera.verticalTilt
    );
    if (cameraPrompt) parts.push(cameraPrompt);
  }

  const ledActive = config.led.backlit.enabled || config.led.frontlit.enabled;
  const hasBg = !!visualInputs?.hasBackground;
  const timeOfDayPrompt = buildTimeOfDayPrompt(config.timeOfDay, ledActive, hasBg);
  if (timeOfDayPrompt) parts.push(timeOfDayPrompt);

  if (options?.presetTexts) {
    for (const t of options.presetTexts) {
      const trimmed = t.trim();
      if (trimmed) parts.push(trimmed);
    }
  }

  return parts.join(" ");
}
