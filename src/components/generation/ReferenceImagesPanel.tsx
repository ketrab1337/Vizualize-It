import { ImagePlus, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useGenerationStore } from "../../stores/generationStore";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Sekcja zdjęć referencyjnych dołączanych do żądania AI (osobno od zdjęć materiałów —
 * te dolatują automatycznie z biblioteki). Tutaj użytkownik dorzuca własne inspiracje.
 */
export function ReferenceImagesPanel() {
  const { referenceImages, addReferenceImage, removeReferenceImage } = useGenerationStore();

  async function handleAdd() {
    const path = await open({
      filters: [{ name: "Obrazy", extensions: ["jpg", "jpeg", "png", "webp"] }],
      multiple: false,
    });
    if (!path || Array.isArray(path)) return;
    const bytes = await readFile(path);
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const base64 = uint8ToBase64(bytes);
    const dataUrl = `data:${mime};base64,${base64}`;
    const name = path.split(/[\\/]/).pop() ?? path;
    addReferenceImage({ dataUrl, name });
  }

  return (
    <div className="shrink-0 space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Zdjęcia referencyjne
        </label>
        <button
          onClick={handleAdd}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors"
        >
          <ImagePlus className="w-3 h-3" />
          Dodaj zdjęcie
        </button>
      </div>

      {referenceImages.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {referenceImages.map((img, i) => (
            <div key={i} className="relative group">
              <img
                src={img.dataUrl}
                alt={img.name}
                title={img.name}
                className="w-14 h-14 object-cover rounded border border-gray-700"
              />
              <button
                onClick={() => removeReferenceImage(i)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-800 border border-gray-600 text-gray-400 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Usuń zdjęcie"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-gray-400">
          Dodaj zdjęcia referencyjne, które AI uwzględni przy generowaniu.
        </p>
      )}
    </div>
  );
}
