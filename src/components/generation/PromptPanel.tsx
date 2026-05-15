import { useMemo, useEffect, useState } from "react";
import { RotateCcw, RefreshCw, PenLine, ImagePlus, X, Plus, Pencil, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useEditorStore } from "../../stores/editorStore";
import { useGenerationStore } from "../../stores/generationStore";
import { useMaterialsStore } from "../../stores/materialsStore";
import { usePromptPresets, type PromptPreset } from "../../hooks/usePromptPresets";
import { assemblePrompt } from "../../lib/promptAssembler";
import { buildElements } from "../../lib/buildElements";
import { PresetEditorModal } from "./PresetEditorModal";
import type { SignConfig } from "../../types";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function PromptPanel() {
  const { nodeOverrides, backgroundPath } = useEditorStore();
  const { materials } = useMaterialsStore();
  const {
    led,
    camera,
    cameraDirty,
    userPrompt,
    promptOverride,
    timeOfDay,
    referenceImages,
    activePresets,
    setUserPrompt,
    setPromptOverride,
    addReferenceImage,
    removeReferenceImage,
    togglePreset,
  } = useGenerationStore();

  const { presets, loadPresets, createPreset, updatePreset, deletePreset } = usePromptPresets();
  useEffect(() => { loadPresets(); }, [loadPresets]);

  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [presetEditing, setPresetEditing] = useState<PromptPreset | null>(null);

  function handleAddPreset() {
    setPresetEditing(null);
    setPresetModalOpen(true);
  }

  function handleEditPreset(preset: PromptPreset) {
    setPresetEditing(preset);
    setPresetModalOpen(true);
  }

  async function handleDeletePreset(preset: PromptPreset) {
    if (!confirm(`Usunąć preset „${preset.label}"?`)) return;
    await deletePreset(preset.id);
  }

  async function handleSubmitPreset(label: string, text: string, description: string): Promise<boolean> {
    if (presetEditing) {
      return updatePreset(presetEditing.id, label, text, description);
    }
    return createPreset(label, text, description);
  }

  async function handleAddReferenceImage() {
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

  const signConfig: SignConfig = useMemo(() => {
    const elements = buildElements(nodeOverrides, materials);
    return {
      elements,
      hasDistances: elements.some((el) => el.hasDistances),
      distanceMaterial: elements.find((el) => el.hasDistances)?.material ?? null,
      led,
      camera,
      background: backgroundPath ?? null,
      timeOfDay,
    };
  }, [nodeOverrides, materials, led, camera, backgroundPath, timeOfDay]);

  // Auto-assembled prompt — recomputes live when any input changes.
  // Presety dolatują jako część assembled promptu, żeby były widoczne w podglądzie.
  // User prompt (free text) zostaje osobno.
  const autoPrompt = useMemo(() => {
    const presetTexts = activePresets.map((p) => p.text).filter(Boolean);
    return assemblePrompt(signConfig, undefined, { cameraDirty, presetTexts });
  }, [signConfig, cameraDirty, activePresets]);

  // true when user has manually overridden the full prompt
  const isEditing = promptOverride !== null;

  const previewValue = isEditing ? promptOverride : autoPrompt;

  function handleEdit() {
    // Seed the override with the current auto prompt so the user starts from it
    setPromptOverride(autoPrompt);
  }

  function handleReset() {
    setPromptOverride(null);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {/* ── Twój prompt + Presety (2 kolumny) ───────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        {/* Lewa: prompt */}
        <div className="col-span-2 space-y-1.5">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Twój prompt
          </label>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="Dodatkowe wskazówki dla AI… (np. wieczór, deszcz, neon na cegle)"
            rows={5}
            className="w-full bg-[#111] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-gray-500 transition-colors"
          />
        </div>

        {/* Prawa: presety z CRUD */}
        <div className="col-span-1 space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Presety
            </label>
            <button
              onClick={handleAddPreset}
              title="Dodaj nowy preset"
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors"
            >
              <Plus className="w-3 h-3" />
              Dodaj
            </button>
          </div>
          <div
            className="bg-[#111] border border-gray-700 rounded-md p-1.5 overflow-y-auto"
            style={{ height: "calc(5 * 1.5rem + 1rem)" }}
          >
            {presets.length === 0 && (
              <p className="text-[10px] text-gray-600 text-center py-2">
                Brak presetów. Kliknij „Dodaj".
              </p>
            )}
            {presets.map((preset) => {
              const isActive = activePresets.some((p) => p.id === preset.id);
              return (
                <div
                  key={preset.id}
                  className={`group flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-colors ${
                    isActive ? "bg-blue-600/20" : "hover:bg-[#1a1a1a]"
                  }`}
                >
                  <button
                    onClick={() => togglePreset({ id: preset.id, text: preset.text })}
                    title={preset.description ?? preset.text}
                    className={`flex-1 text-left truncate ${
                      isActive ? "text-blue-300 font-medium" : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {preset.label}
                  </button>
                  <button
                    onClick={() => handleEditPreset(preset)}
                    title="Edytuj preset"
                    className="shrink-0 p-0.5 text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDeletePreset(preset)}
                    title="Usuń preset"
                    className="shrink-0 p-0.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Zdjęcia referencyjne ────────────────────────────────────────── */}
      <div className="shrink-0 space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Zdjęcia referencyjne
          </label>
          <button
            onClick={handleAddReferenceImage}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors"
          >
            <ImagePlus className="w-3 h-3" />
            Dodaj zdjęcie
          </button>
        </div>
        {referenceImages.length > 0 && (
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
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {referenceImages.length === 0 && (
          <p className="text-[10px] text-gray-700">
            Dodaj zdjęcia referencyjne, które AI uwzględni przy generowaniu.
          </p>
        )}
      </div>

      {/* ── Podgląd pełnego promptu ──────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 gap-1.5">
        <div className="flex items-center justify-between shrink-0">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Podgląd pełnego promptu
          </label>

          <div className="flex items-center gap-1.5">
            {isEditing && (
              <>
                <button
                  onClick={() => setPromptOverride(autoPrompt)}
                  disabled={promptOverride === autoPrompt}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-[#2a2a2a]"
                  title="Załaduj aktualne ustawienia panelu (materiały, LED, kamera, środowisko) do edytowanego promptu"
                >
                  <RefreshCw className="w-3 h-3" />
                  Synchronizuj
                </button>
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors"
                  title="Wyłącz tryb ręcznej edycji i wróć do automatu"
                >
                  <RotateCcw className="w-3 h-3" />
                  Wróć do automatu
                </button>
              </>
            )}
            {!isEditing && (
              <button
                onClick={handleEdit}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors"
                title="Odblokuj prompt do ręcznej edycji"
              >
                <PenLine className="w-3 h-3" />
                Edytuj prompt
              </button>
            )}
          </div>
        </div>

        <textarea
          value={previewValue}
          readOnly={!isEditing}
          onChange={(e) => setPromptOverride(e.target.value)}
          spellCheck={false}
          className={`flex-1 min-h-0 w-full rounded-md px-3 py-2.5 text-xs font-mono leading-relaxed resize-none focus:outline-none transition-colors ${
            isEditing
              ? "bg-[#111] border border-blue-600 text-gray-200 focus:border-blue-400"
              : "bg-[#0d0d0d] border border-gray-800 text-gray-500 cursor-default select-text"
          }`}
        />

        {isEditing && (
          <p className="shrink-0 text-[10px] text-amber-600/80">
            ⚠ Tryb ręcznej edycji — zmiany materiałów/LED/kamery/środowiska NIE są automatycznie wczytywane. Kliknij „Synchronizuj" aby wczytać aktualne ustawienia, lub „Wróć do automatu" aby wyjść z trybu edycji.
          </p>
        )}

        {!isEditing && (
          <p className="shrink-0 text-[10px] text-gray-700">
            Aktualizuje się automatycznie. Kliknij „Edytuj prompt" aby zmodyfikować przed wysłaniem.
          </p>
        )}
      </div>

      <PresetEditorModal
        open={presetModalOpen}
        preset={presetEditing}
        onClose={() => setPresetModalOpen(false)}
        onSubmit={handleSubmitPreset}
      />
    </div>
  );
}
