import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import type { PromptPreset } from "../../hooks/usePromptPresets";

interface PresetEditorModalProps {
  open: boolean;
  preset: PromptPreset | null; // null = nowy preset
  onClose: () => void;
  onSubmit: (label: string, text: string, description: string) => Promise<boolean>;
}

export function PresetEditorModal({ open, preset, onClose, onSubmit }: PresetEditorModalProps) {
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLabel(preset?.label ?? "");
      setText(preset?.text ?? "");
      setDescription(preset?.description ?? "");
      setSaving(false);
    }
  }, [open, preset]);

  async function handleSave() {
    if (!label.trim() || !text.trim()) return;
    setSaving(true);
    const ok = await onSubmit(label, text, description);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={preset ? "Edytuj preset" : "Nowy preset"}
      size="md"
    >
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Nazwa
          </label>
          <input
            type="text"
            value={label}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            placeholder="np. Widok nocny"
            className="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Opis (opcjonalnie)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Krótki opis pokazywany w tooltipie"
            className="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Tekst presetu
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Treść doklejana do promptu po włączeniu presetu…"
            rows={5}
            className="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !label.trim() || !text.trim()}
            className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
          >
            {saving ? "Zapisywanie…" : preset ? "Zapisz zmiany" : "Dodaj preset"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
