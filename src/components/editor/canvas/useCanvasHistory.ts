import { useCallback, useRef } from "react";
import paper from "paper";
import { exportSvgLayer, findItemByName } from "./paperUtils";
import { updateSvgWithOverrides } from "../../../lib/svgHelpers";
import { useEditorStore } from "../../../stores/editorStore";
import type { NodeOverride } from "../../../types";

interface HistoryEntry { svg: string; selection: string[]; }

interface UseCanvasHistoryParams {
  svgLayerRef: React.MutableRefObject<paper.Layer | null>;
  svgContentRef: React.MutableRefObject<string | null>;
  nodeOverridesRef: React.MutableRefObject<Record<string, NodeOverride>>;
  mmPerUnitRef: React.MutableRefObject<number>;
  selectedItemsRef: React.MutableRefObject<paper.Item[]>;
  /** Ostatnio zapisany svgContent — reimport w Canvas skip-uje gdy svgContent === ten ref. */
  lastSavedContentRef: React.MutableRefObject<string | null>;
  setSvgContent: (content: string | null) => void;
  clearSelection: () => void;
  addToSelection: (item: paper.Item) => void;
  rebuildLayerItems: () => void;
  setContextMenu: (m: null) => void;
  removeNodeOverride: (id: string) => void;
  removeBoundsForElement: (id: string) => void;
  /** Wywoływane po wklejeniu — aktualizuje boundsPerElement i parentMap dla nowych kopii. */
  onAfterPaste?: (items: paper.Item[]) => void;
}

interface UseCanvasHistoryResult {
  historyRef: React.MutableRefObject<HistoryEntry[]>;
  historyIndexRef: React.MutableRefObject<number>;
  isUndoRedoRef: React.MutableRefObject<boolean>;
  clipboardRef: React.MutableRefObject<{ item: paper.Item; name: string }[]>;
  isDraggingItemRef: React.MutableRefObject<boolean>;
  pushHistory: () => void;
  /** Zapisuje gotowy SVG-string bezpośrednio do historii (używane np. przy lock/visible). */
  pushHistoryDirect: (svg: string) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleCopy: () => void;
  handlePaste: () => void;
  handleDelete: () => void;
}

/**
 * Historia cofania/ponawiania, schowek (kopiuj/wklej) i usuwanie.
 * Wszystkie operacje pracują przez refy — komponent przekazuje refy z useRef.
 */
export function useCanvasHistory(params: UseCanvasHistoryParams): UseCanvasHistoryResult {
  const {
    svgLayerRef, svgContentRef, nodeOverridesRef, mmPerUnitRef,
    selectedItemsRef, lastSavedContentRef,
    setSvgContent, clearSelection, addToSelection, rebuildLayerItems, setContextMenu,
    removeNodeOverride, removeBoundsForElement, onAfterPaste,
  } = params;

  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  const clipboardRef = useRef<{ item: paper.Item; name: string }[]>([]);
  const pasteOffsetRef = useRef(0);
  const isDraggingItemRef = useRef(false);

  const pushHistory = useCallback(() => {
    if (isUndoRedoRef.current) return; // nie zapisuj podczas cofania/ponawiania
    const layer = svgLayerRef.current;
    const content = svgContentRef.current;
    if (!layer || !content) return;
    const exported = exportSvgLayer(layer, mmPerUnitRef.current);
    // Czytaj bezpośrednio ze store (synchroniczny Zustand), nie z ref — ref aktualizuje się
    // dopiero po renderze, a pushHistory może być wołany z setTimeout(0) przed renderem.
    const currentOverrides = useEditorStore.getState().nodeOverrides;
    const withOverrides = updateSvgWithOverrides(exported, currentOverrides);
    const selection = selectedItemsRef.current.map((i) => i.name).filter(Boolean) as string[];
    historyRef.current.splice(historyIndexRef.current + 1);
    historyRef.current.push({ svg: withOverrides, selection });
    historyIndexRef.current = historyRef.current.length - 1;
    // Sync store → wyzwala auto-zapis w MainArea; lastSavedContentRef blokuje reimport w Canvas
    // (deterministyczne porównanie content zamiast wcześniejszego setTimeout-based isSavingRef).
    lastSavedContentRef.current = withOverrides;
    setSvgContent(withOverrides);
  }, [svgLayerRef, svgContentRef, nodeOverridesRef, mmPerUnitRef, selectedItemsRef, lastSavedContentRef, setSvgContent]);

  const pushHistoryDirect = useCallback((svg: string) => {
    if (isUndoRedoRef.current) return;
    const selection = selectedItemsRef.current.map((i) => i.name).filter(Boolean) as string[];
    historyRef.current.splice(historyIndexRef.current + 1);
    historyRef.current.push({ svg, selection });
    historyIndexRef.current = historyRef.current.length - 1;
    lastSavedContentRef.current = svg;
    setSvgContent(svg);
  }, [isUndoRedoRef, selectedItemsRef, historyRef, historyIndexRef, lastSavedContentRef, setSvgContent]);

  const restoreSelectionAfterUndoRedo = useCallback((names: string[]) => {
    const layer = svgLayerRef.current;
    if (!layer || names.length === 0) return;
    clearSelection();
    names.forEach((name) => {
      const item = findItemByName(layer, name);
      if (item) addToSelection(item);
    });
  }, [svgLayerRef, clearSelection, addToSelection]);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current--;
    const entry = historyRef.current[historyIndexRef.current];
    // Wyzeruj lastSavedContentRef — bez tego REDO do najświeższego stanu (== lastSaved
    // z ostatniego pushHistory) trafi w skip-guard w useEffect import i Paper.js
    // zostanie w stanie po undo, a store pokaże stan po redo (rozsynchronizowanie).
    lastSavedContentRef.current = null;
    setSvgContent(entry.svg);
    setTimeout(() => {
      isUndoRedoRef.current = false;
      restoreSelectionAfterUndoRedo(entry.selection);
    }, 100);
  }, [setSvgContent, restoreSelectionAfterUndoRedo, lastSavedContentRef]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current++;
    const entry = historyRef.current[historyIndexRef.current];
    lastSavedContentRef.current = null;
    setSvgContent(entry.svg);
    setTimeout(() => {
      isUndoRedoRef.current = false;
      restoreSelectionAfterUndoRedo(entry.selection);
    }, 100);
  }, [setSvgContent, restoreSelectionAfterUndoRedo, lastSavedContentRef]);

  const handleCopy = useCallback(() => {
    const items = selectedItemsRef.current;
    if (items.length === 0) return;
    // Klonujemy poza drzewem projektu — project.clear() nie usuwa elementów bez rodzica
    clipboardRef.current = items.map((item) => ({
      item: item.clone({ deep: true, insert: false }) as paper.Item,
      name: item.name || `item_${Date.now()}`,
    }));
    pasteOffsetRef.current = 0;
  }, [selectedItemsRef]);

  const handlePaste = useCallback(() => {
    const clipboard = clipboardRef.current;
    const layer = svgLayerRef.current;
    if (clipboard.length === 0 || !layer) return;
    pasteOffsetRef.current += 10;
    const offset = pasteOffsetRef.current;
    clearSelection();
    layer.activate();
    const pasted: paper.Item[] = [];
    clipboard.forEach(({ item: original, name }, i) => {
      // Klonujemy z kopii w schowku — oryginał pozostaje dla kolejnych wklejeń
      const clone = original.clone({ deep: true, insert: false }) as paper.Item;
      layer.addChild(clone);
      clone.position = clone.position.add(new paper.Point(offset, offset));
      // offset rośnie o 10 przy każdym wklejeniu → unikalna nazwa dla każdej partii kopii
      clone.name = `${name}_kopia_${offset}_${i}`;
      pasted.push(clone);
    });
    pasted.forEach((item) => addToSelection(item));
    onAfterPaste?.(pasted);
    setTimeout(() => rebuildLayerItems(), 0);
    pushHistory();
  }, [svgLayerRef, clearSelection, addToSelection, rebuildLayerItems, pushHistory, onAfterPaste]);

  const handleDelete = useCallback(() => {
    const items = [...selectedItemsRef.current];
    if (items.length === 0) return;

    // Zbierz wszystkie nazwy usuwanych elementów (rekurencyjnie przez grupy)
    function collectNames(item: paper.Item): string[] {
      const names: string[] = [];
      if (item.name) names.push(item.name);
      const g = item as paper.Group;
      if (g.children) g.children.forEach((c: paper.Item) => names.push(...collectNames(c)));
      return names;
    }
    const deletedNames = items.flatMap(collectNames);

    items.forEach((item) => item.remove());
    clearSelection();

    // Usuń wpisy usuniętych elementów ze store — wycena nie będzie ich już uwzględniać
    deletedNames.forEach((name) => {
      removeNodeOverride(name);
      removeBoundsForElement(name);
    });

    setTimeout(() => rebuildLayerItems(), 0);
    if (svgContentRef.current && svgLayerRef.current) {
      const layerEmpty = svgLayerRef.current.children.length === 0;
      if (layerEmpty) {
        // Warstwa pusta — traktuj jak brak SVG, żeby assembler promptu nie generował
        // opisu "schematyczny projekt SVG" dla pustego canvasa.
        historyRef.current.splice(historyIndexRef.current + 1);
        historyIndexRef.current = historyRef.current.length - 1;
        lastSavedContentRef.current = null;
        svgContentRef.current = null;
        setSvgContent(null);
      } else {
        const exported = exportSvgLayer(svgLayerRef.current, mmPerUnitRef.current);
        const withOverrides = updateSvgWithOverrides(exported, nodeOverridesRef.current);
        historyRef.current.splice(historyIndexRef.current + 1);
        historyRef.current.push({ svg: withOverrides, selection: [] });
        historyIndexRef.current = historyRef.current.length - 1;
        lastSavedContentRef.current = withOverrides;
        setSvgContent(withOverrides);
      }
    }
    setContextMenu(null);
  }, [selectedItemsRef, svgContentRef, svgLayerRef, nodeOverridesRef, mmPerUnitRef, lastSavedContentRef, clearSelection, rebuildLayerItems, setSvgContent, setContextMenu, removeNodeOverride, removeBoundsForElement]);

  return {
    historyRef, historyIndexRef, isUndoRedoRef, clipboardRef, isDraggingItemRef,
    pushHistory, pushHistoryDirect, handleUndo, handleRedo, handleCopy, handlePaste, handleDelete,
  };
}
