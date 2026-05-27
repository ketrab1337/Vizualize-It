export const saveFnRef: { current: (() => void) | null } = { current: null };
export function saveCanvasToStore(): void { saveFnRef.current?.(); }

export const pushHistoryRef: { current: (() => void) | null } = { current: null };
export function pushCanvasHistory(): void { pushHistoryRef.current?.(); }

export const resizeElementFnRef: { current: ((widthMm: number, heightMm: number) => void) | null } = { current: null };
export function resizeSelectedElement(widthMm: number, heightMm: number): void { resizeElementFnRef.current?.(widthMm, heightMm); }

/** Wynik kompozycji canvasu dla AI: czysty PNG base64 (tło + SVG bez etykiet). */
export interface CanvasCapture {
  /** Kompozyt PNG (tło + SVG) jako base64 bez prefixu data URL. */
  pngBase64: string;
}

/**
 * Zwraca kompozyt aktualnie widocznego canvasu Paper.js dla AI:
 * - tło (jeśli jest) wypełnione z object-fit: cover
 * - SVG na wierzchu z aktualnym zoom/pan
 *
 * NIE rysujemy etykiet — AI rozpoznaje elementy po kolorach z SVG (opisanych
 * w prompcie), a wcześniejsze etykiety tekstowe (typu "svg_item_0_4") były
 * przez Gemini dosłownie renderowane na szyldzie. Identyfikatory elementów
 * lecą tylko tekstem w prompt (`assemblePrompt`), nie wizualnie.
 */
export const captureCanvasFnRef: { current: (() => CanvasCapture | null) | null } = { current: null };
export function captureCanvas(): CanvasCapture | null { return captureCanvasFnRef.current?.() ?? null; }

// ── Nesting ───────────────────────────────────────────────────────────────────

/** Krok rotacji w stopniach; 360 = bez rotacji (tylko 0°). */
export type RotationStep = 1 | 5 | 15 | 45 | 90 | 360;

export interface NestingConfig {
  nodeIds: string[];
  plateWidthMm: number;
  plateHeightMm: number;
  gapMm: number;
  rotationStep: RotationStep;
}

export interface NestingRunResult {
  placed: number;
  overflow: string[];
}

export const runNestingFnRef: { current: ((config: NestingConfig) => NestingRunResult | null) | null } = { current: null };
export const clearNestingFnRef: { current: (() => void) | null } = { current: null };
export const exportNestingSvgFnRef: { current: (() => string | null) | null } = { current: null };
