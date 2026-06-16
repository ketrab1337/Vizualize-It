import { useEffect, useState } from "react";
import { Plus, ImageIcon, Trash2, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useBackgroundsStore } from "../../stores/backgroundsStore";
import { useToastStore } from "../../stores/toastStore";
import type { BackgroundItem } from "../../types";

// ── BackgroundCard ──────────────────────────────────────────────────────────────

interface BackgroundCardProps {
  item: BackgroundItem;
  thumbUrl: string | undefined;
  onDelete: (item: BackgroundItem) => void;
}

function BackgroundCard({ item, thumbUrl, onDelete }: BackgroundCardProps) {
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="group relative bg-[#1e1e1e] border border-gray-800 rounded-lg overflow-hidden">
      <div className="aspect-video bg-[#161616] flex items-center justify-center relative overflow-hidden">
        {thumbUrl ? (
          <img src={thumbUrl} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="w-8 h-8 text-gray-700" />
        )}

        {confirm ? (
          <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center gap-2">
            <span className="text-xs text-red-300">Usunąć tło?</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onDelete(item)}
                className="px-2.5 py-1 rounded text-xs bg-red-700 hover:bg-red-600 text-white transition-colors"
              >
                Usuń
              </button>
              <button
                onClick={() => setConfirm(false)}
                className="px-2.5 py-1 rounded text-xs text-gray-300 hover:text-white transition-colors"
              >
                Anuluj
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            className="absolute top-1.5 right-1.5 p-1 rounded bg-black/60 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Usuń tło"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-gray-200 text-xs font-medium truncate" title={item.name}>{item.name}</p>
      </div>
    </div>
  );
}

// ── BackgroundLibrary (główny komponent) ─────────────────────────────────────────

export function BackgroundLibrary() {
  const { backgrounds, thumbs, isLoading, refresh, addBackground, removeBackground } =
    useBackgroundsStore();
  const addToast = useToastStore((s) => s.addToast);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    refresh().catch((e) => addToast(`Błąd ładowania teł: ${e}`, "error"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd() {
    const filePath = await open({
      multiple: false,
      filters: [{ name: "Zdjęcia", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (!filePath || typeof filePath !== "string") return;
    setIsAdding(true);
    try {
      await addBackground(filePath);
      addToast("Tło dodane do biblioteki", "success");
    } catch (e) {
      addToast(`Błąd dodawania tła: ${e}`, "error");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDelete(item: BackgroundItem) {
    try {
      await removeBackground(item);
      addToast("Tło usunięte", "info");
    } catch (e) {
      addToast(`Błąd usuwania tła: ${e}`, "error");
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <div>
          <h2 className="text-white font-medium">Biblioteka teł</h2>
          <p className="text-gray-600 text-xs mt-0.5">
            {backgrounds.length} {backgrounds.length === 1 ? "tło" : "teł"}
          </p>
        </div>
        <button
          onClick={handleAdd}
          disabled={isAdding}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Dodaj tło
        </button>
      </div>

      {/* Siatka teł */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
          </div>
        ) : backgrounds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
            <ImageIcon className="w-8 h-8 text-gray-700" />
            <p className="text-gray-500 text-sm">Brak teł w bibliotece</p>
            <p className="text-gray-600 text-xs">Dodaj zdjęcia JPG/PNG, których użyjesz jako tło w edytorze.</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {backgrounds.map((item) => (
              <BackgroundCard
                key={item.id}
                item={item}
                thumbUrl={thumbs[item.id]}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
