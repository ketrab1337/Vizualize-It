import { X } from "lucide-react";
import { ZoomableImage } from "../ui/ZoomableImage";
import { modelLabel } from "../../lib/aiModelLabels";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import type { GalleryImage } from "../../hooks/useGallery";

interface CompareModalProps {
  images: GalleryImage[];
  dataUrls: Record<string, string>;
  onClose: () => void;
}

// Lokalny inline-spinner używany przez CompareModal (różny od domyślnego Loader2
// z lucide w ZoomableImage — w czarnym tle modala wygląda lepiej cienki border).
const CompareSpinner = (
  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
);

// Konfiguracja stylów ZoomableImage dla CompareModal (mniejszy padding, niebieski tint, min-h).
const CompareZoom = ({ src }: { src: string | undefined }) => (
  <ZoomableImage
    src={src}
    wrapClassName="flex flex-col flex-1 min-h-0"
    containerClassName="flex-1 bg-[#1a1a1a] rounded-lg overflow-hidden flex items-center justify-center min-h-[60vh]"
    imgClassName="max-w-full max-h-full object-contain"
    badgePosClassName="bottom-2 right-2"
    loader={CompareSpinner}
  />
);

export function CompareModal({ images, dataUrls, onClose }: CompareModalProps) {
  useEscapeKey(true, onClose);
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
              <CompareZoom src={dataUrls[img.id]} />
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
