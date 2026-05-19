import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Sidebar } from "./components/layout/Sidebar";
import { MainArea } from "./components/layout/MainArea";
import { SettingsView } from "./components/settings/SettingsView";
import { NewProjectModal } from "./components/layout/NewProjectModal";
import { ToastContainer } from "./components/ui/Toast";
import { useProject } from "./hooks/useProject";
import { useKeysStore } from "./stores/keysStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useToastStore } from "./stores/toastStore";

export function App() {
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { loadProjects } = useProject();
  const { refreshKeys } = useKeysStore();
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const addToast = useToastStore((s) => s.addToast);

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

    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (!update?.available) return;
        addToast(
          `Dostępna aktualizacja ${update.version} — kliknij by zainstalować`,
          "info",
          {
            label: "Zainstaluj",
            fn: async () => {
              addToast("Pobieranie aktualizacji...", "info");
              await update.downloadAndInstall();
              await relaunch();
            },
          }
        );
      } catch {
        // ignoruj błędy sprawdzania aktualizacji
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [loadProjects, refreshKeys, loadSettings, addToast]);

  return (
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
      <ToastContainer />
    </div>
  );
}
