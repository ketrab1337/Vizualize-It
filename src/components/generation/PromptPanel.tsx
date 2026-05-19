import { RotateCcw, PenLine } from "lucide-react";
import { useGenerationStore } from "../../stores/generationStore";
import { useAssembledPrompt } from "../../hooks/useAssembledPrompt";

/**
 * Pojedyncze pole promptu — łączy w sobie automatycznie złożoną część (materiały,
 * LED, kamera, tło, presety) i swobodny tekst od użytkownika. Dopóki użytkownik
 * nie zedytuje treści, pole aktualizuje się na żywo z konfiguracją panelu po lewej.
 * Pierwsza edycja "zamraża" treść do override (przycisk „Resetuj do automatu"
 * wraca do trybu auto).
 */
export function PromptPanel() {
  const { prompt, setPrompt } = useGenerationStore();
  const autoPrompt = useAssembledPrompt();

  const isOverride = prompt !== null;
  const value = isOverride ? prompt : autoPrompt;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-1.5">
      <div className="flex items-center justify-between shrink-0">
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Prompt
        </label>

        <div className="flex items-center gap-1.5">
          {isOverride ? (
            <button
              onClick={() => setPrompt(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors"
              title="Wróć do trybu automatycznego — prompt znowu będzie się aktualizował z konfiguracją"
            >
              <RotateCcw className="w-3 h-3" />
              Resetuj do automatu
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
              <PenLine className="w-3 h-3" />
              Tryb automatyczny — zacznij pisać, by przejąć kontrolę
            </span>
          )}
        </div>
      </div>

      <textarea
        value={value}
        onChange={(e) => setPrompt(e.target.value)}
        spellCheck={false}
        className={`flex-1 min-h-0 w-full rounded-md px-3 py-2.5 text-xs font-mono leading-relaxed resize-none focus:outline-none transition-colors ${
          isOverride
            ? "bg-[#111] border border-blue-600 text-gray-200 focus:border-blue-400"
            : "bg-[#111] border border-gray-800 text-gray-300 focus:border-gray-600"
        }`}
        placeholder="Edytuj prompt lub dodaj własne wskazówki…"
      />

      {isOverride && (
        <p className="shrink-0 text-[10px] text-amber-600/80">
          ⚠ Tryb ręcznej edycji — zmiany materiałów, LED, kamery, środowiska i presetów
          NIE są już automatycznie wczytywane. Kliknij „Resetuj do automatu", by wrócić.
        </p>
      )}
    </div>
  );
}
