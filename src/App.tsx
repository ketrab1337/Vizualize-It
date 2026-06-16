import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/layout/Sidebar";
import { MainArea } from "./components/layout/MainArea";
import { SettingsView } from "./components/settings/SettingsView";
import { NewProjectModal } from "./components/layout/NewProjectModal";
import { UpdateModal } from "./components/layout/UpdateModal";
import { ToastContainer } from "./components/ui/Toast";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { useProject } from "./hooks/useProject";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useKeysStore } from "./stores/keysStore";
import { useSettingsStore } from "./stores/settingsStore";

export function App() {
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { loadProjects } = useProject();
  const { refreshKeys } = useKeysStore();
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const updateState = useAppUpdate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F12") invoke("open_devtools").catch(() => {});
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    loadProjects();
    refreshKeys();
    loadSettings();
  }, [loadProjects, refreshKeys, loadSettings]);

  return (
    <ErrorBoundary>
      <div className="flex h-full bg-[#0f0f0f] text-gray-200 overflow-hidden">
        <Sidebar
          onSettings={() => setSettingsOpen(true)}
          onLeaveSettings={() => setSettingsOpen(false)}
          settingsActive={settingsOpen}
        />

        {/* MainArea zawsze zamontowana — ukryta przez CSS gdy Ustawienia otwarte.
            Dzięki temu Paper.js, debounce auto-save i Canvas zachowują stan przy
            przełączaniu Ustawienia ↔ widoki projektu. `display: contents` sprawia,
            że wrapper jest neutralny w layoucie flex. */}
        <div className={settingsOpen ? "hidden" : "contents"}>
          <MainArea
            onNewProject={() => setNewProjectOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
        {settingsOpen && <SettingsView />}

        <NewProjectModal
          open={newProjectOpen}
          onClose={() => setNewProjectOpen(false)}
        />
        <UpdateModal state={updateState} />
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
}
