import { useEffect, useState, useCallback } from "react";
import { Trash2, BookmarkCheck, Loader2, Pencil } from "lucide-react";
import { useTemplates, type TemplateConfig } from "../../hooks/useTemplates";
import { useGenerationStore } from "../../stores/generationStore";
import { useToastStore } from "../../stores/toastStore";
import { Modal } from "../ui/Modal";
import { SaveTemplateModal } from "../generation/SaveTemplateModal";
import type { Template } from "../../types";

export function Templates() {
  const { loadTemplates, deleteTemplate } = useTemplates();
  const { setLedBacklit, setLedFrontlit, setModel, setFormat } = useGenerationStore();
  const { addToast } = useToastStore();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await loadTemplates());
    } finally {
      setLoading(false);
    }
  }, [loadTemplates]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteTemplate(confirmDeleteId);
      setTemplates((prev) => prev.filter((t) => t.id !== confirmDeleteId));
      addToast("Szablon usunięty.", "success");
    } catch {
      addToast("Nie udało się usunąć szablonu.", "error");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }

  function handleApply(template: Template) {
    try {
      const config: TemplateConfig = JSON.parse(template.config_json);
      setLedBacklit(config.led.backlit);
      setLedFrontlit(config.led.frontlit);
      setModel(config.model);
      setFormat(config.format);
      addToast(`Zastosowano szablon „${template.name}".`, "success");
    } catch {
      addToast("Nie udało się wczytać konfiguracji szablonu.", "error");
    }
  }

  const confirmTarget = templates.find((t) => t.id === confirmDeleteId);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-100 uppercase tracking-wide">
            Zapisane szablony
          </h3>
          <span className="text-xs text-gray-600">
            Szablony zapisujesz w zakładce Generowanie
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookmarkCheck className="w-10 h-10 text-gray-700 mb-3" />
            <p className="text-sm text-gray-500">Brak zapisanych szablonów</p>
            <p className="text-xs text-gray-700 mt-1">
              W zakładce Generowanie kliknij „Zapisz jako szablon".
            </p>
          </div>
        ) : (
          <div className="space-y-2">
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
                  className="flex items-center gap-3 bg-[#1a1a1a] border border-gray-800 rounded-lg px-4 py-3 hover:border-gray-700 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200 truncate">
                      {template.name}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {new Date(template.created_at).toLocaleDateString("pl-PL", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {config && (
                        <span className="ml-2 text-gray-700">
                          · {modelLabel(config.model)} · {config.format}
                          {config.led.backlit.enabled && " · Backlit"}
                          {config.led.frontlit.enabled && " · Front-lit"}
                        </span>
                      )}
                    </p>
                  </div>

                  <button
                    onClick={() => handleApply(template)}
                    className="shrink-0 px-3 py-1.5 rounded text-xs font-medium bg-blue-700/30 text-blue-300 hover:bg-blue-600/40 hover:text-blue-200 transition-colors"
                  >
                    Zastosuj
                  </button>

                  <button
                    onClick={() => setEditTemplate(template)}
                    className="shrink-0 p-1.5 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                    title="Edytuj szablon"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => setConfirmDeleteId(template.id)}
                    className="shrink-0 p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-red-950/30 transition-colors"
                    title="Usuń szablon"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal edycji szablonu */}
      <SaveTemplateModal
        open={!!editTemplate}
        onClose={() => { setEditTemplate(null); refresh(); }}
        editId={editTemplate?.id}
        defaultName={editTemplate?.name}
      />

      {/* Modal potwierdzenia usunięcia */}
      <Modal
        title="Usuń szablon"
        open={!!confirmDeleteId}
        onClose={() => !deleting && setConfirmDeleteId(null)}
      >
        <p className="text-sm text-gray-300 mb-6">
          Czy na pewno chcesz usunąć szablon{" "}
          <span className="font-medium text-white">„{confirmTarget?.name}"</span>?
          Operacja jest nieodwracalna.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setConfirmDeleteId(null)}
            disabled={deleting}
            className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 rounded-md text-sm font-medium bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Usuń
          </button>
        </div>
      </Modal>
    </div>
  );
}

function modelLabel(model: string): string {
  switch (model) {
    case "nano-banana-2":   return "NB2";
    case "nano-banana-pro": return "NB Pro";
    case "gpt-image-2":     return "GPT-4o";
    default:                return model;
  }
}
