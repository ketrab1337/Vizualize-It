import { ZoomIn, ZoomOut, Maximize2, Hand } from "lucide-react";

interface ZoomWidgetProps {
  zoomLevel: number;
  zoomInput: string | null;
  setZoomInput: (val: string | null) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onZoomInputCommit: (raw: string) => void;
  panMode: boolean;
  onTogglePanMode: () => void;
}

export function ZoomWidget({
  zoomLevel, zoomInput, setZoomInput,
  onZoomIn, onZoomOut, onResetView, onZoomInputCommit,
  panMode, onTogglePanMode,
}: ZoomWidgetProps) {
  return (
    <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 bg-[#1e1e1e] border border-gray-700 rounded-lg shadow-lg px-2 py-1.5">
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={onTogglePanMode}
        title={panMode ? "Wyłącz tryb przesuwania" : "Tryb przesuwania (przeciąganie zamiast zaznaczania)"}
        className={`p-1 rounded transition-colors ${
          panMode
            ? "bg-blue-600 text-white hover:bg-blue-500"
            : "text-gray-400 hover:text-gray-200 hover:bg-[#252525]"
        }`}
      >
        <Hand className="w-4 h-4" />
      </button>
      <div className="w-px h-5 bg-gray-700" />
      <button onClick={onZoomOut} title="Oddal (Ctrl+scroll)" className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-[#252525] transition-colors">
        <ZoomOut className="w-4 h-4" />
      </button>
      {zoomInput !== null ? (
        <input
          autoFocus
          type="number"
          min={10}
          max={500}
          value={zoomInput}
          onChange={(e) => setZoomInput(e.target.value)}
          onBlur={(e) => onZoomInputCommit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onZoomInputCommit((e.target as HTMLInputElement).value);
            if (e.key === "Escape") setZoomInput(null);
          }}
          className="w-14 text-center text-sm bg-[#252525] border border-gray-600 rounded text-gray-200 outline-none focus:border-blue-500 tabular-nums py-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      ) : (
        <button
          onClick={() => setZoomInput(String(Math.round(zoomLevel * 100)))}
          title="Kliknij aby wpisać zoom"
          className="w-14 text-center text-sm text-gray-400 hover:text-gray-200 tabular-nums select-none cursor-text"
        >
          {Math.round(zoomLevel * 100)}%
        </button>
      )}
      <button onClick={onZoomIn} title="Przybliż (Ctrl+scroll)" className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-[#252525] transition-colors">
        <ZoomIn className="w-4 h-4" />
      </button>
      <button onMouseDown={e => e.preventDefault()} onClick={onResetView} title="Resetuj widok" className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-[#252525] transition-colors">
        <Maximize2 className="w-4 h-4" />
      </button>
    </div>
  );
}
