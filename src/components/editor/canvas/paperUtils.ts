import paper from "paper";
import type { LayerItem } from "../LayersPanel";

export const CANVAS_SIZE_MM = 7500; // stały rozmiar obszaru roboczego w mm
export const BG_COLOR = "#e8e9ed";

export function fitViewToPage(viewSize: paper.Size) {
  if (viewSize.width === 0 || viewSize.height === 0) return;
  const zoom = Math.min(viewSize.width, viewSize.height) / CANVAS_SIZE_MM * 0.88;
  paper.view.zoom = zoom;
  paper.view.center = new paper.Point(CANVAS_SIZE_MM / 2, CANVAS_SIZE_MM / 2);
}

export function drawPageBackground(bgLayer: paper.Layer, hasBg = false): paper.Shape {
  bgLayer.removeChildren();
  const prev = paper.project.activeLayer;
  bgLayer.activate();
  const rect = new paper.Shape.Rectangle(
    new paper.Rectangle(0, 0, CANVAS_SIZE_MM, CANVAS_SIZE_MM),
  );
  rect.fillColor = hasBg ? null : new paper.Color("white");
  rect.strokeColor = new paper.Color(0.7, 0.71, 0.76, 1);
  rect.strokeWidth = 1;
  rect.locked = true;
  prev.activate();
  return rect;
}

export function exportSvgLayer(layer: paper.Layer, _project: paper.Project, _originalContent: string, mmPerUnit: number): string {
  // Eksportujemy tylko tę warstwę bez kopiowania width/height/viewBox z oryginalnego pliku.
  // Historia przechowuje elementy we współrzędnych Paper.js (po fit-to-view).
  // Kopiowanie viewBox z oryginału powodowałoby, że importSVG przelicza współrzędne
  // przez viewBox → elementy zmieniają pozycję przy undo/redo.
  // data-mm-per-unit zachowuje przelicznik mm — niezbędny przy wczytywaniu z bazy.
  const layerEl = layer.exportSVG({ asString: false }) as SVGElement;

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
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

function applyFill(item: paper.Item, fill: string): void {
  const g = item as paper.Group;
  if (g.children) {
    g.children.forEach((c) => applyFill(c, fill));
  } else if (item.fillColor !== null) {
    try { item.fillColor = fill && fill !== "none" ? new paper.Color(fill) : null; }
    catch { /* nieprawidłowy kolor */ }
  }
}

export function applyFillByName(name: string, fill: string): void {
  for (const layer of paper.project.layers as paper.Layer[]) {
    const item = findItemByName(layer, name);
    if (item) { applyFill(item, fill); return; }
  }
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
