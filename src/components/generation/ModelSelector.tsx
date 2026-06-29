import { useGenerationStore } from "../../stores/generationStore";
import { useSettingsStore, type GptImageQuality } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import type { AiModel } from "../../types";

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

const COUNTS = [1, 2, 3, 4] as const;

const QUALITY_OPTIONS: { value: GptImageQuality; label: string }[] = [
  { value: "low", label: "Niska" },
  { value: "medium", label: "Średnia" },
  { value: "high", label: "Wysoka" },
];

export function ModelSelector() {
  const { model, count, batchMode, setModel, setCount, setBatchMode } =
    useGenerationStore();
  const {
    gptImageQuality,
    nanoBananaTemperature,
    setGptImageQuality,
    setNanoBananaTemperature,
  } = useSettingsStore();
  const { projects, activeProjectId } = useProjectStore();
  // Format wyjściowy = proporcja canvasu projektu (źródło prawdy w edytorze).
  const aspect = projects.find((p) => p.id === activeProjectId)?.aspect_ratio ?? "1:1";
  const isNanoBanana = model === "nano-banana-2" || model === "nano-banana-pro";

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
              <p className="text-xs text-gray-400 mt-0.5">{m.desc}</p>
            </div>
          </label>
        ))}
      </div>


      {/* Jakość gpt-image-2 (zależna od modelu) */}
      {model === "gpt-image-2" && (
        <div className="border-t border-gray-800 pt-4">
          <p className="text-xs text-gray-400 font-medium mb-2">Jakość (wpływa na koszt)</p>
          <div className="flex gap-1">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={q.value}
                onClick={() => void setGptImageQuality(q.value)}
                className={`flex-1 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  gptImageQuality === q.value
                    ? "bg-blue-600 text-white"
                    : "bg-[#222] text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a]"
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
            Wyższa jakość = więcej detali, ale wyższy koszt (Wysoka ≈ ~4× Średnia).
          </p>
        </div>
      )}

      {/* Temperatura Nano Banana (zależna od modelu) */}
      {isNanoBanana && (
        <div className="border-t border-gray-800 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400 font-medium">Temperatura</p>
            <span className="text-xs text-gray-300 tabular-nums">
              {nanoBananaTemperature.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={nanoBananaTemperature}
            onChange={(e) => void setNanoBananaTemperature(Number.parseFloat(e.target.value))}
            className="w-full accent-blue-500"
          />
          <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
            Niższa = stabilniej i wierniej (mniej mutacji tekstu na szyldzie). Wyższa = więcej
            wariancji.
          </p>
        </div>
      )}

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

      {/* Format obrazu — wynika z proporcji canvasu (zmieniana w edytorze) */}
      <div>
        <p className="text-xs text-gray-400 font-medium mb-2">Format obrazu</p>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded text-xs font-medium bg-blue-600/20 text-blue-300 border border-blue-700/40">
            {aspect}
          </span>
          <span className="text-[11px] text-gray-500">
            wynika z proporcji canvasu — zmień w edytorze
          </span>
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
