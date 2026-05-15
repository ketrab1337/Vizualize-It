import { Upload, Loader2, Download, ImageIcon, X } from "lucide-react";

interface CanvasToolbarProps {
  hasSvg: boolean;
  isImportingSvg: boolean;
  isImportingBg: boolean;
  backgroundDataUrl: string | null;
  backgroundFilename: string;
  onImportSvg: () => void;
  onExportSvg: () => void;
  onImportBackground: () => void;
  onRemoveBackground: () => void;
}

export function CanvasToolbar({
  hasSvg, isImportingSvg, isImportingBg,
  backgroundDataUrl, backgroundFilename,
  onImportSvg, onExportSvg, onImportBackground, onRemoveBackground,
}: CanvasToolbarProps) {
  return (
    <div className="h-10 bg-[#1a1a1a] border-b border-gray-800 flex items-center gap-1 px-3 shrink-0 flex-wrap">
      <button
        onClick={onImportSvg}
        disabled={isImportingSvg}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-gray-300 bg-[#252525] hover:bg-[#2e2e2e] border border-gray-700 hover:border-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isImportingSvg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        Importuj SVG
      </button>

      {hasSvg && (
        <button
          onClick={onExportSvg}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-gray-300 bg-[#252525] hover:bg-[#2e2e2e] border border-gray-700 hover:border-gray-600 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Eksportuj SVG
        </button>
      )}

      <div className="h-5 w-px bg-gray-800 mx-1" />

      {!backgroundDataUrl ? (
        <button
          onClick={onImportBackground}
          disabled={isImportingBg}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-gray-300 bg-[#252525] hover:bg-[#2e2e2e] border border-gray-700 hover:border-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isImportingBg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
          Dodaj tło
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-950/40 border border-blue-900/50">
          <ImageIcon className="w-3 h-3 text-blue-400 shrink-0" />
          <span className="text-xs text-blue-300 max-w-[140px] truncate" title={backgroundFilename}>
            {backgroundFilename}
          </span>
          <button
            onClick={onRemoveBackground}
            className="p-0.5 rounded text-blue-500 hover:text-red-400 transition-colors"
            title="Usuń tło"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
