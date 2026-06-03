import { useCallback, useEffect, useState, type PointerEvent, type RefObject } from "react";
import type { PerspectiveCorners } from "../../../types";

interface Props {
  /** Znormalizowane narożniki (0..1) względem wymiarów obrazu tła. */
  corners: PerspectiveCorners;
  /** Referencja do `<img>` tła — potrzebna do `naturalWidth/Height` (object-fit: cover). */
  bgRef: RefObject<HTMLImageElement | null>;
  /** Referencja do containera (overlay pozycjonowany absolutnie nad nim). */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Live update podczas dragowania (tylko stan UI). */
  onChange: (corners: PerspectiveCorners) => void;
  /** Po zwolnieniu — odpalany do persystencji w DB. */
  onCommit: (corners: PerspectiveCorners) => void;
}

const HANDLE_SIZE = 14;
const COLORS = ["#FF6B6B", "#4ECDC4", "#FFE66D", "#A78BFA"] as const;

/**
 * Overlay z 4 draggable handlami nad tłem — wskazujący 4 narożniki ściany.
 * Pozycje znormalizowane do wymiarów tła (object-fit: cover w containerze).
 *
 * Konwersja: bgWidth/Height (natural) × scale (cover) + offset → pozycje px.
 * Identyczna logika jak `captureCanvas` — gwarantuje że narożniki w UI lądują
 * tam, gdzie warp ich użyje w finalnym obrazie wysyłanym do AI.
 */
export function PerspectiveOverlay({ corners, bgRef, containerRef, onChange, onCommit }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  // Wymuszamy rerender przy resize containera (handles przeskalowują się z nim)
  const [, forceTick] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => forceTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const bg = bgRef.current;
  const container = containerRef.current;
  if (!bg || !container || !bg.complete || bg.naturalWidth === 0) return null;

  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const iw = bg.naturalWidth;
  const ih = bg.naturalHeight;
  const scale = Math.max(cw / iw, ch / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  /** Normalized (0..1 względem BG) → pixel w container. */
  const toPx = (n: [number, number]): [number, number] => [
    dx + n[0] * dw,
    dy + n[1] * dh,
  ];
  /** Pixel w container → normalized (0..1 względem BG), clamped. */
  const toNorm = (px: number, py: number): [number, number] => {
    const nx = (px - dx) / dw;
    const ny = (py - dy) / dh;
    return [Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny))];
  };

  const pxCorners = corners.map(toPx) as [
    [number, number],
    [number, number],
    [number, number],
    [number, number]
  ];

  const handlePointerDown = (idx: number) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(idx);
  };

  const handlePointerMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (dragging == null) return;
      const rect = container.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const newNorm = toNorm(px, py);
      const next = corners.map((c, i) => (i === dragging ? newNorm : c)) as PerspectiveCorners;
      onChange(next);
    },
    // toNorm zależy od dx/dy/dw/dh które się zmieniają — używamy snapshotu z aktualnego renderu
    [dragging, corners, onChange, container, dx, dy, dw, dh] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging == null) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    setDragging(null);
    onCommit(corners);
  };

  const quadPath =
    `M ${pxCorners[0][0]} ${pxCorners[0][1]} ` +
    `L ${pxCorners[1][0]} ${pxCorners[1][1]} ` +
    `L ${pxCorners[2][0]} ${pxCorners[2][1]} ` +
    `L ${pxCorners[3][0]} ${pxCorners[3][1]} Z`;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={cw}
      height={ch}
      style={{ zIndex: 15 }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Półprzezroczyste wypełnienie quadu — pokazuje płaszczyznę ściany */}
      <path
        d={quadPath}
        fill="rgba(251, 191, 36, 0.08)"
        stroke="rgba(251, 191, 36, 0.9)"
        strokeWidth={2}
        strokeDasharray="6 4"
      />
      {/* 4 handle — kółka z border, każde inny kolor dla orientacji */}
      {pxCorners.map(([x, y], i) => (
        <g key={i}>
          <circle
            cx={x}
            cy={y}
            r={HANDLE_SIZE / 2 + 4}
            fill="rgba(0,0,0,0.4)"
            className="pointer-events-none"
          />
          <circle
            cx={x}
            cy={y}
            r={HANDLE_SIZE / 2}
            fill={COLORS[i]}
            stroke="white"
            strokeWidth={2}
            className="pointer-events-auto cursor-grab"
            style={{ cursor: dragging === i ? "grabbing" : "grab" }}
            onPointerDown={handlePointerDown(i)}
          />
        </g>
      ))}
      {/* Etykiety narożników — TL, TR, BR, BL */}
      {(["TL", "TR", "BR", "BL"] as const).map((label, i) => (
        <text
          key={label}
          x={pxCorners[i][0]}
          y={pxCorners[i][1] - HANDLE_SIZE - 4}
          fill="white"
          stroke="rgba(0,0,0,0.7)"
          strokeWidth={3}
          paintOrder="stroke fill"
          fontSize="11"
          fontWeight="600"
          textAnchor="middle"
          className="pointer-events-none select-none"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}
