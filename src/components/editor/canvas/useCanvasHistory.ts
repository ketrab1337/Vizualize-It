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
  isSavingRef: React.MutableRefObject<boolean>;
  setSvgContent: (content: string) => void;
  clearSelection: () => void;
  addToSelection: (item: paper.Item) => void;
  rebuildLayerItems: () => void;
  setContextMenu: (m: null) => void;
  removeNodeOverride: (id: string) => void;
  removeBoundsForElement: (id: string) => void;
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
    selectedItemsRef, isSavingRef,
    setSvgContent, clearSelection, addToSelection, rebuildLayerItems, setContextMenu,
    removeNodeOverride, removeBoundsForElement,
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
    const exported = exportSvgLayer(layer, paper.project, content, mmPerUnitRef.current);
    // Czytaj bezpośrednio ze store (synchroniczny Zustand), nie z ref — ref aktualizuje się
    // dopiero po renderze, a pushHistory może być wołany z setTimeout(0) przed renderem.
    const currentOverrides = useEditorStore.getState().nodeOverrides;
    const withOverrides = updateSvgWithOverrides(exported, currentOverrides);
    const selection = selectedItemsRef.current.map((i) => i.name).filter(Boolean) as string[];
    historyRef.current.splice(historyIndexRef.current + 1);
    historyRef.current.push({ svg: withOverrides, selection });
    historyIndexRef.current = historyRef.current.length - 1;
    // Sync store → wyzwala auto-zapis w MainArea; isSavingRef blokuje reimport w Canvas
    isSavingRef.current = true;
    setSvgContent(withOverrides);
    setTimeout(() => { isSavingRef.current = false; }, 50);
  }, [svgLayerRef, svgContentRef, nodeOverridesRef, mmPerUnitRef, selectedItemsRef, isSavingRef, setSvgContent]);

  const pushHistoryDirect = useCallback((svg: string) => {
    if (isUndoRedoRef.current) return;
    const selection = selectedItemsRef.current.map((i) => i.name).filter(Boolean) as string[];
    historyRef.current.splice(historyIndexRef.current + 1);
    historyRef.current.push({ svg, selection });
    historyIndexRef.current = historyRef.current.length - 1;
    isSavingRef.current = true;
    setSvgContent(svg);
    setTimeout(() => { isSavingRef.current = false; }, 50);
  }, [isUndoRedoRef, selectedItemsRef, historyRef, historyIndexRef, isSavingRef, setSvgContent]);

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
    setSvgContent(entry.svg);
    setTimeout(() => {
      isUndoRedoRef.current = false;
      restoreSelectionAfterUndoRedo(entry.selection);
    }, 100);
  }, [setSvgContent, restoreSelectionAfterUndoRedo]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current++;
    const entry = historyRef.current[historyIndexRef.current];
    setSvgContent(entry.svg);
    setTimeout(() => {
      isUndoRedoRef.current = false;
      restoreSelectionAfterUndoRedo(entry.selection);
    }, 100);
  }, [setSvgContent, restoreSelectionAfterUndoRedo]);

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
      clone.name = `${name}_kopia_${i}`;
      pasted.push(clone);
    });
    pasted.forEach((item) => addToSelection(item));
    setTimeout(() => rebuildLayerItems(), 0);
    pushHistory();
  }, [svgLayerRef, clearSelection, addToSelection, rebuildLayerItems, pushHistory]);

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
      const exported = exportSvgLayer(svgLayerRef.current, paper.project, svgContentRef.current, mmPerUnitRef.current);
      const withOverrides = updateSvgWithOverrides(exported, nodeOverridesRef.current);
      historyRef.current.splice(historyIndexRef.current + 1);
      historyRef.current.push({ svg: withOverrides, selection: [] });
      historyIndexRef.current = historyRef.current.length - 1;
      isSavingRef.current = true;
      setSvgContent(withOverrides);
      setTimeout(() => { isSavingRef.current = false; }, 50);
    }
    setContextMenu(null);
  }, [selectedItemsRef, svgContentRef, svgLayerRef, nodeOverridesRef, mmPerUnitRef, isSavingRef, clearSelection, rebuildLayerItems, setSvgContent, setContextMenu, removeNodeOverride, removeBoundsForElement]);

  return {
    historyRef, historyIndexRef, isUndoRedoRef, clipboardRef, isDraggingItemRef,
    pushHistory, pushHistoryDirect, handleUndo, handleRedo, handleCopy, handlePaste, handleDelete,
  };
}
