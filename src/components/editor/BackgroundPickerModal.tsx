import { useEffect } from "react";
import { ImageIcon, Loader2, X } from "lucide-react";
import { useBackgroundsStore } from "../../stores/backgroundsStore";
import { useToastStore } from "../../stores/toastStore";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import type { BackgroundItem } from "../../types";

interface BackgroundPickerModalProps {
  onClose: () => void;
  onSelect: (item: BackgroundItem) => void;
}

/**
 * Modal wyboru tła z globalnej biblioteki (Ustawienia → Biblioteka teł).
 * Po wyborze woła `onSelect(item)` — Canvas kopiuje plik do projektu i ustawia jako tło.
 */
export function BackgroundPickerModal({ onClose, onSelect }: BackgroundPickerModalProps) {
  const { backgrounds, thumbs, isLoading, refresh } = useBackgroundsStore();
  const addToast = useToastStore((s) => s.addToast);
  useEscapeKey(true, onClose);

  useEffect(() => {
    refresh().catch((e) => addToast(`Błąd ładowania teł: ${e}`, "error"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[#1e1e1e] rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <h2 className="text-white font-medium text-sm">Wybierz tło z biblioteki</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
            </div>
          ) : backgrounds.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
              <ImageIcon className="w-8 h-8 text-gray-700" />
              <p className="text-gray-500 text-sm">Biblioteka teł jest pusta</p>
              <p className="text-gray-600 text-xs">
                Dodaj tła w Ustawieniach → Biblioteka teł, a potem wybierz je tutaj.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {backgrounds.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelect(item)}
                  className="group relative bg-[#161616] border border-gray-800 rounded-lg overflow-hidden hover:border-blue-500 transition-colors text-left"
                >
                  <div className="aspect-video flex items-center justify-center overflow-hidden">
                    {thumbs[item.id] ? (
                      <img src={thumbs[item.id]} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-7 h-7 text-gray-700" />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-gray-200 text-xs font-medium truncate" title={item.name}>
                      {item.name}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
