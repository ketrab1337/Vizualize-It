// Linijki canvasu — czyste funkcje rysujące, bez stanu Reacta.

export const RULER_SIZE = 20; // px
export const RULER_BG = "#d8d9de";
export const RULER_BORDER = "#b4b5be";

function niceMmStep(minMm: number): number {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) {
    if (s >= minMm) return s;
  }
  return 1000;
}

export function drawHRuler(
  canvas: HTMLCanvasElement,
  zoom: number,
  centerX: number,
  viewW: number,
  mmPerUnit: number,
) {
  const W = canvas.offsetWidth;
  if (W === 0) return;
  canvas.width = W;
  canvas.height = RULER_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, 0, W, RULER_SIZE);
  ctx.strokeStyle = RULER_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE - 0.5);
  ctx.lineTo(W, RULER_SIZE - 0.5);
  ctx.stroke();

  if (mmPerUnit <= 0) return;
  const pxPerMm = zoom / mmPerUnit;
  const mmStep = niceMmStep(44 / pxPerMm);
  const pxStep = mmStep * pxPerMm;
  const mmAtLeft = ((-viewW / 2) / zoom + centerX) * mmPerUnit;
  const firstMm = Math.ceil(mmAtLeft / mmStep) * mmStep;

  ctx.fillStyle = "#666";
  ctx.font = `8px system-ui,sans-serif`;
  ctx.textBaseline = "top";

  for (let mm = firstMm; ; mm += mmStep) {
    const sx = (mm / mmPerUnit - centerX) * zoom + viewW / 2;
    if (sx > W + 4) break;
    if (sx < -4) continue;

    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + 0.5, RULER_SIZE - 6);
    ctx.lineTo(sx + 0.5, RULER_SIZE);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(mm)}`, sx + 2, 2);

    if (pxStep > 32) {
      const sub = pxStep > 80 ? 5 : 2;
      for (let j = 1; j < sub; j++) {
        const subSx = sx + (pxStep / sub) * j;
        if (subSx < 0 || subSx > W) continue;
        ctx.strokeStyle = "#aaa";
        ctx.beginPath();
        ctx.moveTo(subSx + 0.5, RULER_SIZE - 3);
        ctx.lineTo(subSx + 0.5, RULER_SIZE);
        ctx.stroke();
      }
    }
  }
}

export function drawVRuler(
  canvas: HTMLCanvasElement,
  zoom: number,
  centerY: number,
  viewH: number,
  mmPerUnit: number,
) {
  const H = canvas.offsetHeight;
  if (H === 0) return;
  canvas.width = RULER_SIZE;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, 0, RULER_SIZE, H);
  ctx.strokeStyle = RULER_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(RULER_SIZE - 0.5, 0);
  ctx.lineTo(RULER_SIZE - 0.5, H);
  ctx.stroke();

  if (mmPerUnit <= 0) return;
  const pxPerMm = zoom / mmPerUnit;
  const mmStep = niceMmStep(44 / pxPerMm);
  const pxStep = mmStep * pxPerMm;
  const mmAtTop = ((-viewH / 2) / zoom + centerY) * mmPerUnit;
  const firstMm = Math.ceil(mmAtTop / mmStep) * mmStep;

  ctx.fillStyle = "#666";
  ctx.font = `8px system-ui,sans-serif`;

  for (let mm = firstMm; ; mm += mmStep) {
    const sy = (mm / mmPerUnit - centerY) * zoom + viewH / 2;
    if (sy > H + 4) break;
    if (sy < -4) continue;

    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE - 6, sy + 0.5);
    ctx.lineTo(RULER_SIZE, sy + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.translate(RULER_SIZE / 2 - 2, sy - 1);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(mm)}`, 0, 0);
    ctx.restore();

    if (pxStep > 32) {
      const sub = pxStep > 80 ? 5 : 2;
      for (let j = 1; j < sub; j++) {
        const subSy = sy + (pxStep / sub) * j;
        if (subSy < 0 || subSy > H) continue;
        ctx.strokeStyle = "#aaa";
        ctx.beginPath();
        ctx.moveTo(RULER_SIZE - 3, subSy + 0.5);
        ctx.lineTo(RULER_SIZE, subSy + 0.5);
        ctx.stroke();
      }
    }
  }
}
