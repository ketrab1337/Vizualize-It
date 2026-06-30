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
  /** Liczniki diagnostyczne (tymczasowe, do profilowania — gdzie idzie czas skanu). */
  diag?: NestDiag;
}

/** Liczniki profilujące jedną próbę `runPlacement` (tymczasowe — diagnoza wydajności). */
export interface NestDiag {
  elements: number;
  /** Ile elementów rozwiązał szybki `frontierScan`. */
  frontierScans: number;
  /** Ile razy odpalił DROGI pełny `coarseScan(true)` (fallback gdy frontier nic nie znalazł). */
  coarseFallbacks: number;
  /** Ile razy odpalił narożny skan pierwszego elementu (`coarseScan(false)`). */
  firstScans: number;
  /** Łączna liczba wywołań `evalPos`. */
  evalPos: number;
  /** Łączna liczba wywołań `fits` (po cutoff, gdy NIE pominięto zgrubnie). */
  fits: number;
  /** Ile pozycji pominięto zgrubnym pre-checkiem B' (pusty obszar — bez fits/enclosure/contact). */
  coarseSkips: number;
  /** Suma rozmiarów frontiera w chwili skanu każdego elementu. */
  frontierSum: number;
  /** Maksymalny rozmiar frontiera w trakcie. */
  maxFrontier: number;
  /** Czas tej próby w ms. */
  ms: number;
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
 * Maska serializowalna (przesyłana do workera): SAME typed-arraye, bez żadnego `Set`. Komórki
 * brzegowe i kierunki „na zewnątrz" liczone RAZ na głównym wątku (`computeBoundary`), nie per próba
 * — to było źródło OOM (Set per maska × liczba workerów równolegle).
 * `angle` w stopniach, `mw`/`mh` w komórkach, `cellDx`/`cellDy` to offsety pokrytych komórek.
 */
export interface SerMask {
  angle: number;
  mw: number;
  mh: number;
  cellDx: Int16Array;
  cellDy: Int16Array;
  /** Komórki BRZEGOWE (≥1 sąsiad poza maską) — `contactScore` liczy styk tylko z nich (O(obwód)). */
  boundaryDx: Int16Array;
  boundaryDy: Int16Array;
  /** Per komórka brzegowa: bity kierunków NA ZEWNĄTRZ maski (1=prawo, 2=lewo, 4=dół, 8=góra = NEIGH). */
  boundaryOut: Uint8Array;
}

/**
 * Liczy komórki brzegowe maski + kierunki „na zewnątrz" (bity wg NEIGH: 1=prawo,2=lewo,4=dół,8=góra).
 * Komórka brzegowa = ma ≥1 sąsiada poza obwiednią LUB niewypełnionego. Używa transientnego `Set`
 * TYLKO tu (główny wątek, jedna maska naraz, GC), więc runtime/worker są od `Set` wolne.
 */
export function computeBoundary(
  cellDx: Int16Array,
  cellDy: Int16Array,
  mw: number,
  mh: number,
): { boundaryDx: Int16Array; boundaryDy: Int16Array; boundaryOut: Uint8Array } {
  const set = new Set<number>();
  for (let i = 0; i < cellDx.length; i++) set.add(cellDy[i] * mw + cellDx[i]);
  const bdx: number[] = [];
  const bdy: number[] = [];
  const bout: number[] = [];
  for (let i = 0; i < cellDx.length; i++) {
    const dx = cellDx[i];
    const dy = cellDy[i];
    let out = 0;
    if (dx + 1 >= mw || !set.has(dy * mw + (dx + 1))) out |= 1; // prawo
    if (dx - 1 < 0 || !set.has(dy * mw + (dx - 1))) out |= 2; // lewo
    if (dy + 1 >= mh || !set.has((dy + 1) * mw + dx)) out |= 4; // dół
    if (dy - 1 < 0 || !set.has((dy - 1) * mw + dx)) out |= 8; // góra
    if (out !== 0) {
      bdx.push(dx);
      bdy.push(dy);
      bout.push(out);
    }
  }
  return {
    boundaryDx: Int16Array.from(bdx),
    boundaryDy: Int16Array.from(bdy),
    boundaryOut: Uint8Array.from(bout),
  };
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
/**
 * Twardy limit liczby komórek siatki — chroni pamięć i czas skanu. 4M (2026-06-30): na dużych
 * płytach (1500 mm) limit zgrubiał res do ~1,22 mm → maski „puchły", drobne gubiły dziury →
 * upakowanie spadało. 4M sadza 1500 mm na res ~0,75 mm = zmierzony sweet spot (gęstość 40%→49,5%;
 * drobniej NIE poprawia). Koszt ~2-3× czasu — świadomie (jakość > prędkość).
 *
 * PAMIĘĆ: bezpieczne dopiero PO usunięciu `Set` z runtime (`computeBoundary` na głównym wątku).
 * 4M bez Setów (~2,7 jedn. pamięci masek) zużywa MNIEJ niż stare 1,5M z Setami (~13 jedn.), które
 * działało — bo `Set` to ~10× narzut nad typed-arrayami. Pierwsza próba 4M Z Setami dała OOM (~35 jedn.).
 */
const MAX_CELLS = 4_000_000;
/** Maks. liczba pozycji na kąt — limit włączany TYLKO przy rozdmuchanej-pustej obwiedni. */
const MAX_POS_PER_ANGLE = 6_000;
/** Próg rzadkości: pole obwiedni > SPARSE_FACTOR × pole wypełnienia → duży cienki element. */
const SPARSE_FACTOR = 4;

/**
 * Budżet pozycji na element w `frontierScan` (kotwic × masek × 4). Przy zwartym bloku frontier
 * jest duży, a przy drobnej rotacji jest WIELE masek (np. 72 przy kroku 5°) → pełny iloczyn
 * eksploduje. Stride po komórkach frontiera utrzymuje liczbę kotwic w budżecie; lokalne
 * dostrojenie (±rad co 1 komórkę) i tak dociąga finalną pozycję, więc jakość spada minimalnie.
 * Pomiar 2026-06-30: 120k było absurdalnym nadmiarem (104k evalPos/element) → 25k tnie ~5×.
 */
const FRONTIER_BUDGET = 25_000;

/**
 * Rozmiar bloku zgrubnej bitmapy zajętości (B') = 2^BLOCK_SHIFT komórek drobnej siatki.
 * Blok jest „zajęty", gdy DOWOLNA jego drobna komórka jest zajęta (element lub ramka).
 * Służy do BŁYSKAWICZNEGO pominięcia pustych obszarów w `evalPos` — drobna siatka pozostaje
 * źródłem prawdy (zero straty jakości), bitmapa tylko odsiewa jawnie pustą przestrzeń, gdzie
 * `fits`/`contact`/`enclosure` i tak przeszłyby całą wielką maskę, by stwierdzić „nic tu nie ma".
 */
const BLOCK_SHIFT = 3;

/**
 * Czy obszar maski (gx,gy,mw,mh) POWIĘKSZONY o 1 komórkę marginesu jest w CAŁOŚCI wolny wg
 * zgrubnej bitmapy? Margines pokrywa sąsiadów testowanych przez `contact`/`enclosure`. Gdy true:
 * maska na pewno się mieści (fits), a styk i otoczenie = 0 (brak sąsiadów) — można pominąć
 * wszystkie trzy drobne funkcje. Konserwatywne i DOKŁADNE: blok wolny ⟹ wszystkie jego komórki
 * wolne, więc false-positive (uznać zajęty obszar za wolny) jest niemożliwy.
 */
function regionFree(
  coarse: Uint8Array,
  CGW: number,
  CGH: number,
  gx: number,
  gy: number,
  mw: number,
  mh: number,
): boolean {
  let bx0 = (gx - 1) >> BLOCK_SHIFT;
  let by0 = (gy - 1) >> BLOCK_SHIFT;
  const bx1 = Math.min(CGW - 1, (gx + mw) >> BLOCK_SHIFT);
  const by1 = Math.min(CGH - 1, (gy + mh) >> BLOCK_SHIFT);
  if (bx0 < 0) bx0 = 0;
  if (by0 < 0) by0 = 0;
  for (let by = by0; by <= by1; by++) {
    const row = by * CGW;
    for (let bx = bx0; bx <= bx1; bx++) {
      if (coarse[row + bx]) return false;
    }
  }
  return true;
}

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

// ── Maska runtime ────────────────────────────────────────────────────────────────
// RtMask == SerMask (wszystko policzone już w prepareNesting). `materialize` jest tożsamością,
// więc worker NIE alokuje nic per próba — koniec OOM z `Set` × workery.

type RtMask = SerMask;
type RtElement = PreparedElement;
export type RtPrepared = PreparedNest;

/**
 * Tożsamość: komórki brzegowe/kierunki są już w `SerMask` (policzone RAZ na głównym wątku).
 * Zostaje jako cienki shim, by nie zmieniać wywołań w workerze i silniku.
 */
export function materialize(prep: PreparedNest): RtPrepared {
  return prep;
}

// ── Operacje na siatce zajętości ────────────────────────────────────────────────

function fits(grid: Uint8Array, GW: number, m: RtMask, gx: number, gy: number): boolean {
  const { cellDx, cellDy } = m;
  for (let i = 0; i < cellDx.length; i++) {
    if (grid[(gy + cellDy[i]) * GW + (gx + cellDx[i])] !== 0) return false;
  }
  return true;
}

function contactScore(grid: Uint8Array, GW: number, GH: number, m: RtMask, gx: number, gy: number): number {
  // Tylko komórki BRZEGOWE, i tylko ich kierunki NA ZEWNĄTRZ (bity `boundaryOut`) — wnętrze i
  // sąsiedzi wewnątrz maski dają 0 styku. Bez `Set`: kierunki policzone raz w `computeBoundary`.
  const { boundaryDx, boundaryDy, boundaryOut } = m;
  let contact = 0;
  for (let i = 0; i < boundaryDx.length; i++) {
    const out = boundaryOut[i];
    const bx = gx + boundaryDx[i];
    const by = gy + boundaryDy[i];
    if ((out & 1) && bx + 1 < GW && grid[by * GW + bx + 1] === 1) contact++;
    if ((out & 2) && bx - 1 >= 0 && grid[by * GW + bx - 1] === 1) contact++;
    if ((out & 4) && by + 1 < GH && grid[(by + 1) * GW + bx] === 1) contact++;
    if ((out & 8) && by - 1 >= 0 && grid[(by - 1) * GW + bx] === 1) contact++;
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
  coarse: Uint8Array,
  CGW: number,
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
          coarse[(yy >> BLOCK_SHIFT) * CGW + (xx >> BLOCK_SHIFT)] = 1; // B': zaznacz blok
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

  // B': zgrubna bitmapa zajętości (blok = 2^BLOCK_SHIFT komórek). Budowana raz z `grid` (na razie
  // tylko ramka), potem utrzymywana inkrementalnie w `markAndFrontier`.
  const CGW = (GW >> BLOCK_SHIFT) + 1;
  const CGH = (GH >> BLOCK_SHIFT) + 1;
  const coarse = new Uint8Array(CGW * CGH);
  for (let y = 0; y < GH; y++) {
    const row = y * GW;
    const cRow = (y >> BLOCK_SHIFT) * CGW;
    for (let x = 0; x < GW; x++) {
      if (grid[row + x] !== 0) coarse[cRow + (x >> BLOCK_SHIFT)] = 1;
    }
  }

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

  // Liczniki diagnostyczne (tymczasowe).
  const _t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  let diagFrontierScans = 0;
  let diagCoarseFallbacks = 0;
  let diagFirstScans = 0;
  let diagEvalPos = 0;
  let diagFits = 0;
  let diagCoarseSkips = 0;
  let diagFrontierSum = 0;
  let diagMaxFrontier = 0;

  interface Best {
    longSide: number; // dłuższy bok wynikowej obwiedni (PIERWSZORZĘDNE — broni przed paskiem)
    area: number; // pole wynikowej obwiedni (drugorzędne — ciasność/gęstość)
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

    const evalPos = (m: RtMask, gx: number, gy: number, best: Best | null): Best | null => {
      diagEvalPos++;
      // Wynikowa obwiednia po dołożeniu maski w (gx,gy).
      let nW: number, nH: number;
      if (hasOcc) {
        const nMinX = Math.min(occMinX, gx);
        const nMinY = Math.min(occMinY, gy);
        const nMaxX = Math.max(occMaxX, gx + m.mw - 1);
        const nMaxY = Math.max(occMaxY, gy + m.mh - 1);
        nW = nMaxX - nMinX + 1;
        nH = nMaxY - nMinY + 1;
      } else {
        nW = m.mw;
        nH = m.mh;
      }
      // PIERWSZORZĘDNE: dłuższy bok obwiedni (klaster rośnie ku KWADRATOWI, nie w pasek).
      // Min POLA jako primary degenerowało w kolumnę 1-szeroką: dokładanie pod spodem zawsze
      // dawało mniejszy przyrost pola niż z prawej → sprzężenie zwrotne. Dłuższy bok to blokuje.
      // DRUGORZĘDNE: pole (ciasność). Pozycja wewnątrz obwiedni (otwór/zatoka) ma OBA minimalne
      // = wciąż wygrywa → wkładanie drobnych w dziury zachowane; enclosure/contact wybierają dziurę.
      const longSide = nW >= nH ? nW : nH;
      const area = nW * nH;
      // Odcięcie na (longSide, area) — OBA liczone tanio przed fits. Sam `longSide` był zbyt
      // zgrubny (duże plateau jednakowych wartości) → fits/enclosure/contact liczone dla mnóstwa
      // pozycji = regresja ~20×. Człon `area` (drobnoziarnisty) przywraca odcięcie z plateau.
      if (best && (longSide > best.longSide || (longSide === best.longSide && area > best.area))) {
        return best;
      }
      // B': zgrubny pre-check. Gdy maska + 1 komórka marginesu są w CAŁOŚCI w wolnych blokach →
      // na pewno się mieści, a styk i otoczenie = 0. Pomijamy wszystkie 3 drogie drobne funkcje
      // (to one zżerały czas w pustych obszarach „lewego" projektu). DOKŁADNE — bez straty jakości.
      let enclosure: number;
      let contact: number;
      if (regionFree(coarse, CGW, CGH, gx, gy, m.mw, m.mh)) {
        diagCoarseSkips++;
        enclosure = 0;
        contact = 0;
      } else {
        diagFits++;
        if (!fits(grid, GW, m, gx, gy)) return best;
        enclosure = enclosureSides(grid, GW, GH, m, gx, gy);
        contact = contactScore(grid, GW, GH, m, gx, gy);
      }
      const tie = tieOf(gx, gy);
      const eq =
        !!best &&
        longSide === best.longSide &&
        area === best.area &&
        enclosure === best.enclosure &&
        contact === best.contact;
      if (
        !best ||
        longSide < best.longSide ||
        (longSide === best.longSide && area < best.area) ||
        (longSide === best.longSide && area === best.area && enclosure > best.enclosure) ||
        (longSide === best.longSide &&
          area === best.area &&
          enclosure === best.enclosure &&
          contact > best.contact) ||
        (eq && tie < best.tie) ||
        (eq && tie === best.tie && gy < best.gy) ||
        (eq && tie === best.tie && gy === best.gy && gx < best.gx)
      ) {
        return { longSide, area, enclosure, contact, tie, gx, gy, mask: m };
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
      // Stride po frontierze, by iloczyn kotwic×masek×4 nie przekroczył budżetu (patrz FRONTIER_BUDGET).
      const totalRaw = cells.length * masks.length * 4;
      const stride = totalRaw > FRONTIER_BUDGET ? Math.ceil(totalRaw / FRONTIER_BUDGET) : 1;
      for (const m of masks) {
        const gxMax = GW - m.mw - gapCells;
        const gyMax = GH - m.mh - gapCells;
        if (gxMax < gapCells || gyMax < gapCells) continue;
        const halfW = (m.mw / 2) | 0;
        const halfH = (m.mh / 2) | 0;
        const lastX = m.mw - 1;
        const lastY = m.mh - 1;
        const seen = new Set<number>();
        for (let ci = 0; ci < cells.length; ci += stride) {
          const f = cells[ci];
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

    diagFrontierSum += frontier.size;
    if (frontier.size > diagMaxFrontier) diagMaxFrontier = frontier.size;

    let best: Best | null;
    if (frontier.size === 0) {
      diagFirstScans++;
      best = coarseScan(false);
      if (!best) { diagCoarseFallbacks++; best = coarseScan(true); }
    } else {
      diagFrontierScans++;
      best = frontierScan();
      if (!best) { diagCoarseFallbacks++; best = coarseScan(true); }
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

    markAndFrontier(grid, GW, GH, best.mask, best.gx, best.gy, gapCells, frontier, coarse, CGW);
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
  const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - _t0;
  const diag: NestDiag = {
    elements: rt.elements.length,
    frontierScans: diagFrontierScans,
    coarseFallbacks: diagCoarseFallbacks,
    firstScans: diagFirstScans,
    evalPos: diagEvalPos,
    fits: diagFits,
    coarseSkips: diagCoarseSkips,
    frontierSum: diagFrontierSum,
    maxFrontier: diagMaxFrontier,
    ms,
  };
  return { placed, overflow, filledCells: occArea, bboxCells, diag };
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
