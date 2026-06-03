/**
 * Bilinear warp: mapuje prostokąt źródłowy na czworokąt docelowy przez
 * subdivisions×subdivisions siatkę trójkątów, każdy rysowany z affine transform.
 *
 * Stosowane do warpowania front-on SVG na płaszczyznę ściany przed wysłaniem
 * do AI — model dostaje już skompozytowany obraz z szyldem osadzonym w
 * perspektywie ściany, a nie płaską nakładkę.
 *
 * UWAGA: To NIE jest poprawna projekcja perspektywiczna (homografia 3×3) —
 * używa interpolacji bilinearnej, która jest wizualnie podobna przy umiarkowanych
 * kątach (ściana fotografowana mniej-więcej od frontu). Dla mocno pochylonej
 * ściany (kąt > ~45°) bilinear daje subtelne zniekształcenie środka quadu,
 * ale dla typowego use-case (szyld na ścianie biurowej) różnica jest
 * pomijalna i mocno upraszcza implementację bez WebGL.
 */

export type Pt = [number, number];

/** 4 punkty docelowe — kolejność: TL, TR, BR, BL. */
export type Quad = [Pt, Pt, Pt, Pt];

/** Macierz homografii 3×3 (wiersz-major): [h11 h12 h13 h21 h22 h23 h31 h32 h33]. */
export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * Computuje homografię H taką, że H · src_i ≈ dst_i (w homogeneous coords).
 * Rozwiązuje 8 równań × 8 niewiadomych (h11..h32, przy założeniu h33=1).
 *
 * Zwraca null gdy punkty zdegenerowane (3+ kolinearne).
 */
export function computeHomography(src: Quad, dst: Quad): Mat3 | null {
  // Dla każdego punktu:
  //   dst.x = (h11·sx + h12·sy + h13) / (h31·sx + h32·sy + 1)
  //   dst.y = (h21·sx + h22·sy + h23) / (h31·sx + h32·sy + 1)
  // Przekształcamy do liniowej postaci → 2 równania na punkt × 4 punkty = 8 równań.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }
  const h = solveLinearSystem(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gauss-Jordan z partial pivoting — zwraca null przy macierzy osobliwej. */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    if (Math.abs(aug[maxRow][col]) < 1e-9) return null;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let c = col; c <= n; c++) {
        aug[row][c] -= factor * aug[col][c];
      }
    }
  }
  const x: number[] = new Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row][n];
    for (let col = row + 1; col < n; col++) {
      sum -= aug[row][col] * x[col];
    }
    x[row] = sum / aug[row][row];
  }
  return x;
}

/** Apply homografia H do punktu 2D. */
export function applyHomography(H: Mat3, pt: Pt): Pt {
  const [x, y] = pt;
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-9) return [x, y];
  return [
    (H[0] * x + H[1] * y + H[2]) / w,
    (H[3] * x + H[4] * y + H[5]) / w,
  ];
}

/**
 * Bilinear interpolation: punkt (u,v) ∈ [0,1] mapowany na quad.
 *   P(u,v) = (1-u)(1-v)*TL + u(1-v)*TR + u*v*BR + (1-u)*v*BL
 */
export function bilinearMap(u: number, v: number, quad: Quad): Pt {
  const [tl, tr, br, bl] = quad;
  const w00 = (1 - u) * (1 - v);
  const w10 = u * (1 - v);
  const w11 = u * v;
  const w01 = (1 - u) * v;
  return [
    w00 * tl[0] + w10 * tr[0] + w11 * br[0] + w01 * bl[0],
    w00 * tl[1] + w10 * tr[1] + w11 * br[1] + w01 * bl[1],
  ];
}

/**
 * Affine matrix [a, b, c, d, e, f] taka, że:
 *   a*sx + c*sy + e = dx
 *   b*sx + d*sy + f = dy
 * dla każdej z 3 par (s_i, d_i). Rozwiązanie 6 równań przez wyznaczniki.
 */
function affineFromTriangles(
  sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number,
  dx0: number, dy0: number, dx1: number, dy1: number, dx2: number, dy2: number
): [number, number, number, number, number, number] {
  const det = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
  if (Math.abs(det) < 1e-9) {
    // Trójkąt zdegenerowany (linia/punkt) — identyczność jako bezpieczny fallback
    return [1, 0, 0, 1, 0, 0];
  }
  const invDet = 1 / det;
  const a = ((dx1 - dx0) * (sy2 - sy0) - (dx2 - dx0) * (sy1 - sy0)) * invDet;
  const c = ((dx2 - dx0) * (sx1 - sx0) - (dx1 - dx0) * (sx2 - sx0)) * invDet;
  const b = ((dy1 - dy0) * (sy2 - sy0) - (dy2 - dy0) * (sy1 - sy0)) * invDet;
  const d = ((dy2 - dy0) * (sx1 - sx0) - (dy1 - dy0) * (sx2 - sx0)) * invDet;
  const e = dx0 - a * sx0 - c * sy0;
  const f = dy0 - b * sx0 - d * sy0;
  return [a, b, c, d, e, f];
}

/**
 * Warpuje fragment `src` (prostokąt `srcRect`) na czworokąt `dstQuad` rysując
 * na `targetCtx`. Dziali siatką `subdivisions`×`subdivisions` (każda komórka =
 * 2 trójkąty z affine setTransform + drawImage). Domyślne 30 daje ~1800 trójkątów —
 * gładki wynik dla typowych quadów, render <50ms.
 *
 * @param targetCtx kontekst do którego rysujemy (offscreen canvas kompozytu)
 * @param src źródło (canvas Paper.js z SVG)
 * @param srcRect prostokąt w `src`, który chcemy zmapować na quad
 * @param dstQuad 4 punkty w docelowym układzie współrzędnych (TL, TR, BR, BL)
 * @param subdivisions ilość komórek w jednym wymiarze
 */
export function warpCanvasToQuad(
  targetCtx: CanvasRenderingContext2D,
  src: HTMLCanvasElement | HTMLImageElement,
  srcRect: { x: number; y: number; w: number; h: number },
  dstQuad: Quad,
  subdivisions: number = 30
): void {
  const N = Math.max(2, subdivisions);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const u0 = i / N;
      const u1 = (i + 1) / N;
      const v0 = j / N;
      const v1 = (j + 1) / N;

      // Wierzchołki komórki w src (piksele)
      const sx0 = srcRect.x + u0 * srcRect.w;
      const sx1 = srcRect.x + u1 * srcRect.w;
      const sy0 = srcRect.y + v0 * srcRect.h;
      const sy1 = srcRect.y + v1 * srcRect.h;

      // Te same wierzchołki w dst (po bilinear na quadzie)
      const [px00, py00] = bilinearMap(u0, v0, dstQuad);
      const [px10, py10] = bilinearMap(u1, v0, dstQuad);
      const [px11, py11] = bilinearMap(u1, v1, dstQuad);
      const [px01, py01] = bilinearMap(u0, v1, dstQuad);

      // Trójkąt A: (00, 10, 11). Wierzchołki src ↔ dst.
      drawTriangle(
        targetCtx, src,
        sx0, sy0, sx1, sy0, sx1, sy1,
        px00, py00, px10, py10, px11, py11
      );
      // Trójkąt B: (00, 11, 01).
      drawTriangle(
        targetCtx, src,
        sx0, sy0, sx1, sy1, sx0, sy1,
        px00, py00, px11, py11, px01, py01
      );
    }
  }
}

/**
 * Computes the warped destination quad for a source rectangle, preserving the
 * source rectangle's SIZE in the output — only perspective rotation/shear is applied.
 *
 * Problem it solves: the standard approach (applyHomography to all 4 corners) scales
 * the sign proportionally with the wall quad size. If the user marks a large wall area
 * the sign shrinks; a small area → sign enlarges. Unintuitive when the user wants to
 * define only the perspective ANGLE, not the scale.
 *
 * Algorithm:
 *   1. Map source CENTER through H → correct wall position (wcx, wcy)
 *   2. Compute local Jacobian J of H at center
 *   3. Normalize J to remove scale factor (preserves rotation + shear only)
 *   4. Apply J_norm to corner offsets from center → size-preserved warped corners
 *
 * Fallback: if Jacobian is degenerate (|det| < ε), returns the standard H-warped quad.
 */
export function computeWarpedQuadSizePreserved(
  H: Mat3,
  sx0: number, sy0: number,
  sx1: number, sy1: number
): Quad {
  const scx = (sx0 + sx1) / 2;
  const scy = (sy0 + sy1) / 2;
  const [wcx, wcy] = applyHomography(H, [scx, scy]);

  // Denominator at center point
  const denom = H[6] * scx + H[7] * scy + H[8];

  // Jacobian of H at (scx, scy):
  //   ∂X/∂x = (h0 − X·h6) / denom   ∂X/∂y = (h1 − X·h7) / denom
  //   ∂Y/∂x = (h3 − Y·h6) / denom   ∂Y/∂y = (h4 − Y·h7) / denom
  const j00 = (H[0] - wcx * H[6]) / denom;
  const j01 = (H[1] - wcx * H[7]) / denom;
  const j10 = (H[3] - wcy * H[6]) / denom;
  const j11 = (H[4] - wcy * H[7]) / denom;

  const det = j00 * j11 - j01 * j10;
  const s = Math.sqrt(Math.abs(det));

  if (s < 1e-9) {
    // Degenerate Jacobian — fall back to standard homography warp
    return [
      applyHomography(H, [sx0, sy0]),
      applyHomography(H, [sx1, sy0]),
      applyHomography(H, [sx1, sy1]),
      applyHomography(H, [sx0, sy1]),
    ];
  }

  // Scale-normalized Jacobian: preserves rotation + shear, removes global scale
  const j00n = j00 / s;
  const j01n = j01 / s;
  const j10n = j10 / s;
  const j11n = j11 / s;

  const hw = (sx1 - sx0) / 2;
  const hh = (sy1 - sy0) / 2;

  const applyJnorm = (dx: number, dy: number): Pt => [
    wcx + j00n * dx + j01n * dy,
    wcy + j10n * dx + j11n * dy,
  ];

  return [
    applyJnorm(-hw, -hh),  // TL
    applyJnorm(hw,  -hh),  // TR
    applyJnorm(hw,   hh),  // BR
    applyJnorm(-hw,  hh),  // BL
  ];
}

/** Rysuje pojedynczy trójkąt z `src` na `ctx` przez affine + clip. */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement | HTMLImageElement,
  sx0: number, sy0: number,
  sx1: number, sy1: number,
  sx2: number, sy2: number,
  dx0: number, dy0: number,
  dx1: number, dy1: number,
  dx2: number, dy2: number
): void {
  const [a, b, c, d, e, f] = affineFromTriangles(
    sx0, sy0, sx1, sy1, sx2, sy2,
    dx0, dy0, dx1, dy1, dx2, dy2
  );
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();
  // setTransform: ctx jest już w "world coords" (offscreen canvas). Stosujemy
  // affine + drawImage(src, 0, 0) — pixel (sx,sy) z src ląduje w (a*sx+c*sy+e, b*sx+d*sy+f).
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}
