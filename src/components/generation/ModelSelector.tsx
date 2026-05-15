import { useGenerationStore } from "../../stores/generationStore";
import type { AiModel, ImageFormat } from "../../types";

const MODELS: { id: AiModel; label: string; desc: string; disabled?: boolean }[] = [
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    desc: "Szybki, dobra jakość",
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    desc: "Wyższa jakość, wolniejszy",
  },
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    desc: "OpenAI GPT Image 2",
  },
];

const FORMATS: { id: ImageFormat; label: string }[] = [
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "1:1", label: "1:1" },
  { id: "3:4", label: "3:4" },
  { id: "9:16", label: "9:16" },
];

const COUNTS = [1, 2, 3, 4] as const;

export function ModelSelector() {
  const { model, format, count, batchMode, setModel, setFormat, setCount, setBatchMode } =
    useGenerationStore();

  return (
    <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-5">
      <h3 className="text-sm font-semibold text-gray-100 uppercase tracking-wide">
        Model AI
      </h3>

      {/* Wybór modelu */}
      <div className="space-y-2">
        {MODELS.map((m) => (
          <label
            key={m.id}
            className={`flex items-start gap-3 p-2.5 rounded-md cursor-pointer transition-colors ${
              m.disabled
                ? "opacity-40 cursor-not-allowed"
                : model === m.id
                ? "bg-blue-900/30 border border-blue-700/50"
                : "hover:bg-[#222] border border-transparent"
            }`}
          >
            <input
              type="radio"
              name="ai-model"
              value={m.id}
              checked={model === m.id}
              disabled={m.disabled}
              onChange={() => setModel(m.id)}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <p className="text-sm text-gray-200 leading-tight">{m.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Tryb batch */}
      <div className="border-t border-gray-800 pt-4 flex items-center justify-between">
        <p className="text-sm text-gray-200">Tryb batch</p>
        <label className="relative cursor-pointer shrink-0">
          <input
            type="checkbox"
            className="sr-only"
            checked={batchMode}
            onChange={(e) => setBatchMode(e.target.checked)}
          />
          <div
            className={`w-10 h-5 rounded-full transition-colors ${
              batchMode ? "bg-blue-600" : "bg-gray-700"
            }`}
          />
          <div
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              batchMode ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </label>
      </div>

      {/* Format obrazu */}
      <div>
        <p className="text-xs text-gray-400 font-medium mb-2">Format obrazu</p>
        <div className="flex gap-1 flex-wrap">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFormat(f.id)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                format === f.id
                  ? "bg-blue-600 text-white"
                  : "bg-[#222] text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Liczba obrazów */}
      <div>
        <p className="text-xs text-gray-400 font-medium mb-2">Liczba obrazów</p>
        <div className="flex gap-1">
          {COUNTS.map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`w-9 h-8 rounded text-sm font-medium transition-colors ${
                count === n
                  ? "bg-blue-600 text-white"
                  : "bg-[#222] text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a]"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
