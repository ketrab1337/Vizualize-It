import { Download, Sparkles, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import type { AppUpdateState } from "../../hooks/useAppUpdate";

interface UpdateModalProps {
  state: AppUpdateState;
}

/**
 * Okno aktualizacji w stylu aplikacji — zastępuje surowy systemowy popup.
 * Pokazuje wersję, opis zmian (release notes) oraz pasek postępu pobierania.
 * Sterowane w całości przez useAppUpdate (state).
 */
export function UpdateModal({ state }: UpdateModalProps) {
  const { status, update, progress, error, install, restart, dismiss } = state;

  if (status === "idle" || !update) return null;

  const busy = status === "downloading" || status === "installing";
  const indeterminate = status === "downloading" && progress < 0;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="bg-[#1e1e1e] rounded-lg shadow-xl w-full max-w-md flex flex-col overflow-hidden">
        {/* Nagłówek z gradientem akcentującym */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800 bg-gradient-to-r from-indigo-950/60 to-transparent">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-white font-medium leading-tight">
              Dostępna aktualizacja
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Wersja {update.version}
              {update.currentVersion && (
                <span className="text-gray-600"> · obecnie {update.currentVersion}</span>
              )}
            </p>
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Release notes */}
          {update.body && status === "available" && (
            <div className="max-h-48 overflow-y-auto rounded-md bg-[#161616] border border-gray-800 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">
                Co nowego
              </p>
              <p className="text-sm text-gray-300 whitespace-pre-line leading-relaxed">
                {update.body}
              </p>
            </div>
          )}

          {/* Pasek postępu pobierania / instalacji */}
          {busy && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {status === "downloading" ? "Pobieranie aktualizacji…" : "Instalowanie…"}
                </span>
                {status === "downloading" && !indeterminate && (
                  <span className="tabular-nums">{progress}%</span>
                )}
              </div>
              <div className="h-2 rounded-full bg-[#2a2a2a] overflow-hidden">
                <div
                  className={`h-full bg-indigo-500 transition-all duration-200 ${
                    indeterminate || status === "installing"
                      ? "w-1/3 animate-pulse"
                      : ""
                  }`}
                  style={
                    !indeterminate && status === "downloading"
                      ? { width: `${progress}%` }
                      : undefined
                  }
                />
              </div>
            </div>
          )}

          {/* Sukces — gotowe do restartu */}
          {status === "ready" && (
            <div className="flex items-start gap-2.5 rounded-md bg-green-950/40 border border-green-900 px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
              <p className="text-sm text-green-200">
                Aktualizacja zainstalowana. Zrestartuj aplikację, aby zacząć korzystać
                z nowej wersji.
              </p>
            </div>
          )}

          {/* Błąd */}
          {status === "error" && (
            <div className="flex items-start gap-2.5 rounded-md bg-red-950/40 border border-red-900 px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-200 break-words">
                Nie udało się zainstalować aktualizacji.
                {error && <span className="block text-red-300/70 mt-1 text-xs">{error}</span>}
              </p>
            </div>
          )}
        </div>

        {/* Stopka z akcjami */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800">
          {status === "available" && (
            <>
              <button
                onClick={dismiss}
                className="px-3 py-1.5 rounded text-sm text-gray-300 bg-[#2a2a2a] hover:bg-[#333] transition-colors"
              >
                Później
              </button>
              <button
                onClick={install}
                className="px-3 py-1.5 rounded text-sm text-white bg-indigo-600 hover:bg-indigo-500 flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Zainstaluj teraz
              </button>
            </>
          )}

          {busy && (
            <button
              disabled
              className="px-3 py-1.5 rounded text-sm text-gray-500 bg-[#2a2a2a] cursor-not-allowed"
            >
              Proszę czekać…
            </button>
          )}

          {status === "ready" && (
            <>
              <button
                onClick={dismiss}
                className="px-3 py-1.5 rounded text-sm text-gray-300 bg-[#2a2a2a] hover:bg-[#333] transition-colors"
              >
                Później
              </button>
              <button
                onClick={restart}
                className="px-3 py-1.5 rounded text-sm text-white bg-green-700 hover:bg-green-600 flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Zrestartuj teraz
              </button>
            </>
          )}

          {status === "error" && (
            <>
              <button
                onClick={dismiss}
                className="px-3 py-1.5 rounded text-sm text-gray-300 bg-[#2a2a2a] hover:bg-[#333] transition-colors"
              >
                Zamknij
              </button>
              <button
                onClick={install}
                className="px-3 py-1.5 rounded text-sm text-white bg-indigo-600 hover:bg-indigo-500 flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Spróbuj ponownie
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
