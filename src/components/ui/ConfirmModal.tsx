import { Trash2 } from "lucide-react";

interface ConfirmModalProps {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ open, message, onConfirm, onCancel }: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#1e1e1e] rounded-lg shadow-xl w-full max-w-sm p-5 flex flex-col gap-4">
        <p className="text-gray-200 text-sm">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm text-gray-300 bg-[#2a2a2a] hover:bg-[#333] transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded text-sm text-white bg-red-700 hover:bg-red-600 flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Usuń
          </button>
        </div>
      </div>
    </div>
  );
}
