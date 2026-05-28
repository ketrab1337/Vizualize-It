import { ReactNode, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

// ── ZoomableImage — scroll=zoom do kursora, drag=pan ─────────────────────────
// Jeden stan { scale, tx, ty } aktualizowany atomowo (CLAUDE.md zabrania rozdzielania).
// Wyprowadzenie: punkt pod kursorem (cx, cy względem środka kontenera) musi
// pozostać nieruchomy po zmianie skali f = next/prev:
//   tx_new = cx*(1-f) + tx_old*f
//
// Wcześniej zduplikowany w ImageGrid.tsx i CompareModal.tsx — tu jedno źródło prawdy,
// a oba miejsca konfigurują wygląd przez propsy (containerClassName / loader / badgePos).

interface ZoomableImageProps {
  src: string | undefined;
  /** Klasy kontenera obrazu (tło, padding, rounding). */
  containerClassName?: string;
  /** Klasy samego <img>. */
  imgClassName?: string;
  /** Niestandardowy loader gdy src jest pusty. Domyślnie Loader2 z lucide. */
  loader?: ReactNode;
  /** Pozycja badge'a z zoomem (Tailwind classes typu `bottom-3 right-3`). */
  badgePosClassName?: string;
  /** Opcjonalny outer wrapper (np. dla CompareModal flex-col flex-1 min-h-0). */
  wrapClassName?: string;
}

export function ZoomableImage({
  src,
  containerClassName = "flex-1 overflow-hidden flex items-center justify-center bg-[#111111] p-4",
  imgClassName = "max-w-full max-h-full object-contain rounded",
  loader,
  badgePosClassName = "bottom-3 right-3",
  wrapClassName,
}: ZoomableImageProps) {
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const step = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((prev) => {
        const next = Math.max(1, Math.min(8, prev.scale * step));
        if (next === 1) return { scale: 1, tx: 0, ty: 0 };
        const f = next / prev.scale;
        return { scale: next, tx: cx * (1 - f) + prev.tx * f, ty: cy * (1 - f) + prev.ty * f };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function handleMouseDown(e: React.MouseEvent) {
    if (view.scale <= 1) return;
    e.preventDefault();
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    setView((prev) => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
  }

  function handleMouseUp() {
    dragRef.current.active = false;
  }

  function handleReset() {
    setView({ scale: 1, tx: 0, ty: 0 });
  }

  const isZoomed = view.scale > 1.01;

  const inner = (
    <div
      ref={containerRef}
      className={`${containerClassName} relative select-none ${
        isZoomed ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      }`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className={imgClassName}
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            transformOrigin: "50% 50%",
            willChange: "transform",
          }}
          draggable={false}
        />
      ) : (
        loader ?? <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
      )}

      {isZoomed && (
        <div className={`absolute ${badgePosClassName} flex items-center gap-1 bg-black/60 rounded px-2 py-1`}>
          <span className="text-white text-[11px] font-mono">{Math.round(view.scale * 100)}%</span>
          <button
            onClick={(e) => { e.stopPropagation(); handleReset(); }}
            className="text-gray-400 hover:text-white transition-colors ml-1"
            title="Resetuj zoom"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      )}

    </div>
  );

  if (wrapClassName) {
    return <div className={wrapClassName}>{inner}</div>;
  }
  return inner;
}
