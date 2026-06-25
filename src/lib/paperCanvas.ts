export const saveFnRef: { current: (() => void) | null } = { current: null };
export function saveCanvasToStore(): void { saveFnRef.current?.(); }

export const pushHistoryRef: { current: (() => void) | null } = { current: null };
export function pushCanvasHistory(): void { pushHistoryRef.current?.(); }

export const resizeElementFnRef: { current: ((widthMm: number, heightMm: number) => void) | null } = { current: null };
export function resizeSelectedElement(widthMm: number, heightMm: number): void { resizeElementFnRef.current?.(widthMm, heightMm); }

/**
 * Wynik kompozycji canvasu dla AI, z którego `useGeneration` wybiera zależnie od sceny:
 *
 * - **szyld/produkty na realnym tle**: `compositePngBase64` — nakładka SVG wtopiona w zdjęcie
 *   (Obraz 1). Rozmiar i proporcje niesie sama nakładka (pixel-perfect); prompt każe wyrenderować
 *   ją w perspektywie ściany (sprawdzona formuła 22.06 — bez footprintu, który sam kotwiczył frontalnie).
 * - **sam projekt** (bez tła): `designPngBase64`.
 * - **samo tło** (bez geometrii szyldu): `scenePngBase64`.
 */
export interface CanvasCapture {
  /** Czysty render projektu SVG na neutralnym jasnoszarym tle. Null gdy brak geometrii SVG. */
  designPngBase64: string | null;
  /** Samo zdjęcie ściany (object-fit cover viewportu) — używane gdy NIE ma geometrii szyldu. Renderowane z <img>, więc blob-safe. Null gdy brak tła. */
  scenePngBase64: string | null;
  /** Kompozyt tło+SVG — nakładka SVG wtopiona w zdjęcie (szyld na tle ORAZ produkty <image>). Null gdy brak tła lub brak SVG. */
  compositePngBase64: string | null;
}

/**
 * Zwraca obrazy aktualnego canvasu Paper.js dla AI (patrz `CanvasCapture`).
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
