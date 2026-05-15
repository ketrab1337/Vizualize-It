import { useEffect, useRef, useState } from "react";
import { X, RotateCcw } from "lucide-react";
import type { GalleryImage } from "../../hooks/useGallery";

interface CompareModalProps {
  images: GalleryImage[];
  dataUrls: Record<string, string>;
  onClose: () => void;
}

function modelLabel(model: string): string {
  if (model === "nano-banana-pro") return "Nano Banana Pro";
  if (model === "gpt-image-2") return "GPT Image 2";
  return "Nano Banana 2";
}

// ── ZoomableImage — scroll=zoom do kursora, drag=pan ─────────────────────────
// Jeden stan { scale, tx, ty } aktualizowany atomowo.
// Wyprowadzenie: punkt pod kursorem (cx, cy względem środka kontenera) musi
// pozostać nieruchomy po zmianie skali f = next/prev:
//   tx_new = cx*(1-f) + tx_old*f

function ZoomableImage({ src }: { src: string | undefined }) {
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

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        ref={containerRef}
        className={`flex-1 bg-[#1a1a1a] rounded-lg overflow-hidden flex items-center justify-center min-h-[60vh] relative select-none ${
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
            className="max-w-full max-h-full object-contain"
            style={{
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              transformOrigin: "50% 50%",
              willChange: "transform",
            }}
            draggable={false}
          />
        ) : (
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        )}

        {isZoomed && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 rounded px-2 py-1">
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

        {!isZoomed && src && (
          <div className="absolute bottom-2 right-2 text-[10px] text-gray-600 pointer-events-none">
            scroll — zoom · przeciągnij — przesuń
          </div>
        )}
      </div>
    </div>
  );
}

export function CompareModal({ images, dataUrls, onClose }: CompareModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white text-sm font-medium">
            Porównanie {images.length} obrazów
          </span>
          <span className="text-gray-600 text-xs">
            Scroll — zoom · przeciągnij — przesuń
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div
          className="grid gap-3 h-full"
          style={{ gridTemplateColumns: `repeat(${images.length}, minmax(0, 1fr))` }}
        >
          {images.map((img) => (
            <div key={img.id} className="flex flex-col gap-2 min-h-0">
              <ZoomableImage src={dataUrls[img.id]} />
              <div className="text-center pb-1 shrink-0">
                <p className="text-xs text-gray-400">{modelLabel(img.model)}</p>
                <p className="text-xs text-gray-600">
                  {new Date(img.created_at).toLocaleDateString("pl-PL")}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
