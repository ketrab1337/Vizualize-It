import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Globalny boundary łapiący niezhandlowane wyjątki render'u Reacta.
 * Bez tego pojedynczy throw w którymkolwiek komponencie powodował biały ekran.
 * Tu pokazujemy komunikat z opcją reloadu — użytkownik nie traci sesji systemowej.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Logujemy do konsoli dev — w Tauri Windows production console nie jest widoczna,
    // ale przy ręcznym devtools (F12) developer może zobaczyć stack.
    console.error("Niezłapany wyjątek React:", error, info.componentStack);
  }

  handleReload = () => {
    // Najprościej: full reload window. Zachowuje SQLite/keyring, traci stan in-memory.
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0f0f0f] text-gray-200 p-8">
        <div className="max-w-lg bg-[#1e1e1e] rounded-lg border border-gray-800 p-6 shadow-xl">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-white font-medium text-lg mb-1">Coś poszło nie tak</h2>
              <p className="text-sm text-gray-400">
                Aplikacja napotkała niespodziewany błąd. Możesz spróbować odświeżyć widok —
                Twoje projekty są bezpiecznie zapisane w bazie.
              </p>
            </div>
          </div>
          <pre className="text-xs text-red-300 bg-black/40 rounded p-3 overflow-auto max-h-40 mb-4 whitespace-pre-wrap break-words">
            {this.state.error.message || String(this.state.error)}
          </pre>
          <button
            onClick={this.handleReload}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Odśwież aplikację
          </button>
        </div>
      </div>
    );
  }
}
