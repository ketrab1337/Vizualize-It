import { useMemo } from "react";
import { ImagePlus, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useGenerationStore } from "../../stores/generationStore";
import { useEditorStore } from "../../stores/editorStore";
import { useMaterialsStore } from "../../stores/materialsStore";

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
  const {
    referenceImages,
    addReferenceImage,
    removeReferenceImage,
    setReferenceDescription,
  } = useGenerationStore();
  const { nodeOverrides, svgContent, backgroundDataUrl } = useEditorStore();
  const { materials } = useMaterialsStore();

  /**
   * Wylicza numer "Obraz N" pierwszego zdjęcia referencyjnego w prompcie.
   * Kolejność obrazów wysyłanych do AI:
   *   1. Kompozyt (tło + SVG) lub samo tło — jeśli jest
   *   2. Zdjęcia materiałów (deduplikowane per material_id)
   *   3. Zdjęcia referencyjne
   * Bez tej numeracji user nie wie którym "Obrazem N" w prompcie jest jego
   * referencja — istotne gdy chce pisać własny opis ("jak na Obrazie 5...").
   *
   * WAŻNE: używamy backgroundDataUrl (obraz w pamięci), nie backgroundPath
   * (ścieżka z bazy). useGeneration.ts sprawdza backgroundDataUrl — jeśli
   * używamy backgroundPath, numeracja rozjeżdża się gdy tło nie jest jeszcze
   * załadowane do pamięci (backgroundPath ustawiony, backgroundDataUrl null).
   */
  const firstRefImageIdx = useMemo(() => {
    const hasComposite = !!svgContent || !!backgroundDataUrl;
    const uniqueMaterialIds = new Set<string>();
    for (const ov of Object.values(nodeOverrides)) {
      if (ov.materialId) uniqueMaterialIds.add(ov.materialId);
    }
    const materialPhotoCount = [...uniqueMaterialIds].filter(
      (id) => materials.find((m) => m.id === id)?.photo_path
    ).length;
    return (hasComposite ? 1 : 0) + materialPhotoCount + 1;
  }, [svgContent, backgroundDataUrl, nodeOverrides, materials]);

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
        <div className="space-y-1.5">
          {referenceImages.map((img, i) => {
            const aiImageNumber = firstRefImageIdx + i;
            return (
              <div
                key={i}
                className="flex gap-2 items-start p-1.5 rounded bg-[#202020] border border-gray-800"
              >
                <div className="relative shrink-0">
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    title={img.name}
                    className="w-14 h-14 object-cover rounded border border-gray-700"
                  />
                  <div className="absolute -top-1.5 -left-1.5 px-1 py-0.5 rounded bg-blue-600 text-white text-[9px] font-bold leading-none shadow">
                    Obraz {aiImageNumber}
                  </div>
                  <button
                    onClick={() => removeReferenceImage(i)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-800 border border-gray-600 text-gray-400 hover:text-white flex items-center justify-center"
                    title="Usuń zdjęcie"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-500 truncate" title={img.name}>
                    {img.name}
                  </div>
                  <input
                    type="text"
                    value={img.description ?? ""}
                    onChange={(e) => setReferenceDescription(i, e.target.value)}
                    placeholder="Opis dla AI (np. inspiracja kolorystyczna, styl światła)"
                    className="mt-0.5 w-full bg-[#1a1a1a] border border-gray-700 text-gray-200 text-[10px] rounded px-1.5 py-1 focus:outline-none focus:border-blue-500 placeholder:text-gray-600"
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[10px] text-gray-400">
          Dodaj zdjęcia referencyjne, które AI uwzględni przy generowaniu.
        </p>
      )}
    </div>
  );
}
