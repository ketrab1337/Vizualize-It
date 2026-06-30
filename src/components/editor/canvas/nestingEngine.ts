import paper from "paper";
import {
  computeGridParams,
  materialize,
  runPlacement,
  isBetterNest,
  strategiesForAttempts,
  type SerMask,
  type PreparedElement,
  type PreparedNest,
  type NestResult,
  type NestStrategy,
} from "./nestingCore";

export type { NestResult, NestStrategy, NestPlacement, PreparedNest } from "./nestingCore";

/** Krok rotacji w stopniach; 360 = bez rotacji (tylko 0°). */
export type RotationStep = 1 | 5 | 15 | 45 | 90 | 360;

export interface NestInput {
  nodeId: string;
  item: paper.Item;
}

/**
 * Próg alfa (0–255) uznania piksela za pokryty. Niski (≈12%) CELOWO — maska ma być
 * NADZBIOREM kształtu (łapie krawędziowe piksele anty-aliasingu i cienkie elementy),
 * żeby sąsiednie elementy NIGDY się nie nakładały. Zbyt wysoki próg erodował maskę
 * (kształt wystawał poza maskę) → nakładanie przy ciasnym pakowaniu.
 */
const ALPHA_THRESHOLD = 8;

/**
 * Sprawdza czy item (lub którekolwiek jego dziecko) ma kolor wypełnienia.
 * Kształty stroke-only (fillColor === null) rasteryzują się tylko jako obrys — dla nich
 * traktujemy cały bbox jako pełny (zachowawczo, jak poprzednia wersja).
 */
function itemHasFill(item: paper.Item): boolean {
  if (item.fillColor !== null) return true;
  const children = (item as paper.Item & { children?: paper.Item[] }).children;
  if (children) return children.some(itemHasFill);
  return false;
}

function rotationAngles(step: RotationStep): number[] {
  if (step >= 360) return [0];
  const angles: number[] = [];
  for (let a = 0; a < 360; a += step) angles.push(a);
  return angles;
}

// ── Rasteryzacja maski (Paper.js, główny wątek) ──────────────────────────────────

/**
 * Rasteryzuje element pod kątem `angle` na siatkę o rozdzielczości `res` → `SerMask`
 * (same typed-arraye pokrytych komórek; `cellSet` odtwarza `materialize` w core/workerze).
 * Komórki pokryte RZECZYWISTYM wypełnieniem (z otworami liter — oczko G/O jest WOLNE),
 * więc małe elementy mogą legalnie wejść w dziury i zatoki większych.
 *
 * Szybka ścieżka: natywna rasteryzacja Paper.js (`rasterize`) → odczyt kanału alfa.
 * Awaryjnie: `contains()` komórka-po-komórce, a w ostateczności pełny prostokąt.
 */
function buildMask(item: paper.Item, angle: number, res: number): SerMask {
  const c = item.clone({ insert: false }) as paper.Item;
  c.rotation = angle;
  const bw = c.bounds.width;
  const bh = c.bounds.height;
  // ceil (nie round) → maska nie jest węższa/niższa niż kształt = nadzbiór = brak nakładania.
  const mw = Math.max(1, Math.ceil(bw / res));
  const mh = Math.max(1, Math.ceil(bh / res));

  const dx: number[] = [];
  const dy: number[] = [];

  const fillFullRect = () => {
    dx.length = 0;
    dy.length = 0;
    for (let cy = 0; cy < mh; cy++)
      for (let cx = 0; cx < mw; cx++) {
        dx.push(cx);
        dy.push(cy);
      }
  };

  if (!itemHasFill(c)) {
    fillFullRect();
    c.remove();
    return { angle, mw, mh, cellDx: Int16Array.from(dx), cellDy: Int16Array.from(dy) };
  }

  let ok = false;
  try {
    const raster = c.rasterize({ resolution: 72 / res, insert: false }) as paper.Raster;
    const cv = (raster as unknown as { canvas?: HTMLCanvasElement }).canvas;
    if (cv && cv.width > 0 && cv.height > 0) {
      const ctx = cv.getContext("2d");
      if (ctx) {
        const cvW = cv.width;
        const cvH = cv.height;
        const data = ctx.getImageData(0, 0, cvW, cvH).data;
        // Próbkowanie BLOKOWE raster→siatka: komórka pokryta gdy DOWOLNY piksel jej bloku
        // przekracza próg. Konserwatywne (nadzbiór kształtu) i odporne na pixelRatio ekranu.
        for (let cy = 0; cy < mh; cy++) {
          const py0 = Math.floor((cy * cvH) / mh);
          const py1 = Math.min(cvH, Math.max(py0 + 1, Math.floor(((cy + 1) * cvH) / mh)));
          for (let cx = 0; cx < mw; cx++) {
            const px0 = Math.floor((cx * cvW) / mw);
            const px1 = Math.min(cvW, Math.max(px0 + 1, Math.floor(((cx + 1) * cvW) / mw)));
            let covered = false;
            for (let py = py0; py < py1 && !covered; py++) {
              for (let px = px0; px < px1; px++) {
                if (data[(py * cvW + px) * 4 + 3] >= ALPHA_THRESHOLD) {
                  covered = true;
                  break;
                }
              }
            }
            if (covered) {
              dx.push(cx);
              dy.push(cy);
            }
          }
        }
        ok = dx.length > 0;
      }
    }
    raster.remove();
  } catch {
    ok = false;
  }

  // Fallback: próbkowanie contains() (wolniejsze, ale bez canvasu).
  if (!ok) {
    dx.length = 0;
    dy.length = 0;
    c.position = c.position.subtract(c.bounds.topLeft);
    for (let cy = 0; cy < mh; cy++)
      for (let cx = 0; cx < mw; cx++) {
        if (c.contains(new paper.Point((cx + 0.5) * res, (cy + 0.5) * res))) {
          dx.push(cx);
          dy.push(cy);
        }
      }
    if (dx.length === 0) fillFullRect();
  }

  c.remove();
  return { angle, mw, mh, cellDx: Int16Array.from(dx), cellDy: Int16Array.from(dy) };
}

// ── Przygotowanie danych (rasteryzacja wszystkich masek) ─────────────────────────

/**
 * Rasteryzuje WSZYSTKIE maski (per element × kąt) na głównym wątku i pakuje do `PreparedNest`
 * — w pełni serializowalnego (typed-arraye) kompletu gotowego do skanu lokalnie lub w workerze.
 *
 * Maski NIE zależą od strategii (sortowania/tie-breaku), więc liczymy je RAZ i wielokrotnie
 * uruchamiamy na nich `runPlacement` z różnymi strategiami (multi-start), także równolegle.
 */
export function prepareNesting(
  items: NestInput[],
  plateW: number,
  plateH: number,
  gap: number,
  rotationStep: RotationStep,
): PreparedNest {
  const { res, GW, GH, gapCells } = computeGridParams(plateW, plateH, gap);
  const baseAngles = rotationAngles(rotationStep);

  const elements: PreparedElement[] = items.map(({ nodeId, item }) => {
    const w = item.bounds.width;
    const h = item.bounds.height;
    const masks: SerMask[] = [];
    for (const a of baseAngles) {
      const m = buildMask(item, a, res);
      // Odrzuć maski nie mieszczące się w płycie (z ramką odstępu).
      if (m.mw > GW - 2 * gapCells || m.mh > GH - 2 * gapCells) continue;
      masks.push(m);
    }
    // Mniejszy footprint pierwszy — przy pełnym remisie wygra kompaktowszy kąt.
    masks.sort((p, q) => p.mw * p.mh - q.mw * q.mh);
    return { nodeId, w, h, masks };
  });

  return { plateW, plateH, res, GW, GH, gapCells, elements };
}

// ── Synchroniczne API (fallback, gdy workery niedostępne) ─────────────────────────

/**
 * Nesting metodą BEST-FIT — wariant SYNCHRONICZNY (główny wątek). Używany jako fallback, gdy
 * pula workerów jest niedostępna lub zawiedzie. Pełny opis algorytmu: `nestingCore.runPlacement`.
 * Domyślna (brak `strategy`) ścieżka odtwarza DOKŁADNIE poprzednie deterministyczne zachowanie.
 */
export function computeNesting(
  items: NestInput[],
  plateW: number,
  plateH: number,
  gap: number,
  rotationStep: RotationStep,
  strategy?: NestStrategy,
): NestResult {
  const rt = materialize(prepareNesting(items, plateW, plateH, gap, rotationStep));
  return runPlacement(rt, strategy ?? { sort: "area", seed: 0 });
}

/**
 * Multi-start SYNCHRONICZNY (fallback). Buduje maski RAZ, po czym uruchamia `attempts` prób na
 * tej samej `RtPrepared`. Próba 0 = domyślna; remis wygrywa domyślna → wynik nie gorszy niż 1
 * próba. Wersja równoległa (pula workerów) jest w `nestingPool.ts`.
 */
export function computeNestingBest(
  items: NestInput[],
  plateW: number,
  plateH: number,
  gap: number,
  rotationStep: RotationStep,
  attempts: number,
): NestResult {
  const rt = materialize(prepareNesting(items, plateW, plateH, gap, rotationStep));
  const strategies = strategiesForAttempts(attempts);
  let best = runPlacement(rt, strategies[0]);
  for (let i = 1; i < strategies.length; i++) {
    const r = runPlacement(rt, strategies[i]);
    if (isBetterNest(r, best)) best = r;
  }
  return best;
}
