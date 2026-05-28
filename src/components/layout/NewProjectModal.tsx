import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useProject } from "../../hooks/useProject";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { createProject } = useProject();
  useEscapeKey(open, onClose);

  useEffect(() => {
    if (open) {
      setName("");
      setError("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  async function handleCreate() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Nazwa projektu musi mieć co najmniej 2 znaki.");
      return;
    }
    setLoading(true);
    setError("");
    const project = await createProject(trimmed);
    setLoading(false);
    if (project) onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
    // Escape jest też w useEscapeKey, ale tu zostaje na wypadek gdyby focus
    // był na inpucie i listener okna nie odpalił (rzadkie, ale defensywnie).
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#1e1e1e] rounded-lg shadow-xl w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="text-white font-medium">Nowy projekt</h2>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label htmlFor="new-project-name" className="block text-gray-400 text-xs mb-1.5">Nazwa projektu</label>
            <input
              ref={inputRef}
              id="new-project-name"
              name="project_name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              placeholder="np. Szyld restauracji Pod Lipami"
              className="w-full bg-[#111111] border border-gray-700 rounded-md px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
              disabled={loading}
            />
            {error && <p className="mt-1.5 text-red-400 text-xs">{error}</p>}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || name.trim().length < 2}
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Utwórz
          </button>
        </div>
      </div>
    </div>
  );
}
