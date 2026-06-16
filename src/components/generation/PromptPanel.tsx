import { useState, useRef, Fragment } from "react";
import { RotateCcw, PenLine, X, Pencil, Check } from "lucide-react";
import { useGenerationStore } from "../../stores/generationStore";
import { useAssembledPrompt, useAssembledPromptItems } from "../../hooks/useAssembledPrompt";
import { providerForModel, PROVIDER_LABEL } from "../../lib/provider";

/**
 * Pojedyncze pole promptu w dwóch trybach:
 *   - AUTO (default): renderuje sekwencję auto-fragmentów (read-only tekst inline)
 *     przeplatanych badgami aktywnych presetów. Wszystko płynie inline jak tekst
 *     w zdaniu. User może:
 *       • przeciągnąć badge na inną pozycję — ruchomy caret (niebieska linia)
 *         podąża za kursorem i pokazuje gdzie wyląduje preset
 *       • usunąć badge (toggle preset off)
 *       • edytować INLINE tekst badge'a (zapisuje override per-instancja, NIE
 *         zmienia globalnego presetu w bibliotece)
 *   - OVERRIDE: textarea ze surowym tekstem (klasyczna ręczna edycja).
 *
 * UWAGA — drag używa POINTER EVENTS, nie HTML5 DnD.
 * Powód: Tauri z dragDropEnabled:true (potrzebne do dropowania plików z OS) rejestruje
 * IDropTarget na poziomie OLE, co intercepuje HTML5 `drop` event (cursor "no-drop").
 * Pointer events działają niezależnie od warstwy OLE — bez interferencji z Tauri.
 *
 * Dodawanie presetu z PresetsKanban → click na kafelek (toggle). Drag&drop z biblioteki
 * presetów do promptu wycofany — zbyt skomplikowany przez OLE/HTML5 konflikt.
 */
export function PromptPanel() {
  const {
    prompt, setPrompt, togglePresetId, setPresetAnchor,
    setPresetTextOverride, reorderActivePresetId, activePresetIds,
    setTimeOfDay, setTimeOfDayTextOverride, setTimeOfDayAnchor, model,
  } = useGenerationStore();
  const autoPrompt = useAssembledPrompt();
  const items = useAssembledPromptItems();
  const providerLabel = PROVIDER_LABEL[providerForModel(model)];

  // Drag state — pointer-based, bez HTML5 DnD
  const draggingPresetId = useRef<string | null>(null);
  const [draggingPresetIdState, setDraggingPresetIdState] = useState<string | null>(null);
  const [isDraggingAny, setIsDraggingAny] = useState(false);
  // Świeżo przeniesiony preset — animacja flash highlight przez 600ms po dropie
  const [recentlyMovedPresetId, setRecentlyMovedPresetId] = useState<string | null>(null);

  // Inline edit: który preset jest właśnie edytowany + buffer tekstu
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState("");

  // Insertion caret — pozycja gdzie wyląduje preset (śledzi kursor).
  // Renderowany absolute w containerRef. Idx synchroniczny w ref, pozycja w state.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const caretDropIdxRef = useRef<number | null>(null);
  const [caretPos, setCaretPos] = useState<{ top: number; left: number; height: number } | null>(null);
  // Wszystkie sloty (punkty wstawienia) — obliczone raz na początek draga.
  // Renderowane jako subtelne markery żeby user widział GDZIE może upuścić.
  const [allSlots, setAllSlots] = useState<Array<{ idx: number; top: number; left: number; height: number }>>([]);

  const isOverride = prompt !== null;

  function handleEnterOverride() {
    setPrompt(autoPrompt);
  }

  function handleResetToAuto() {
    setPrompt(null);
  }

  function handleRemoveBadge(presetId: string) {
    if (presetId === "__tod__") {
      setTimeOfDay("brak");
    } else {
      togglePresetId(presetId);
    }
  }

  function handleStartEdit(presetId: string, currentText: string) {
    setEditingPresetId(presetId);
    setEditBuffer(currentText);
  }

  function handleSaveEdit() {
    if (editingPresetId == null) return;
    const trimmed = editBuffer.trim();
    if (editingPresetId === "__tod__") {
      setTimeOfDayTextOverride(trimmed || null);
    } else {
      setPresetTextOverride(editingPresetId, trimmed);
    }
    setEditingPresetId(null);
    setEditBuffer("");
  }

  function handleCancelEdit() {
    setEditingPresetId(null);
    setEditBuffer("");
  }

  /**
   * Mapowanie indeksu wstawienia na anchor presetu (ID fragmentu).
   *   - idx = 0 → "__start__"
   *   - idx = items.length → "__end__"
   *   - inaczej → ID najbliższego fragmentu PRZED tym punktem
   */
  function dropIdxToAnchor(idx: number): string {
    if (idx <= 0) return "__start__";
    if (idx >= items.length) return "__end__";
    for (let i = idx - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "fragment") return it.id;
    }
    return "__start__";
  }

  /** Pozycja w `activePresetIds`: liczba innych presetów przed dropIdx. */
  function dropIdxToActiveIdx(dropIdx: number, draggedId: string): number {
    let count = 0;
    for (let i = 0; i < dropIdx && i < items.length; i++) {
      const it = items[i];
      if (it.kind === "preset" && it.presetId !== draggedId) count++;
    }
    return count;
  }

  /**
   * Buduje wszystkie N+1 punktów wstawienia (luki między elementami +
   * przed pierwszym + po ostatnim). Współrzędne w pikselach viewportu (nie
   * przeliczone na container coordinate jeszcze).
   *
   * Wspólna logika dla computeNearestDropPoint i computeAllDropPoints.
   */
  function buildInsertionPoints(elements: HTMLElement[]):
    Array<{ idx: number; x: number; y: number; height: number }>
  {
    const points: Array<{ idx: number; x: number; y: number; height: number }> = [];
    for (let i = 0; i <= elements.length; i++) {
      if (i === 0) {
        const r = elements[0].getBoundingClientRect();
        points.push({ idx: 0, x: r.left, y: r.top + r.height / 2, height: r.height });
      } else if (i === elements.length) {
        const r = elements[i - 1].getBoundingClientRect();
        points.push({ idx: i, x: r.right, y: r.top + r.height / 2, height: r.height });
      } else {
        const r1 = elements[i - 1].getBoundingClientRect();
        const r2 = elements[i].getBoundingClientRect();
        const sameLine = Math.abs(r1.top - r2.top) < 4;
        if (sameLine) {
          points.push({
            idx: i,
            x: (r1.right + r2.left) / 2,
            y: r1.top + r1.height / 2,
            height: Math.max(r1.height, r2.height),
          });
        } else {
          // Wrap: dwa warianty tego samego idx — koniec poprzedniej linii i początek następnej
          points.push({ idx: i, x: r1.right, y: r1.top + r1.height / 2, height: r1.height });
          points.push({ idx: i, x: r2.left, y: r2.top + r2.height / 2, height: r2.height });
        }
      }
    }
    return points;
  }

  /**
   * Konwersja punktu viewport→container (z kompensacją scroll).
   * Output używany bezpośrednio w CSS `position: absolute` w containerRef.
   */
  function toContainerCoord(
    p: { idx: number; x: number; y: number; height: number },
    cRect: DOMRect,
    scrollTop: number,
    scrollLeft: number,
  ): { idx: number; top: number; left: number; height: number } {
    return {
      idx: p.idx,
      top: p.y - cRect.top + scrollTop - p.height / 2,
      left: p.x - cRect.left + scrollLeft,
      height: p.height,
    };
  }

  /**
   * Znajduje punkt wstawienia do (clientX, clientY) w dwóch krokach:
   *
   * 1. **Inside-element rule (priorytet):** Jeśli kursor jest WEWNĄTRZ któregoś
   *    z `[data-prompt-item]`, snapuj do lewej lub prawej krawędzi tego elementu
   *    w zależności od X w połowie. To znacznie bardziej wybaczające niż czysta
   *    odległość — cały obszar fragmentu/badge'a "przyciąga" do najbliższej krawędzi.
   *
   * 2. **Fallback (odległość Euklidesowa):** Jeśli kursor w gapie lub w pustym
   *    obszarze poniżej tekstu — wybierz najbliższy punkt z computeAllDropPoints.
   */
  function computeNearestDropPoint(clientX: number, clientY: number):
    | { idx: number; top: number; left: number; height: number }
    | null
  {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return null;
    const cRect = container.getBoundingClientRect();
    const scrollTop = container.scrollTop;
    const scrollLeft = container.scrollLeft;

    const elements = Array.from(inner.querySelectorAll<HTMLElement>("[data-prompt-item]"));
    if (elements.length === 0) {
      const innerRect = inner.getBoundingClientRect();
      return {
        idx: 0,
        top: innerRect.top - cRect.top + scrollTop,
        left: innerRect.left - cRect.left + scrollLeft,
        height: 16,
      };
    }

    // 1. Inside-element half rule — kursor wewnątrz fragmentu/badge'a snapuje
    //    do najbliższej krawędzi (lewa = idx, prawa = idx+1).
    for (let i = 0; i < elements.length; i++) {
      const r = elements[i].getBoundingClientRect();
      if (
        clientX >= r.left && clientX <= r.right &&
        clientY >= r.top && clientY <= r.bottom
      ) {
        const midX = r.left + r.width / 2;
        const useRight = clientX >= midX;
        return {
          idx: useRight ? i + 1 : i,
          top: r.top - cRect.top + scrollTop,
          left: (useRight ? r.right : r.left) - cRect.left + scrollLeft,
          height: r.height,
        };
      }
    }

    // 2. Fallback — najbliższy punkt z N+1 luki.
    const points = buildInsertionPoints(elements);
    let nearest = points[0];
    let minDist = Infinity;
    for (const p of points) {
      const dx = p.x - clientX;
      const dy = p.y - clientY;
      const d = dx * dx + dy * dy;
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    return toContainerCoord(nearest, cRect, scrollTop, scrollLeft);
  }

  /**
   * Zwraca WSZYSTKIE punkty wstawienia (do renderowania slot markerów podczas draga).
   * Wywoływane raz na początek draga — pozycje slotów nie zmieniają się w trakcie.
   */
  function computeAllDropPoints(): Array<{ idx: number; top: number; left: number; height: number }> {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return [];
    const cRect = container.getBoundingClientRect();
    const scrollTop = container.scrollTop;
    const scrollLeft = container.scrollLeft;

    const elements = Array.from(inner.querySelectorAll<HTMLElement>("[data-prompt-item]"));
    if (elements.length === 0) {
      const innerRect = inner.getBoundingClientRect();
      return [{
        idx: 0,
        top: innerRect.top - cRect.top + scrollTop,
        left: innerRect.left - cRect.left + scrollLeft,
        height: 16,
      }];
    }

    return buildInsertionPoints(elements).map((p) =>
      toContainerCoord(p, cRect, scrollTop, scrollLeft),
    );
  }

  /**
   * Custom drag oparty na pointer events — zastępuje HTML5 draggable/dragstart/drop.
   * Powód: Tauri (dragDropEnabled:true) intercepuje OLE DnD, więc HTML5 `drop` nie odpala
   * i kursor pokazuje "zakaz". Pointer events działają niezależnie od OLE.
   *
   * Sekwencja:
   *   pointerdown na badge → zapisz start pos, czekaj
   *   pointermove > 5px → DRAG ACTIVE (ustaw isDraggingAny, śledzi caret)
   *   pointerup:
   *     - jeśli nie był drag → click bubbluje normalnie (edycja/usuwanie)
   *     - jeśli był drag i upuszczono nad container → commit
   *     - jeśli był drag poza container → cleanup
   */
  function handleBadgePointerDown(e: React.PointerEvent, presetId: string) {
    // Tylko LPM
    if (e.button !== 0) return;
    // Klik na przycisk wewnątrz badge'a (edycja/usuń) — nie inicjuj draga
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    function handlePointerMove(ev: PointerEvent) {
      if (!dragging) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        // Próg 5px — bez tego klik na badge przypadkowo zacząłby drag
        if (dx * dx + dy * dy < 25) return;
        dragging = true;
        draggingPresetId.current = presetId;
        setDraggingPresetIdState(presetId);
        setIsDraggingAny(true);
        // Oblicz wszystkie sloty raz — pozycje nie zmieniają się w trakcie draga
        // (badge dragowany pozostaje w layoucie, tylko z opacity).
        setAllSlots(computeAllDropPoints());
      }
      // Ukryj caret+ghost gdy kursor poza containerem — visualne kłamstwo "tu wpadnie"
      // jeśli i tak nie commitujemy poza obszarem promptu.
      const rect = containerRef.current?.getBoundingClientRect();
      const isOver = !!rect &&
        ev.clientX >= rect.left && ev.clientX <= rect.right &&
        ev.clientY >= rect.top && ev.clientY <= rect.bottom;
      if (!isOver) {
        caretDropIdxRef.current = null;
        setCaretPos(null);
        return;
      }
      const point = computeNearestDropPoint(ev.clientX, ev.clientY);
      if (point) {
        caretDropIdxRef.current = point.idx;
        setCaretPos({ top: point.top, left: point.left, height: point.height });
      } else {
        caretDropIdxRef.current = null;
        setCaretPos(null);
      }
    }

    function handlePointerUp(ev: PointerEvent) {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);

      if (!dragging) {
        // To był click, nie drag — nic nie rób, naturalny onClick (jeśli jest) odpali
        return;
      }

      // Sprawdź czy upuszczono nad containerem promptu
      const rect = containerRef.current?.getBoundingClientRect();
      const isOverContainer = !!rect &&
        ev.clientX >= rect.left && ev.clientX <= rect.right &&
        ev.clientY >= rect.top && ev.clientY <= rect.bottom;

      if (isOverContainer) {
        commitPresetDrop(presetId);
      } else {
        // Upuszczone poza promptem — cleanup bez commitowania
        draggingPresetId.current = null;
        caretDropIdxRef.current = null;
        setDraggingPresetIdState(null);
        setIsDraggingAny(false);
        setCaretPos(null);
      }
      setAllSlots([]);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  }

  function commitPresetDrop(presetId: string) {
    const idx = caretDropIdxRef.current ?? items.length;

    if (presetId === "__tod__") {
      setTimeOfDayAnchor(dropIdxToAnchor(idx));
    } else {
      const wasActive = activePresetIds.includes(presetId);
      if (!wasActive) {
        togglePresetId(presetId);
      }
      setPresetAnchor(presetId, dropIdxToAnchor(idx));
      if (wasActive) {
        reorderActivePresetId(presetId, dropIdxToActiveIdx(idx, presetId));
      }
    }

    draggingPresetId.current = null;
    caretDropIdxRef.current = null;
    setDraggingPresetIdState(null);
    setIsDraggingAny(false);
    setCaretPos(null);
    setAllSlots([]);

    // Flash highlight świeżo przeniesionego presetu
    setRecentlyMovedPresetId(presetId);
    setTimeout(() => setRecentlyMovedPresetId((curr) => (curr === presetId ? null : curr)), 600);
  }

  // ── Render ────────────────────────────────────────────────────────────
  if (isOverride) {
    return (
      <div className="flex flex-col flex-1 min-h-0 gap-1.5">
        <div className="flex items-center justify-between shrink-0">
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Prompt (tryb ręczny)
            <span className="inline-flex items-center rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-blue-300" title="Prompt jest osobny dla każdego dostawcy">
              {providerLabel}
            </span>
          </label>
          <button
            onClick={handleResetToAuto}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors"
            title="Wróć do trybu automatycznego z presetami jako badges"
          >
            <RotateCcw className="w-3 h-3" />
            Resetuj do automatu
          </button>
        </div>

        <textarea
          value={prompt!}
          onChange={(e) => setPrompt(e.target.value)}
          spellCheck={false}
          className="flex-1 min-h-0 w-full rounded-md px-3 py-2.5 text-xs font-mono leading-relaxed resize-none focus:outline-none bg-[#111] border border-blue-600 text-gray-200 focus:border-blue-400"
          placeholder="Edytuj prompt lub dodaj własne wskazówki…"
        />

        <p className="shrink-0 text-[10px] text-amber-600/80">
          ⚠ Tryb ręcznej edycji — zmiany materiałów, LED, kamery, środowiska i presetów
          NIE są już automatycznie wczytywane. Kliknij „Resetuj do automatu", by wrócić.
        </p>
      </div>
    );
  }

  const showCaret = isDraggingAny && caretPos !== null;

  // Tekst aktualnie przeciąganego presetu — do podglądu w "ghost badge".
  // Truncate do pierwszej linii + 60 znaków: ghost ma być wskazówką, nie kopią całości.
  let draggedTextPreview = "";
  if (draggingPresetIdState) {
    const draggedItem = items.find(
      (it) => it.kind === "preset" && it.presetId === draggingPresetIdState,
    );
    if (draggedItem && draggedItem.kind === "preset") {
      const firstLine = draggedItem.text.split("\n")[0];
      const truncated = firstLine.slice(0, 60);
      draggedTextPreview = truncated + (firstLine.length > 60 || draggedItem.text.includes("\n") ? "…" : "");
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-1.5">
      <div className="flex items-center justify-between shrink-0">
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Prompt
          <span className="inline-flex items-center rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-blue-300" title="Prompt jest osobny dla każdego dostawcy">
            {providerLabel}
          </span>
        </label>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
            <PenLine className="w-3 h-3" />
            Auto + presety jako badges
          </span>
          <button
            onClick={handleEnterOverride}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors"
            title="Przełącz na ręczną edycję jako tekst"
          >
            <Pencil className="w-3 h-3" />
            Edytuj ręcznie
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`relative flex-1 min-h-0 w-full rounded-md px-3 py-2.5 text-xs font-mono leading-relaxed overflow-y-auto bg-[#111] border text-gray-300 transition-colors ${
          isDraggingAny ? "border-blue-700" : "border-gray-800"
        }`}
      >
        {items.length === 0 ? (
          <p className="text-gray-600 italic">
            Brak treści promptu — dodaj materiały, tło lub presety.
          </p>
        ) : (
          // Inline flow: fragmenty + badges. Każdy ma `data-prompt-item`
          // żeby hit-test mógł je iterować przez querySelectorAll.
          <div ref={innerRef}>
            {items.map((item, i) => (
              <Fragment key={`${item.kind}-${i}`}>
                {item.kind === "fragment" ? (
                  <span
                    data-prompt-item={i}
                    className="whitespace-pre-wrap"
                  >
                    {item.text}{" "}
                  </span>
                ) : (
                  <PresetBadge
                    itemIdx={i}
                    text={item.text}
                    isEditing={editingPresetId === item.presetId}
                    editBuffer={editBuffer}
                    isDragging={draggingPresetIdState === item.presetId}
                    isRecentlyMoved={recentlyMovedPresetId === item.presetId}
                    onRemove={() => handleRemoveBadge(item.presetId)}
                    onStartEdit={() => handleStartEdit(item.presetId, item.text)}
                    onChangeEditBuffer={setEditBuffer}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={handleCancelEdit}
                    onPointerDown={(e) => handleBadgePointerDown(e, item.presetId)}
                  />
                )}
              </Fragment>
            ))}
          </div>
        )}

        {/* Slot markery — subtelne pionowe kreski we WSZYSTKICH możliwych miejscach
            wstawienia. Widoczne podczas draga żeby user widział że może upuścić
            w wielu miejscach (nie tylko w jednym "magicznym" punkcie).
            Aktywny slot ukryty — przejmuje go I-beam caret. */}
        {isDraggingAny && allSlots.map((slot, i) => {
          if (slot.idx === caretDropIdxRef.current) return null;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                top: slot.top,
                left: slot.left - 1,
                height: slot.height,
                width: 2,
              }}
              className="rounded-full bg-blue-500/25 pointer-events-none"
            />
          );
        })}

        {/* Insertion caret w stylu I-beam (kursor tekstowy) — gruba pionowa linia
            z poziomymi serifami u góry i u dołu. Bardziej widoczna niż cienka linia 2px.
            Pozycja `absolute` w container coordinate, transition gładko śledzi kursor.
            pointer-events-none żeby nie blokował pointermove. */}
        {showCaret && (
          <div
            style={{
              position: "absolute",
              top: caretPos!.top - 2,
              left: caretPos!.left,
              height: caretPos!.height + 4,
              width: 0,
            }}
            className="pointer-events-none z-10 transition-all duration-75 ease-out"
          >
            {/* Górna serifa */}
            <div
              className="absolute bg-blue-400 rounded-full shadow shadow-blue-500/60"
              style={{ top: 0, left: -6, width: 14, height: 2 }}
            />
            {/* Pionowa linia (3px) z pulsacją */}
            <div
              className="absolute bg-blue-400 rounded-full shadow shadow-blue-500/70 animate-pulse"
              style={{ top: 2, left: -1.5, width: 3, height: caretPos!.height }}
            />
            {/* Dolna serifa */}
            <div
              className="absolute bg-blue-400 rounded-full shadow shadow-blue-500/60"
              style={{ bottom: 0, left: -6, width: 14, height: 2 }}
            />
          </div>
        )}

        {/* Ghost badge — półprzezroczysta kopia przeciąganego presetu w miejscu
            gdzie wyląduje. WYSIWYG: user widzi DOKŁADNIE co i gdzie. Pozycja tuż
            obok caret (po prawej, żeby caret pokazywał punkt wstawienia). */}
        {showCaret && draggedTextPreview && (
          <div
            style={{
              position: "absolute",
              top: caretPos!.top,
              left: caretPos!.left + 10,
              height: caretPos!.height,
            }}
            className="pointer-events-none z-10 flex items-center transition-all duration-75 ease-out"
          >
            <span className="inline-block border border-blue-400/80 bg-blue-700/50 text-blue-50 rounded px-1.5 py-0.5 backdrop-blur-sm shadow-lg shadow-blue-900/50 whitespace-nowrap text-[11px]">
              {draggedTextPreview}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subkomponenty ──────────────────────────────────────────────────────

interface PresetBadgeProps {
  itemIdx: number;
  text: string;
  isEditing: boolean;
  editBuffer: string;
  isDragging: boolean;
  isRecentlyMoved: boolean;
  onRemove: () => void;
  onStartEdit: () => void;
  onChangeEditBuffer: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
}

function PresetBadge({
  itemIdx, text, isEditing, editBuffer, isDragging, isRecentlyMoved,
  onRemove, onStartEdit, onChangeEditBuffer, onSaveEdit, onCancelEdit, onPointerDown,
}: PresetBadgeProps) {
  if (isEditing) {
    return (
      <span
        data-prompt-item={itemIdx}
        className="inline-flex items-start gap-1 mx-0.5 align-middle bg-blue-950/70 border border-blue-500 rounded-md px-1.5 py-1"
      >
        <textarea
          value={editBuffer}
          onChange={(e) => onChangeEditBuffer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSaveEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          autoFocus
          rows={Math.max(2, Math.min(6, editBuffer.split("\n").length))}
          className="bg-[#0a0a0a] text-blue-100 text-[11px] rounded px-1.5 py-1 focus:outline-none border border-blue-700 focus:border-blue-400 min-w-[280px] resize-y"
        />
        <span className="inline-flex flex-col gap-0.5">
          <button
            onClick={onSaveEdit}
            title="Zapisz (Ctrl+Enter)"
            className="p-0.5 text-green-400 hover:text-white transition-colors"
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            onClick={onCancelEdit}
            title="Anuluj (Esc)"
            className="p-0.5 text-gray-400 hover:text-red-300 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      </span>
    );
  }

  const stateClasses = isDragging
    ? "opacity-40 scale-95 shadow-lg shadow-blue-900/50 bg-blue-700/60 border-blue-400"
    : isRecentlyMoved
      ? "bg-blue-700/80 border-blue-400 ring-2 ring-blue-400/60"
      : "bg-blue-900/60 border-blue-700 hover:bg-blue-800/70 hover:border-blue-600";

  return (
    <span
      data-prompt-item={itemIdx}
      onPointerDown={onPointerDown}
      title="Przeciągnij by zmienić pozycję"
      className={`inline align-baseline border text-blue-100 rounded px-1.5 py-0.5 mx-0.5 cursor-grab active:cursor-grabbing select-none transition-all duration-200 ease-out ${stateClasses}`}
      style={isDragging ? { transform: "scale(0.95) rotate(-1deg)" } : undefined}
    >
      <span className="whitespace-pre-wrap">{text}</span>
      <button
        onClick={onStartEdit}
        title="Edytuj tę instancję (nie zmienia presetu w bibliotece)"
        className="ml-1 align-middle text-blue-300 hover:text-white transition-colors"
      >
        <Pencil className="w-2.5 h-2.5 inline" />
      </button>
      <button
        onClick={onRemove}
        title="Usuń z promptu"
        className="ml-0.5 align-middle text-blue-300 hover:text-red-300 transition-colors"
      >
        <X className="w-2.5 h-2.5 inline" />
      </button>
    </span>
  );
}
