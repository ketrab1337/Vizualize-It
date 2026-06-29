import paper from "paper";
import type { LayerItem } from "../LayersPanel";
import type { ImageFormat } from "../../../types";

/** Dłuższy bok strony roboczej w mm — krótszy wyliczany z proporcji (patrz `pageDimsForAspect`). */
export const CANVAS_LONG_MM = 7500;
export const BG_COLOR = "#e8e9ed";

/** Domyślna proporcja canvasu nowego projektu (zob. migracja 025). */
export const DEFAULT_ASPECT: ImageFormat = "1:1";

export interface PageDims {
  width: number;
  height: number;
}

/**
 * Wymiary strony roboczej (mm) dla danej proporcji. Dłuższy bok = `CANVAS_LONG_MM`,
 * krótszy liczony z proporcji. To ramka, w której renderujemy do AI (koniec
 * przycinania tła do prostokątnego viewportu).
 */
export function pageDimsForAspect(aspect: ImageFormat | null | undefined): PageDims {
  const [aw, ah] = (aspect ?? DEFAULT_ASPECT).split(":").map(Number);
  const w = aw || 1;
  const h = ah || 1;
  if (w >= h) return { width: CANVAS_LONG_MM, height: Math.round((CANVAS_LONG_MM * h) / w) };
  return { width: Math.round((CANVAS_LONG_MM * w) / h), height: CANVAS_LONG_MM };
}

const ASPECT_RATIOS: { id: ImageFormat; ratio: number }[] = [
  { id: "16:9", ratio: 16 / 9 },
  { id: "4:3", ratio: 4 / 3 },
  { id: "1:1", ratio: 1 },
  { id: "3:4", ratio: 3 / 4 },
  { id: "9:16", ratio: 9 / 16 },
];

/** Najbliższy z 5 presetów dla zadanych wymiarów zdjęcia (przycisk „Dopasuj do zdjęcia"). */
export function nearestAspect(width: number, height: number): ImageFormat {
  if (!width || !height) return DEFAULT_ASPECT;
  const r = width / height;
  return ASPECT_RATIOS.reduce((best, cur) =>
    Math.abs(cur.ratio - r) < Math.abs(best.ratio - r) ? cur : best
  ).id;
}

export function fitViewToPage(viewSize: paper.Size, page: PageDims) {
  if (viewSize.width === 0 || viewSize.height === 0) return;
  const zoom = Math.min(viewSize.width / page.width, viewSize.height / page.height) * 0.88;
  paper.view.zoom = zoom;
  paper.view.center = new paper.Point(page.width / 2, page.height / 2);
}

/**
 * Ogranicza `paper.view.center` tak, aby ramka strony (powiększona o margines)
 * nie wyjeżdżała poza widok. Gdy cała strona mieści się w danej osi (np. przy max
 * oddaleniu), środek jest przyklejany do środka strony → przewijanie samo się
 * blokuje. Wywoływać po każdym panie/zoomie.
 */
export function clampViewCenter(page: PageDims): void {
  const z = paper.view.zoom;
  if (!z) return;
  const margin = CANVAS_LONG_MM * 0.1;
  const vs = paper.view.viewSize;
  const halfW = vs.width / z / 2;
  const halfH = vs.height / z / 2;
  const axis = (center: number, size: number, halfView: number): number => {
    const min = -margin;
    const max = size + margin;
    if (2 * halfView >= max - min) return (min + max) / 2;
    return Math.min(Math.max(center, min + halfView), max - halfView);
  };
  const c = paper.view.center;
  const nx = axis(c.x, page.width, halfW);
  const ny = axis(c.y, page.height, halfH);
  if (nx !== c.x || ny !== c.y) paper.view.center = new paper.Point(nx, ny);
}

export function drawPageBackground(bgLayer: paper.Layer, page: PageDims, hasBg = false): paper.Shape {
  bgLayer.removeChildren();
  const prev = paper.project.activeLayer;
  bgLayer.activate();
  const rect = new paper.Shape.Rectangle(
    new paper.Rectangle(0, 0, page.width, page.height),
  );
  // Szare (nie białe) tło pustej strony — biała plexa szyldu pozostaje widoczna,
  // gdy użytkownik nie ustawił własnego tła.
  rect.fillColor = hasBg ? null : new paper.Color("#d9dadf");
  rect.strokeColor = hasBg ? null : new paper.Color(0.7, 0.71, 0.76, 1);
  rect.strokeWidth = hasBg ? 0 : 1;
  rect.locked = true;
  prev.activate();
  return rect;
}

export function exportSvgLayer(layer: paper.Layer, mmPerUnit: number): string {
  // Eksportujemy tylko tę warstwę bez kopiowania width/height/viewBox z oryginalnego pliku.
  // Historia przechowuje elementy we współrzędnych Paper.js (po fit-to-view).
  // Kopiowanie viewBox z oryginału powodowałoby, że importSVG przelicza współrzędne
  // przez viewBox → elementy zmieniają pozycję przy undo/redo.
  // data-mm-per-unit zachowuje przelicznik mm — niezbędny przy wczytywaniu z bazy.
  // embedImages:false → dla rasterów (produktów) Paper.js użyje oryginalnego src
  // (nasz data URL WebP) zamiast re-enkodować do PNG. Bez tego produkt puchnie w
  // historii/bazie (PNG ~3–5× cięższy niż WebP), a jakość i tak bez zmian.
  const layerEl = layer.exportSVG({ asString: false, embedImages: false }) as SVGElement;

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Produkty (paper.Raster) eksportują się jako <image> z atrybutem xlink:href. Deklaracja
  // namespace na korzeniu gwarantuje, że href przetrwa round-tripy DOMParser/XMLSerializer
  // (saveEditorState → updateSvgWithOverrides → reimport). Bez tego href bywał gubiony.
  svgEl.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  svgEl.setAttribute("data-mm-per-unit", String(mmPerUnit));

  // layerEl jest <g> — przenosimy dzieci bezpośrednio do <svg>
  Array.from(layerEl.children).forEach((child) => svgEl.appendChild(child));

  // Zapisz stan locked/hidden z Paper.js items do data-* atrybutów w eksportowanym SVG.
  // Paper.js nie eksportuje tych właściwości, więc robimy to ręcznie po eksporcie.
  (layer.children as paper.Item[]).forEach((item) => {
    if (!item.name) return;
    const el = svgEl.querySelector(`[id="${CSS.escape(item.name)}"]`);
    if (!el) return;
    if (item.locked) el.setAttribute("data-locked", "1");
    else el.removeAttribute("data-locked");
    if (!item.visible) el.setAttribute("data-hidden", "1");
    else el.removeAttribute("data-hidden");
  });

  return new XMLSerializer().serializeToString(svgEl);
}

/**
 * Dokleja fizyczne wymiary (mm) do SVG przeznaczonego do EKSPORTU na dysk.
 *
 * `exportSvgLayer` celowo NIE zapisuje `width`/`height`/`viewBox` (psułyby pozycje
 * przy undo/redo i ponownym imporcie z bazy). Ale plik bez tych atrybutów otwarty
 * w zewnętrznym programie (laser/CAD/Illustrator) jest interpretowany jako piksele
 * przy 96 DPI → obiekty wychodzą ~3.78× za małe (1 mm = 3.7795 px).
 *
 * Współrzędne warstwy są w mm (1 jednostka Paper.js = 1 mm), więc viewBox w tych
 * samych jednostkach + width/height z sufiksem „mm" daje skalę 1:1 w każdym programie.
 *
 * @param svgString wyeksportowany SVG (np. z `exportSvgLayer` + overrides)
 * @param bounds obwiednia zawartości w jednostkach Paper.js (= mm), np. `layer.bounds`
 */
export function withPhysicalSizeMm(svgString: string, bounds: paper.Rectangle | null): string {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return svgString;
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  const svg = doc.documentElement;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  svg.setAttribute("viewBox", `${r(bounds.x)} ${r(bounds.y)} ${r(bounds.width)} ${r(bounds.height)}`);
  svg.setAttribute("width", `${r(bounds.width)}mm`);
  svg.setAttribute("height", `${r(bounds.height)}mm`);
  return new XMLSerializer().serializeToString(svg);
}

/** Przypisuje auto-nazwy wszystkim elementom bez id (rekurencyjnie). */
export function assignMissingNames(item: paper.Item, prefix: string, index: number): void {
  if (!item.name) item.name = `${prefix}_${index}`;
  const g = item as paper.Group;
  if (g.children) {
    (g.children as paper.Item[]).forEach((c, i) => assignMissingNames(c, item.name, i));
  }
}

export function findItemByName(item: paper.Item, name: string): paper.Item | null {
  if (item.name === name) return item;
  const g = item as paper.Group;
  if (g.children) {
    for (const c of g.children) {
      const f = findItemByName(c, name);
      if (f) return f;
    }
  }
  return null;
}

/** Zdejmuje obrys (stroke) z elementu — wspólne dla importu i nadawania materiału. */
function clearStroke(item: paper.Item): void {
  item.strokeColor = null;
  item.strokeWidth = 0;
}

/**
 * Usuwa obrys z elementów, które mają REALNE wypełnienie.
 *
 * Reguła: element z wypełnieniem (materiał/kolor plexy) to lico szyldu — jego obrys
 * z programu wektorowego jest dekoracją i NIE może trafić do podglądu ani do kompozytu
 * wysyłanego do AI (model renderował niebieski/czarny obrys jako realny kant na szyldzie).
 *
 * Ścieżki BEZ wypełnienia (fill=none) zostają NIETKNIĘTE — tam obrys NIESIE kształt
 * (typowe linie cięcia z softu laserowego, np. xTool). Idempotentne — bezpieczne przy
 * ponownym imporcie.
 */
export function stripStrokeIfFilled(item: paper.Item): void {
  if (item instanceof paper.CompoundPath) {
    if (item.fillColor) clearStroke(item);
    return;
  }
  const g = item as paper.Group;
  if (g.children) {
    g.children.forEach((c) => stripStrokeIfFilled(c as paper.Item));
    return;
  }
  if (item.fillColor) clearStroke(item);
}

function applyFill(item: paper.Item, fill: string): void {
  const real = !!fill && fill !== "none";
  // CompoundPath (litery z otworami, logo z wycięciami itp.) ma .children (subpaths),
  // ale fill ustawia się BEZPOŚREDNIO na nim — nie na subpathach. Subpaths nie mają
  // własnych fills i Paper.js ignoruje fillColor ustawiony na poszczególnych subpathach.
  if (item instanceof paper.CompoundPath) {
    try {
      item.fillColor = real ? new paper.Color(fill) : null;
      if (real) clearStroke(item); // element z wypełnieniem nie nosi obrysu (patrz stripStrokeIfFilled)
    } catch { /* nieprawidłowy kolor */ }
    return;
  }
  const g = item as paper.Group;
  if (g.children) {
    g.children.forEach((c) => applyFill(c, fill));
  } else {
    try {
      item.fillColor = real ? new paper.Color(fill) : null;
      if (real) clearStroke(item);
    } catch { /* nieprawidłowy kolor */ }
  }
}

export function applyFillByName(name: string, fill: string): void {
  for (const layer of paper.project.layers as paper.Layer[]) {
    const item = findItemByName(layer, name);
    if (item) { applyFill(item, fill); return; }
  }
}

/** Zwraca nazwy wszystkich potomków elementu (rekurencyjnie, bez samego elementu). */
function collectDescendants(item: paper.Item, out: string[]): void {
  const g = item as paper.Group;
  if (!g.children) return;
  for (const c of g.children as paper.Item[]) {
    if (c.name) out.push(c.name);
    collectDescendants(c, out);
  }
}

export function collectDescendantNames(name: string): string[] {
  const result: string[] = [];
  for (const layer of paper.project.layers as paper.Layer[]) {
    const item = findItemByName(layer, name);
    if (item) { collectDescendants(item, result); break; }
  }
  return result;
}

export function getItemType(item: paper.Item): LayerItem["type"] {
  if (item instanceof paper.CompoundPath) return "compound";
  if (item instanceof paper.Group) return "group";
  if (item instanceof paper.Shape) return "shape";
  if (item instanceof paper.Path) return "path";
  return "other";
}

export function getDefaultName(item: paper.Item): string {
  if (item instanceof paper.CompoundPath) return "Compound vector";
  if (item instanceof paper.Group) return "Grupa";
  if (item instanceof paper.Shape) return "Kształt";
  if (item instanceof paper.Path) return "Vector";
  return "Obiekt";
}

export function calcTotalLength(item: paper.Item): number {
  const p = item as paper.Path;
  if (typeof p.length === "number") return p.length;
  const g = item as paper.Group;
  if (g.children) return g.children.reduce((s, c) => s + calcTotalLength(c), 0);
  return 0;
}

// Rzeczywiste pole powierzchni ścieżki (z odejmowaniem otworów przez znak area).
// paper.Path.area jest ujemne dla ścieżek narysowanych zgodnie z ruchem wskazówek
// zegara (np. otwory w compound path) — sumujemy wartości bezwzględne, ale
// dla CompoundPath Paper.js sam obsługuje otwory, więc bierzemy Math.abs całości.
export function calcTotalArea(item: paper.Item): number {
  const cp = item as paper.CompoundPath;
  if (cp.children && (item as unknown as { className?: string }).className === "CompoundPath") {
    return Math.abs(cp.area ?? 0);
  }
  const p = item as paper.Path;
  if (typeof p.area === "number") return Math.abs(p.area);
  const g = item as paper.Group;
  if (g.children) return g.children.reduce((s, c) => s + calcTotalArea(c), 0);
  return 0;
}

export function parseSvgDimension(attr: string | null): { value: number; unit: string } {
  if (!attr) return { value: 0, unit: "px" };
  const m = attr.match(/^([\d.]+)(mm|cm|in|px|pt|pc)?/);
  return m ? { value: parseFloat(m[1]), unit: m[2] ?? "px" } : { value: 0, unit: "px" };
}

export function toMm(value: number, unit: string): number {
  const f: Record<string, number> = {
    mm: 1, cm: 10, in: 25.4, pt: 0.352778, pc: 4.23333, px: 0.264583,
  };
  return value * (f[unit] ?? 0.264583);
}
