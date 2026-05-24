import { useEffect, useState } from "react";
import { BookmarkCheck, Loader2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { useTemplates, type TemplateConfig } from "../../hooks/useTemplates";
import { usePromptPresets } from "../../hooks/usePromptPresets";
import { useGenerationStore } from "../../stores/generationStore";
import { useToastStore } from "../../stores/toastStore";
import type { Template } from "../../types";

function modelLabel(model: string): string {
  switch (model) {
    case "nano-banana-2":   return "NB2";
    case "nano-banana-pro": return "NB Pro";
    case "gpt-image-2":     return "GPT-4o";
    default:                return model;
  }
}

interface ApplyTemplateModalProps {
  open: boolean;
  onClose: () => void;
}

export function ApplyTemplateModal({ open, onClose }: ApplyTemplateModalProps) {
  const { loadTemplates } = useTemplates();
  const { loadPresets } = usePromptPresets();
  const {
    setLedBacklit, setLedFrontlit, setModel, setFormat,
    togglePresetId, activePresetIds,
    setPrompt, setCamera, resetCamera, setTimeOfDay,
    setPresetAnchor, setPresetTextOverride,
  } = useGenerationStore();
  const addToast = useToastStore((s) => s.addToast);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadTemplates()
      .then(setTemplates)
      .finally(() => setLoading(false));
  }, [open, loadTemplates]);

  async function handleApply(template: Template) {
    try {
      const config: TemplateConfig = JSON.parse(template.config_json);
      setLedBacklit(config.led.backlit);
      setLedFrontlit(config.led.frontlit);
      setModel(config.model);
      setFormat(config.format);

      // Pora dnia (opcjonalna — stare szablony bez tego pola zachowają obecną wartość)
      if (config.timeOfDay !== undefined) {
        setTimeOfDay(config.timeOfDay);
      }

      // Kamera — gdy szablon ma `cameraDirty=true`, zastosuj setCamera (oznacza dirty
      // w storze). Inaczej resetCamera (default + dirty=false → assembler pominie kąt).
      if (config.camera && config.cameraDirty) {
        setCamera(config.camera);
      } else if (config.cameraDirty === false) {
        resetCamera();
      }

      // Presety: zsynchronizuj aktywne (zachowując kolejność z szablonu) + zastosuj
      // per-instancyjne anchory i overrides. Wszystko per template — nie merge'uje
      // z bieżącym stanem, tylko zastępuje.
      const targetActiveIds = config.activePresetIds ?? [];
      const allPresets = await loadPresets();
      const knownIds = new Set(allPresets.map((p) => p.id));
      // Wyczyść bieżące presety
      for (const id of [...activePresetIds]) togglePresetId(id);
      // Włącz presety z szablonu (zachowując kolejność z config)
      for (const id of targetActiveIds) {
        if (knownIds.has(id)) togglePresetId(id);
      }

      // Anchory presetów (gdzie wstawić w prompcie)
      if (config.presetAnchors) {
        for (const [presetId, anchor] of Object.entries(config.presetAnchors)) {
          if (knownIds.has(presetId)) setPresetAnchor(presetId, anchor);
        }
      }

      // Per-instancyjne edycje tekstu badge'ów
      if (config.presetTextOverrides) {
        for (const [presetId, text] of Object.entries(config.presetTextOverrides)) {
          if (knownIds.has(presetId)) setPresetTextOverride(presetId, text);
        }
      }

      // Override prompta (tryb ręcznej edycji)
      // null/undefined → tryb auto, string → manual edit text
      if (config.prompt !== undefined) {
        setPrompt(config.prompt);
      }

      addToast(`Zastosowano szablon „${template.name}".`, "success");
      onClose();
    } catch {
      addToast("Nie udało się wczytać konfiguracji szablonu.", "error");
    }
  }

  return (
    <Modal title="Wybierz szablon" open={open} onClose={onClose} size="md">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <BookmarkCheck className="w-8 h-8 text-gray-500 mb-3" />
          <p className="text-sm text-gray-300">Brak zapisanych szablonów</p>
          <p className="text-xs text-gray-400 mt-1">
            Kliknij „Zapisz jako szablon" żeby utworzyć pierwszy szablon.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {templates.map((template) => {
            let config: TemplateConfig | null = null;
            try {
              config = JSON.parse(template.config_json);
            } catch {
              // noop
            }
            return (
              <div
                key={template.id}
                className="flex items-center gap-3 bg-[#1a1a1a] border border-gray-800 rounded-lg px-3 py-2.5 hover:border-gray-700 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{template.name}</p>
                  {config && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {modelLabel(config.model)} · {config.format}
                      {config.led.backlit.enabled && " · Backlit"}
                      {config.led.frontlit.enabled && " · Front-lit"}
                      {config.prompt != null && " · własny prompt"}
                      {config.presetTextOverrides && Object.keys(config.presetTextOverrides).length > 0
                        && ` · ${Object.keys(config.presetTextOverrides).length} edycji presetów`}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleApply(template)}
                  className="shrink-0 px-3 py-1.5 rounded text-xs font-medium bg-blue-700/30 text-blue-300 hover:bg-blue-600/40 hover:text-blue-200 transition-colors"
                >
                  Zastosuj
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
