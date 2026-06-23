import paper from "paper";

/** Krok rotacji w stopniach; 360 = bez rotacji (tylko 0°). */
export type RotationStep = 1 | 5 | 15 | 45 | 90 | 360;

export interface NestInput {
  nodeId: string;
  item: paper.Item;
}

export interface NestPlacement {
  nodeId: string;
  plateX: number;
  plateY: number;
  rotation: number;
}

export interface NestResult {
  placed: NestPlacement[];
  overflow: string[];
}

/**
 * Docelowa liczba komórek siatki na krótszy bok płyty. Większa = drobniejsza siatka
 * (mniejsze odstępy i mniej nakładania). Koszt skanu rekompensuje adaptacyjny krok
 * (`stepForMask`) + odcięcie, więc można trzymać siatkę drobno (~0.6 mm).
 */
const TARGET_GRID = 900;

/** Najdrobniejsza rozdzielczość komórki (jednostki płyty = mm). */
const MIN_RES = 0.6;

/** Twardy limit liczby komórek siatki — chroni pamięć i czas skanu na dużych płytach. */
const MAX_CELLS = 1_500_000;

/**
 * Maks. liczba sprawdzanych pozycji na jeden kąt — limit włączany TYLKO przy rozdmuchanej
 * obwiedni (duży cienki element). Bez tego skan takiej (w środku pustej) obwiedni trwał minuty.
 * Zwykłych GĘSTYCH projektów nie dotyczy (tam skan jest drobny). Mniejsza = szybciej, zgrubniej.
 */
const MAX_POS_PER_ANGLE = 6_000;

/**
 * Próg rzadkości: jeśli pole obwiedni > SPARSE_FACTOR × pole wypełnienia, układ jest
 * zdominowany przez duży CIENKI element (obwiednia w większości pusta) → włącz limit pozycji.
 * Zwykłe gęste projekty (obwiednia ≈ wypełnienie) są poniżej progu → skan pozostaje drobny.
 */
const SPARSE_FACTOR = 4;

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

// ── Maska rastrowa ──────────────────────────────────────────────────────────────

/**
 * Rastrowa maska kształtu pod danym kątem: komórki pokryte RZECZYWISTYM wypełnieniem
 * (z otworami liter — komórka w oczku G/O jest WOLNA). Dzięki temu małe elementy mogą
 * legalnie wejść w dziury i zatoki większych.
 */
interface PieceMask {
  angle: number;
  mw: number; // szerokość maski w komórkach
  mh: number; // wysokość maski w komórkach
  cellDx: Int16Array; // offsety x pokrytych komórek (lokalne, od rogu maski)
  cellDy: Int16Array; // offsety y pokrytych komórek
  cellSet: Set<number>; // dy*mw+dx pokrytych komórek — do testu sąsiedztwa (styk)
}

function packMask(
  angle: number,
  mw: number,
  mh: number,
  dx: number[],
  dy: number[],
  set: Set<number>,
): PieceMask {
  return {
    angle,
    mw,
    mh,
    cellDx: Int16Array.from(dx),
    cellDy: Int16Array.from(dy),
    cellSet: set,
  };
}

/**
 * Rasteryzuje element pod kątem `angle` na siatkę o rozdzielczości `res`.
 * Szybka ścieżka: natywna rasteryzacja Paper.js (`rasterize`) → odczyt kanału alfa.
 * Próbkowanie raster→siatka po globalnym `res` (odporne na pixelRatio ekranu).
 * Awaryjnie: `contains()` komórka-po-komórce, a w ostateczności pełny prostokąt.
 */
function buildMask(item: paper.Item, angle: number, res: number): PieceMask {
  const c = item.clone({ insert: false }) as paper.Item;
  c.rotation = angle;
  const bw = c.bounds.width;
  const bh = c.bounds.height;
  // ceil (nie round) → maska nie jest węższa/niższa niż kształt = nadzbiór = brak nakładania.
  const mw = Math.max(1, Math.ceil(bw / res));
  const mh = Math.max(1, Math.ceil(bh / res));

  const dx: number[] = [];
  const dy: number[] = [];
  const set = new Set<number>();

  const fillFullRect = () => {
    dx.length = 0;
    dy.length = 0;
    set.clear();
    for (let cy = 0; cy < mh; cy++)
      for (let cx = 0; cx < mw; cx++) {
        dx.push(cx);
        dy.push(cy);
        set.add(cy * mw + cx);
      }
  };

  if (!itemHasFill(c)) {
    fillFullRect();
    c.remove();
    return packMask(angle, mw, mh, dx, dy, set);
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
              set.add(cy * mw + cx);
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
    set.clear();
    c.position = c.position.subtract(c.bounds.topLeft);
    for (let cy = 0; cy < mh; cy++)
      for (let cx = 0; cx < mw; cx++) {
        if (c.contains(new paper.Point((cx + 0.5) * res, (cy + 0.5) * res))) {
          dx.push(cx);
          dy.push(cy);
          set.add(cy * mw + cx);
        }
      }
    if (dx.length === 0) fillFullRect();
  }

  c.remove();
  return packMask(angle, mw, mh, dx, dy, set);
}

// ── Operacje na siatce zajętości ────────────────────────────────────────────────

/** Czy maska zmieści się w (gx,gy) bez kolizji z zajętymi komórkami? */
function fits(grid: Uint8Array, GW: number, m: PieceMask, gx: number, gy: number): boolean {
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

/**
 * Miara styku (kryterium DRUGORZĘDNE): ile komórek brzegowych maski sąsiaduje z innym
 * ELEMENTEM (grid === 1). Liczona TYLKO względem elementów — NIE krawędzi płyty (ramka = 2,
 * poza siatką = nie liczy). Dzięki temu przy równym wzroście obwiedni wygrywa pozycja
 * najbardziej OTOCZONA elementami = zatoka/wnęka/oczko (przyleganie na wielu bokach), więc
 * drobne wchodzą w środek dużych. Gdyby liczyć krawędź — elementy oblepiałyby ściany płyty.
 */
function contactScore(
  grid: Uint8Array,
  GW: number,
  GH: number,
  m: PieceMask,
  gx: number,
  gy: number,
): number {
  const { cellDx, cellDy, cellSet, mw, mh } = m;
  let contact = 0;
  for (let i = 0; i < cellDx.length; i++) {
    const lx = cellDx[i];
    const ly = cellDy[i];
    for (const [ddx, ddy] of NEIGH) {
      const nlx = lx + ddx;
      const nly = ly + ddy;
      // sąsiad wewnątrz samej maski → nie liczy się jako styk
      if (nlx >= 0 && nlx < mw && nly >= 0 && nly < mh && cellSet.has(nly * mw + nlx)) continue;
      const gxx = gx + lx + ddx;
      const gyy = gy + ly + ddy;
      if (gxx < 0 || gxx >= GW || gyy < 0 || gyy >= GH) continue; // poza płytą = krawędź, nie liczymy
      if (grid[gyy * GW + gxx] === 1) contact++; // sąsiad to ELEMENT (ramka = 2 → pomijamy)
    }
  }
  return contact;
}

/**
 * Liczba STRON (0–4), z których maskę otacza inny element. W odróżnieniu od `contactScore`
 * (długość styku) liczy KIERUNKI otoczenia. To kluczowe dla wchodzenia W ŚRODEK dużych
 * elementów: wąska zatoka otacza z 2–3 stron, a długa płaska krawędź tylko z 1 — więc bez
 * tej miary drobne wolą przylgnąć do długiego zewnętrznego boku niż wejść w zatokę. Liczy
 * tylko elementy (grid===1; ramka=2 i poza płytą nie liczą → brak ściągania do krawędzi).
 */
function enclosureSides(
  grid: Uint8Array,
  GW: number,
  GH: number,
  m: PieceMask,
  gx: number,
  gy: number,
): number {
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

/**
 * Oznacz komórki maski jako zajęte (z dylatacją o `gapCells`) ORAZ zaktualizuj zbiór
 * komórek GRANICZNYCH (`frontier`) = wolne komórki przylegające do zajętych przez ELEMENTY.
 * Frontier jest seedowany wyłącznie tutaj (przy układaniu elementów), więc NIE zawiera
 * komórek przy ramce płyty — dzięki temu kotwiczenie nie ściąga elementów do krawędzi.
 */
function markAndFrontier(
  grid: Uint8Array,
  GW: number,
  GH: number,
  m: PieceMask,
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
  // Nowo zajęte komórki wypadają z frontier; ich wolni sąsiedzi do niego wchodzą.
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

/**
 * Zablokuj ramkę szerokości `gapCells` — wymusza odstęp od krawędzi płyty.
 * Wartość 2 (nie 1) odróżnia ramkę od elementów: `fits` blokuje na obu (!==0), ale
 * `contactScore` liczy tylko elementy (===1), więc krawędź NIE przyciąga (brak edge-hugging).
 */
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

/**
 * Adaptacyjny krok skanu (w komórkach): duże maski skanowane rzadziej (nie potrzebują
 * precyzji na 1 komórkę), małe gęsto (muszą trafić w wąskie luki/oczka). Po skanie
 * następuje lokalne dostrojenie co 1 komórkę, więc krok nie pogarsza ciasności odstępu —
 * tylko skraca czas. Bez tego drobna siatka byłaby zbyt wolna.
 */
function stepForMask(m: PieceMask, res: number): number {
  const maxStep = Math.max(1, Math.round(2.5 / res));
  const bySize = Math.round(Math.min(m.mw, m.mh) * 0.12);
  return Math.max(1, Math.min(maxStep, bySize));
}

// ── Główna funkcja nestingu ─────────────────────────────────────────────────────

/**
 * Nesting metodą BEST-FIT na rastrowej mapie zajętości.
 *
 * Dla każdego elementu oceniane są pozycje×kąty; wybierana jest ta o:
 *   1. najmniejszym wzroście wspólnej obwiedni  → ZWARTOŚĆ (mały kompaktowy klaster,
 *      minimum traconej płyty) + klucz ODCIĘCIA (szybkość),
 *   2. największym styku z sąsiadami/krawędziami → przy równym wzroście wpycha w oczka/zatoki,
 *   3. najwyżej-lewo                            → determinizm.
 *
 * UWAGA: „styk jako kryterium główne" próbowano i ODRZUCONO — przyciągał elementy do krawędzi
 * płyty (krawędź też daje styk), które oblepiały ściany zostawiając pusty środek = więcej
 * traconej płyty. Wzrost obwiedni daje zwarty klaster i musi być pierwszorzędny.
 *
 * Wydajność i wypełnianie wnętrz — KOTWICZENIE: kandydaci generowani są wyłącznie przy obrysie
 * już ułożonych elementów (zbiór `frontier`), a nie w całym prostokącie obwiedni. Liczba pozycji
 * skaluje się więc z długością obrysu, nie z polem obwiedni — duży CIENKI element (obwiednia ~cała
 * płyta, w środku pusta) nie rozdmuchuje już skanu (było 8 min). Jednocześnie skan jest gęsty przy
 * zawartości, więc znajduje zatoki/wnęki dużych elementów, a kryterium „wzrost obwiedni" (zatoka =
 * wzrost 0) je tam wkłada. Pierwszy element: skan narożny. Fallback (gdy kotwiczenie nic nie
 * znajdzie): pełny skan z limitem pozycji. Otwory liter widoczne dzięki rasteryzacji wypełnienia.
 */
export function computeNesting(
  items: NestInput[],
  plateW: number,
  plateH: number,
  gap: number,
  rotationStep: RotationStep,
): NestResult {
  const baseAngles = rotationAngles(rotationStep);

  // Rozdzielczość: drobna dla dokładnego odstępu (res ≤ gap/2 → gapCells≈2 trafia w gap),
  // ale nie drobniej niż detal siatki ani MIN_RES, i z twardym limitem liczby komórek.
  const detailRes = Math.min(plateW, plateH) / TARGET_GRID;
  const gapRes = gap > 0 ? gap / 2 : Infinity;
  let res = Math.max(MIN_RES, Math.min(detailRes, gapRes));
  if (Math.ceil(plateW / res) * Math.ceil(plateH / res) > MAX_CELLS) {
    res = Math.sqrt((plateW * plateH) / MAX_CELLS);
  }

  const GW = Math.max(1, Math.ceil(plateW / res));
  const GH = Math.max(1, Math.ceil(plateH / res));
  const grid = new Uint8Array(GW * GH);
  const gapCells = gap > 0 ? Math.max(1, Math.round(gap / res)) : 0;
  blockBorder(grid, GW, GH, gapCells);

  // Największe elementy najpierw — trudniej je upchnąć, a po nich małe wchodzą w luki.
  const sorted = [...items].sort(
    (a, b) =>
      b.item.bounds.width * b.item.bounds.height -
      a.item.bounds.width * a.item.bounds.height,
  );

  const placed: NestPlacement[] = [];
  const overflow: string[] = [];

  // Zajęty prostokąt w komórkach — do liczenia wzrostu obwiedni i ograniczenia skanu.
  let occMinX = GW;
  let occMinY = GH;
  let occMaxX = -1;
  let occMaxY = -1;
  // Suma pól wypełnienia ułożonych masek — do wykrycia rozdmuchanej-pustej obwiedni
  // (gdy bboxArea ≫ occArea = duży cienki element → włącz limit pozycji w computeStep w fallbacku).
  let occArea = 0;
  // Komórki graniczne: wolne komórki przylegające do JUŻ UŁOŻONYCH ELEMENTÓW. Z nich wyprowadzamy
  // pozycje kandydatów (kotwiczenie), zamiast skanować cały — w środku pusty — prostokąt obwiedni.
  const frontier = new Set<number>();

  interface Best {
    growth: number;
    enclosure: number;
    contact: number;
    gx: number;
    gy: number;
    mask: PieceMask;
  }

  for (const { nodeId, item } of sorted) {
    // Maski per kąt; odrzuć te, które nie mieszczą się w płycie (z ramką odstępu).
    const masks: PieceMask[] = [];
    for (const a of baseAngles) {
      const m = buildMask(item, a, res);
      if (m.mw > GW - 2 * gapCells || m.mh > GH - 2 * gapCells) continue;
      masks.push(m);
    }
    if (masks.length === 0) {
      overflow.push(nodeId);
      continue;
    }
    // Mniejszy footprint pierwszy — przy pełnym remisie wygra kompaktowszy kąt.
    masks.sort((p, q) => p.mw * p.mh - q.mw * q.mh);

    const hasOcc = occMaxX >= 0;
    const curArea = hasOcc ? (occMaxX - occMinX + 1) * (occMaxY - occMinY + 1) : 0;

    // Ocena jednej pozycji (gx,gy) dla maski m — zwraca zaktualizowany `best`.
    // Kryteria (leksykograficznie): 1) min wzrost obwiedni (zwartość + odcięcie/wydajność),
    // 2) max LICZBA STRON otoczenia (wpycha w zatoki/wnętrza — kierunki, nie długość styku),
    // 3) max długość styku (ciasność), 4) najwyżej-lewo.
    const evalPos = (m: PieceMask, gx: number, gy: number, best: Best | null): Best | null => {
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
      if (best && growth > best.growth) return best; // odcięcie (klucz wydajności)
      if (!fits(grid, GW, m, gx, gy)) return best;
      const enclosure = enclosureSides(grid, GW, GH, m, gx, gy);
      const contact = contactScore(grid, GW, GH, m, gx, gy);
      if (
        !best ||
        growth < best.growth ||
        (growth === best.growth && enclosure > best.enclosure) ||
        (growth === best.growth && enclosure === best.enclosure && contact > best.contact) ||
        (growth === best.growth &&
          enclosure === best.enclosure &&
          contact === best.contact &&
          gy < best.gy) ||
        (growth === best.growth &&
          enclosure === best.enclosure &&
          contact === best.contact &&
          gy === best.gy &&
          gx < best.gx)
      ) {
        return { growth, enclosure, contact, gx, gy, mask: m };
      }
      return best;
    };

    // Krok skanu. Domyślnie drobny (adaptacyjny wg rozmiaru maski) — to daje zwarte, ładne
    // układy zwykłych projektów. TYLKO gdy obwiednia jest rozdmuchana-pusta (duży cienki
    // element: pole obwiedni > SPARSE_FACTOR × pole wypełnienia) ograniczamy liczbę pozycji
    // do ~MAX_POS_PER_ANGLE — inaczej skan tej (w środku pustej) obwiedni trwałby minuty.
    const computeStep = (m: PieceMask, full: boolean): number => {
      const fine = stepForMask(m, res);
      if (!hasOcc) return fine;
      const bboxArea = (occMaxX - occMinX + 1) * (occMaxY - occMinY + 1);
      if (bboxArea <= occArea * SPARSE_FACTOR) return fine; // gęsto (zwykły projekt) → drobno
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

        // Ogranicz skan do zajętego obszaru + pas jednego elementu (chyba że fallback).
        // Pokrywa wszystkie luki/oczka oraz dostawienie z prawej/od dołu. Pierwszy
        // element (pusta płyta) → wąski pas przy narożniku (tam max styk z krawędziami).
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

    // KOTWICZENIE: kandydaci wyłącznie przy obrysie już ułożonych elementów (zbiór `frontier`),
    // a nie w całym — w środku pustym — prostokącie obwiedni. Dla każdej komórki granicznej F
    // próbujemy 4 dosunięć: krawędź maski (lewa/prawa/górna/dolna) przechodzi przez F. Kolizyjne
    // odpadają na `fits`. To jest szybkie (liczba pozycji ~ długość obrysu, nie pole obwiedni)
    // I gęste przy zawartości, więc znajduje też zatoki/wnęki dużych cienkich elementów.
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
          // [cx, cy] = lewy-górny róg maski dla 4 dosunięć względem F.
          const c0x = fx, c0y = fy - halfH; // F na lewej krawędzi
          const c1x = fx - lastX, c1y = fy - halfH; // F na prawej krawędzi
          const c2x = fx - halfW, c2y = fy; // F na górnej krawędzi
          const c3x = fx - halfW, c3y = fy - lastY; // F na dolnej krawędzi
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

    // Pierwszy element (brak zawartości) → narożny skan; kolejne → kotwiczenie przy zawartości,
    // z awaryjnym pełnym skanem gdyby kotwiczenie nic nie znalazło (poszarpany brzeg).
    let best: Best | null;
    if (frontier.size === 0) {
      best = coarseScan(false);
      if (!best) best = coarseScan(true);
    } else {
      best = frontierScan();
      if (!best) best = coarseScan(true);
    }

    // Lokalne dostrojenie co 1 komórkę wokół najlepszej pozycji — dociąga element bliżej
    // zawartości (odzyskuje ciasny odstęp utracony przez dosunięcie/krok).
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
      overflow.push(nodeId);
      continue;
    }

    markAndFrontier(grid, GW, GH, best.mask, best.gx, best.gy, gapCells, frontier);
    occMinX = Math.min(occMinX, best.gx);
    occMinY = Math.min(occMinY, best.gy);
    occMaxX = Math.max(occMaxX, best.gx + best.mask.mw - 1);
    occMaxY = Math.max(occMaxY, best.gy + best.mask.mh - 1);
    occArea += best.mask.cellDx.length;

    placed.push({
      nodeId,
      plateX: best.gx * res,
      plateY: best.gy * res,
      rotation: best.mask.angle,
    });
  }

  return { placed, overflow };
}
