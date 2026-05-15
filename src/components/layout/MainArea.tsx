import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Bookmark, BookmarkCheck, Loader2, Settings, Sparkles } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { useKeysStore } from "../../stores/keysStore";
import { useGeneration } from "../../hooks/useGeneration";
import { useProject } from "../../hooks/useProject";
import { ProjectsGrid } from "./ProjectsGrid";
import { Canvas } from "../editor/Canvas";
import { ElementPanel } from "../editor/ElementPanel";
import { LedPanel } from "../generation/LedPanel";
import { CameraAngleSection } from "../generation/CameraAngleSection";
import { PromptPanel } from "../generation/PromptPanel";
import { ModelSelector } from "../generation/ModelSelector";
import { TimeOfDayPanel } from "../generation/TimeOfDayPanel";
import { ImageGrid } from "../gallery/ImageGrid";
import { SaveTemplateModal } from "../generation/SaveTemplateModal";
import { ApplyTemplateModal } from "../generation/ApplyTemplateModal";

interface MainAreaProps {
  onNewProject: () => void;
  onOpenSettings: () => void;
}

// ---------------------------------------------------------------------------
// Banner ostrzegawczy — brak kluczy API
// ---------------------------------------------------------------------------
function ApiKeysBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { googleAiSet, openAiSet, loaded } = useKeysStore();
  if (!loaded || (googleAiSet && openAiSet)) return null;

  const missing: string[] = [];
  if (!googleAiSet) missing.push("Google AI (Nano Banana 2 / Pro)");
  if (!openAiSet) missing.push("OpenAI (GPT Image 2)");

  return (
    <div className="shrink-0 mx-4 mt-3 flex items-start gap-3 bg-amber-950/40 border border-amber-800/50 rounded-lg px-4 py-3">
      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-amber-300 font-medium">
          Brak kluczy API — generowanie niedostępne
        </p>
        <p className="text-xs text-amber-600 mt-0.5">
          Nie skonfigurowano: {missing.join(", ")}.
        </p>
      </div>
      <button
        onClick={onOpenSettings}
        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-amber-300 hover:text-white bg-amber-800/30 hover:bg-amber-700/40 transition-colors"
      >
        <Settings className="w-3 h-3" />
        Ustawienia
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function MainArea({ onNewProject, onOpenSettings }: MainAreaProps) {
  const { projects, activeProjectId, setActiveProject } = useProjectStore();
  const { activeTab, svgContent, nodeOverrides, backgroundPath } = useEditorStore();
  const { generate, generating } = useGeneration();
  const { saveEditorState, loadEditorState } = useProject();
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const isLoadingRef = useRef(false);
  const prevProjectIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Przy zmianie projektu: zapisz poprzedni (natychmiastowo), załaduj nowy
  useEffect(() => {
    const prevId = prevProjectIdRef.current;
    prevProjectIdRef.current = activeProjectId;

    if (prevId && prevId !== activeProjectId && !isLoadingRef.current) {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      saveEditorState(prevId);
    }

    if (activeProjectId) {
      isLoadingRef.current = true;
      loadEditorState(activeProjectId).finally(() => { isLoadingRef.current = false; });
    }
  }, [activeProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-zapis po edycji (debounce 1.5s)
  useEffect(() => {
    if (!activeProjectId || isLoadingRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!isLoadingRef.current && activeProjectId) saveEditorState(activeProjectId);
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [svgContent, nodeOverrides, backgroundPath, activeProjectId, saveEditorState]);

  if (!activeProject) {
    return <ProjectsGrid onNewProject={onNewProject} />;
  }

  return (
    <main className="flex-1 flex flex-col bg-[#0f0f0f] overflow-hidden">
      {/* Nagłówek projektu */}
      <header className="h-12 border-b border-gray-800 flex items-center px-3 shrink-0 bg-[#111111] gap-2">
        <button
          onClick={() => setActiveProject(null)}
          title="Wróć do listy projektów"
          className="shrink-0 p-1.5 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-white font-medium text-sm truncate">{activeProject.name}</h2>
        <span className="ml-1 text-gray-600 text-xs shrink-0">
          {(() => {
            const d = new Date(activeProject.updated_at);
            const day = d.toLocaleDateString("pl-PL", { day: "2-digit" });
            const month = d.toLocaleDateString("pl-PL", { month: "short" });
            const time = d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
            return `${day} ${month}, ${time}`;
          })()}
        </span>
      </header>

      {/* Edytor — zawsze zmontowany, ukryty gdy inna zakładka; dzięki temu Paper.js
          zachowuje pozycje elementów po przejściu do Generowania / Galerii. */}
      <div className={`flex flex-1 overflow-hidden ${activeTab !== "edytor" ? "hidden" : ""}`}>
        <Canvas project={activeProject} />
        <ElementPanel />
      </div>

      {/* Zakładka: Generowanie */}
      {activeTab === "generowanie" && (
        <div className="tab-fade flex flex-col flex-1 overflow-hidden">
          <ApiKeysBanner onOpenSettings={onOpenSettings} />

          <div className="flex flex-1 overflow-hidden">
            {/* Lewa kolumna — konfiguracja */}
            <div className="w-80 shrink-0 border-r border-gray-800 overflow-y-auto p-4 space-y-4">
              <TimeOfDayPanel />
              <LedPanel />
              <CameraAngleSection />
              <ModelSelector />
            </div>

            {/* Prawa kolumna — podgląd promptu + generuj */}
            <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
              <PromptPanel />
              {generating && (
                <div className="shrink-0 h-1 rounded-full bg-blue-950 overflow-hidden relative mx-0.5">
                  <div className="progress-shimmer absolute inset-y-0 left-0 right-0 bg-blue-600 rounded-full" />
                </div>
              )}
              <div className="shrink-0 flex gap-2">
                <button
                  onClick={() => setApplyTemplateOpen(true)}
                  title="Wczytaj zapisany szablon konfiguracji"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-gray-200 bg-[#1a1a1a] hover:bg-[#222] border border-gray-800 hover:border-gray-700 transition-colors"
                >
                  <BookmarkCheck className="w-3.5 h-3.5" />
                  Wybierz szablon
                </button>
                <button
                  onClick={() => setSaveTemplateOpen(true)}
                  title="Zapisz bieżącą konfigurację LED, model i format jako szablon"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-gray-200 bg-[#1a1a1a] hover:bg-[#222] border border-gray-800 hover:border-gray-700 transition-colors"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  Zapisz jako szablon
                </button>
                <button
                  onClick={generate}
                  disabled={generating}
                  className={`flex-1 py-3 rounded-lg text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                    generating
                      ? "bg-blue-800 opacity-70 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-500"
                  }`}
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generowanie…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generuj wizualizację
                    </>
                  )}
                </button>
              </div>
            </div>

            <SaveTemplateModal
              open={saveTemplateOpen}
              onClose={() => setSaveTemplateOpen(false)}
            />
            <ApplyTemplateModal
              open={applyTemplateOpen}
              onClose={() => setApplyTemplateOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Zakładka: Galeria */}
      {activeTab === "galeria" && (
        <div className="tab-fade flex flex-col flex-1 overflow-hidden">
          <ImageGrid projectId={activeProject.id} />
        </div>
      )}
    </main>
  );
}
