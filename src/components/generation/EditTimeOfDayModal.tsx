import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Modal } from "../ui/Modal";
import type { TimeOfDay } from "../../types";

interface EditTimeOfDayModalProps {
  open: boolean;
  optionId: TimeOfDay | null;
  optionLabel: string;
  /** Tekst auto-generowany przez assembler dla tej opcji + bieżącego kontekstu. */
  autoText: string;
  /** Aktualnie zapisany override (null = brak = tryb auto). */
  currentOverride: string | null;
  onClose: () => void;
  onSave: (text: string | null) => void;
}

export function EditTimeOfDayModal({
  open,
  optionLabel,
  autoText,
  currentOverride,
  onClose,
  onSave,
}: EditTimeOfDayModalProps) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) {
      setText(currentOverride ?? autoText);
    }
  }, [open, currentOverride, autoText]);

  function handleSave() {
    const trimmed = text.trim();
    // Jeśli tekst identyczny z auto lub pusty — usuń override
    onSave(trimmed === "" || trimmed === autoText.trim() ? null : trimmed);
    onClose();
  }

  function handleReset() {
    setText(autoText);
  }

  const isModified = text.trim() !== autoText.trim() && text.trim() !== "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edytuj środowisko — ${optionLabel}`}
      size="md"
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          Tekst trafia do promptu jako opis warunków oświetleniowych i otoczenia.
          Zostaw bez zmian lub wyczyść żeby użyć tekstu automatycznego.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full bg-[#111] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none leading-relaxed"
        />

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={handleReset}
            disabled={text === autoText}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Przywróć automatyczny
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-[#222] border border-gray-700 transition-colors"
            >
              Anuluj
            </button>
            <button
              onClick={handleSave}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                isModified
                  ? "bg-blue-600 hover:bg-blue-500 text-white"
                  : "bg-[#222] text-gray-400 hover:text-gray-200 border border-gray-700"
              }`}
            >
              {isModified ? "Zapisz" : "OK"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
