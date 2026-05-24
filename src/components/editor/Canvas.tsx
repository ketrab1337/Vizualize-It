import { useEffect, useRef, useState, useCallback } from "react";
import { Upload, Loader2, Layers } from "lucide-react";
import { LayersPanel } from "./LayersPanel";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import paper from "paper";
import { useEditorStore } from "../../stores/editorStore";
import { useGenerationStore } from "../../stores/generationStore";
import { useToastStore } from "../../stores/toastStore";
import { saveFnRef, resizeElementFnRef, captureCanvasFnRef, pushHistoryRef } from "../../lib/paperCanvas";
import { updateSvgWithOverrides, patchSvgLayerState } from "../../lib/svgHelpers";
import { RULER_SIZE, RULER_BG, RULER_BORDER, drawHRuler, drawVRuler } from "./canvas/rulers";
import {
  CANVAS_SIZE_MM, BG_COLOR,
  fitViewToPage, drawPageBackground, exportSvgLayer,
  assignMissingNames, findItemByName, applyFillByName,
  getItemType, getDefaultName, calcTotalLength, calcTotalArea,
  parseSvgDimension, toMm,
} from "./canvas/paperUtils";
import { HANDLE_PX, HANDLE_CURSORS, computeResizeDelta, type HandleType } from "./canvas/resize";
import { CanvasToolbar } from "./canvas/CanvasToolbar";
import { ZoomWidget } from "./canvas/ZoomWidget";
import { CanvasContextMenu, type CtxMenuState } from "./canvas/CanvasContextMenu";
import { DragOverlay, type DragOverKind } from "./canvas/DragOverlay";
import { useCanvasHistory } from "./canvas/useCanvasHistory";
import { useZoomActions } from "./canvas/useZoomActions";
import type { LayerItem } from "./LayersPanel";
import type { NodeOverride, Project, ElementRole } from "../../types";

function setBoundsRecursive(
  item: paper.Item,
  mm: number,
  setter: (name: string, b: { widthMm: number; heightMm: number; pathLengthMm: number; areaMm2: number }) => void
): void {
  if (item.name) {
    const b = item.bounds;
    setter(item.name, {
      widthMm: b.width * mm,
      heightMm: b.height * mm,
      pathLengthMm: calcTotalLength(item) * mm,
      areaMm2: calcTotalArea(item) * mm * mm,
    });
  }
  const g = item as paper.Group;
  if (g.children) {
    (g.children as paper.Item[]).forEach((child) => setBoundsRecursive(child, mm, setter));
  }
}

/** Buduje mapę child→parent dla całego drzewa elementów (do wykrywania duplikatów w wycenie). */
function buildParentMapFromItems(items: paper.Item[]): Record<string, string> {
  const map: Record<string, string> = {};
  function walk(item: paper.Item, parentName: string | null) {
    if (parentName && item.name) map[item.name] = parentName;
    const g = item as paper.Group;
    if (g.children) {
      (g.children as paper.Item[]).forEach((c) => walk(c, item.name || parentName));
    }
  }
  items.forEach((item) => walk(item, null));
  return map;
}

function computeCombinedBounds(items: paper.Item[], mm: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let totalArea = 0, totalLength = 0;
  for (const it of items) {
    const b = it.bounds;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
    totalArea += calcTotalArea(it) * mm * mm;
    totalLength += calcTotalLength(it) * mm;
  }
  return {
    widthMm: (maxX - minX) * mm,
    heightMm: (maxY - minY) * mm,
    areaMm2: totalArea,
    pathLengthMm: totalLength,
  };
}

interface CanvasProps { project: Project; }
interface SvgImportResult { filename: string; content: string; }
interface BackgroundImportResult { path: string; mime: string; }

async function backgroundToBlobUrl(path: string, mime: string): Promise<string> {
  const bytes = await readFile(path);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

function mapDeepLayerItems(
  items: LayerItem[],
  id: string,
  update: (item: LayerItem) => LayerItem,
): LayerItem[] {
  return items.map((i) => {
    if (i.id === id) return update(i);
    if (i.children) return { ...i, children: mapDeepLayerItems(i.children, id, update) };
    return i;
  });
}

function flattenLayerItems(items: LayerItem[]): LayerItem[] {
  const result: LayerItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) result.push(...flattenLayerItems(item.children));
  }
  return result;
}

// Guardy modułowe — przeżywają remounty Reacta, są współdzielone przez wszystkie instancje.
let _addingSvg = false;
let _lastAddedPath: string | null = null;
let _lastAddedTime = 0;
const ADD_DEDUP_MS = 5000;
let _dropHandling = false; // blokada drop handlera — niezależna od listenerów
let _lastDropPaths = ""; // deduplication na poziomie eventu
let _lastDropTime = 0;

// ── Canvas ─────────────────────────────────────────────────────────────────────

export function Canvas({ project }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const topRulerRef = useRef<HTMLCanvasElement>(null);
  const leftRulerRef = useRef<HTMLCanvasElement>(null);
  const backgroundImgRef = useRef<HTMLImageElement>(null);
  const drawRulersRef = useRef<() => void>(() => {});

  // Refs — stan imperatywny
  const svgContentRef = useRef<string | null>(null);
  const bgLayerRef = useRef<paper.Layer | null>(null);
  const pageRectRef = useRef<paper.Shape | null>(null);
  const nodeOverridesRef = useRef<Record<string, NodeOverride>>({});
  const isSavingRef = useRef(false);
  const paperReadyRef = useRef(false);
  const svgLayerRef = useRef<paper.Layer | null>(null);
  const uiLayerRef = useRef<paper.Layer | null>(null);
  const selectedItemsRef = useRef<paper.Item[]>([]);
  const hoverRectRef = useRef<paper.Shape | null>(null);
  const rubberBandRectRef = useRef<paper.Shape | null>(null);
  const rubberBandStartRef = useRef<paper.Point | null>(null);
  const justRubberBandRef = useRef(false);
  const clickedOnItemRef = useRef(false);
  const isPanningRef = useRef(false);
  const panModeRef = useRef(false);
  const mmPerUnitRef = useRef(1);
  const dropHandlerRef = useRef<((paths: string[]) => Promise<void>) | null>(null);
  // Blokuje współbieżne wywołania handleAddSvg i główny useEffect importu SVG
  const isAddingSvgRef = useRef(false);

  // Ref z aktualnymi callbackami dla Tool (Tool tworzony raz, odczytuje zawsze bieżące fn)
  const toolCbRef = useRef({
    clearSelection: () => {},
    addToSelection: (_item: paper.Item) => {},
    hitTestSvg: (_pt: paper.Point): paper.Item | null => null,
    updateHover: (_target: paper.Item | null) => {},
    drawRubberBand: (_s: paper.Point, _e: paper.Point) => {},
    hitTestHandle: (_pt: paper.Point): HandleType | null => null,
    drawResizeHandles: () => {},
    clearResizeHandles: () => {},
    pushHistory: () => {},
  });

  // Refs stanu resize
  const resizeHandlesRef      = useRef<Map<HandleType, paper.Shape>>(new Map());
  const activeHandleRef       = useRef<HandleType | null>(null);
  const resizeStartBoundsRef  = useRef<paper.Rectangle | null>(null);  // union bounds
  const resizeItemStartRef    = useRef<Map<paper.Item, paper.Rectangle>>(new Map()); // per-item
  const resizePivotRef        = useRef<paper.Point | null>(null);
  const resizePrevSxRef       = useRef(1);
  const resizePrevSyRef       = useRef(1);


  const [hasSvg, setHasSvg] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomInput, setZoomInput] = useState<string | null>(null);
  const [panMode, setPanMode] = useState(false);
  panModeRef.current = panMode;
  const [isImportingSvg, setIsImportingSvg] = useState(false);
  const [isImportingBg, setIsImportingBg] = useState(false);
  const [isDragOver, setIsDragOver] = useState<DragOverKind | null>(null);
  const [contextMenu, setContextMenu] = useState<CtxMenuState | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [layerItems, setLayerItems] = useState<LayerItem[]>([]);
const [selectedItemNames, setSelectedItemNames] = useState<string[]>([]);

  const {
    svgContent, setSvgContent,
    setSelectedElement, setSelectedItemBounds,
    setBoundsForElement, removeBoundsForElement, clearBoundsPerElement,
    setParentMap, setChildParent, removeFromParentMap,
    selectedElementIds: _sel, setSelectedElementIds,
    backgroundDataUrl, backgroundPath, setBackground, clearBackground,
    nodeOverrides, setNodeOverride, renameNodeOverride, removeNodeOverride, clearNodeOverrides,
  } = useEditorStore();
  void _sel; // używane tylko przez ElementPanel przez store
  const addToast = useToastStore((s) => s.addToast);

  svgContentRef.current = svgContent;
  nodeOverridesRef.current = nodeOverrides;

  // Synchronizuj wypełnienie i obramowanie prostokąta strony z obecnością tła
  useEffect(() => {
    const rect = pageRectRef.current;
    if (!rect) return;
    if (backgroundDataUrl) {
      rect.fillColor = null;
      rect.strokeColor = null;
      rect.strokeWidth = 0;
    } else {
      rect.fillColor = new paper.Color("white");
      rect.strokeColor = new paper.Color(0.7, 0.71, 0.76, 1);
      rect.strokeWidth = 1;
    }
  }, [backgroundDataUrl]);

  // ── Callbacki (stabilne — używane w Tool) ─────────────────────────────────

  const clearSelection = useCallback(() => {
    selectedItemsRef.current.forEach((i) => { i.selected = false; });
    selectedItemsRef.current = [];
    setSelectedElement(null);
    setSelectedItemBounds(null);
    setSelectedItemNames([]);
    setSelectedElementIds([]);
    toolCbRef.current.clearResizeHandles();
  }, [setSelectedElement, setSelectedItemBounds, setSelectedElementIds]);

  const addToSelection = useCallback((item: paper.Item) => {
    item.selected = true;
    selectedItemsRef.current.push(item);
    const ids = selectedItemsRef.current.map((i) => i.name).filter(Boolean) as string[];
    setSelectedItemNames(ids);
    setSelectedElementIds(ids);
    const mm = mmPerUnitRef.current;
    if (selectedItemsRef.current.length === 1) {
      setSelectedElement(item.name);
      const b = item.bounds;
      const bounds = {
        widthMm: b.width * mm,
        heightMm: b.height * mm,
        pathLengthMm: calcTotalLength(item) * mm,
        areaMm2: calcTotalArea(item) * mm * mm,
      };
      setSelectedItemBounds(bounds);
      if (item.name) setBoundsForElement(item.name, bounds);
    } else {
      setSelectedElement(null);
      setSelectedItemBounds(computeCombinedBounds(selectedItemsRef.current, mm));
    }
    toolCbRef.current.drawResizeHandles();
  }, [setSelectedElement, setSelectedItemBounds, setSelectedElementIds, setBoundsForElement]);

  const hitTestSvg = useCallback((point: paper.Point): paper.Item | null => {
    // Testuj tylko warstwę "svg" — warstwa "ui" (hover rect, rubber band) nie może
    // przechwytywać kliknięć, nawet gdy element ma locked=true.
    const svgLayer = svgLayerRef.current;
    if (!svgLayer) return null;
    const hit = (svgLayer as unknown as { hitTest: (p: paper.Point, o: object) => paper.HitResult | null }).hitTest(point, {
      fill: true, stroke: true,
      tolerance: 5 / paper.view.zoom,
    });
    if (!hit) return null;
    // Idź w górę do bezpośredniego dziecka svgLayer — to jest jednostka zaznaczania.
    // Nie wymaga nazwy: po rozgrupowaniu ścieżki bez id też muszą być zaznaczalne.
    let target: paper.Item | null = hit.item;
    while (target && !(target instanceof paper.Layer)) {
      if (target.parent === svgLayer) return target.locked ? null : target;
      target = target.parent;
    }
    return null;
  }, []);

  const updateHover = useCallback((target: paper.Item | null) => {
    hoverRectRef.current?.remove();
    hoverRectRef.current = null;
    if (!target || !uiLayerRef.current) return;
    const prev = paper.project.activeLayer;
    uiLayerRef.current.activate();
    const r = new paper.Shape.Rectangle(target.bounds.expand(2));
    r.strokeColor = new paper.Color(0.29, 0.62, 1, 0.7);
    r.strokeWidth = 1 / paper.view.zoom;
    r.fillColor = null;
    r.locked = true;
    hoverRectRef.current = r as unknown as paper.Shape;
    prev.activate();
  }, []);

  const drawRubberBand = useCallback((start: paper.Point, end: paper.Point) => {
    rubberBandRectRef.current?.remove();
    if (!uiLayerRef.current) return;
    const prev = paper.project.activeLayer;
    uiLayerRef.current.activate();
    const r = new paper.Shape.Rectangle(new paper.Rectangle(start, end));
    r.strokeColor = new paper.Color("#3b82f6");
    r.strokeWidth = 1 / paper.view.zoom;
    r.fillColor = new paper.Color(0.23, 0.51, 0.96, 0.1);
    r.locked = true;
    rubberBandRectRef.current = r as unknown as paper.Shape;
    prev.activate();
  }, []);

  // ── Resize handles ─────────────────────────────────────────────────────────

  const clearResizeHandles = useCallback(() => {
    resizeHandlesRef.current.forEach((h) => { try { h.remove(); } catch { /* already removed */ } });
    resizeHandlesRef.current.clear();
  }, []);

  const drawResizeHandles = useCallback(() => {
    // Usuń stare uchwyty
    resizeHandlesRef.current.forEach((h) => { try { h.remove(); } catch { /* already removed */ } });
    resizeHandlesRef.current.clear();

    const items = selectedItemsRef.current;
    if (items.length === 0) return;
    const uiLayer = uiLayerRef.current;
    if (!uiLayer) return;

    // Union bounds wszystkich zaznaczonych elementów
    let b = items[0].bounds.clone();
    for (let i = 1; i < items.length; i++) b = b.unite(items[i].bounds);
    const hSize = HANDLE_PX / paper.view.zoom;
    const sw    = 1.5 / paper.view.zoom;

    const positions: Record<HandleType, paper.Point> = {
      tl: b.topLeft,    tc: b.topCenter,    tr: b.topRight,
      ml: new paper.Point(b.left,  b.center.y),
      mr: new paper.Point(b.right, b.center.y),
      bl: b.bottomLeft, bc: b.bottomCenter, br: b.bottomRight,
    };

    const prev = paper.project.activeLayer;
    uiLayer.activate();
    const newHandles = new Map<HandleType, paper.Shape>();
    (Object.keys(positions) as HandleType[]).forEach((key) => {
      const shape = new paper.Shape.Rectangle(
        new paper.Rectangle(
          positions[key].subtract(hSize / 2),
          new paper.Size(hSize, hSize),
        ),
      );
      shape.fillColor = new paper.Color("white");
      shape.strokeColor = new paper.Color("#3b82f6");
      shape.strokeWidth = sw;
      shape.locked = true;
      newHandles.set(key, shape as unknown as paper.Shape);
    });
    resizeHandlesRef.current = newHandles;
    prev.activate();
  }, []);

  const hitTestHandle = useCallback((point: paper.Point): HandleType | null => {
    const hSize = HANDLE_PX / paper.view.zoom;
    const hitArea = hSize * 1.2; // nieco większy obszar kliknięcia
    for (const [key, shape] of resizeHandlesRef.current) {
      if (shape.bounds.expand(hitArea).contains(point)) return key;
    }
    return null;
  }, []);



  // ── Panel warstw — odbudowa listy ───────────────────────────────

  const rebuildLayerItems = useCallback(() => {
    const layer = svgLayerRef.current;
    if (!layer || !layer.children) return;

    function buildItem(item: paper.Item, idx: number): LayerItem {
      const isGroup = item instanceof paper.Group && !(item instanceof paper.CompoundPath);
      const children = isGroup && (item as paper.Group).children?.length
        ? [...(item as paper.Group).children].map((c, i) => buildItem(c, i))
        : undefined;
      return {
        id: item.name || `__item_${idx}`,
        name: item.name || getDefaultName(item),
        type: getItemType(item),
        locked: item.locked,
        visible: item.visible,
        children,
      };
    }

    const newItems = [...(layer.children as paper.Item[])].reverse().map((item, idx) => buildItem(item, idx));
    setLayerItems(newItems);
  }, []);

  const {
    historyRef, historyIndexRef, isUndoRedoRef, clipboardRef, isDraggingItemRef,
    pushHistory, pushHistoryDirect, handleUndo, handleRedo, handleCopy, handlePaste, handleDelete,
  } = useCanvasHistory({
    svgLayerRef, svgContentRef, nodeOverridesRef, mmPerUnitRef,
    selectedItemsRef, isSavingRef,
    setSvgContent, clearSelection, addToSelection, rebuildLayerItems, setContextMenu,
    removeNodeOverride, removeBoundsForElement,
  });

  // Udostępnij pushHistory dla komponentów poza Canvas (np. ElementPanel)
  useEffect(() => {
    pushHistoryRef.current = pushHistory;
    return () => { pushHistoryRef.current = null; };
  }, [pushHistory]);

  const handleLayerSelect = useCallback((id: string, multi: boolean) => {
    const layer = svgLayerRef.current;
    if (!layer) return;
    const item = findItemByName(layer, id);
    if (!item) return;
    if (multi) {
      const idx = selectedItemsRef.current.findIndex((i) => i === item);
      if (idx >= 0) {
        item.selected = false;
        selectedItemsRef.current.splice(idx, 1);
        const rem = selectedItemsRef.current;
        const ids = rem.map((i) => i.name).filter(Boolean) as string[];
        setSelectedItemNames(ids);
        setSelectedElementIds(ids);
        const mm = mmPerUnitRef.current;
        if (rem.length === 1) {
          setSelectedElement(rem[0].name);
          const b = rem[0].bounds;
          setSelectedItemBounds({ widthMm: b.width * mm, heightMm: b.height * mm, pathLengthMm: calcTotalLength(rem[0]) * mm, areaMm2: calcTotalArea(rem[0]) * mm * mm });
          toolCbRef.current.drawResizeHandles();
        } else if (rem.length > 1) {
          setSelectedElement(null);
          setSelectedItemBounds(computeCombinedBounds(rem, mm));
          toolCbRef.current.clearResizeHandles();
        } else {
          setSelectedElement(null);
          setSelectedItemBounds(null);
          toolCbRef.current.clearResizeHandles();
        }
      } else {
        addToSelection(item);
      }
    } else {
      clearSelection();
      addToSelection(item);
    }
  }, [clearSelection, addToSelection, setSelectedElement, setSelectedItemBounds, setSelectedElementIds]);

  const handleLayerRename = useCallback((id: string, newName: string) => {
    const layer = svgLayerRef.current;
    if (!layer) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === id) return;
    const item = findItemByName(layer, id);
    if (!item) return;
    item.name = trimmed;
    setLayerItems((prev) => mapDeepLayerItems(prev, id, (i) => ({ ...i, id: trimmed, name: trimmed })));
    setSelectedItemNames((prev) => prev.map((n) => n === id ? trimmed : n));
    renameNodeOverride(id, trimmed);

    if (svgContentRef.current) {
      isSavingRef.current = true;
      setSvgContent(exportSvgLayer(layer, paper.project, svgContentRef.current, mmPerUnitRef.current));
      setTimeout(() => { isSavingRef.current = false; }, 50);
      pushHistory();
    }
  }, [renameNodeOverride, setSvgContent, pushHistory]);

  const handleLayerToggleLock = useCallback((id: string) => {
    const layer = svgLayerRef.current;
    if (!layer) return;
    const item = findItemByName(layer, id);
    if (item) {
      item.locked = !item.locked;
      if (item.locked) {
        // Usuń z zaznaczenia jeśli właśnie zablokowano
        const idx = selectedItemsRef.current.findIndex((i) => i === item);
        if (idx >= 0) {
          item.selected = false;
          selectedItemsRef.current.splice(idx, 1);
          const ids = selectedItemsRef.current.map((i) => i.name).filter(Boolean) as string[];
          setSelectedItemNames(ids);
          setSelectedElementIds(ids);
        }
      }
    }
    setLayerItems((prev) => {
      const next = mapDeepLayerItems(prev, id, (i) => ({ ...i, locked: !i.locked }));
      const content = svgContentRef.current;
      if (content) {
        const patched = patchSvgLayerState(content, flattenLayerItems(next).map((i) => ({ id: i.id, locked: i.locked, visible: i.visible })));
        const withOverrides = updateSvgWithOverrides(patched, useEditorStore.getState().nodeOverrides);
        // Zapisz do historii — blokada/odblokowanie to osobna zmiana cofalna przez Ctrl+Z
        setTimeout(() => { pushHistoryDirect(withOverrides); }, 0);
      }
      return next;
    });
  }, [setSelectedElementIds, pushHistoryDirect]);

  const handleLayerToggleVisible = useCallback((id: string) => {
    const layer = svgLayerRef.current;
    if (!layer) return;
    const item = findItemByName(layer, id);
    if (item) {
      item.visible = !item.visible;
      paper.view.update();
    }
    setLayerItems((prev) => {
      const next = mapDeepLayerItems(prev, id, (i) => ({ ...i, visible: !i.visible }));
      const content = svgContentRef.current;
      if (content) {
        const patched = patchSvgLayerState(content, flattenLayerItems(next).map((i) => ({ id: i.id, locked: i.locked, visible: i.visible })));
        const withOverrides = updateSvgWithOverrides(patched, useEditorStore.getState().nodeOverrides);
        setTimeout(() => { pushHistoryDirect(withOverrides); }, 0);
      }
      return next;
    });
  }, [pushHistoryDirect]);

  const handleLayerReorder = useCallback((fromIdx: number, toIdx: number) => {
    let didReorder = false;
    setLayerItems((prev) => {
      if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= prev.length || toIdx >= prev.length) return prev;

      // Nowa kolejność w panelu (panel[0] = front, panel[N-1] = back)
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);

      // Zsynchronizuj z Paper.js — panel jest odwrócony względem tablicy children.
      // panel[0] = children[last], panel[N-1] = children[0]
      // → Paper.js order = [...next].reverse()
      const layer = svgLayerRef.current;
      if (layer) {
        const paperOrder = [...next].reverse(); // back-to-front
        paperOrder.forEach((layerItem, childIdx) => {
          const item = findItemByName(layer, layerItem.id);
          if (item) layer.insertChild(childIdx, item);
        });
        paper.view.update();
        didReorder = true;
      }

      return next;
    });

    if (didReorder && svgLayerRef.current && svgContentRef.current) {
      isSavingRef.current = true;
      setSvgContent(exportSvgLayer(svgLayerRef.current, paper.project, svgContentRef.current, mmPerUnitRef.current));
      setTimeout(() => { isSavingRef.current = false; }, 50);
      pushHistory();
    }
  }, [setSvgContent, pushHistory]);

  const getThumbnailForItem = useCallback((id: string): string | null => {
    const layer = svgLayerRef.current;
    if (!layer) return null;
    const item = findItemByName(layer, id);
    if (!item) return null;
    try {
      const bounds = item.bounds;
      if (bounds.width === 0 || bounds.height === 0) return null;
      const svgEl = item.exportSVG({ asString: false }) as SVGElement;
      const pad = Math.max(bounds.width, bounds.height) * 0.08 + 6;
      const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      wrapper.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      wrapper.setAttribute("viewBox", `${bounds.x - pad} ${bounds.y - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`);
      wrapper.setAttribute("width", "160");
      wrapper.setAttribute("height", "120");
      wrapper.appendChild(svgEl);
      const str = new XMLSerializer().serializeToString(wrapper);
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(str)}`;
    } catch {
      return null;
    }
  }, []);

  // Aktualizuj toolCbRef przy każdym renderze (Tool zawsze czyta bieżące fn)
  toolCbRef.current = {
    clearSelection, addToSelection, hitTestSvg, updateHover, drawRubberBand,
    hitTestHandle, drawResizeHandles, clearResizeHandles, pushHistory,
  };

  // drawRulers — odczytuje aktualny stan paper.view za każdym wywołaniem
  drawRulersRef.current = () => {
    if (!paperReadyRef.current) return;
    const top = topRulerRef.current;
    const left = leftRulerRef.current;
    const zoom = paper.view.zoom;
    const center = paper.view.center;
    const vs = paper.view.viewSize;
    const mpu = mmPerUnitRef.current;
    if (top) drawHRuler(top, zoom, center.x, vs.width, mpu);
    if (left) drawVRuler(left, zoom, center.y, vs.height, mpu);
  };

  // ── Rejestracja funkcji zapisu ─────────────────────────────────────────────

  useEffect(() => {
    saveFnRef.current = () => {
      const content = svgContentRef.current;
      if (!content) return;
      isSavingRef.current = true;
      setSvgContent(updateSvgWithOverrides(content, nodeOverridesRef.current));
      setTimeout(() => { isSavingRef.current = false; }, 50);
    };
    captureCanvasFnRef.current = () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      try {
        const bgImg = backgroundImgRef.current;
        const hasBg = !!(bgImg && bgImg.complete && bgImg.naturalWidth > 0);

        // Bez tła — bez kompozycji (sam canvas Paper.js)
        if (!hasBg) {
          const pngBase64 = canvas
            .toDataURL("image/png")
            .replace(/^data:image\/png;base64,/, "");
          return { pngBase64 };
        }

        // Z tłem: kompozyt off-screen (tło object-fit: cover + canvas Paper.js)
        const off = document.createElement("canvas");
        off.width = canvas.width;
        off.height = canvas.height;
        const ctx = off.getContext("2d");
        if (!ctx) return null;

        const cw = off.width;
        const ch = off.height;
        const iw = bgImg!.naturalWidth;
        const ih = bgImg!.naturalHeight;
        const scale = Math.max(cw / iw, ch / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (cw - dw) / 2;
        const dy = (ch - dh) / 2;
        ctx.drawImage(bgImg!, dx, dy, dw, dh);

        ctx.drawImage(canvas, 0, 0);

        const pngBase64 = off.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
        return { pngBase64 };
      } catch {
        return null;
      }
    };
    return () => {
      saveFnRef.current = null;
      captureCanvasFnRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rejestracja funkcji resize elementu ───────────────────────────────────

  useEffect(() => {
    resizeElementFnRef.current = (widthMm: number, heightMm: number) => {
      const items = selectedItemsRef.current;
      const mm = mmPerUnitRef.current;
      if (items.length === 0 || mm <= 0) return;

      if (items.length === 1) {
        const item = items[0];
        const b = item.bounds;
        if (b.width <= 0 || b.height <= 0) return;
        item.scale(widthMm / mm / b.width, heightMm / mm / b.height, b.center);
        const nb = item.bounds;
        const newBounds = {
          widthMm: nb.width * mm,
          heightMm: nb.height * mm,
          pathLengthMm: calcTotalLength(item) * mm,
          areaMm2: calcTotalArea(item) * mm * mm,
        };
        setSelectedItemBounds(newBounds);
        if (item.name) setBoundsForElement(item.name, newBounds);
      } else {
        // Oblicz łączny bounding box w jednostkach Paper.js
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const it of items) {
          const b = it.bounds;
          if (b.x < minX) minX = b.x;
          if (b.y < minY) minY = b.y;
          if (b.x + b.width > maxX) maxX = b.x + b.width;
          if (b.y + b.height > maxY) maxY = b.y + b.height;
        }
        const combinedW = (maxX - minX) * mm;
        const combinedH = (maxY - minY) * mm;
        if (combinedW <= 0 || combinedH <= 0) return;
        const sx = widthMm / combinedW;
        const sy = heightMm / combinedH;
        const center = new paper.Point((minX + maxX) / 2, (minY + maxY) / 2);
        for (const it of items) {
          it.scale(sx, sy, center);
          if (it.name) {
            const nb = it.bounds;
            setBoundsForElement(it.name, {
              widthMm: nb.width * mm,
              heightMm: nb.height * mm,
              pathLengthMm: calcTotalLength(it) * mm,
              areaMm2: calcTotalArea(it) * mm * mm,
            });
          }
        }
        setSelectedItemBounds(computeCombinedBounds(items, mm));
      }

      toolCbRef.current.drawResizeHandles();
      toolCbRef.current.pushHistory();
    };
    return () => { resizeElementFnRef.current = null; };
  }, [setSelectedItemBounds, setBoundsForElement]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Paper.js setup + Warstwy + Tool ───────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
    paper.setup(canvas);

    // Warstwy (od dołu: bg → svg → ui)
    const bgLayer = paper.project.activeLayer;
    bgLayer.name = "bg";
    bgLayerRef.current = bgLayer;
    pageRectRef.current = drawPageBackground(bgLayer, !!backgroundDataUrl);

    const svgLayer = new paper.Layer({ name: "svg" });
    svgLayerRef.current = svgLayer;

    const uiLayer = new paper.Layer({ name: "ui" });
    uiLayerRef.current = uiLayer;
    svgLayer.activate();

    // Dopasuj widok do strony 7500x7500mm
    fitViewToPage(paper.view.viewSize);

    // Paper.js Tool — deleguje do toolCbRef.current (zawsze aktualny)
    const tool = new paper.Tool();

    tool.onMouseDown = (event: paper.ToolEvent) => {
      const e = (event as unknown as { event: MouseEvent }).event;
      if (e.button === 1 || (panModeRef.current && e.button === 0)) {
        e.preventDefault();
        isPanningRef.current = true;
        canvas.style.cursor = "grabbing";
        return;
      }
      if (e.button !== 0) return;

      // Sprawdź uchwyty resize PRZED testem SVG
      const handleHit = toolCbRef.current.hitTestHandle(event.point);
      if (handleHit) {
        activeHandleRef.current = handleHit;
        clickedOnItemRef.current = false;
        const items = selectedItemsRef.current;
        if (items.length > 0) {
          // Union bounds jako punkt odniesienia dla resize
          let unionBounds = items[0].bounds.clone();
          for (let i = 1; i < items.length; i++) unionBounds = unionBounds.unite(items[i].bounds);
          resizeStartBoundsRef.current = unionBounds;
          // Per-item start bounds — każdy element skalowany od tego samego pivota
          const perItem = new Map<paper.Item, paper.Rectangle>();
          items.forEach((it) => perItem.set(it, it.bounds.clone()));
          resizeItemStartRef.current = perItem;
          resizePivotRef.current = null;
          resizePrevSxRef.current = 1;
          resizePrevSyRef.current = 1;
        }
        canvas.style.cursor = HANDLE_CURSORS[handleHit];
        return;
      }

      rubberBandStartRef.current = event.point;
      const hitItem = toolCbRef.current.hitTestSvg(event.point);
      clickedOnItemRef.current = !!hitItem;

      if (!hitItem) return; // puste miejsce — deselect i rubber band obsługuje onMouseClick/onMouseUp

      if (e.shiftKey) {
        // Shift+click: toggle elementu w zaznaczeniu — obsługujemy tu (nie w onMouseClick,
        // który może nie odpalić gdy mysz minimalnie drgnęła między down a up).
        const idx = selectedItemsRef.current.findIndex((i) => i === hitItem);
        if (idx >= 0) {
          // Usuń z zaznaczenia
          hitItem.selected = false;
          selectedItemsRef.current.splice(idx, 1);
          const rem = selectedItemsRef.current;
          const ids = rem.map((i) => i.name).filter(Boolean) as string[];
          setSelectedItemNames(ids);
          setSelectedElementIds(ids);
          const mm = mmPerUnitRef.current;
          if (rem.length === 1) {
            setSelectedElement(rem[0].name);
            const b = rem[0].bounds;
            setSelectedItemBounds({ widthMm: b.width * mm, heightMm: b.height * mm, pathLengthMm: calcTotalLength(rem[0]) * mm, areaMm2: calcTotalArea(rem[0]) * mm * mm });
            toolCbRef.current.drawResizeHandles();
          } else if (rem.length > 1) {
            setSelectedElement(null);
            setSelectedItemBounds(computeCombinedBounds(rem, mm));
            toolCbRef.current.clearResizeHandles();
          } else {
            setSelectedElement(null);
            setSelectedItemBounds(null);
            toolCbRef.current.clearResizeHandles();
          }
        } else {
          // Dodaj do zaznaczenia
          toolCbRef.current.addToSelection(hitItem);
        }
      } else {
        // Zwykłe kliknięcie: zaznacz element jeśli jeszcze nie zaznaczony
        // (jeśli już zaznaczony — nie ruszaj, żeby drag wielokrotnego zaznaczenia działał).
        if (!selectedItemsRef.current.some((i) => i === hitItem)) {
          toolCbRef.current.clearSelection();
          toolCbRef.current.addToSelection(hitItem);
        }
      }
    };

    tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (isPanningRef.current) {
        // Używamy MouseEvent.movementX/Y (delta w pikselach ekranu) zamiast
        // paper.event.delta — paper.delta jest w world coordinates, które
        // zmieniają się gdy przesuwamy view.center i powodują drift/zniekształcenie.
        const ne = (event as unknown as { event: MouseEvent }).event;
        const dxScreen = ne.movementX || 0;
        const dyScreen = ne.movementY || 0;
        const z = paper.view.zoom || 1;
        paper.view.center = paper.view.center.subtract(
          new paper.Point(dxScreen / z, dyScreen / z)
        );
        drawRulersRef.current();
        return;
      }

      // Tryb resize — aktywny uchwyt
      if (activeHandleRef.current) {
        isDraggingItemRef.current = true;
        const items = selectedItemsRef.current;
        const startBounds = resizeStartBoundsRef.current;
        if (items.length > 0 && startBounds) {
          const nativeEvent = (event as unknown as { event: MouseEvent }).event;
          const { sx, sy, pivot } = computeResizeDelta(
            activeHandleRef.current, startBounds, event.point, nativeEvent.shiftKey,
          );
          if (!resizePivotRef.current) resizePivotRef.current = pivot;
          const p = resizePivotRef.current;
          const prevSx = resizePrevSxRef.current;
          const prevSy = resizePrevSyRef.current;
          // Cofnij poprzednią skalę i nałóż nową dla każdego elementu
          items.forEach((it) => {
            if (prevSx !== 1 || prevSy !== 1) it.scale(1 / prevSx, 1 / prevSy, p);
            it.scale(sx, sy, p);
          });
          resizePrevSxRef.current = sx;
          resizePrevSyRef.current = sy;
          toolCbRef.current.drawResizeHandles();
        }
        return;
      }

      // Kliknięcie na pustym miejscu → rubber band (niezależnie od zaznaczenia)
      if (!clickedOnItemRef.current) {
        if (rubberBandStartRef.current) {
          toolCbRef.current.drawRubberBand(rubberBandStartRef.current, event.point);
        }
        return;
      }
      // Kliknięcie na elemencie → drag zaznaczonych
      if (selectedItemsRef.current.length > 0) {
        isDraggingItemRef.current = true;
        selectedItemsRef.current.forEach((i) => {
          i.position = i.position.add(event.delta);
        });
        hoverRectRef.current?.remove();
        hoverRectRef.current = null;
        toolCbRef.current.drawResizeHandles();
      }
    };

    tool.onMouseUp = (event: paper.ToolEvent) => {
      const e = (event as unknown as { event: MouseEvent }).event;
      if (isPanningRef.current && (e.button === 1 || (panModeRef.current && e.button === 0))) {
        isPanningRef.current = false;
        canvas.style.cursor = panModeRef.current ? "grab" : "default";
        return;
      }
      if (e.button !== 0) return;

      // Zakończ tryb resize
      if (activeHandleRef.current) {
        activeHandleRef.current = null;
        resizeStartBoundsRef.current = null;
        resizeItemStartRef.current.clear();
        resizePivotRef.current = null;
        resizePrevSxRef.current = 1;
        resizePrevSyRef.current = 1;
        canvas.style.cursor = "default";
        const items = selectedItemsRef.current;
        const mm = mmPerUnitRef.current;
        if (items.length === 1) {
          const b  = items[0].bounds;
          const newBounds = {
            widthMm: b.width * mm,
            heightMm: b.height * mm,
            pathLengthMm: calcTotalLength(items[0]) * mm,
            areaMm2: calcTotalArea(items[0]) * mm * mm,
          };
          setSelectedItemBounds(newBounds);
          if (items[0].name) setBoundsForElement(items[0].name, newBounds);
        } else {
          setSelectedItemBounds(computeCombinedBounds(items, mm));
          items.forEach((it) => {
            if (!it.name) return;
            const b = it.bounds;
            setBoundsForElement(it.name, {
              widthMm: b.width * mm,
              heightMm: b.height * mm,
              pathLengthMm: calcTotalLength(it) * mm,
              areaMm2: calcTotalArea(it) * mm * mm,
            });
          });
        }
        if (isDraggingItemRef.current) {
          isDraggingItemRef.current = false;
          toolCbRef.current.pushHistory();
        }
        drawRulersRef.current();
        return;
      }

      if (rubberBandRectRef.current) {
        const bounds = rubberBandRectRef.current.bounds;
        rubberBandRectRef.current.remove();
        rubberBandRectRef.current = null;
        const e = (event as unknown as { event: MouseEvent }).event;
        if (!e.shiftKey) toolCbRef.current.clearSelection();
        const svgLyr = svgLayerRef.current;
        if (svgLyr) {
          (svgLyr.children as paper.Item[]).forEach((item) => {
            if (!item.locked && item.bounds.intersects(bounds)) toolCbRef.current.addToSelection(item);
          });
        }
        justRubberBandRef.current = true;
      } else if (!clickedOnItemRef.current) {
        // Zwykłe kliknięcie na pustym obszarze (bez przeciągania) → odznacz wszystko
        const e = (event as unknown as { event: MouseEvent }).event;
        if (!e.shiftKey) toolCbRef.current.clearSelection();
      }
      rubberBandStartRef.current = null;

      // Zapisz historię po przeciąganiu elementów
      if (isDraggingItemRef.current) {
        isDraggingItemRef.current = false;
        toolCbRef.current.pushHistory();
        toolCbRef.current.drawResizeHandles();
      }

      drawRulersRef.current();
    };

    (tool as unknown as { onMouseClick: (e: paper.ToolEvent) => void }).onMouseClick = (event: paper.ToolEvent) => {
      const e = (event as unknown as { event: MouseEvent }).event;
      if (e.button !== 0) return;
      if (panModeRef.current) return;
      if (justRubberBandRef.current) { justRubberBandRef.current = false; return; }
      // Shift+click i pierwsze zaznaczenie elementu są obsługiwane w onMouseDown
      // (onMouseClick może nie odpalić gdy mysz minimalnie drgnęła).
      // Tu obsługujemy tylko dwa przypadki:
      const target = toolCbRef.current.hitTestSvg(event.point);
      if (!target && !e.shiftKey) {
        // 1. Klik na pustym obszarze → odznacz wszystko
        toolCbRef.current.clearSelection();
      } else if (target && !e.shiftKey) {
        // 2. Klik (bez shift) na elemencie → jeśli zaznaczonych jest kilka, zostaw tylko ten jeden
        //    (mouseDown nie czyścił żeby drag wielokrotnego zaznaczenia działał)
        if (selectedItemsRef.current.length > 1) {
          toolCbRef.current.clearSelection();
          toolCbRef.current.addToSelection(target);
        }
      }
    };

    tool.onMouseMove = (event: paper.ToolEvent) => {
      if (isPanningRef.current) return;
      if (panModeRef.current) {
        canvas.style.cursor = "grab";
        toolCbRef.current.updateHover(null);
        return;
      }
      // Sprawdź uchwyty resize PRZED testem SVG
      const handleHit = toolCbRef.current.hitTestHandle(event.point);
      if (handleHit) {
        canvas.style.cursor = HANDLE_CURSORS[handleHit];
        toolCbRef.current.updateHover(null);
        return;
      }
      const target = toolCbRef.current.hitTestSvg(event.point);
      canvas.style.cursor = target ? "pointer" : "default";
      toolCbRef.current.updateHover(target);
    };

    tool.activate();
    paperReadyRef.current = true;

    // ── Menu kontekstowe — prawy przycisk ───────────────────────────────────
    const onCtxMenu = (e: MouseEvent) => {
      e.preventDefault();
      const items = selectedItemsRef.current;
      // Sprawdź czy kliknięto na konkretny element (nawet niezaznaczony)
      const pt = paper.view.viewToProject(new paper.Point(e.offsetX, e.offsetY));
      // Hit-test uwzględniający też zablokowane elementy (żeby można je odblokować przez menu)
      const svgLyrCtx = svgLayerRef.current;
      let clickedItem: paper.Item | null = null;
      if (svgLyrCtx) {
        const hitResult = (svgLyrCtx as unknown as { hitTest: (p: paper.Point, o: object) => paper.HitResult | null })
          .hitTest(pt, { fill: true, stroke: true, tolerance: 5 / paper.view.zoom });
        if (hitResult) {
          let t: paper.Item | null = hitResult.item;
          while (t && !(t instanceof paper.Layer)) {
            if (t.parent === svgLyrCtx) { clickedItem = t; break; }
            t = t.parent;
          }
        }
      }
      if (!clickedItem && items.length === 1) clickedItem = items[0];
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        showUngroup: items.length === 1 && items[0] instanceof paper.Group,
        showGroup: items.length >= 2,
        groupCount: items.length,
        itemName: clickedItem?.name ?? null,
        itemLocked: clickedItem?.locked ?? false,
      });
    };
    canvas.addEventListener("contextmenu", onCtxMenu);

    return () => {
      paper.project?.clear();
      canvas.removeEventListener("contextmenu", onCtxMenu);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ResizeObserver ─────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!paperReadyRef.current) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return; // ukryty (display:none) — ignoruj
      const newSize = new paper.Size(Math.floor(width), Math.floor(height));
      paper.view.viewSize = newSize;
      // Jeśli zoom jest 0 (setup trafił na 0x0 kontener), dopasuj widok teraz
      if (paper.view.zoom === 0) fitViewToPage(newSize);
      drawRulersRef.current();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Import SVG ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!paperReadyRef.current || isSavingRef.current || isAddingSvgRef.current) return;

    if (!svgContent) {
      resizeHandlesRef.current.clear();
      activeHandleRef.current = null;
      paper.project.clear();
      const bgLayer = new paper.Layer({ name: "bg" });
      bgLayerRef.current = bgLayer;
      pageRectRef.current = drawPageBackground(bgLayer, !!backgroundDataUrl);
      const svgLayer = new paper.Layer({ name: "svg" });
      svgLayerRef.current = svgLayer;
      const uiLayer = new paper.Layer({ name: "ui" });
      uiLayerRef.current = uiLayer;
      svgLayer.activate();
      selectedItemsRef.current = [];
      setHasSvg(false);
      setLayerItems([]);
      setSelectedItemNames([]);
      setSelectedElementIds([]);
      clearNodeOverrides();
      fitViewToPage(paper.view.viewSize);
      return;
    }

    resizeHandlesRef.current.clear();
    activeHandleRef.current = null;

    // Zapisz widok przed clear() — przywrócimy po reimporcie (undo/redo)
    const savedZoom   = paper.view.zoom;
    const savedCenter = paper.view.center.clone();

    paper.project.clear();
    clearSelection();

    // Odtwórz warstwy po clear() (od dołu: bg → svg → ui)
    const bgLayer = new paper.Layer({ name: "bg" });
    bgLayerRef.current = bgLayer;
    pageRectRef.current = drawPageBackground(bgLayer, !!backgroundDataUrl);
    const svgLayer = new paper.Layer({ name: "svg" });
    svgLayerRef.current = svgLayer;
    const uiLayer = new paper.Layer({ name: "ui" });
    uiLayerRef.current = uiLayer;
    svgLayer.activate();

    // Odczytaj wymiary i data-* przed importem (Paper.js je pomija)
    const doc = new DOMParser().parseFromString(svgContent, "image/svg+xml");
    const svgEl = doc.documentElement;

    // Stały przelicznik: 1 jednostka Paper.js = 1 mm
    mmPerUnitRef.current = 1.0;

    // mmPerSvgUnit — ilu mm odpowiada 1 jednostce oryginalnego SVG.
    // Używamy tylko do przeskalowania elementów do układu mm przy pierwszym imporcie.
    // SVG zapisany przez nas ma data-mm-per-unit="1" → brak dodatkowego skalowania.
    const widthAttr = svgEl.getAttribute("width");
    const vbAttr = svgEl.getAttribute("viewBox");
    const mmPerUnitAttr = svgEl.getAttribute("data-mm-per-unit");
    let mmPerSvgUnit = 1.0;
    if (widthAttr && vbAttr) {
      const vb = vbAttr.split(/[\s,]+/).map(Number);
      const { value: wVal, unit: wUnit } = parseSvgDimension(widthAttr);
      const vbW = vb[2];
      if (vbW > 0 && wVal > 0) mmPerSvgUnit = toMm(wVal, wUnit) / vbW;
    } else if (mmPerUnitAttr) {
      mmPerSvgUnit = parseFloat(mmPerUnitAttr);
    }

    const savedAttrs = new Map<string, {
      fill: string; materialId: string | null;
      thicknessMm: number | null; quantity: number | null;
      ledLengthM: number | null; ledPricePerM: number | null;
      hasPowerSupply: boolean | null; powerSupplyPrice: number | null;
      role: ElementRole | null;
      ledBacklit: boolean | null;
      ledFrontlit: boolean | null;
      cutoutBackingId: string | null;
    }>();
    doc.querySelectorAll("[id]").forEach((el) => {
      const id = el.getAttribute("id")!;
      const fill = el.getAttribute("data-color");
      const materialId = el.getAttribute("data-material");
      const tStr = el.getAttribute("data-thickness-mm");
      const qStr = el.getAttribute("data-quantity");
      const ledLStr = el.getAttribute("data-led-length-m");
      const ledPStr = el.getAttribute("data-led-price-per-m");
      const hasPSStr = el.getAttribute("data-has-power-supply");
      const psPriceStr = el.getAttribute("data-power-supply-price");
      const roleStr = el.getAttribute("data-role");
      const ledBacklitStr = el.getAttribute("data-led-backlit");
      const ledFrontlitStr = el.getAttribute("data-led-frontlit");
      const cutoutBackingStr = el.getAttribute("data-cutout-backing");
      if (fill || materialId || tStr || qStr || ledLStr || roleStr || ledBacklitStr || ledFrontlitStr || cutoutBackingStr) {
        savedAttrs.set(id, {
          fill: fill ?? "",
          materialId,
          thicknessMm: tStr ? parseFloat(tStr) : null,
          quantity: qStr ? parseInt(qStr) : null,
          ledLengthM: ledLStr ? parseFloat(ledLStr) : null,
          ledPricePerM: ledPStr ? parseFloat(ledPStr) : null,
          hasPowerSupply: hasPSStr === "1" ? true : null,
          powerSupplyPrice: psPriceStr ? parseFloat(psPriceStr) : null,
          role: (roleStr as ElementRole | null) || null,
          ledBacklit: ledBacklitStr === "1" ? true : null,
          ledFrontlit: ledFrontlitStr === "1" ? true : null,
          cutoutBackingId: cutoutBackingStr || null,
        });
      }
    });

    const savedLayerState = new Map<string, { locked: boolean; hidden: boolean }>();
    doc.querySelectorAll("[id]").forEach((el) => {
      const id = el.getAttribute("id")!;
      const locked = el.getAttribute("data-locked") === "1";
      const hidden = el.getAttribute("data-hidden") === "1";
      if (locked || hidden) savedLayerState.set(id, { locked, hidden });
    });

    const imported = paper.project.importSVG(svgContent, { expandShapes: true, insert: true });
    // importSVG może zresetować widok na podstawie viewBox — przywróć natychmiast
    if (isUndoRedoRef.current) {
      paper.view.zoom = savedZoom;
      paper.view.center = savedCenter;
    }
    if (!imported) { setHasSvg(false); return; }

    // Usuń clip mask PRZED nadaniem nazw — clip rect nie ma nazwy w tym momencie,
    // więc warunek !clipItem.name działa poprawnie. Gdyby assignMissingNames był pierwszy,
    // clip rect dostałby auto-nazwę i nie zostałby usunięty (byłby potem zaznaczalny jako
    // "niewidoczna ramka" po rozgrupowaniu).
    const g = imported as paper.Group;
    if (g.clipped) {
      const clipItem = g.firstChild;
      g.clipped = false;
      if (clipItem && !clipItem.name) clipItem.remove();
    }

    // Przypisz auto-nazwy elementom bez id (żeby były zaznaczalne i mogły mieć materiały)
    assignMissingNames(imported, "svg_item", 0);

    // Przeskaluj do układu mm (1 Paper.js unit = 1 mm).
    // Przy undo/redo elementy są już w mm — mmPerSvgUnit = 1, brak skalowania.
    if (mmPerSvgUnit !== 1.0) {
      imported.scale(mmPerSvgUnit, new paper.Point(0, 0));
    }

    // Dopasuj widok do strony tylko przy pierwszym imporcie (nie przy undo/redo,
    // gdzie widok jest zachowywany powyżej).
    if (!isUndoRedoRef.current) {
      fitViewToPage(paper.view.viewSize);
    }

    // Rozwiń wrapper root-grupy — importSVG zawsze opakowuje w Group (korzeń <svg>),
    // ale my chcemy mieć dzieci bezpośrednio w svgLayer, żeby cofanie nie grupowało
    // wszystkiego z powrotem w jedną grupę.
    // Paper.js przenosi dzieci z zachowaniem globalnej transformacji (matrix).
    const rootGroup = imported as paper.Group;
    if (rootGroup.children?.length) {
      const kids = [...(rootGroup.children as paper.Item[])];
      kids.forEach((kid) => svgLayer.addChild(kid));
      rootGroup.remove();
    }

    // Wycentruj tylko przy imporcie świeżego pliku zewnętrznego.
    // Nasze zapisane SVG mają data-mm-per-unit → pozycje są już poprawne, nie ruszaj.
    // Zewnętrzne SVG mogą mieć dowolne jednostki (mm, px, pt…) — zawsze centruj na stronie.
    if (!isUndoRedoRef.current && !mmPerUnitAttr) {
      const layerChildren = svgLayer.children as paper.Item[];
      if (layerChildren.length > 0) {
        const allBounds = layerChildren.map((c) => c.bounds).reduce((a, b) => a.unite(b));
        const pageCenter = new paper.Point(CANVAS_SIZE_MM / 2, CANVAS_SIZE_MM / 2);
        const offset = pageCenter.subtract(allBounds.center);
        layerChildren.forEach((c) => { c.position = c.position.add(offset); });
      }
    }

    setHasSvg(true);
    clearBoundsPerElement();
    const mm = mmPerUnitRef.current;
    const svgLyr = svgLayerRef.current;
    if (svgLyr) {
      const topLevel = svgLyr.children as paper.Item[];
      setParentMap(buildParentMapFromItems(topLevel));
      topLevel.forEach((item) => {
        // Rekurencyjnie — ustawia bounds dla elementu ORAZ wszystkich zagnieżdżonych dzieci grup
        setBoundsRecursive(item, mm, setBoundsForElement);
        if (item.name) {
          const ls = savedLayerState.get(item.name);
          if (ls) {
            item.locked = ls.locked;
            item.visible = !ls.hidden;
          }
        }
      });
    }
    setTimeout(() => rebuildLayerItems(), 0);
    clearNodeOverrides();
    savedAttrs.forEach((attrs, id) => {
      setNodeOverride(id, {
        fill: attrs.fill,
        materialId: attrs.materialId,
        thicknessMm: attrs.thicknessMm,
        quantity: attrs.quantity,
        ledLengthM: attrs.ledLengthM,
        ledPricePerM: attrs.ledPricePerM,
        hasPowerSupply: attrs.hasPowerSupply,
        powerSupplyPrice: attrs.powerSupplyPrice,
        role: attrs.role,
        ledBacklit: attrs.ledBacklit,
        ledFrontlit: attrs.ledFrontlit,
        cutoutBackingId: attrs.cutoutBackingId,
      });
      if (attrs.fill) applyFillByName(id, attrs.fill);
    });
    drawRulersRef.current();
    // Inicjuj historię przy (re)imporcie SVG
    setTimeout(() => pushHistory(), 0);
  }, [svgContent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Aplikuj overrides ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!paperReadyRef.current) return;
    Object.entries(nodeOverrides).forEach(([id, override]) => {
      if (override.fill) applyFillByName(id, override.fill);
    });
    paper.view.update();
    // Odśwież miniaturki w LayersPanel — Paper.js zmienił kolor, thumbnail musi się zaktualizować
    setLayerItems((prev) => [...prev]);
  }, [nodeOverrides]);

  // ── Zoom (kółko myszy) ────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // Ctrl+scroll → zoom do kursora
        const rect = canvas.getBoundingClientRect();
        const screenPt = new paper.Point(e.clientX - rect.left, e.clientY - rect.top);
        const projPt = paper.view.viewToProject(screenPt);
        const oldZoom = paper.view.zoom;
        const newZoom = Math.max(0.1, Math.min(5, oldZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        const oldCenter = paper.view.center;
        paper.view.zoom = newZoom;
        paper.view.center = projPt.subtract(projPt.subtract(oldCenter).multiply(oldZoom / newZoom));
        setZoomLevel(newZoom);
        toolCbRef.current.drawResizeHandles();
        const _uiSw = 1 / newZoom;
        if (hoverRectRef.current) hoverRectRef.current.strokeWidth = _uiSw;
        if (rubberBandRectRef.current) rubberBandRectRef.current.strokeWidth = _uiSw;
      } else if (e.shiftKey) {
        // Shift+scroll → pan lewo/prawo
        const delta = e.deltaY / paper.view.zoom;
        paper.view.center = paper.view.center.add(new paper.Point(delta, 0));
      } else {
        // scroll → pan góra/dół
        const delta = e.deltaY / paper.view.zoom;
        paper.view.center = paper.view.center.add(new paper.Point(0, delta));
      }
      drawRulersRef.current();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ── Przyciski zoom ─────────────────────────────────────────────────────────

  const { handleZoomIn, handleZoomOut, handleResetView, handleZoomInputCommit } = useZoomActions({
    setZoomLevel, setZoomInput, drawRulersRef, toolCbRef, hoverRectRef, rubberBandRectRef,
  });

  // ── Grupowanie / Rozgrupowanie ─────────────────────────────────────────────

  const handleGroup = useCallback(() => {
    const items = [...selectedItemsRef.current];
    if (items.length < 2 || !svgLayerRef.current) return;
    const group = new paper.Group(items);
    group.name = `group_${Date.now()}`;
    // Aktualizuj parentMap: każde dziecko (z całego poddrzewa) → nowa grupa
    items.forEach((it) => {
      if (it.name) setChildParent(it.name, group.name);
    });
    clearSelection();
    addToSelection(group);
    setTimeout(() => rebuildLayerItems(), 0);
    if (svgContentRef.current) {
      isSavingRef.current = true;
      setSvgContent(exportSvgLayer(svgLayerRef.current, paper.project, svgContentRef.current, mmPerUnitRef.current));
      setTimeout(() => { isSavingRef.current = false; }, 50);
    }
    pushHistory();
    setContextMenu(null);
  }, [clearSelection, addToSelection, setSvgContent, rebuildLayerItems, pushHistory]);

  const handleUngroup = useCallback(() => {
    const item = selectedItemsRef.current[0];
    if (!item || !(item instanceof paper.Group) || !svgLayerRef.current) return;
    const parent = item.parent;
    const idx = (parent.children as paper.Item[]).indexOf(item);
    const groupName = item.name;
    const groupOverride = groupName ? nodeOverridesRef.current[groupName] : undefined;

    // Jeśli grupa jest przycinana — usuń clip mask zanim pobierzemy dzieci
    if ((item as paper.Group).clipped) {
      (item as paper.Group).clipped = false;
      const clipItem = item.firstChild;
      if (clipItem && !clipItem.name) clipItem.remove();
    }

    const children = [...(item.children as paper.Item[])];
    // Przypisz nazwy dzieciom przed przeniesieniem (mogą nie mieć id z SVG)
    children.forEach((c, i) => { if (!c.name) c.name = `${groupName || "group"}_${i}`; });

    // Migracja override grupy → dzieci (tylko te bez własnego override).
    if (groupOverride) {
      children.forEach((c) => {
        const childName = c.name;
        if (!childName) return;
        if (!nodeOverridesRef.current[childName]) {
          setNodeOverride(childName, groupOverride);
          if (groupOverride.fill) applyFillByName(childName, groupOverride.fill);
        }
      });
      if (groupName) removeNodeOverride(groupName);
    }

    // Aktualizuj parentMap: dzieci przechodzą na poziom rodzica grupy (lub top-level)
    const groupParentName = groupName ? useEditorStore.getState().parentMap[groupName] : undefined;
    children.forEach((c) => {
      if (!c.name) return;
      if (groupParentName) setChildParent(c.name, groupParentName);
      else removeFromParentMap(c.name);
    });
    if (groupName) removeFromParentMap(groupName);

    parent.insertChildren(idx, children);
    item.remove();
    clearSelection();
    children.forEach((c) => addToSelection(c));
    setTimeout(() => rebuildLayerItems(), 0);
    if (svgContentRef.current) {
      isSavingRef.current = true;
      setSvgContent(exportSvgLayer(svgLayerRef.current, paper.project, svgContentRef.current, mmPerUnitRef.current));
      setTimeout(() => { isSavingRef.current = false; }, 50);
    }
    pushHistory();
    setContextMenu(null);
  }, [clearSelection, addToSelection, setSvgContent, rebuildLayerItems, pushHistory, setNodeOverride, removeNodeOverride, setChildParent, removeFromParentMap]);

  // ── Skróty klawiszowe ─────────────────────────────────────────────────────
  // Blok musi być po handleGroup/handleUngroup (zdefiniowanych wyżej przez useCallback),
  // żeby ich nazwy nie były w temporal dead zone przy ewaluacji tablicy deps.

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
      if (ctrl && e.code === "KeyZ" && e.shiftKey)  { e.preventDefault(); handleRedo(); return; }
      if (ctrl && e.code === "KeyG" && !e.shiftKey) { e.preventDefault(); handleGroup(); return; }
      if (ctrl && e.code === "KeyG" && e.shiftKey)  { e.preventDefault(); handleUngroup(); return; }
      if (ctrl && e.key === "c") { e.preventDefault(); handleCopy(); return; }
      if (ctrl && e.key === "v") { e.preventDefault(); handlePaste(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); handleDelete(); return; }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo, handleGroup, handleUngroup, handleCopy, handlePaste, handleDelete]);

  // ── Eksport SVG ────────────────────────────────────────────────────────────

  const handleExportSvg = useCallback(async () => {
    const content = svgContentRef.current;
    if (!content) return;
    const updated = updateSvgWithOverrides(content, nodeOverridesRef.current);

    const filePath = await save({
      title: "Zapisz plik SVG",
      defaultPath: `${project.name}.svg`,
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (!filePath) return;

    try {
      await writeTextFile(filePath, updated);
      addToast("Plik SVG został zapisany.", "success");
    } catch (e) {
      addToast(`Błąd zapisu pliku: ${e}`, "error");
    }
  }, [project.name, addToast]);

  // ── Dodaj SVG do istniejącego projektu (scalanie) ─────────────────────────

  const handleAddSvg = useCallback(async (providedPath?: string) => {
    // Blokada modułowa — niezależna od Reacta, blokuje wielokrotne wywołania.
    // Sprawdź zarówno flagę "w trakcie" jak i deduplication ścieżki (5s okno).
    if (_addingSvg) return;
    if (providedPath && providedPath === _lastAddedPath && Date.now() - _lastAddedTime < ADD_DEDUP_MS) return;
    _addingSvg = true;
    // KRYTYCZNE: blokada useEffect importu — bez tego główny useEffect (line ~1070)
    // może rerunować podczas handleAddSvg jeśli svgContent się zmieni (np. przez
    // auto-save lub pushHistory) i wyczyścić layer, gubiąc właśnie dodane elementy.
    isAddingSvgRef.current = true;

    let filePath: string | null = providedPath ?? null;
    if (!filePath) {
      const picked = await open({ multiple: false, filters: [{ name: "SVG", extensions: ["svg"] }] });
      if (!picked || typeof picked !== "string") {
        _addingSvg = false;
        isAddingSvgRef.current = false;
        return;
      }
      filePath = picked;
    }
    // Zapisz ścieżkę zaraz po ustaleniu — przed jakimkolwiek await
    if (filePath) { _lastAddedPath = filePath; _lastAddedTime = Date.now(); }

    const layer = svgLayerRef.current;
    if (!layer) {
      _addingSvg = false;
      isAddingSvgRef.current = false;
      return;
    }
    setIsImportingSvg(true);
    try {
      const result = await invoke<SvgImportResult>("import_svg", { slug: project.slug, sourcePath: filePath });
      const newContent = result.content;

      // Zapisz stan sprzed scalenia do historii — Ctrl+Z wróci do kanwasu bez nowego SVG
      {
        const lyr = svgLayerRef.current;
        const cnt = svgContentRef.current;
        if (lyr && cnt) {
          const exported = exportSvgLayer(lyr, paper.project, cnt, mmPerUnitRef.current);
          const withOverrides = updateSvgWithOverrides(exported, nodeOverridesRef.current);
          historyRef.current.splice(historyIndexRef.current + 1);
          historyRef.current.push({ svg: withOverrides, selection: [] });
          historyIndexRef.current = historyRef.current.length - 1;
        }
      }

      // Odczytaj wymiary nowego SVG (do przelicznika mm)
      const doc = new DOMParser().parseFromString(newContent, "image/svg+xml");
      const svgEl = doc.documentElement;

      let newMmPerUnit = mmPerUnitRef.current; // domyślnie: taka sama skala
      const widthAttr = svgEl.getAttribute("width");
      const vbAttr = svgEl.getAttribute("viewBox");
      const mmPerUnitAttr = svgEl.getAttribute("data-mm-per-unit");
      if (widthAttr && vbAttr) {
        const vb = vbAttr.split(/[\s,]+/).map(Number);
        const { value: wVal, unit: wUnit } = parseSvgDimension(widthAttr);
        const vbW = vb[2];
        if (vbW > 0 && wVal > 0) newMmPerUnit = toMm(wVal, wUnit) / vbW;
      } else if (mmPerUnitAttr) {
        newMmPerUnit = parseFloat(mmPerUnitAttr);
      }

      // Odczytaj data-* overrides z nowego pliku
      const savedAttrs = new Map<string, {
        fill: string; materialId: string | null;
        thicknessMm: number | null; quantity: number | null;
        ledLengthM: number | null; ledPricePerM: number | null;
        hasPowerSupply: boolean | null; powerSupplyPrice: number | null;
        role: ElementRole | null;
      }>();
      doc.querySelectorAll("[id]").forEach((el) => {
        const id = el.getAttribute("id")!;
        const fill = el.getAttribute("data-color");
        const materialId = el.getAttribute("data-material");
        const tStr = el.getAttribute("data-thickness-mm");
        const qStr = el.getAttribute("data-quantity");
        const ledLStr = el.getAttribute("data-led-length-m");
        const ledPStr = el.getAttribute("data-led-price-per-m");
        const hasPSStr = el.getAttribute("data-has-power-supply");
        const psPriceStr = el.getAttribute("data-power-supply-price");
        const roleStr = el.getAttribute("data-role");
        if (fill || materialId || tStr || qStr || ledLStr || roleStr) {
          savedAttrs.set(id, {
            fill: fill ?? "",
            materialId,
            thicknessMm: tStr ? parseFloat(tStr) : null,
            quantity: qStr ? parseInt(qStr) : null,
            ledLengthM: ledLStr ? parseFloat(ledLStr) : null,
            ledPricePerM: ledPStr ? parseFloat(ledPStr) : null,
            hasPowerSupply: hasPSStr === "1" ? true : null,
            powerSupplyPrice: psPriceStr ? parseFloat(psPriceStr) : null,
            role: (roleStr as ElementRole | null) || null,
          });
        }
      });

      // Zbuduj zestaw istniejących nazw (do unikania kolizji)
      const existingNames = new Set<string>();
      (layer.children as paper.Item[]).forEach(function collectNames(item: paper.Item) {
        if (item.name) existingNames.add(item.name);
        const g = item as paper.Group;
        if (g.children) g.children.forEach(collectNames);
      });

      // Importuj nowy SVG — insert:false, żeby nie zaburzać widoku istniejących elementów.
      // importSVG może modyfikować paper.view (rozmiar/zoom/centrum) przy SVG bez viewBox —
      // zachowujemy i przywracamy stan widoku.
      const savedZoom   = paper.view.zoom;
      const savedCenter = paper.view.center.clone();
      layer.activate();
      const imported = paper.project.importSVG(newContent, { expandShapes: true, insert: false });
      paper.view.zoom   = savedZoom;
      paper.view.center = savedCenter;
      if (!imported) return;
      layer.addChild(imported);

      // Usuń clip mask
      const g = imported as paper.Group;
      if (g.clipped) {
        const clipItem = g.firstChild;
        g.clipped = false;
        if (clipItem && !clipItem.name) clipItem.remove();
      }

      // Przeskaluj do układu mm (1 Paper.js unit = 1 mm)
      if (newMmPerUnit > 0 && Math.abs(newMmPerUnit - 1.0) > 1e-9) {
        imported.scale(newMmPerUnit, new paper.Point(0, 0));
      }

      // Nadaj auto-nazwy z sufiksem _add aby uniknąć kolizji
      const makeUnique = (name: string): string => {
        if (!existingNames.has(name)) { existingNames.add(name); return name; }
        let i = 2;
        while (existingNames.has(`${name}_${i}`)) i++;
        const unique = `${name}_${i}`;
        existingNames.add(unique);
        return unique;
      };
      const renameItem = (item: paper.Item, prefix: string, idx: number) => {
        const base = item.name || `${prefix}_${idx}`;
        item.name = makeUnique(base);
        const grp = item as paper.Group;
        if (grp.children) grp.children.forEach((c, i) => renameItem(c, item.name, i));
      };

      // Rozwiń root-grupę do svgLayer
      const rootGroup = imported as paper.Group;
      const newKids: paper.Item[] = [];
      if (rootGroup.children?.length) {
        const kids = [...(rootGroup.children as paper.Item[])];
        kids.forEach((kid, i) => {
          renameItem(kid, "svg_item", i);
          layer.addChild(kid);
          newKids.push(kid);
        });
        rootGroup.remove();
      } else {
        renameItem(imported, "svg_item", 0);
        newKids.push(imported);
      }

      // Przesuń nowe elementy na środek strony (7500/2, 7500/2)
      if (newKids.length > 0) {
        const allBounds = newKids.map((k) => k.bounds);
        const combinedBounds = allBounds.reduce((acc, b) => acc.unite(b));
        const pageCenter = new paper.Point(CANVAS_SIZE_MM / 2, CANVAS_SIZE_MM / 2);
        const offset = pageCenter.subtract(combinedBounds.center);
        newKids.forEach((k) => { k.position = k.position.add(offset); });
      }

      // Zastosuj overrides z nowego pliku
      const mm = mmPerUnitRef.current;
      savedAttrs.forEach((attrs, id) => {
        // Znajdź element po oryginalnej nazwie id (może być już przemianowany)
        setNodeOverride(id, {
          fill: attrs.fill,
          materialId: attrs.materialId,
          thicknessMm: attrs.thicknessMm,
          quantity: attrs.quantity,
          ledLengthM: attrs.ledLengthM,
          ledPricePerM: attrs.ledPricePerM,
          hasPowerSupply: attrs.hasPowerSupply,
          powerSupplyPrice: attrs.powerSupplyPrice,
          role: attrs.role,
        });
        if (attrs.fill) applyFillByName(id, attrs.fill);
      });

      // Przelicz wymiary nowych elementów (rekurencyjnie — łącznie z dziećmi grup)
      newKids.forEach((item) => { setBoundsRecursive(item, mm, setBoundsForElement); });

      setHasSvg(true);
      setTimeout(() => rebuildLayerItems(), 0);
      pushHistory();
      addToast("Plik SVG został dodany do projektu.", "success");
    } catch (e) {
      addToast(`Błąd dodawania SVG: ${e}`, "error");
    } finally {
      setIsImportingSvg(false);
      // Zwolnij blokadę po przetworzeniu wszystkich zmian stanu przez Reacta
      setTimeout(() => { _addingSvg = false; isAddingSvgRef.current = false; }, 200);
    }
  }, [project.slug, addToast, setNodeOverride, setBoundsForElement, rebuildLayerItems, pushHistory]);

  // ── Import SVG (dialog) ────────────────────────────────────────────────────
  //
  // "Importuj SVG" (przycisk) — ZASTĘPUJE bieżący projekt nowym plikiem.
  // Gdy hasSvg=true, pokazuje modal "Zastąp / Dodaj / Anuluj" zamiast cichego mergowania.
  // Powód: wcześniej przycisk cicho mergował, co user interpretował jako "usunięte
  // rzeczy wróciły" — bo bieżąca zawartość zostawała widoczna obok nowego SVG.

  // Path do pliku wybranego przez user, czekający na rozstrzygnięcie zastąp/dodaj.
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);

  /** Faktyczny replace — czyści bieżący SVG i ładuje nowy z filePath. */
  const handleReplaceSvg = useCallback(async (filePath: string) => {
    setIsImportingSvg(true);
    try {
      const result = await invoke<SvgImportResult>("import_svg", { slug: project.slug, sourcePath: filePath });
      // Zapisz pusty stan przed importem — Ctrl+Z wróci do pustego kanwasu
      historyRef.current.splice(historyIndexRef.current + 1);
      historyRef.current.push({ svg: "", selection: [] });
      historyIndexRef.current = historyRef.current.length - 1;
      // setSvgContent triggeruje główny useEffect który czyści paper.project,
      // clearNodeOverrides (line ~1256), i reimportuje nowy SVG. Stare overrides znikają.
      setSvgContent(result.content);
    } catch (e) {
      addToast(`Błąd importu SVG: ${e}`, "error");
    } finally {
      setIsImportingSvg(false);
    }
  }, [project.slug, setSvgContent, addToast]);

  const handleImportSvg = useCallback(async () => {
    const filePath = await open({ multiple: false, filters: [{ name: "SVG", extensions: ["svg"] }] });
    if (!filePath || typeof filePath !== "string") return;

    if (hasSvg) {
      // Pokaż modal z wyborem — user świadomie decyduje co zrobić
      setPendingImportPath(filePath);
      return;
    }

    // Brak istniejącego SVG — bezpośredni import
    await handleReplaceSvg(filePath);
  }, [hasSvg, handleReplaceSvg]);

  // ── Import tła ─────────────────────────────────────────────────────────────

  const handleImportBackground = useCallback(async () => {
    const filePath = await open({
      multiple: false,
      filters: [{ name: "Zdjęcia", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (!filePath || typeof filePath !== "string") return;
    setIsImportingBg(true);
    try {
      const result = await invoke<BackgroundImportResult>("import_background", {
        slug: project.slug, sourcePath: filePath,
      });
      const blobUrl = await backgroundToBlobUrl(result.path, result.mime);
      setBackground(blobUrl, result.path);
    } catch (e) {
      addToast(`Błąd importu tła: ${e}`, "error");
    } finally {
      setIsImportingBg(false);
    }
  }, [project.slug, setBackground, addToast]);

  const handleRemoveBackground = useCallback(() => clearBackground(), [clearBackground]);

  // ── Drag & drop plików (Tauri window-level events) ───────────────────────

  // Ref zawsze wskazuje na aktualne zamknięcie — listener rejestrujemy raz
  dropHandlerRef.current = async (paths: string[]) => {
    if (_dropHandling) return;
    _dropHandling = true;

    const svgPath = paths.find((p) => /\.svg$/i.test(p));
    const imgPath = paths.find((p) => /\.(jpg|jpeg|png|webp)$/i.test(p));

    // Routing po aktywnej zakładce — w widoku Generowania obraz powinien
    // trafić do "zdjęć referencyjnych", a nie jako tło edytora.
    const tab = useEditorStore.getState().activeTab;

    try {
    if (tab === "generowanie" && imgPath) {
      try {
        const ext = imgPath.split(".").pop()?.toLowerCase() ?? "";
        const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        const bytes = await readFile(imgPath);
        // Inline base64 conversion (uniknięcie cyklicznych zależności z helperem PromptPanel)
        let binary = "";
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const dataUrl = `data:${mime};base64,${btoa(binary)}`;
        const name = imgPath.split(/[\\/]/).pop() ?? imgPath;
        useGenerationStore.getState().addReferenceImage({ dataUrl, name });
        addToast(`Dodano zdjęcie referencyjne: ${name}`, "success");
      } catch (e) {
        addToast(`Błąd dodawania zdjęcia referencyjnego: ${e}`, "error");
      }
      return;
    }

    if (tab === "galeria") {
      // Galeria nie obsługuje drop — ignoruj cicho
      return;
    }

    if (svgPath) {
      if (svgLayerRef.current && svgLayerRef.current.children?.length > 0) {
        // Jest już SVG — dodaj scalając
        await handleAddSvg(svgPath);
      } else {
        setIsImportingSvg(true);
        try {
          const result = await invoke<SvgImportResult>("import_svg", {
            slug: project.slug,
            sourcePath: svgPath,
          });
          setSvgContent(result.content);
        } catch {
          addToast("Nie udało się wczytać pliku SVG.", "error");
        } finally {
          setIsImportingSvg(false);
        }
      }
      return;
    }

    if (imgPath) {
      setIsImportingBg(true);
      try {
        const result = await invoke<BackgroundImportResult>("import_background", {
          slug: project.slug,
          sourcePath: imgPath,
        });
        const blobUrl = await backgroundToBlobUrl(result.path, result.mime);
        setBackground(blobUrl, result.path);
      } catch (e) {
        addToast(`Błąd importu tła: ${e}`, "error");
      } finally {
        setIsImportingBg(false);
      }
      return;
    }

    addToast("Obsługiwane formaty: SVG, JPG, PNG, WebP.", "error");
    } finally {
      setTimeout(() => { _dropHandling = false; }, 3000);
    }
  };

  useEffect(() => {
    // Tauri onDragDropEvent — obsługuje dropa pliku z systemu operacyjnego (Explorer itp.).
    // dragDropEnabled: true w tauri.conf.json → Tauri rejestruje IDropTarget i dostaje
    // ścieżki plików bezpośrednio od OS (nie przez file.path jak w Electron/Chromium).
    // Wewnętrzny HTML5 DnD presetów (bez ścieżek pliku) nie wpływa na ten handler —
    // preset drag używa pointerup jako fallback (patrz PromptPanel.tsx).
    let unlisten: (() => void) | null = null;

    getCurrentWindow().onDragDropEvent((event) => {
      const { type } = event.payload;

      if (type === "enter") {
        const paths = (event.payload as { paths?: string[] }).paths ?? [];
        const first = paths[0] ?? "";
        if (/\.svg$/i.test(first)) setIsDragOver("svg");
        else if (/\.(jpg|jpeg|png|webp)$/i.test(first)) setIsDragOver("image");
        else if (first) setIsDragOver("unknown");
        // Brak ścieżek = wewnętrzny HTML5 DnD (preset) — ignoruj
      } else if (type === "leave") {
        setIsDragOver(null);
      } else if (type === "drop") {
        setIsDragOver(null);
        const paths = (event.payload as { paths?: string[] }).paths ?? [];
        if (!paths.length) return; // wewnętrzny DnD bez pliku — ignoruj
        const pathsKey = paths.join("|");
        const now = Date.now();
        if (pathsKey === _lastDropPaths && now - _lastDropTime < 3000) return;
        _lastDropPaths = pathsKey;
        _lastDropTime = now;
        dropHandlerRef.current?.(paths);
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bgFilename = backgroundPath?.split(/[/\\]/).pop() ?? "";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-w-0" style={{ background: BG_COLOR }}>
      <CanvasToolbar
        hasSvg={hasSvg}
        isImportingSvg={isImportingSvg}
        isImportingBg={isImportingBg}
        backgroundDataUrl={backgroundDataUrl}
        backgroundFilename={bgFilename}
        onImportSvg={handleImportSvg}
        onExportSvg={handleExportSvg}
        onImportBackground={handleImportBackground}
        onRemoveBackground={handleRemoveBackground}
      />

      {/* Obszar kanwasu z linijkami */}
      <div className="flex flex-1 overflow-hidden">
        {/* Lewa kolumna: narożnik + linijka pionowa */}
        <div className="flex flex-col shrink-0" style={{ width: RULER_SIZE }}>
          <div style={{ width: RULER_SIZE, height: RULER_SIZE, background: RULER_BG, borderRight: `1px solid ${RULER_BORDER}`, borderBottom: `1px solid ${RULER_BORDER}`, flexShrink: 0 }} />
          <canvas ref={leftRulerRef} style={{ width: RULER_SIZE, display: "block", flexShrink: 0, flexGrow: 1, height: 0 }} />
        </div>

        {/* Prawa kolumna: linijka pozioma + kanwas */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <canvas ref={topRulerRef} style={{ height: RULER_SIZE, display: "block", flexShrink: 0 }} />

          <div ref={containerRef} className="flex-1 relative overflow-hidden">
            {backgroundDataUrl && (
              <img
                ref={backgroundImgRef}
                src={backgroundDataUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
              />
            )}

            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ background: backgroundDataUrl ? "transparent" : BG_COLOR }}
            />

        {/* Przycisk toggle panelu obiektów */}
        {hasSvg && (
          <button
            onClick={() => setIsPanelOpen((p) => !p)}
            className={`absolute bottom-3 left-3 z-20 p-2 rounded-lg shadow-lg border transition-colors ${
              isPanelOpen
                ? "bg-blue-600 border-blue-500 text-white"
                : "bg-[#1e1e1e] border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-[#252525]"
            }`}
            title="Lista obiektów"
          >
            <Layers className="w-4 h-4" />
          </button>
        )}

        <ZoomWidget
          zoomLevel={zoomLevel}
          zoomInput={zoomInput}
          setZoomInput={setZoomInput}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetView={handleResetView}
          onZoomInputCommit={handleZoomInputCommit}
          panMode={panMode}
          onTogglePanMode={() => {
            setPanMode((v) => {
              const next = !v;
              const c = canvasRef.current;
              if (c) c.style.cursor = next ? "grab" : "default";
              return next;
            });
          }}
        />

        {/* Panel obiektów/warstw */}
        {hasSvg && isPanelOpen && (
          <LayersPanel
            items={layerItems}
            selectedIds={selectedItemNames}
            onSelect={handleLayerSelect}
            onRename={handleLayerRename}
            onToggleLock={handleLayerToggleLock}
            onToggleVisible={handleLayerToggleVisible}
            onReorder={handleLayerReorder}
            getThumbnail={getThumbnailForItem}
          />
        )}

        {!hasSvg && !isImportingSvg && !isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/60 flex items-center justify-center mx-auto mb-4 shadow-sm">
                <Upload className="w-7 h-7 text-gray-400" />
              </div>
              <p className="text-gray-500 text-sm font-medium">Brak projektu</p>
              <p className="text-gray-400 text-xs mt-1.5">
                Kliknij „Importuj SVG" lub przeciągnij plik tutaj
              </p>
            </div>
          </div>
        )}

        {isDragOver && <DragOverlay kind={isDragOver} />}

        {isImportingSvg && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: `${BG_COLOR}cc` }}>
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Wczytywanie SVG…
            </div>
          </div>
        )}
          </div>
        </div>
      </div>

      {contextMenu && (
        <CanvasContextMenu
          menu={contextMenu}
          clipboardEmpty={clipboardRef.current.length === 0}
          onClose={() => setContextMenu(null)}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
          onToggleLock={handleLayerToggleLock}
          onDelete={handleDelete}
        />
      )}

      {/* Modal wyboru zachowania importu gdy projekt już ma SVG.
          Trzy opcje: Zastąp (clear + load), Dodaj (merge), Anuluj. */}
      {pendingImportPath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#1e1e1e] rounded-lg shadow-xl w-full max-w-md p-5 flex flex-col gap-4">
            <div>
              <h3 className="text-gray-100 text-base font-semibold mb-1">
                Projekt zawiera już SVG
              </h3>
              <p className="text-gray-400 text-sm">
                Co chcesz zrobić z plikiem{" "}
                <span className="text-gray-200">
                  {pendingImportPath.split(/[\\/]/).pop()}
                </span>
                ?
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  const path = pendingImportPath;
                  setPendingImportPath(null);
                  handleReplaceSvg(path);
                }}
                className="px-3 py-2 rounded text-sm text-white bg-red-700 hover:bg-red-600 transition-colors text-left"
              >
                <span className="font-medium">Zastąp</span>
                <span className="block text-[11px] text-red-100/80 mt-0.5">
                  Usuwa bieżący projekt i ładuje nowy SVG.
                </span>
              </button>
              <button
                onClick={() => {
                  const path = pendingImportPath;
                  setPendingImportPath(null);
                  handleAddSvg(path);
                }}
                className="px-3 py-2 rounded text-sm text-white bg-blue-700 hover:bg-blue-600 transition-colors text-left"
              >
                <span className="font-medium">Dodaj do projektu</span>
                <span className="block text-[11px] text-blue-100/80 mt-0.5">
                  Scala nowy plik z istniejącym SVG.
                </span>
              </button>
              <button
                onClick={() => setPendingImportPath(null)}
                className="px-3 py-2 rounded text-sm text-gray-300 bg-[#2a2a2a] hover:bg-[#333] transition-colors"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
