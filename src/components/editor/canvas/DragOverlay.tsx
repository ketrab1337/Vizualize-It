import { Upload, ImageIcon } from "lucide-react";

export type DragOverKind = "svg" | "image" | "unknown";

interface DragOverlayProps {
  kind: DragOverKind;
}

export function DragOverlay({ kind }: DragOverlayProps) {
  return (
    <div
      className={`absolute inset-0 z-30 flex items-center justify-center pointer-events-none transition-colors ${
        kind === "unknown"
          ? "bg-red-900/20 border-2 border-dashed border-red-600"
          : "bg-blue-900/20 border-2 border-dashed border-blue-500"
      }`}
    >
      <div className="text-center select-none">
        {kind === "svg" && (
          <>
            <Upload className="w-10 h-10 text-blue-400 mx-auto mb-3" />
            <p className="text-blue-300 text-sm font-medium">Upuść plik SVG</p>
            <p className="text-blue-500 text-xs mt-1">Zaimportuje projekt do edytora</p>
          </>
        )}
        {kind === "image" && (
          <>
            <ImageIcon className="w-10 h-10 text-blue-400 mx-auto mb-3" />
            <p className="text-blue-300 text-sm font-medium">Upuść zdjęcie tła</p>
            <p className="text-blue-500 text-xs mt-1">JPG, PNG, WebP</p>
          </>
        )}
        {kind === "unknown" && (
          <>
            <Upload className="w-10 h-10 text-red-500 mx-auto mb-3" />
            <p className="text-red-400 text-sm font-medium">Nieobsługiwany format</p>
            <p className="text-red-600 text-xs mt-1">Obsługiwane: SVG, JPG, PNG, WebP</p>
          </>
        )}
      </div>
    </div>
  );
}
