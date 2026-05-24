import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useGenerationStore } from "../../stores/generationStore";
import { usePromptPresets, type PromptPreset } from "../../hooks/usePromptPresets";
import { PresetEditorModal } from "./PresetEditorModal";
import { ConfirmModal } from "../ui/ConfirmModal";

/**
 * Lista presetów promptu w widoku kanban: każdy preset jako kafelek z nazwą i fragmentem
 * tekstu. Klik = toggle (aktywny preset doczepia się do assemblowanego promptu). Aktywne
 * presety per-projekt — patrz `generation_state_json` w migracji 014.
 */
export function PresetsKanban() {
  const { activePresetIds, togglePresetId } = useGenerationStore();
  const { presets, loadPresets, createPreset, updatePreset, deletePreset } = usePromptPresets();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PromptPreset | null>(null);
  const [confirmPreset, setConfirmPreset] = useState<PromptPreset | null>(null);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  function handleAdd() {
    setEditing(null);
    setModalOpen(true);
  }

  function handleEdit(e: React.MouseEvent, preset: PromptPreset) {
    e.stopPropagation();
    setEditing(preset);
    setModalOpen(true);
  }

  function handleDeleteClick(e: React.MouseEvent, preset: PromptPreset) {
    e.stopPropagation();
    setConfirmPreset(preset);
  }

  async function handleDeleteConfirm() {
    if (!confirmPreset) return;
    await deletePreset(confirmPreset.id);
    setConfirmPreset(null);
  }

  async function handleSubmit(label: string, text: string, description: string): Promise<boolean> {
    if (editing) {
      return updatePreset(editing.id, label, text, description);
    }
    return createPreset(label, text, description);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Presety
        </label>
        <button
          onClick={handleAdd}
          title="Dodaj nowy preset"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors"
        >
          <Plus className="w-3 h-3" />
          Dodaj
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto -mr-1 pr-1">
        {presets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-xs text-gray-400">Brak presetów</p>
            <p className="text-[10px] text-gray-500 mt-1">
              Kliknij „Dodaj" by utworzyć pierwszy.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {presets.map((preset) => {
              const isActive = activePresetIds.includes(preset.id);
              return (
                <button
                  key={preset.id}
                  onClick={() => togglePresetId(preset.id)}
                  title={isActive ? "Kliknij by usunąć z promptu" : "Kliknij by dodać do promptu"}
                  className={`group w-full text-left rounded-md border p-2.5 transition-colors cursor-pointer ${
                    isActive
                      ? "bg-blue-950/40 border-blue-700 hover:border-blue-600"
                      : "bg-[#1a1a1a] border-gray-800 hover:border-gray-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span
                      className={`text-xs font-medium truncate ${
                        isActive ? "text-blue-300" : "text-gray-200"
                      }`}
                    >
                      {preset.label}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <span
                        onClick={(e) => handleEdit(e, preset)}
                        title="Edytuj preset"
                        className="p-0.5 text-gray-500 hover:text-gray-300 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                      </span>
                      <span
                        onClick={(e) => handleDeleteClick(e, preset)}
                        title="Usuń preset"
                        className="p-0.5 text-gray-500 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                  <p
                    className={`text-[10px] leading-snug line-clamp-3 ${
                      isActive ? "text-blue-200/70" : "text-gray-400"
                    }`}
                  >
                    {preset.text}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <PresetEditorModal
        open={modalOpen}
        preset={editing}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        open={confirmPreset !== null}
        message={`Usunąć preset „${confirmPreset?.label}"?`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmPreset(null)}
      />
    </div>
  );
}
