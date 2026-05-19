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
