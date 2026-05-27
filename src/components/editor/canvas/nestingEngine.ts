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
 * Krok skanowania (mm).
 * 5 mm = dobry kompromis między dokładnością a szybkością.
 * Zmniejsz do 2–3 gdy elementy są bardzo małe (< 15 mm).
 */
const SCAN_STEP = 5;

function rotationAngles(step: RotationStep): number[] {
  if (step >= 360) return [0];
  const angles: number[] = [];
  for (let a = 0; a < 360; a += step) angles.push(a);
  return angles;
}

/**
 * Analityczna obwiednia po rotacji — bez klonowania Paper.js.
 * Używana do sortowania kątów (preferuj mniejszy footprint w otwartej przestrzeni).
 */
function rotatedBoundsApprox(bw: number, bh: number, angleDeg: number): { w: number; h: number } {
  const a = ((angleDeg % 180) + 180) % 180;
  if (a === 0) return { w: bw, h: bh };
  if (a === 90) return { w: bh, h: bw };
  const rad = (a * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { w: bw * c + bh * s, h: bw * s + bh * c };
}

// ── Główna funkcja nestingu ────────────────────────────────────────────────────

/**
 * Algorytm nestingu z prawdziwą geometrią Paper.js.
 *
 * Kluczowa zmiana vs. poprzednia wersja:
 *   Stara kolejność pętli:  KĄTY → pozycje (y→x)
 *     Gdy kąt=0° pasował na pierwszej napotkanej pozycji, inne kąty nigdy
 *     nie były sprawdzane → litery układały się w poziomych rzędach bez rotacji.
 *
 *   Nowa kolejność pętli:   POZYCJE (y→x) → kąty
 *     Dla każdej pozycji (x,y) próbujemy WSZYSTKICH kątów zanim przejdziemy
 *     do kolejnej pozycji. W otwartej przestrzeni (brak AABB-overlap) przyjmujemy
 *     pierwszy kąt (kąty posortowane rosnąco po footprincie → najbardziej kompaktowy).
 *     W ciasnych miejscach (AABB-overlap z istniejącymi elementami) próbujemy kolejnych
 *     kątów — dzięki temu obrócone elementy wchodzą w wolne przestrzenie sąsiadów
 *     (np. litera A pod poprzeczką M, kółko wewnątrz O).
 *
 * Optymalizacje:
 *   • 1 klon per kąt tworzony z góry (nie per pozycja) — K klonów zamiast K×P
 *   • AABB pre-check (arytmetyka) → geometry check (Paper.js) tylko gdy potrzeba
 *   • Geometria Paper.js (intersects + contains) zachowana → małe elementy
 *     nadal mogą leżeć wewnątrz otworów liter (P, R, A, O, U itd.)
 */
export function computeNesting(
  items: NestInput[],
  plateW: number,
  plateH: number,
  gap: number,
  rotationStep: RotationStep,
): NestResult {
  const baseAngles = rotationAngles(rotationStep);

  // Największe elementy najpierw — trudniej je upchnąć
  const sorted = [...items].sort(
    (a, b) =>
      b.item.bounds.width * b.item.bounds.height -
      a.item.bounds.width * a.item.bounds.height,
  );

  const placed: NestPlacement[] = [];
  const overflow: string[] = [];

  // Klony ułożonych elementów — do kolizji geometry
  const colliders: paper.Item[] = [];

  for (const { nodeId, item } of sorted) {
    const origBw = item.bounds.width;
    const origBh = item.bounds.height;

    // Posortuj kąty rosnąco po footprincie.
    // W otwartej przestrzeni (pierwszy pasujący kąt bez AABB-overlap) wybieramy
    // najbardziej kompaktowy kąt — zajmuje mniej miejsca dla kolejnych elementów.
    const anglesSorted = [...baseAngles].sort((a, b) => {
      const da = rotatedBoundsApprox(origBw, origBh, a);
      const db = rotatedBoundsApprox(origBw, origBh, b);
      return da.w * da.h - db.w * db.h;
    });

    // ── Jeden klon per kąt (wszystkie z góry) ─────────────────────────────────
    interface AngleClone {
      angle: number;
      clone: paper.Item;
      iw: number;
      ih: number;
      halfW: number;
      halfH: number;
      xMax: number;
      yMax: number;
    }
    const angleClones: AngleClone[] = [];
    for (const angle of anglesSorted) {
      const c = item.clone({ insert: false }) as paper.Item;
      c.rotation = angle;
      c.position = new paper.Point(0, 0);
      const iw = c.bounds.width;
      const ih = c.bounds.height;
      if (iw + 2 * gap > plateW || ih + 2 * gap > plateH) {
        c.remove();
        continue;
      }
      angleClones.push({
        angle,
        clone: c,
        iw,
        ih,
        halfW: iw / 2,
        halfH: ih / 2,
        xMax: plateW - iw - gap,
        yMax: plateH - ih - gap,
      });
    }

    if (angleClones.length === 0) {
      overflow.push(nodeId);
      continue;
    }

    // Granice skanowania — maksymalne po wszystkich kątach
    const globalXMax = Math.max(...angleClones.map((ac) => ac.xMax));
    const globalYMax = Math.max(...angleClones.map((ac) => ac.yMax));

    let foundPlacement: NestPlacement | null = null;

    // ── Skan: y-zewnętrzna, x-wewnętrzna, kąt-najgłębsza ─────────────────────
    // Pętla po pozycjach jako zewnętrzna gwarantuje ułożenie jak najwyżej/najdalej
    // w lewo, a pętla po kątach wewnątrz oznacza, że przy każdej pozycji (x,y)
    // sprawdzamy ALL kąty przed przejściem do następnej pozycji.
    outer: for (let y = gap; y <= globalYMax; y += SCAN_STEP) {
      for (let x = gap; x <= globalXMax; x += SCAN_STEP) {

        for (const ac of angleClones) {
          if (x > ac.xMax || y > ac.yMax) continue;

          const { clone: testClone, iw, ih, halfW, halfH, angle } = ac;

          // ── Faza 1: AABB pre-check ─────────────────────────────────────────
          // Jeśli żaden kolider nie jest blisko → pozycja wolna, akceptuj od razu.
          // Kąty posortowane po footprincie → w otwartej przestrzeni trafiamy tu
          // przy pierwszym (najbardziej kompaktowym) kącie.
          let anyClose = false;
          for (const col of colliders) {
            const cb = col.bounds;
            if (
              x + iw + gap > cb.left &&
              x < cb.right + gap &&
              y + ih + gap > cb.top &&
              y < cb.bottom + gap
            ) {
              anyClose = true;
              break;
            }
          }

          if (!anyClose) {
            foundPlacement = { nodeId, plateX: x, plateY: y, rotation: angle };
            break outer;
          }

          // ── Faza 2: Dokładna geometria Paper.js ───────────────────────────
          // AABB sygnalizuje bliskość kolidera — sprawdź rzeczywistą geometrię.
          // Ten kąt może wejść w "dziurę" sąsiedniego elementu mimo AABB-overlap.
          const cx = x + halfW;
          const cy = y + halfH;
          testClone.position = new paper.Point(cx, cy);
          const testCenter = new paper.Point(cx, cy);

          let collision = false;
          for (const col of colliders) {
            const cb = col.bounds;
            if (
              x + iw + gap <= cb.left ||
              x >= cb.right + gap ||
              y + ih + gap <= cb.top ||
              y >= cb.bottom + gap
            ) {
              continue; // ten konkretny kolider jest daleko
            }

            if (testClone.intersects(col)) {
              collision = true;
              break;
            }
            // Fallback: intersects() nie wykrywa kształtów leżących idealnie w sobie
            if (col.contains(testCenter) || testClone.contains(cb.center)) {
              collision = true;
              break;
            }
          }

          if (!collision) {
            foundPlacement = { nodeId, plateX: x, plateY: y, rotation: angle };
            break outer;
          }
          // Ten kąt koliduje — próbuj następnego kąta przy tej samej pozycji
        }
      }
    }

    // Zwolnij wszystkie klony kątów
    angleClones.forEach(({ clone }) => clone.remove());

    if (foundPlacement) {
      placed.push(foundPlacement);

      // Dodaj klon ułożonego elementu do koliderów (w koordynatach płyty)
      const col = item.clone({ insert: false }) as paper.Item;
      col.rotation = foundPlacement.rotation;
      col.position = new paper.Point(0, 0);
      const colW = col.bounds.width;
      const colH = col.bounds.height;
      col.position = new paper.Point(
        foundPlacement.plateX + colW / 2,
        foundPlacement.plateY + colH / 2,
      );
      colliders.push(col);
    } else {
      overflow.push(nodeId);
    }
  }

  colliders.forEach((c) => c.remove());
  return { placed, overflow };
}
