export const saveFnRef: { current: (() => void) | null } = { current: null };
export function saveCanvasToStore(): void { saveFnRef.current?.(); }

export const resizeElementFnRef: { current: ((widthMm: number, heightMm: number) => void) | null } = { current: null };
export function resizeSelectedElement(widthMm: number, heightMm: number): void { resizeElementFnRef.current?.(widthMm, heightMm); }

/** Zwraca PNG base64 aktualnie widocznego canvasu Paper.js (bez prefixu data URL). */
export const captureCanvasFnRef: { current: (() => string | null) | null } = { current: null };
export function captureCanvas(): string | null { return captureCanvasFnRef.current?.() ?? null; }
