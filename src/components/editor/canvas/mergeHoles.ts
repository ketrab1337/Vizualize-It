import paper from "paper";

/**
 * Scalanie konturów liter w prawdziwe wektory z otworami.
 *
 * KONTEKST PROBLEMU:
 * Pliki z xTool Creative Space (i większości softu laserowego) eksportują każdy
 * kontur jako OSOBNY <path fill="none"> (linia cięcia). Środek litery — trójkąt
 * w „A", oczko w „0"/„O"/„R"/„9" — to ODDZIELNA ścieżka, a nie „dziura" w literze.
 * Dlatego:
 *   • po nadaniu materiału (koloru) wypełnia się cała sylwetka litery — środek nie
 *     jest odjęty, więc zostaje zamalowany,
 *   • do nestingu każdy kontur liczy się jako osobny element (samo oczko „0" jako
 *     oddzielny kawałek).
 *
 * ROZWIĄZANIE:
 * Wykryj, które kontury leżą wewnątrz innych (= otwory), i połącz każdą literę
 * (kontur zewnętrzny + jego otwory) w jeden `paper.CompoundPath` z regułą
 * `fill-rule="evenodd"`. Wtedy środek jest pusty (evenodd przełącza wnętrze/zewnętrze
 * po parzystości przecięć — kierunek nawijania ścieżki nie ma znaczenia), a litera
 * jest JEDNYM elementem gotowym do nestingu (silnik może nawet układać małe litery
 * w dużych otworach).
 *
 * Ramka prostokątna (obrys płyty obejmujący wszystkie litery) jest wykluczana z
 * analizy — inaczej „wchłonęłaby" wszystkie litery jako swoje otwory.
 */

export interface MergeHolesResult {
  /** Liczba liter, którym scalono otwór(y) w jeden wektor. */
  merged: number;
  /** Liczba ścieżek-otworów wchłoniętych (usuniętych jako osobne elementy). */
  holesConsumed: number;
  /** Liczba istniejących CompoundPath, którym naprawiono regułę na evenodd. */
  fixedFillRule: number;
  /** Nazwy usuniętych otworów — caller czyści z nich stores (override/bounds/parentMap). */
  removedNames: string[];
  /** Nazwy elementów (liter), którym nadano wypełnienie — caller ustawia im override.fill. */
  filledNames: string[];
}

type ClosedItem = paper.Path | paper.CompoundPath;

/** Kandydat do analizy: zamknięta ścieżka lub compound path, widoczny i odblokowany. */
function isClosedCandidate(item: paper.Item): item is ClosedItem {
  if (item.locked || !item.visible) return false;
  if (item instanceof paper.CompoundPath) return true;
  if (item instanceof paper.Path) return item.closed;
  return false;
}

function absArea(item: ClosedItem): number {
  return Math.abs(item.area ?? 0);
}

/** Punkt pewnie leżący WEWNĄTRZ ścieżki — do testu zawierania. */
function interiorPoint(path: ClosedItem): paper.Point {
  const c = path.bounds.center;
  // Środek bboxa zwykle leży w środku otworu/litery. Gdy nie (kształt wklęsły jak
  // „C", „U") — użyj centroidu z wierzchołków segmentów.
  try {
    if (path.contains(c)) return c;
  } catch {
    /* contains rzuca dla otwartych ścieżek — obsłużone niżej */
  }
  const segs = (path as paper.Path).segments;
  if (segs && segs.length) {
    let x = 0;
    let y = 0;
    for (const s of segs) {
      x += s.point.x;
      y += s.point.y;
    }
    return new paper.Point(x / segs.length, y / segs.length);
  }
  return c;
}

/** Czy `outer` geometrycznie zawiera `inner` (otwór). */
function geomContains(outer: ClosedItem, inner: ClosedItem, innerPt: paper.Point): boolean {
  if (outer === inner) return false;
  if (!outer.bounds.contains(inner.bounds)) return false; // szybkie odrzucenie po AABB
  const ao = absArea(outer);
  const ai = absArea(inner);
  if (ai <= 0 || ai >= ao * 0.98) return false; // otwór musi być istotnie mniejszy
  try {
    return outer.contains(innerPt);
  } catch {
    return false;
  }
}

/**
 * Czy ścieżka jest „prostokątna" — pole ≈ pole bboxa. Prawdziwy prostokąt wypełnia
 * ~100% bboxa; elipsa (otwór „O") ~78%, więc próg 0.92 czysto je rozdziela.
 */
function rectangleLike(path: ClosedItem): boolean {
  const b = path.bounds;
  const bboxArea = b.width * b.height;
  if (bboxArea <= 0) return false;
  return absArea(path) >= bboxArea * 0.92;
}

/**
 * Ustawia evenodd na istniejących CompoundPath, które mają zagnieżdżony subpath
 * (otwór) ale renderują się pełne (import bez fill-rule, np. z xTool z wieloma
 * subpathami w jednym <path>). Nie rusza compoundów bez zagnieżdżenia.
 */
function fixExistingCompounds(items: ClosedItem[], result: MergeHolesResult): void {
  for (const it of items) {
    if (!(it instanceof paper.CompoundPath)) continue;
    if (!it.parent) continue; // już usunięty (wchłonięty jako outer)
    if (it.fillRule === "evenodd") continue;
    const kids = it.children as paper.Path[];
    if (!kids || kids.length < 2) continue;
    let nested = false;
    for (let i = 0; i < kids.length && !nested; i++) {
      for (let j = 0; j < kids.length; j++) {
        if (i === j) continue;
        const a = kids[i];
        const bch = kids[j];
        if (a.bounds.contains(bch.bounds) && Math.abs(bch.area) < Math.abs(a.area) * 0.98) {
          try {
            if (a.contains(bch.bounds.center)) {
              nested = true;
              break;
            }
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (nested) {
      it.fillRule = "evenodd";
      result.fixedFillRule++;
    }
  }
}

/** Czyści nazwę elementu (identyfikator przechodzi na compound-rodzica). */
function clearName(it: paper.Item): void {
  (it as unknown as { name: string | null }).name = null;
}

/**
 * Przenosi zawartość `src` (Path lub subpathy CompoundPath) jako dzieci do `cp`.
 * Czyści nazwy przenoszonych konturów — tożsamość (id, override) niesie compound,
 * inaczej miałby tę samą nazwę co jego subpath.
 */
function moveContoursInto(cp: paper.CompoundPath, src: ClosedItem): void {
  if (src instanceof paper.CompoundPath) {
    [...(src.children as paper.Item[])].forEach((ch) => {
      clearName(ch);
      cp.addChild(ch);
    });
    src.remove();
  } else {
    clearName(src);
    cp.addChild(src);
  }
}

/**
 * Wykrywa otwory i scala każdą literę (kontur zewnętrzny + otwory) w jeden
 * CompoundPath z evenodd. Mutuje warstwę: buduje compoundy i usuwa ścieżki-otwory.
 *
 * @param topLevel dzieci warstwy „svg" (elementy najwyższego poziomu)
 * @param fillUnfilled gdy podany (np. "#000000") — każda litera/kształt BEZ wypełnienia
 *   (import liniowy `fill="none"`) dostaje ten kolor, by od razu było widać sylwetkę.
 *   Ramka/panel (obrys płyty) jest pomijana. Caller dostaje `filledNames` do ustawienia override.fill.
 * @returns statystyki + nazwy usuniętych otworów (do czyszczenia stores) + nazwy wypełnionych
 */
export function mergeLetterHoles(topLevel: paper.Item[], fillUnfilled?: string): MergeHolesResult {
  const result: MergeHolesResult = {
    merged: 0,
    holesConsumed: 0,
    fixedFillRule: 0,
    removedNames: [],
    filledNames: [],
  };

  const work = topLevel.filter(isClosedCandidate) as ClosedItem[];
  if (work.length === 0) return result;

  // Punkty wewnętrzne (do testu zawierania)
  const pts = new Map<ClosedItem, paper.Point>();
  for (const w of work) pts.set(w, interiorPoint(w));

  // Surowy graf zawierania: dla każdego elementu lista WSZYSTKICH jego kontenerów
  const rawContainers = new Map<ClosedItem, ClosedItem[]>();
  for (const inner of work) {
    const list: ClosedItem[] = [];
    const ip = pts.get(inner)!;
    for (const outer of work) {
      if (geomContains(outer, inner, ip)) list.push(outer);
    }
    rawContainers.set(inner, list);
  }

  // Ile elementów zawiera każdy kontener (do detekcji paneli)
  const containsCount = new Map<ClosedItem, number>();
  for (const w of work) containsCount.set(w, 0);
  for (const [, list] of rawContainers) {
    for (const o of list) containsCount.set(o, (containsCount.get(o) ?? 0) + 1);
  }

  // PANEL = kontener obejmujący wiele elementów. Ramka/obrys płyty (obejmuje ≥3
  // elementy) albo prostokątny panel (prostokąt obejmujący ≥1) — NIE jest literą,
  // więc wykluczamy go z roli kontenera (inaczej wchłonąłby litery jako „otwory").
  // Litera „B"/„8" ma 2 otwory, ale nie jest prostokątna → nie zostaje panelem.
  const panels = new Set<ClosedItem>();
  for (const w of work) {
    const cc = containsCount.get(w) ?? 0;
    if (cc >= 3 || (cc >= 1 && rectangleLike(w))) panels.add(w);
  }

  // Efektywne kontenery = z pominięciem paneli. Nieparzysta liczba = otwór.
  // Każdy otwór przypisz do najmniejszego (bezpośredniego) kontenera = litery.
  const effContainers = new Map<ClosedItem, ClosedItem[]>();
  for (const inner of work) {
    effContainers.set(inner, (rawContainers.get(inner) ?? []).filter((o) => !panels.has(o)));
  }

  const holesByOuter = new Map<ClosedItem, ClosedItem[]>();
  for (const inner of work) {
    if (panels.has(inner)) continue; // panel zostaje osobnym elementem
    const list = effContainers.get(inner)!;
    if (list.length % 2 !== 1) continue; // pełny kształt (litera) — nie otwór
    let parent = list[0];
    for (const o of list) if (absArea(o) < absArea(parent)) parent = o;
    const arr = holesByOuter.get(parent) ?? [];
    arr.push(inner);
    holesByOuter.set(parent, arr);
  }

  // Elementy wchłonięte (outery zamienione w compound + ich otwory) — wykluczane z
  // wypełniania jako osobne kształty. Nowe compoundy (litery) trzymamy osobno.
  const absorbed = new Set<ClosedItem>();
  const builtCompounds: ClosedItem[] = [];

  // Buduj CompoundPath per litera z otworami
  for (const [outer, holes] of holesByOuter) {
    // Pomiń jeśli sam „outer" jest otworem (parzystość nieparzysta) — to nie litera
    if ((effContainers.get(outer)?.length ?? 0) % 2 === 1) continue;
    const parent = outer.parent;
    if (!parent) continue;

    // Snapshot stylu i metadanych z konturu zewnętrznego (PRZED przeniesieniem)
    const fillColor = outer.fillColor;
    const strokeColor = outer.strokeColor;
    const strokeWidth = outer.strokeWidth;
    const dashArray = outer.dashArray;
    const opacity = outer.opacity;
    const visible = outer.visible;
    const name = outer.name;

    const cp = new paper.CompoundPath({ insert: false });
    moveContoursInto(cp, outer); // kontur zewnętrzny
    for (const h of holes) {
      const holeName = h.name; // PRZED moveContoursInto — ono czyści name (clearName),
                               // więc odczyt po przeniesieniu zawsze dawał null i removedNames
                               // zostawało puste → otwory nie znikały z nestingu do reloadu.
      moveContoursInto(cp, h); // otwory
      if (holeName) result.removedNames.push(holeName);
      result.holesConsumed++;
    }

    if (cp.children.length === 0) {
      cp.remove();
      continue;
    }

    cp.fillRule = "evenodd";
    cp.fillColor = fillColor ?? null;
    cp.strokeColor = strokeColor ?? null;
    if (strokeWidth != null) cp.strokeWidth = strokeWidth;
    if (dashArray && dashArray.length) cp.dashArray = dashArray;
    cp.opacity = opacity ?? 1;
    cp.visible = visible;
    if (name) cp.name = name;

    parent.addChild(cp); // kolejność wśród osobnych liter nieistotna
    result.merged++;
    absorbed.add(outer);
    for (const h of holes) absorbed.add(h);
    builtCompounds.push(cp);
  }

  // Napraw istniejące compoundy, które miały otwór w subpathach ale renderowały się pełne
  fixExistingCompounds(work, result);

  // Wypełnij kolorem litery/kształty bez wypełnienia (import liniowy). Pomija ramkę
  // (panel) i elementy już pokolorowane. Nowe compoundy + samodzielne litery (bez otworów).
  if (fillUnfilled) {
    let color: paper.Color | null = null;
    try { color = new paper.Color(fillUnfilled); } catch { color = null; }
    if (color) {
      const targets: ClosedItem[] = [...builtCompounds];
      for (const w of work) {
        if (absorbed.has(w) || panels.has(w) || !w.parent) continue;
        targets.push(w);
      }
      for (const t of targets) {
        if (t.fillColor) continue; // już ma kolor — nie nadpisuj
        t.fillColor = color.clone();
        t.strokeColor = null; // wypełniony element nie nosi obrysu cięcia (jak stripStrokeIfFilled)
        if (t.name) result.filledNames.push(t.name);
      }
    }
  }

  return result;
}
