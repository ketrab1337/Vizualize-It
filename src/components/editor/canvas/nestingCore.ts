// Czysta logika nestingu — BEZ Paper.js i bez DOM. Dzięki temu plik może być importowany
// przez Web Worker (`nestingWorker.ts`) bez wciągania Paper.js do bundla workera.
//
// Podział odpowiedzialności:
// - `nestingEngine.ts` (główny wątek, Paper.js): rasteryzuje maski → `PreparedNest`.
// - TEN plik: czysty skan/umieszczanie (`runPlacement`) + dobór strategii i wybór najlepszej.
//
// `runPlacement` jest CZYSTĄ funkcją (tworzy własną siatkę, nie mutuje wejścia), więc tę samą
// `RtPrepared` można uruchomić wielokrotnie z różnymi strategiami (multi-start) — także równolegle
// w wielu workerach.

export interface NestPlacement {
  nodeId: string;
  plateX: number;
  plateY: number;
  rotation: number;
}

export interface NestResult {
  placed: NestPlacement[];
  overflow: string[];
  /** Suma pól wypełnienia ułożonych masek (komórki siatki) — licznik gęstości upakowania. */
  filledCells: number;
  /** Pole obwiedni ułożonych elementów (komórki siatki). 0 gdy nic nie ułożono. Mniejsze = ciaśniej. */
  bboxCells: number;
}

/**
 * Strategia jednej próby nestingu. Steruje WYŁĄCZNIE kolejnością elementów i tie-breakiem —
 * nie dotyka rasteryzacji otworów, kryteriów `enclosure`/`contact` ani kotwiczenia, więc logika
 * wkładania drobnych w otwory/zatoki dużych elementów jest IDENTYCZNA w każdej próbie.
 *
 * Każdy wariant `sort` jest MALEJĄCY (duże najpierw) — utrzymuje filozofię „duże stabilizują,
 * drobne wpadają w dziury". `seed === 0` → tie-break „najwyżej-lewo" (domyślny, deterministyczny);
 * `seed !== 0` → tie-break pseudolosowy (różne próby przeszukują inne równoważne pozycje).
 */
export interface NestStrategy {
  sort: "area" | "height" | "width" | "perimeter";
  seed: number;
}

/**
 * Maska serializowalna (przesyłana do workera): same typed-arraye, bez `Set` (Set odtwarzamy
 * w `materialize`). `angle` w stopniach, `mw`/`mh` w komórkach, `cellDx`/`cellDy` to offsety
 * pokrytych komórek od rogu maski.
 */
export interface SerMask {
  angle: number;
  mw: number;
  mh: number;
  cellDx: Int16Array;
  cellDy: Int16Array;
}

/** Element po rasteryzacji: maski per kąt (już odfiltrowane do płyty i posortowane po footprincie). */
export interface PreparedElement {
  nodeId: string;
  /** Szerokość/wysokość obwiedni elementu w mm — do metryki sortowania strategii. */
  w: number;
  h: number;
  masks: SerMask[];
}

/** Komplet danych do skanu — w pełni serializowalny, gotowy do wysłania do workera. */
export interface PreparedNest {
  plateW: number;
  plateH: number;
  res: number;
  GW: number;
  GH: number;
  gapCells: number;
  elements: PreparedElement[];
}

// ── Stałe algorytmu (opisy w nestingEngine — tu kopie potrzebne do skanu) ─────────

/** Docelowa liczba komórek siatki na krótszy bok płyty. */
const TARGET_GRID = 900;
/** Najdrobniejsza rozdzielczość komórki (mm). */
const MIN_RES = 0.6;
/** Twardy limit liczby komórek siatki — chroni pamięć i czas skanu. */
const MAX_CELLS = 1_500_000;
/** Maks. liczba pozycji na kąt — limit włączany TYLKO przy rozdmuchanej-pustej obwiedni. */
const MAX_POS_PER_ANGLE = 6_000;
/** Próg rzadkości: pole obwiedni > SPARSE_FACTOR × pole wypełnienia → duży cienki element. */
const SPARSE_FACTOR = 4;

/** Parametry siatki dla danej płyty/odstępu — wspólne dla rasteryzacji i skanu. */
export function computeGridParams(
  plateW: number,
  plateH: number,
  gap: number,
): { res: number; GW: number; GH: number; gapCells: number } {
  const detailRes = Math.min(plateW, plateH) / TARGET_GRID;
  const gapRes = gap > 0 ? gap / 2 : Infinity;
  let res = Math.max(MIN_RES, Math.min(detailRes, gapRes));
  if (Math.ceil(plateW / res) * Math.ceil(plateH / res) > MAX_CELLS) {
    res = Math.sqrt((plateW * plateH) / MAX_CELLS);
  }
  const GW = Math.max(1, Math.ceil(plateW / res));
  const GH = Math.max(1, Math.ceil(plateH / res));
  const gapCells = gap > 0 ? Math.max(1, Math.round(gap / res)) : 0;
  return { res, GW, GH, gapCells };
}

// ── Maska runtime (z `cellSet` do testu sąsiedztwa) ──────────────────────────────

interface RtMask {
  angle: number;
  mw: number;
  mh: number;
  cellDx: Int16Array;
  cellDy: Int16Array;
  cellSet: Set<number>;
}

interface RtElement {
  nodeId: string;
  w: number;
  h: number;
  masks: RtMask[];
}

export interface RtPrepared {
  plateW: number;
  plateH: number;
  res: number;
  GW: number;
  GH: number;
  gapCells: number;
  elements: RtElement[];
}

/**
 * Odtwarza `cellSet` z typed-arrayów raz na komplet (poza pętlą strategii). Wynik jest
 * READ-ONLY dla `runPlacement`, więc tę samą `RtPrepared` można uruchomić wielokrotnie.
 */
export function materialize(prep: PreparedNest): RtPrepared {
  return {
    plateW: prep.plateW,
    plateH: prep.plateH,
    res: prep.res,
    GW: prep.GW,
    GH: prep.GH,
    gapCells: prep.gapCells,
    elements: prep.elements.map((e) => ({
      nodeId: e.nodeId,
      w: e.w,
      h: e.h,
      masks: e.masks.map((m) => {
        const set = new Set<number>();
        for (let i = 0; i < m.cellDx.length; i++) set.add(m.cellDy[i] * m.mw + m.cellDx[i]);
        return { angle: m.angle, mw: m.mw, mh: m.mh, cellDx: m.cellDx, cellDy: m.cellDy, cellSet: set };
      }),
    })),
  };
}

// ── Operacje na siatce zajętości ────────────────────────────────────────────────

function fits(grid: Uint8Array, GW: number, m: RtMask, gx: number, gy: number): boolean {
  const { cellDx, cellDy } = m;
  for (let i = 0; i < cellDx.length; i++) {
    if (grid[(gy + cellDy[i]) * GW + (gx + cellDx[i])] !== 0) return false;
  }
  return true;
}

const NEIGH = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function contactScore(grid: Uint8Array, GW: number, GH: number, m: RtMask, gx: number, gy: number): number {
  const { cellDx, cellDy, cellSet, mw, mh } = m;
  let contact = 0;
  for (let i = 0; i < cellDx.length; i++) {
    const lx = cellDx[i];
    const ly = cellDy[i];
    for (const [ddx, ddy] of NEIGH) {
      const nlx = lx + ddx;
      const nly = ly + ddy;
      if (nlx >= 0 && nlx < mw && nly >= 0 && nly < mh && cellSet.has(nly * mw + nlx)) continue;
      const gxx = gx + lx + ddx;
      const gyy = gy + ly + ddy;
      if (gxx < 0 || gxx >= GW || gyy < 0 || gyy >= GH) continue;
      if (grid[gyy * GW + gxx] === 1) contact++;
    }
  }
  return contact;
}

function enclosureSides(grid: Uint8Array, GW: number, GH: number, m: RtMask, gx: number, gy: number): number {
  const { mw, mh } = m;
  let sides = 0;
  const xl = gx - 1;
  if (xl >= 0) {
    for (let y = gy; y < gy + mh; y++) if (grid[y * GW + xl] === 1) { sides++; break; }
  }
  const xr = gx + mw;
  if (xr < GW) {
    for (let y = gy; y < gy + mh; y++) if (grid[y * GW + xr] === 1) { sides++; break; }
  }
  const yt = gy - 1;
  if (yt >= 0) {
    const row = yt * GW;
    for (let x = gx; x < gx + mw; x++) if (grid[row + x] === 1) { sides++; break; }
  }
  const yb = gy + mh;
  if (yb < GH) {
    const row = yb * GW;
    for (let x = gx; x < gx + mw; x++) if (grid[row + x] === 1) { sides++; break; }
  }
  return sides;
}

function markAndFrontier(
  grid: Uint8Array,
  GW: number,
  GH: number,
  m: RtMask,
  gx: number,
  gy: number,
  gapCells: number,
  frontier: Set<number>,
): void {
  const { cellDx, cellDy } = m;
  const newly: number[] = [];
  for (let i = 0; i < cellDx.length; i++) {
    const bx = gx + cellDx[i];
    const by = gy + cellDy[i];
    for (let oy = -gapCells; oy <= gapCells; oy++) {
      const yy = by + oy;
      if (yy < 0 || yy >= GH) continue;
      const row = yy * GW;
      for (let ox = -gapCells; ox <= gapCells; ox++) {
        const xx = bx + ox;
        if (xx < 0 || xx >= GW) continue;
        const idx = row + xx;
        if (grid[idx] === 0) {
          grid[idx] = 1;
          newly.push(idx);
        }
      }
    }
  }
  for (let i = 0; i < newly.length; i++) frontier.delete(newly[i]);
  for (let i = 0; i < newly.length; i++) {
    const idx = newly[i];
    const x = idx % GW;
    const y = (idx - x) / GW;
    if (x + 1 < GW && grid[idx + 1] === 0) frontier.add(idx + 1);
    if (x - 1 >= 0 && grid[idx - 1] === 0) frontier.add(idx - 1);
    if (y + 1 < GH && grid[idx + GW] === 0) frontier.add(idx + GW);
    if (y - 1 >= 0 && grid[idx - GW] === 0) frontier.add(idx - GW);
  }
}

function blockBorder(grid: Uint8Array, GW: number, GH: number, gapCells: number): void {
  if (gapCells <= 0) return;
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (x < gapCells || x >= GW - gapCells || y < gapCells || y >= GH - gapCells) {
        grid[y * GW + x] = 2;
      }
    }
  }
}

function stepForMask(m: RtMask, res: number): number {
  const maxStep = Math.max(1, Math.round(2.5 / res));
  const bySize = Math.round(Math.min(m.mw, m.mh) * 0.12);
  return Math.max(1, Math.min(maxStep, bySize));
}

// ── Skan / umieszczanie (czysta funkcja) ─────────────────────────────────────────

/**
 * Jedna próba nestingu BEST-FIT na rastrowej mapie zajętości (patrz długi opis w nestingEngine).
 * CZYSTA: tworzy własną siatkę, nie mutuje `rt`. Sortowanie elementów i tie-break sterowane
 * przez `strategy`; domyślne `{ sort:"area", seed:0 }` odtwarza dawne deterministyczne zachowanie.
 */
export function runPlacement(rt: RtPrepared, strategy: NestStrategy): NestResult {
  const { res, GW, GH, gapCells } = rt;
  const seed = strategy.seed;
  const tieOf: (gx: number, gy: number) => number =
    seed === 0
      ? () => 0
      : (gx, gy) => {
          let t = (Math.imul((gx + 1) | 0, 0x9e3779b1) ^ Math.imul((gy + 1) | 0, 0x85ebca77) ^ seed) >>> 0;
          t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
          t ^= t >>> 13;
          return t >>> 0;
        };

  const grid = new Uint8Array(GW * GH);
  blockBorder(grid, GW, GH, gapCells);

  const sortKey = strategy.sort;
  const sortMetric = (e: RtElement): number => {
    switch (sortKey) {
      case "height": return e.h;
      case "width": return e.w;
      case "perimeter": return e.w + e.h;
      default: return e.w * e.h; // "area"
    }
  };
  const sorted = [...rt.elements].sort((a, b) => sortMetric(b) - sortMetric(a));

  const placed: NestPlacement[] = [];
  const overflow: string[] = [];

  let occMinX = GW;
  let occMinY = GH;
  let occMaxX = -1;
  let occMaxY = -1;
  let occArea = 0;
  const frontier = new Set<number>();

  interface Best {
    growth: number;
    enclosure: number;
    contact: number;
    tie: number;
    gx: number;
    gy: number;
    mask: RtMask;
  }

  for (const el of sorted) {
    const masks = el.masks;
    if (masks.length === 0) {
      overflow.push(el.nodeId);
      continue;
    }

    const hasOcc = occMaxX >= 0;
    const curArea = hasOcc ? (occMaxX - occMinX + 1) * (occMaxY - occMinY + 1) : 0;

    const evalPos = (m: RtMask, gx: number, gy: number, best: Best | null): Best | null => {
      let growth: number;
      if (hasOcc) {
        const nMinX = Math.min(occMinX, gx);
        const nMinY = Math.min(occMinY, gy);
        const nMaxX = Math.max(occMaxX, gx + m.mw - 1);
        const nMaxY = Math.max(occMaxY, gy + m.mh - 1);
        growth = (nMaxX - nMinX + 1) * (nMaxY - nMinY + 1) - curArea;
      } else {
        growth = m.mw * m.mh;
      }
      if (best && growth > best.growth) return best;
      if (!fits(grid, GW, m, gx, gy)) return best;
      const enclosure = enclosureSides(grid, GW, GH, m, gx, gy);
      const contact = contactScore(grid, GW, GH, m, gx, gy);
      const tie = tieOf(gx, gy);
      const eq = !!best && growth === best.growth && enclosure === best.enclosure && contact === best.contact;
      if (
        !best ||
        growth < best.growth ||
        (growth === best.growth && enclosure > best.enclosure) ||
        (growth === best.growth && enclosure === best.enclosure && contact > best.contact) ||
        (eq && tie < best.tie) ||
        (eq && tie === best.tie && gy < best.gy) ||
        (eq && tie === best.tie && gy === best.gy && gx < best.gx)
      ) {
        return { growth, enclosure, contact, tie, gx, gy, mask: m };
      }
      return best;
    };

    const computeStep = (m: RtMask, full: boolean): number => {
      const fine = stepForMask(m, res);
      if (!hasOcc) return fine;
      const bboxArea = (occMaxX - occMinX + 1) * (occMaxY - occMinY + 1);
      if (bboxArea <= occArea * SPARSE_FACTOR) return fine;
      const gxMax = GW - m.mw - gapCells;
      const gyMax = GH - m.mh - gapCells;
      const gxEnd = full ? gxMax : Math.min(gxMax, occMaxX + m.mw + 1);
      const gyEnd = full ? gyMax : Math.min(gyMax, occMaxY + m.mh + 1);
      const regionCells = Math.max(1, (gxEnd - gapCells + 1) * (gyEnd - gapCells + 1));
      const cap = Math.max(1, Math.ceil(Math.sqrt(regionCells / MAX_POS_PER_ANGLE)));
      return Math.max(fine, cap);
    };

    const coarseScan = (full: boolean): Best | null => {
      let best: Best | null = null;
      for (const m of masks) {
        const gxMax = GW - m.mw - gapCells;
        const gyMax = GH - m.mh - gapCells;
        if (gxMax < gapCells || gyMax < gapCells) continue;
        const baseX = hasOcc ? occMaxX : gapCells;
        const baseY = hasOcc ? occMaxY : gapCells;
        const gxEnd = full ? gxMax : Math.min(gxMax, baseX + m.mw + 1);
        const gyEnd = full ? gyMax : Math.min(gyMax, baseY + m.mh + 1);
        const step = computeStep(m, full);
        for (let gy = gapCells; gy <= gyEnd; gy += step) {
          for (let gx = gapCells; gx <= gxEnd; gx += step) {
            best = evalPos(m, gx, gy, best);
          }
        }
      }
      return best;
    };

    const frontierScan = (): Best | null => {
      let best: Best | null = null;
      const cells = Array.from(frontier);
      for (const m of masks) {
        const gxMax = GW - m.mw - gapCells;
        const gyMax = GH - m.mh - gapCells;
        if (gxMax < gapCells || gyMax < gapCells) continue;
        const halfW = (m.mw / 2) | 0;
        const halfH = (m.mh / 2) | 0;
        const lastX = m.mw - 1;
        const lastY = m.mh - 1;
        const seen = new Set<number>();
        for (const f of cells) {
          const fx = f % GW;
          const fy = (f - fx) / GW;
          const c0x = fx, c0y = fy - halfH;
          const c1x = fx - lastX, c1y = fy - halfH;
          const c2x = fx - halfW, c2y = fy;
          const c3x = fx - halfW, c3y = fy - lastY;
          for (let k = 0; k < 4; k++) {
            const rawX = k === 0 ? c0x : k === 1 ? c1x : k === 2 ? c2x : c3x;
            const rawY = k === 0 ? c0y : k === 1 ? c1y : k === 2 ? c2y : c3y;
            const gx = rawX < gapCells ? gapCells : rawX > gxMax ? gxMax : rawX;
            const gy = rawY < gapCells ? gapCells : rawY > gyMax ? gyMax : rawY;
            const key = gy * GW + gx;
            if (seen.has(key)) continue;
            seen.add(key);
            best = evalPos(m, gx, gy, best);
          }
        }
      }
      return best;
    };

    let best: Best | null;
    if (frontier.size === 0) {
      best = coarseScan(false);
      if (!best) best = coarseScan(true);
    } else {
      best = frontierScan();
      if (!best) best = coarseScan(true);
    }

    if (best) {
      const m = best.mask;
      const rad = Math.max(2, computeStep(m, false) - 1);
      const gxMax = GW - m.mw - gapCells;
      const gyMax = GH - m.mh - gapCells;
      const gx0 = Math.max(gapCells, best.gx - rad);
      const gx1 = Math.min(gxMax, best.gx + rad);
      const gy0 = Math.max(gapCells, best.gy - rad);
      const gy1 = Math.min(gyMax, best.gy + rad);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          best = evalPos(m, gx, gy, best);
        }
      }
    }

    if (!best) {
      overflow.push(el.nodeId);
      continue;
    }

    markAndFrontier(grid, GW, GH, best.mask, best.gx, best.gy, gapCells, frontier);
    occMinX = Math.min(occMinX, best.gx);
    occMinY = Math.min(occMinY, best.gy);
    occMaxX = Math.max(occMaxX, best.gx + best.mask.mw - 1);
    occMaxY = Math.max(occMaxY, best.gy + best.mask.mh - 1);
    occArea += best.mask.cellDx.length;

    placed.push({
      nodeId: el.nodeId,
      plateX: best.gx * res,
      plateY: best.gy * res,
      rotation: best.mask.angle,
    });
  }

  const bboxCells = occMaxX >= 0 ? (occMaxX - occMinX + 1) * (occMaxY - occMinY + 1) : 0;
  return { placed, overflow, filledCells: occArea, bboxCells };
}

// ── Multi-start: dobór strategii i wybór najlepszej ──────────────────────────────

/** Czy `a` jest lepszym układem niż `b`? Najpierw więcej ułożonych, przy remisie ciaśniej. */
export function isBetterNest(a: NestResult, b: NestResult): boolean {
  if (a.placed.length !== b.placed.length) return a.placed.length > b.placed.length;
  return a.bboxCells < b.bboxCells;
}

/**
 * Lista strategii dla `attempts` prób. INDEKS 0 to ZAWSZE strategia domyślna
 * (`{ sort:"area", seed:0 }`) = identyczna z pojedynczym „Układaj". Pozostałe to wariacje
 * (inne malejące sortowania + pseudolosowy tie-break). Wszystkie sortują duże najpierw.
 */
export function strategiesForAttempts(attempts: number): NestStrategy[] {
  const n = Math.max(1, Math.floor(attempts));
  const out: NestStrategy[] = [{ sort: "area", seed: 0 }];
  const sorts: NestStrategy["sort"][] = ["height", "width", "perimeter", "area"];
  for (let i = 1; i < n; i++) {
    out.push({ sort: sorts[(i - 1) % sorts.length], seed: ((Math.imul(i, 0x9e3779b1) ^ 0x1234567) >>> 0) || 1 });
  }
  return out;
}

/**
 * Wybiera najlepszy wynik. `results` MUSI być w kolejności `strategiesForAttempts` (indeks 0 =
 * domyślna), bo wymagamy ŚCISŁEJ poprawy → przy remisie wygrywa domyślna = wynik nie gorszy
 * niż zwykłe „Układaj".
 */
export function pickBest(results: NestResult[]): NestResult {
  let best = results[0];
  for (let i = 1; i < results.length; i++) {
    if (isBetterNest(results[i], best)) best = results[i];
  }
  return best;
}
