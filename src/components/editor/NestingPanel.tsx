import { useState, useEffect, useMemo } from "react";
import { X, Play, Trash2, RotateCcw, Download, ChevronDown, ChevronUp } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useEditorStore } from "../../stores/editorStore";
import { useToastStore } from "../../stores/toastStore";
import {
  runNestingFnRef,
  clearNestingFnRef,
  exportNestingSvgFnRef,
  type NestingRunResult,
  type RotationStep,
} from "../../lib/paperCanvas";

interface NestableElement {
  nodeId: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

interface NestingPanelProps {
  onClose: () => void;
}

/** Sanityzacja inputu numerycznego — tylko cyfry i kropka, brak ujemnych i spinnera */
function sanitizeNumeric(v: string): string {
  // Tylko cyfry i pojedyncza kropka dziesiętna
  const cleaned = v.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 2) return cleaned;
  return parts[0] + "." + parts.slice(1).join("");
}

export function NestingPanel({ onClose }: NestingPanelProps) {
  const boundsPerElement = useEditorStore((s) => s.boundsPerElement);
  const parentMap = useEditorStore((s) => s.parentMap);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const productIds = useEditorStore((s) => s.productIds);
  const addToast = useToastStore((s) => s.addToast);

  // Lista nestowalnych elementów = top-level (nie mają wpisu w parentMap)
  // Wyklucz też elementy o znikomej powierzchni (linie pomocnicze, puste path-e)
  // oraz produkty (rastry) — to zdjęcia do wizualizacji, nie elementy do cięcia.
  const elements = useMemo<NestableElement[]>(() => {
    const products = new Set(productIds);
    const out: NestableElement[] = [];
    for (const [nodeId, b] of Object.entries(boundsPerElement)) {
      if (parentMap[nodeId]) continue; // dziecko grupy — pomijamy
      if (products.has(nodeId)) continue; // produkt — nie nestujemy
      if (b.widthMm < 0.5 || b.heightMm < 0.5) continue; // za małe
      out.push({ nodeId, label: nodeId, widthMm: b.widthMm, heightMm: b.heightMm });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [boundsPerElement, parentMap, productIds]);

  const [plateW, setPlateW] = useState("0");
  const [plateH, setPlateH] = useState("0");
  const [gapMm, setGapMm] = useState("3");
  const [rotationStep, setRotationStep] = useState<RotationStep>(90);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // true po pierwszym ustawieniu listy — gotowy na live-sync z canvasa
  const [initialized, setInitialized] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<NestingRunResult | null>(null);
  const [overflowExpanded, setOverflowExpanded] = useState(true);

  // Pierwsze załadowanie listy elementów — zastosuj aktualną selekcję canvasa lub wszystkie.
  useEffect(() => {
    if (initialized || elements.length === 0) return;
    setInitialized(true);
    const initial = useEditorStore.getState().selectedElementIds;
    if (initial.length > 0) {
      const valid = initial.filter((id) => elements.some((e) => e.nodeId === id));
      if (valid.length > 0) { setSelectedIds(new Set(valid)); return; }
    }
    setSelectedIds(new Set(elements.map((e) => e.nodeId)));
  }, [elements, initialized]);

  // Live sync: gdy użytkownik zaznaczy elementy na canvasie (niepusta selekcja) → aktualizuj panel.
  // Pusta selekcja (klik na pustym obszarze) nie zmienia zaznaczenia w panelu.
  useEffect(() => {
    if (!initialized || selectedElementIds.length === 0) return;
    const valid = selectedElementIds.filter((id) => elements.some((e) => e.nodeId === id));
    if (valid.length > 0) setSelectedIds(new Set(valid));
  }, [selectedElementIds, initialized, elements]);

  // Reconcile zaznaczenie z aktualną listą elementów. Po strukturalnych zmianach
  // (np. „Wykryj otwory" scala kontury → znikają osobne otwory) panel trzymał stare ID,
  // więc licznik „X/Y" i zaznaczenia nie odświeżały się od razu (merge czyści selekcję
  // canvasa, więc live-sync wyżej się wykręca). Tylko PRZYCINAMY nieistniejące ID —
  // nie dodajemy nowych, by nie nadpisywać ręcznych odznaczeń przy zwykłych zmianach
  // (przesunięcie elementu też zmienia `elements`).
  useEffect(() => {
    if (!initialized) return;
    setSelectedIds((prev) => {
      const ids = new Set(elements.map((e) => e.nodeId));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [elements, initialized]);

  function toggleElement(nodeId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(elements.map((e) => e.nodeId)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  async function handleRun() {
    const w = parseFloat(plateW);
    const h = parseFloat(plateH);
    const g = parseFloat(gapMm);
    if (!w || !h || isNaN(w) || isNaN(h) || isNaN(g) || w <= 0 || h <= 0 || g < 0) return;
    if (selectedIds.size === 0) return;

    setIsRunning(true);
    setResult(null);

    // Pozwól przeglądarce odświeżyć UI przed ciężkim obliczeniem
    await new Promise((r) => setTimeout(r, 30));

    try {
      const res = runNestingFnRef.current?.({
        nodeIds: Array.from(selectedIds),
        plateWidthMm: w,
        plateHeightMm: h,
        gapMm: g,
        rotationStep,
      });
      setResult(res ?? null);
    } finally {
      setIsRunning(false);
    }
  }

  function handleClear() {
    clearNestingFnRef.current?.();
    setResult(null);
  }

  async function handleExport() {
    const svg = exportNestingSvgFnRef.current?.();
    if (!svg) return;
    try {
      const filePath = await save({
        filters: [{ name: "SVG", extensions: ["svg"] }],
        defaultPath: "plyta-nesting.svg",
      });
      if (!filePath) return;
      await writeTextFile(filePath, svg);
      addToast("Plik SVG został zapisany.", "success");
    } catch (e) {
      addToast(`Błąd zapisu: ${e}`, "error");
    }
  }

  const canRun = !isRunning && selectedIds.size > 0 && parseFloat(plateW) > 0 && parseFloat(plateH) > 0;

  return (
    <div
      className="absolute right-3 top-3 bottom-16 w-72 z-20 flex flex-col rounded-lg shadow-2xl border border-gray-700 bg-[#1a1a1a] overflow-hidden"
    >
      {/* Nagłówek */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800 shrink-0">
        <span className="text-sm font-semibold text-gray-200">Nesting — płyta</span>
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-3">

        {/* Wymiary płyty */}
        <section>
          <p className="text-xs font-medium text-gray-400 mb-1.5">Wymiary płyty (mm)</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={plateW}
              onChange={(e) => setPlateW(sanitizeNumeric(e.target.value))}
              onFocus={(e) => e.target.select()}
              className="w-full bg-[#252525] border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 text-center"
              placeholder="Szerokość"
            />
            <span className="text-gray-500 shrink-0">×</span>
            <input
              type="text"
              inputMode="decimal"
              value={plateH}
              onChange={(e) => setPlateH(sanitizeNumeric(e.target.value))}
              onFocus={(e) => e.target.select()}
              className="w-full bg-[#252525] border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 text-center"
              placeholder="Wysokość"
            />
          </div>
        </section>

        {/* Przerwa */}
        <section>
          <p className="text-xs font-medium text-gray-400 mb-1.5">Przerwa między elementami (mm)</p>
          <input
            type="text"
            inputMode="decimal"
            value={gapMm}
            onChange={(e) => setGapMm(sanitizeNumeric(e.target.value))}
            onFocus={(e) => e.target.select()}
            className="w-24 bg-[#252525] border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 text-center"
          />
        </section>

        {/* Rotacja */}
        <section>
          <p className="text-xs font-medium text-gray-400 mb-1.5">Krok rotacji</p>
          <div className="flex flex-col gap-1">
            {(
              [
                { val: 360, label: "Bez rotacji" },
                { val: 90,  label: "Co 90°" },
                { val: 45,  label: "Co 45°" },
                { val: 15,  label: "Co 15°" },
                { val: 5,   label: "Co 5° (wolniej)" },
                { val: 1,   label: "Co 1° (bardzo wolno)" },
              ] as { val: RotationStep; label: string }[]
            ).map(({ val, label }) => (
              <label key={val} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="rotationStep"
                  checked={rotationStep === val}
                  onChange={() => setRotationStep(val)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-gray-300">{label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Lista elementów */}
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-gray-400">
              Elementy ({selectedIds.size}/{elements.length})
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={selectAll}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Wszystkie
              </button>
              <span className="text-gray-700">·</span>
              <button
                onClick={deselectAll}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Żaden
              </button>
            </div>
          </div>

          {elements.length === 0 ? (
            <p className="text-xs text-gray-600 italic">Brak elementów SVG</p>
          ) : (
            <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
              {elements.map((el) => (
                <label
                  key={el.nodeId}
                  className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(el.nodeId)}
                    onChange={() => toggleElement(el.nodeId)}
                    className="accent-blue-500 shrink-0"
                  />
                  <span className="text-xs text-gray-300 truncate flex-1" title={el.nodeId}>
                    {el.label}
                  </span>
                  <span className="text-xs text-gray-600 shrink-0">
                    {el.widthMm.toFixed(0)}×{el.heightMm.toFixed(0)} mm
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        {/* Wynik */}
        {result && (
          <section className="border-t border-gray-800 pt-3">
            <p className="text-xs font-medium text-gray-400 mb-2">Wynik</p>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs text-gray-300">
                Ułożono: <span className="font-medium text-green-400">{result.placed}</span>{" "}
                z {selectedIds.size} elementów
              </span>
            </div>

            {result.overflow.length > 0 && (
              <div>
                <button
                  onClick={() => setOverflowExpanded((v) => !v)}
                  className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors mb-1"
                >
                  {overflowExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  Nie zmieściło się: {result.overflow.length}
                </button>
                {overflowExpanded && (
                  <div className="ml-4 flex flex-col gap-0.5">
                    {result.overflow.map((id) => (
                      <span key={id} className="text-xs text-gray-500 truncate">{id}</span>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    // Zaznacz tylko overflow — kliknięcie Układaj zrobi NOWĄ płytę obok
                    // istniejących (nie czyścimy poprzednich płyt)
                    setSelectedIds(new Set(result.overflow));
                    setResult(null);
                  }}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Zaznacz pozostałe (do nowej płyty)
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Akcje */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-gray-800">
        <button
          onClick={handleRun}
          disabled={!canRun}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isRunning ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Układam…
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Układaj
            </>
          )}
        </button>

        {result && (
          <button
            onClick={handleExport}
            title="Eksportuj płytę do SVG"
            className="p-2 rounded text-gray-400 hover:text-gray-200 bg-[#252525] border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          onClick={handleClear}
          title="Usuń wszystkie płyty (elementy zostają; Ctrl+Z cofa przesunięcia)"
          className="p-2 rounded text-gray-400 hover:text-red-400 bg-[#252525] border border-gray-700 hover:border-gray-600 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
