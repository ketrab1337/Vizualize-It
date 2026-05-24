import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { useTemplates } from "../../hooks/useTemplates";
import { useGenerationStore } from "../../stores/generationStore";
import { useToastStore } from "../../stores/toastStore";

interface SaveTemplateModalProps {
  open: boolean;
  onClose: () => void;
  /** Gdy podane — tryb edycji istniejącego szablonu */
  editId?: string;
  /** Nazwa pre-wypełniona (tryb edycji) */
  defaultName?: string;
}

export function SaveTemplateModal({ open, onClose, editId, defaultName }: SaveTemplateModalProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const { createTemplate, updateTemplate } = useTemplates();
  const {
    led, model, format, activePresetIds,
    prompt, presetAnchors, presetTextOverrides,
    camera, cameraDirty, timeOfDay,
  } = useGenerationStore();
  const { addToast } = useToastStore();

  useEffect(() => {
    if (open) setName(defaultName ?? "");
  }, [open, defaultName]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    // Pełniejszy snapshot — szablon zapisuje też prompt override, per-instancyjne
    // edycje badges, pozycje (anchors), kąt kamery i porę dnia. Wcześniej szablony
    // gubiły tę cześć — user wracał do template i tracił ręczne zmiany.
    const config = {
      led, model, format, activePresetIds,
      prompt, presetAnchors, presetTextOverrides,
      camera, cameraDirty, timeOfDay,
    };
    try {
      if (editId) {
        await updateTemplate(editId, trimmed, config);
        addToast(`Szablon „${trimmed}" zaktualizowany.`, "success");
      } else {
        await createTemplate(trimmed, config);
        addToast(`Szablon „${trimmed}" został zapisany.`, "success");
      }
      setName("");
      onClose();
    } catch {
      addToast("Nie udało się zapisać szablonu.", "error");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (saving) return;
    setName("");
    onClose();
  }

  return (
    <Modal
      title={editId ? "Edytuj szablon" : "Zapisz konfigurację jako szablon"}
      open={open}
      onClose={handleClose}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Nazwa szablonu
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="np. Neon biały backlit 16:9"
            autoFocus
            className="w-full bg-[#111] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <div className="bg-[#111] border border-gray-800 rounded-md px-3 py-2.5 space-y-1">
          <p className="text-xs text-gray-400 font-medium mb-1.5">Zapisywana konfiguracja:</p>
          <ConfigRow label="Model" value={modelLabel(model)} />
          <ConfigRow label="Format" value={format} />
          <ConfigRow
            label="Backlit"
            value={led.backlit.enabled ? `${led.backlit.colorName} (${led.backlit.color})` : "wyłączony"}
          />
          <ConfigRow
            label="Front-lit"
            value={led.frontlit.enabled ? `${led.frontlit.colorName} (${led.frontlit.color})` : "wyłączony"}
          />
          <ConfigRow label="Pora dnia" value={timeOfDay === "brak" ? "—" : timeOfDay} />
          <ConfigRow label="Kąt kamery" value={cameraDirty ? "zmieniony" : "domyślny"} />
          <ConfigRow
            label="Presety"
            value={
              activePresetIds.length === 0
                ? "brak"
                : `${activePresetIds.length} aktywne` +
                  (Object.keys(presetTextOverrides).length > 0
                    ? ` (${Object.keys(presetTextOverrides).length} z własnym tekstem)`
                    : "")
            }
          />
          <ConfigRow
            label="Prompt"
            value={prompt !== null ? "ręcznie edytowany (zapisany)" : "tryb automatyczny"}
          />
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {editId ? "Zaktualizuj szablon" : "Zapisz szablon"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-400 w-20 shrink-0">{label}</span>
      <span className="text-gray-300">{value}</span>
    </div>
  );
}

function modelLabel(model: string): string {
  switch (model) {
    case "nano-banana-2":   return "Nano Banana 2";
    case "nano-banana-pro": return "Nano Banana Pro";
    case "gpt-image-2":     return "GPT Image 2";
    default:                return model;
  }
}
