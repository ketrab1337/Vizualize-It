import type { SignConfig, CameraConfig, TimeOfDay } from "../types";

export interface VisualInputs {
  hasBackground: boolean;
  hasSvg: boolean;
}

export interface AssembleOptions {
  cameraDirty?: boolean;
  /** Teksty włączonych presetów — dołączane na końcu assembled promptu. */
  presetTexts?: string[];
}

export function buildTimeOfDayPrompt(timeOfDay: TimeOfDay, ledActive: boolean): string {
  switch (timeOfDay) {
    case "brak":
      return "";
    case "dzien":
      return (
        "Zdjęcie wykonane w ciągu dnia przy pełnym naturalnym świetle słonecznym. " +
        "Błękitne niebo, wyraźne ostre cienie, jasna i kontrastowa ekspozycja."
      );
    case "wieczor":
      return (
        "Ujęcie o zmierzchu podczas złotej godziny zachodzącego słońca. " +
        "Niebo w odcieniach pomarańczu, różu i fioletu. Miękkie, ciepłe oświetlenie otoczenia. " +
        (ledActive
          ? "Oświetlenie szyldu wyraźnie widoczne i kontrastowe na tle ciemniejącego nieba."
          : "Fasada budynku oświetlona ciepłą, zmierzchową poświatą.")
      );
    case "noc":
      return (
        "Ujęcie nocne. Ciemne niebo, sztuczne oświetlenie miejskie — latarnie, refleksy okien. " +
        (ledActive
          ? "Szyld intensywnie podświetlony LED, wyraźna poświata i aureola światła wokół liter, " +
            "refleksy na mokrym asfalcie poniżej."
          : "Szyld widoczny w świetle ulicznym, ciemne, dramatyczne otoczenie nocnego miasta.")
      );
    case "wnetrze":
      return (
        "Szyld zamontowany wewnątrz pomieszczenia — przestrzeń biurowa, sklep lub reprezentacyjny " +
        "hall wejściowy. Sztuczne oświetlenie sufitowe, neutralne lub ciepłe światło wnętrza, " +
        "czyste tło architektoniczne, profesjonalna aranżacja."
      );
  }
}

export function buildCameraPrompt(
  rotateDeg: CameraConfig["rotateDeg"],
  moveForward: CameraConfig["moveForward"],
  verticalTilt: CameraConfig["verticalTilt"]
): string {
  const parts: string[] = [];

  if (rotateDeg !== 0) {
    const dir = rotateDeg > 0 ? "lewej" : "prawej";
    parts.push(`widok z ${dir} strony pod kątem ${Math.abs(rotateDeg)}°`);
  }

  if (moveForward > 5) {
    parts.push("zbliżenie, ujęcie z bliska");
  } else if (moveForward >= 1) {
    parts.push("widok ze średniej odległości");
  } else {
    parts.push("widok z daleka, perspektywa uliczna");
  }

  if (verticalTilt <= -1) {
    parts.push("perspektywa z góry, widok ptasi");
  } else if (verticalTilt >= 1) {
    parts.push("perspektywa z dołu, widok żabi");
  }

  return parts.join(", ");
}

export function assemblePrompt(
  config: SignConfig,
  _visualInputs?: VisualInputs,
  options?: AssembleOptions
): string {
  const parts: string[] = [];

  // Bez wstępu i bez stałych końcowych — assembler składa tylko świadome wybory użytkownika.
  // Kontekst rodzaju projektu (jest SVG/tło/oba) wynika z samych obrazów dołączonych do
  // żądania API, nie trzeba go opisywać tekstem.

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

  const materialDescriptions = elementsWithMaterial.map(
    (el, idx) =>
      `Element_${idx + 1} (${el.material!.name}, kolor ${el.colorName ?? "domyślny"})`
  );
  if (materialDescriptions.length > 0) {
    parts.push("Elementy szyldu: " + materialDescriptions.join("; ") + ".");
  }

  const distanceEl = elementsWithMaterial.find((el) => el.material?.category === "dystans");
  if (distanceEl?.material) {
    parts.push(`Szyld montowany na dystansach ${distanceEl.material.name}.`);
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

  // Kamera — tylko jeśli użytkownik świadomie ruszył widget 3D.
  if (options?.cameraDirty) {
    const cameraPrompt = buildCameraPrompt(
      config.camera.rotateDeg,
      config.camera.moveForward,
      config.camera.verticalTilt
    );
    if (cameraPrompt) parts.push(cameraPrompt + ".");
  }

  // Pora dnia — tylko jeśli użytkownik świadomie wybrał (timeOfDay !== "brak").
  const ledActive = config.led.backlit.enabled || config.led.frontlit.enabled;
  const timeOfDayPrompt = buildTimeOfDayPrompt(config.timeOfDay, ledActive);
  if (timeOfDayPrompt) parts.push(timeOfDayPrompt);

  // Aktywne presety — doklejone na końcu (każdy jako osobne zdanie).
  if (options?.presetTexts) {
    for (const t of options.presetTexts) {
      const trimmed = t.trim();
      if (trimmed) parts.push(trimmed);
    }
  }

  return parts.join(" ");
}
