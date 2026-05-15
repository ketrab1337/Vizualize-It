import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, CheckCircle, XCircle, Loader2, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useToastStore } from "../../stores/toastStore";
import { useKeysStore } from "../../stores/keysStore";

// ---------------------------------------------------------------------------
// Per-key field state
// ---------------------------------------------------------------------------
type TestStatus = "idle" | "loading" | "ok" | "error";

interface KeyFieldState {
  value: string;
  visible: boolean;
  saving: boolean;
  testStatus: TestStatus;
  testMsg: string;
  isSet: boolean; // whether a key exists in keyring
}

function makeEmpty(): KeyFieldState {
  return { value: "", visible: false, saving: false, testStatus: "idle", testMsg: "", isSet: false };
}

// ---------------------------------------------------------------------------
// Sub-component: one API key field
// ---------------------------------------------------------------------------
interface KeyFieldProps {
  label: string;
  description: string;
  state: KeyFieldState;
  onChange: (value: string) => void;
  onToggleVisible: () => void;
  onSave: () => void;
  onDelete: () => void;
  onTest: () => void;
}

function KeyField({
  label,
  description,
  state,
  onChange,
  onToggleVisible,
  onSave,
  onDelete,
  onTest,
}: KeyFieldProps) {
  const { value, visible, saving, testStatus, testMsg, isSet } = state;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="bg-[#1a1a1a] rounded-lg p-5 space-y-4">
      {/* Header */}
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-gray-100">{label}</h3>
        <p className="text-xs text-gray-500">{description}</p>
      </div>

      {/* Status pill */}
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            isSet ? "bg-green-500" : "bg-gray-600"
          }`}
        />
        <span className={`text-xs ${isSet ? "text-green-400" : "text-gray-500"}`}>
          {isSet ? "Klucz ustawiony" : "Klucz nie ustawiony"}
        </span>
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type={visible ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={isSet ? "••••••••••••••••••••" : "Wklej klucz API…"}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-[#111] border border-gray-700 rounded-md pl-3 pr-10 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono transition-colors"
          />
          <button
            onClick={onToggleVisible}
            title={visible ? "Ukryj klucz" : "Pokaż klucz"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 transition-colors"
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <button
          onClick={onSave}
          disabled={saving || !value.trim()}
          className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Zapisz"}
        </button>

        {isSet && (
          <button
            onClick={onDelete}
            title="Usuń klucz"
            className="px-2.5 py-2 rounded-md text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Test connection */}
      <div className="flex items-center gap-3">
        <button
          onClick={onTest}
          disabled={!isSet || testStatus === "loading"}
          className="px-3 py-1.5 rounded text-xs font-medium bg-[#252525] hover:bg-[#2e2e2e] disabled:opacity-40 disabled:cursor-not-allowed text-gray-300 transition-colors"
        >
          {testStatus === "loading" ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Testowanie…
            </span>
          ) : (
            "Testuj połączenie"
          )}
        </button>

        {testStatus === "ok" && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle className="w-3.5 h-3.5" />
            Połączenie OK
          </span>
        )}
        {testStatus === "error" && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <XCircle className="w-3.5 h-3.5" />
            <span className="max-w-[280px] truncate" title={testMsg}>
              {testMsg}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ApiKeys() {
  const { addToast } = useToastStore();
  const { refreshKeys } = useKeysStore();

  const [google, setGoogle] = useState<KeyFieldState>(makeEmpty());
  const [openai, setOpenai] = useState<KeyFieldState>(makeEmpty());

  // Sprawdzamy tylko czy klucz jest ustawiony — wartość zostaje w keyring, nie w stanie React
  useEffect(() => {
    (async () => {
      const [gSet, oSet] = await Promise.all([
        invoke<boolean>("test_api_key", { account: "google_ai" }).catch(() => false),
        invoke<boolean>("test_api_key", { account: "openai" }).catch(() => false),
      ]);
      setGoogle((s) => ({ ...s, isSet: gSet }));
      setOpenai((s) => ({ ...s, isSet: oSet }));
    })();
  }, []);

  // ── Google AI ──────────────────────────────────────────────────────────
  async function saveGoogle() {
    const key = google.value.trim();
    if (!key) return;
    setGoogle((s) => ({ ...s, saving: true }));
    try {
      await invoke("set_api_key", { account: "google_ai", key });
      setGoogle((s) => ({ ...s, saving: false, isSet: true, testStatus: "idle" }));
      await refreshKeys();
      addToast("Klucz Google AI zapisany.", "success");
    } catch (e) {
      setGoogle((s) => ({ ...s, saving: false }));
      addToast(String(e), "error");
    }
  }

  async function deleteGoogle() {
    try {
      await invoke("delete_api_key", { account: "google_ai" });
      setGoogle({ ...makeEmpty() });
      await refreshKeys();
      addToast("Klucz Google AI usunięty.", "info");
    } catch (e) {
      addToast(String(e), "error");
    }
  }

  async function testGoogle() {
    setGoogle((s) => ({ ...s, testStatus: "loading", testMsg: "" }));
    try {
      await invoke("test_google_ai_connection");
      setGoogle((s) => ({ ...s, testStatus: "ok", testMsg: "" }));
    } catch (e) {
      setGoogle((s) => ({ ...s, testStatus: "error", testMsg: String(e) }));
    }
  }

  // ── OpenAI ────────────────────────────────────────────────────────────
  async function saveOpenAi() {
    const key = openai.value.trim();
    if (!key) return;
    setOpenai((s) => ({ ...s, saving: true }));
    try {
      await invoke("set_api_key", { account: "openai", key });
      setOpenai((s) => ({ ...s, saving: false, isSet: true, testStatus: "idle" }));
      await refreshKeys();
      addToast("Klucz OpenAI zapisany.", "success");
    } catch (e) {
      setOpenai((s) => ({ ...s, saving: false }));
      addToast(String(e), "error");
    }
  }

  async function deleteOpenAi() {
    try {
      await invoke("delete_api_key", { account: "openai" });
      setOpenai({ ...makeEmpty() });
      await refreshKeys();
      addToast("Klucz OpenAI usunięty.", "info");
    } catch (e) {
      addToast(String(e), "error");
    }
  }

  async function testOpenAi() {
    setOpenai((s) => ({ ...s, testStatus: "loading", testMsg: "" }));
    try {
      await invoke("test_openai_connection");
      setOpenai((s) => ({ ...s, testStatus: "ok", testMsg: "" }));
    } catch (e) {
      setOpenai((s) => ({ ...s, testStatus: "error", testMsg: String(e) }));
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4 max-w-2xl">
      <div className="mb-2">
        <h2 className="text-base font-semibold text-gray-100">Klucze API</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Klucze są przechowywane wyłącznie w Windows Credential Manager — nie w bazie danych ani plikach.
        </p>
      </div>

      <KeyField
        label="Google AI API Key"
        description="Używany przez modele: Nano Banana 2 (gemini-3.1-flash-image), Nano Banana Pro (gemini-3-pro-image)"
        state={google}
        onChange={(v) => setGoogle((s) => ({ ...s, value: v }))}
        onToggleVisible={() => setGoogle((s) => ({ ...s, visible: !s.visible }))}
        onSave={saveGoogle}
        onDelete={deleteGoogle}
        onTest={testGoogle}
      />

      <KeyField
        label="OpenAI API Key"
        description="Używany przez model: GPT Image 2 (gpt-image-2). Wymaga weryfikacji organizacji w OpenAI Developer Console."
        state={openai}
        onChange={(v) => setOpenai((s) => ({ ...s, value: v }))}
        onToggleVisible={() => setOpenai((s) => ({ ...s, visible: !s.visible }))}
        onSave={saveOpenAi}
        onDelete={deleteOpenAi}
        onTest={testOpenAi}
      />
    </div>
  );
}
