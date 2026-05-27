import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Bookmark, BookmarkCheck, Loader2, Settings, Sparkles } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { useGenerationStore } from "../../stores/generationStore";
import { useKeysStore } from "../../stores/keysStore";
import { useGeneration } from "../../hooks/useGeneration";
import { useProject } from "../../hooks/useProject";
import { ProjectsGrid } from "./ProjectsGrid";
import { Canvas } from "../editor/Canvas";
import { ElementPanel } from "../editor/ElementPanel";
import { LedPanel } from "../generation/LedPanel";
import { ProductTypeSelector } from "../generation/ProductTypeSelector";
import { CameraAngleSection } from "../generation/CameraAngleSection";
import { PromptPanel } from "../generation/PromptPanel";
import { ReferenceImagesPanel } from "../generation/ReferenceImagesPanel";
import { PresetsKanban } from "../generation/PresetsKanban";
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
  const { saveEditorState, loadEditorState, saveGenerationState, loadGenerationState } = useProject();
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const isLoadingRef = useRef(false);
  const prevProjectIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref dla bieżącego projektu — odczytujemy w subskrypcji do generationStore bez
  // re-rejestrowania subskrypcji za każdą zmianą activeProjectId.
  const activeProjectIdRef = useRef<string | null>(activeProjectId);
  activeProjectIdRef.current = activeProjectId;

  // Przy zmianie projektu: zapisz poprzedni (await, żeby load widział świeże dane),
  // załaduj nowy. Pomijamy `!isLoadingRef.current` w warunku save'a — gdy user szybko
  // przeskakuje między projektami, lepiej zapisać niż zostawić nieuratowane.
  useEffect(() => {
    const prevId = prevProjectIdRef.current;
    prevProjectIdRef.current = activeProjectId;

    let cancelled = false;
    const run = async () => {
      if (prevId && prevId !== activeProjectId) {
        if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
        if (genSaveTimerRef.current) { clearTimeout(genSaveTimerRef.current); genSaveTimerRef.current = null; }
        await Promise.all([saveEditorState(prevId), saveGenerationState(prevId)]);
      }
      if (cancelled) return;
      if (activeProjectId) {
        isLoadingRef.current = true;
        try {
          await Promise.all([
            loadEditorState(activeProjectId),
            loadGenerationState(activeProjectId),
          ]);
        } finally {
          isLoadingRef.current = false;
        }
      }
    };

    run();
    return () => { cancelled = true; };
  }, [activeProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-zapis edytora po edycji (debounce 1.5s)
  useEffect(() => {
    if (!activeProjectId || isLoadingRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!isLoadingRef.current && activeProjectId) saveEditorState(activeProjectId);
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [svgContent, nodeOverrides, backgroundPath, activeProjectId, saveEditorState]);

  // Auto-zapis stanu generowania — subskrybujemy się BEZPOŚREDNIO do zustandowego
  // store, omijając ścieżkę React deps. Wczesna wersja używała useEffect z deps
  // [generationState.X...] i okazywała się niestabilna: czasem cleanup czyścił
  // timer zanim zdążył wystrzelić, a save-on-switch też wpadał w racing z load.
  useEffect(() => {
    const scheduleSave = () => {
      if (isLoadingRef.current) return;
      const pid = activeProjectIdRef.current;
      if (!pid) return;
      if (genSaveTimerRef.current) clearTimeout(genSaveTimerRef.current);
      genSaveTimerRef.current = setTimeout(() => {
        const fpid = activeProjectIdRef.current;
        if (!isLoadingRef.current && fpid) {
          saveGenerationState(fpid);
        }
      }, 1500);
    };

    const unsub = useGenerationStore.subscribe((state, prev) => {
      if (
        state.prompt === prev.prompt &&
        state.activePresetIds === prev.activePresetIds &&
        state.referenceImages === prev.referenceImages &&
        state.led === prev.led &&
        state.camera === prev.camera &&
        state.cameraDirty === prev.cameraDirty &&
        state.model === prev.model &&
        state.format === prev.format &&
        state.count === prev.count &&
        state.timeOfDay === prev.timeOfDay &&
        state.timeOfDayTextOverride === prev.timeOfDayTextOverride &&
        state.timeOfDayAnchor === prev.timeOfDayAnchor
      ) {
        return;
      }
      scheduleSave();
    });

    return () => {
      unsub();
      if (genSaveTimerRef.current) clearTimeout(genSaveTimerRef.current);
    };
  }, [saveGenerationState]);

  // Save on window close (Tauri close button / Ctrl+Q). Tauri nie wysyła
  // beforeunload, ale w runtime tauri jest to OK — używamy zwykłego beforeunload
  // który webview emituje przy zamykaniu / odświeżaniu (dev).
  useEffect(() => {
    const handler = () => {
      const pid = activeProjectIdRef.current;
      if (!pid) return;
      // Synchronous fire-and-forget — JS nie ma czasu czekać, polegamy na tym, że
      // Tauri SQL plugin queue zostanie zapisany przed zamknięciem procesu.
      saveEditorState(pid);
      saveGenerationState(pid);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveEditorState, saveGenerationState]);

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
        <span className="ml-1 text-gray-400 text-xs shrink-0">
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
          zachowuje pozycje elementów po przejściu do Generowania / Galerii.
          KLUCZOWE: key={activeProject.id} wymusza pełny remount przy zmianie projektu —
          bez tego historyRef, paper.project i refy stanu wyciekają między projektami
          (np. po dodaniu SVG w nowym projekcie pojawiała się zawartość z poprzedniego). */}
      <div className={`flex flex-1 overflow-hidden ${activeTab !== "edytor" ? "hidden" : ""}`}>
        <Canvas key={activeProject.id} project={activeProject} />
        <ElementPanel />
      </div>

      {/* Zakładka: Generowanie — 3 kolumny (środowisko | prompt | presety) */}
      {activeTab === "generowanie" && (
        <div className="tab-fade flex flex-col flex-1 overflow-hidden">
          <ApiKeysBanner onOpenSettings={onOpenSettings} />

          <div className="flex flex-1 overflow-hidden">
            {/* Kolumna lewa: typ produktu / model AI / LED / kamera */}
            <div className="w-80 shrink-0 border-r border-gray-800 overflow-y-auto p-4 space-y-4">
              <ProductTypeSelector />
              <LedPanel />
              <ModelSelector />
              <CameraAngleSection />
            </div>

            {/* Kolumna środkowa: prompt → zdjęcia referencyjne → przyciski (szablony + generuj) */}
            <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
              <PromptPanel />
              <ReferenceImagesPanel />

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

            {/* Kolumna prawa: środowisko (nad presetami) + presety */}
            <div className="w-72 shrink-0 border-l border-gray-800 p-4 flex flex-col gap-4 overflow-hidden">
              <div className="shrink-0">
                <TimeOfDayPanel />
              </div>
              <PresetsKanban />
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
