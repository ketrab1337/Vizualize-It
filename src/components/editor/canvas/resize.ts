import paper from "paper";

export type HandleType = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

export const HANDLE_PX = 8;

export const HANDLE_CURSORS: Record<HandleType, string> = {
  tl: "nw-resize", tc: "n-resize",  tr: "ne-resize",
  ml: "w-resize",                    mr: "e-resize",
  bl: "sw-resize", bc: "s-resize",  br: "se-resize",
};

export function computeResizeDelta(
  handle: HandleType,
  startBounds: paper.Rectangle,
  currentPoint: paper.Point,
  constrain = false,
): { sx: number; sy: number; pivot: paper.Point } {
  const b = startBounds;
  let pivot: paper.Point;
  let sx = 1;
  let sy = 1;

  switch (handle) {
    case "tl": pivot = b.bottomRight; break;
    case "tc": pivot = new paper.Point(b.center.x, b.bottom); break;
    case "tr": pivot = b.bottomLeft;  break;
    case "ml": pivot = new paper.Point(b.right,  b.center.y); break;
    case "mr": pivot = new paper.Point(b.left,   b.center.y); break;
    case "bl": pivot = b.topRight;    break;
    case "bc": pivot = new paper.Point(b.center.x, b.top); break;
    case "br": default: pivot = b.topLeft; break;
  }

  if (handle === "ml" || handle === "mr") {
    sx = Math.max(Math.abs(currentPoint.x - pivot.x) / b.width, 0.01);
  } else if (handle === "tc" || handle === "bc") {
    sy = Math.max(Math.abs(currentPoint.y - pivot.y) / b.height, 0.01);
  } else {
    sx = Math.max(Math.abs(currentPoint.x - pivot.x) / b.width,  0.01);
    sy = Math.max(Math.abs(currentPoint.y - pivot.y) / b.height, 0.01);
    // Shift: zachowaj proporcje — użyj większego współczynnika dla obu osi
    if (constrain) {
      const s = Math.max(sx, sy);
      sx = s;
      sy = s;
    }
  }

  return { sx, sy, pivot };
}
