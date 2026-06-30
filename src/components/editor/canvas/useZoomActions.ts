import { useCallback } from "react";
import paper from "paper";
import { fitViewToPage, type PageDims } from "./paperUtils";

interface UseZoomActionsParams {
  setZoomLevel: (z: number) => void;
  setZoomInput: (val: string | null) => void;
  drawRulersRef: React.MutableRefObject<() => void>;
  toolCbRef: React.MutableRefObject<{ drawResizeHandles: () => void }>;
  hoverRectRef: React.MutableRefObject<paper.Shape | null>;
  rubberBandRectRef: React.MutableRefObject<paper.Shape | null>;
  /** Aktualne wymiary strony (zmieniają się przy zmianie proporcji canvasu). */
  pageDimsRef: React.MutableRefObject<PageDims>;
}

interface UseZoomActionsResult {
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetView: () => void;
  handleZoomInputCommit: (raw: string) => void;
}

/** Maksymalny zoom (10 = 1000%). */
const ZOOM_MAX = 10;
const ZOOM_MIN = 0.1;

/** Akcje zoomu: przyciski +/− , reset widoku i ręczne wpisanie procentu. */
export function useZoomActions(params: UseZoomActionsParams): UseZoomActionsResult {
  const { setZoomLevel, setZoomInput, drawRulersRef, toolCbRef, hoverRectRef, rubberBandRectRef, pageDimsRef } = params;

  // Przy zmianie zoomu zachowujemy stałą grubość obrysów UI (hover/rubber band) — w jednostkach świata Paper.js.
  const applyUiStrokeWidth = useCallback((z: number) => {
    const sw = 1 / z;
    if (hoverRectRef.current) hoverRectRef.current.strokeWidth = sw;
    if (rubberBandRectRef.current) rubberBandRectRef.current.strokeWidth = sw;
  }, [hoverRectRef, rubberBandRectRef]);

  const handleZoomIn = useCallback(() => {
    const z = Math.min(paper.view.zoom * 1.25, ZOOM_MAX);
    paper.view.zoom = z; setZoomLevel(z); drawRulersRef.current();
    toolCbRef.current.drawResizeHandles();
    applyUiStrokeWidth(z);
  }, [setZoomLevel, drawRulersRef, toolCbRef, applyUiStrokeWidth]);

  const handleZoomOut = useCallback(() => {
    const z = Math.max(paper.view.zoom / 1.25, ZOOM_MIN);
    paper.view.zoom = z; setZoomLevel(z); drawRulersRef.current();
    toolCbRef.current.drawResizeHandles();
    applyUiStrokeWidth(z);
  }, [setZoomLevel, drawRulersRef, toolCbRef, applyUiStrokeWidth]);

  const handleResetView = useCallback(() => {
    fitViewToPage(paper.view.viewSize, pageDimsRef.current);
    const z = paper.view.zoom;
    setZoomLevel(z); drawRulersRef.current();
    toolCbRef.current.drawResizeHandles();
    applyUiStrokeWidth(z);
  }, [setZoomLevel, drawRulersRef, toolCbRef, applyUiStrokeWidth, pageDimsRef]);

  const handleZoomInputCommit = useCallback((raw: string) => {
    const pct = parseInt(raw, 10);
    if (!isNaN(pct) && pct >= 10 && pct <= ZOOM_MAX * 100) {
      const z = pct / 100;
      paper.view.zoom = z; setZoomLevel(z); drawRulersRef.current();
      toolCbRef.current.drawResizeHandles();
      applyUiStrokeWidth(z);
    }
    setZoomInput(null);
  }, [setZoomLevel, setZoomInput, drawRulersRef, toolCbRef, applyUiStrokeWidth]);

  return { handleZoomIn, handleZoomOut, handleResetView, handleZoomInputCommit };
}
