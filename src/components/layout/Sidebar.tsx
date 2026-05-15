import { PencilLine, Sparkles, Images, Settings } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore, type ProjectTab } from "../../stores/editorStore";

interface SidebarProps {
  onSettings: () => void;
  /** Wywoływane gdy user nawiguje na coś INNEGO niż ustawienia — auto-zamyka SettingsView. */
  onLeaveSettings: () => void;
  settingsActive?: boolean;
}

const PROJECT_TABS: { id: ProjectTab; Icon: React.FC<{ className?: string }>; label: string }[] = [
  { id: "edytor", Icon: PencilLine, label: "Edytor" },
  { id: "generowanie", Icon: Sparkles, label: "Generowanie" },
  { id: "galeria", Icon: Images, label: "Galeria" },
];

interface NavBtnProps {
  Icon: React.FC<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavBtn({ Icon, label, active, onClick }: NavBtnProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`group relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
        active
          ? "bg-[#1e2433] text-blue-400"
          : "text-gray-500 hover:bg-[#1a1a1a] hover:text-gray-300"
      }`}
    >
      <Icon className="w-[18px] h-[18px]" />
      <span className="pointer-events-none absolute left-full ml-3 px-2 py-1 rounded-md bg-gray-900 border border-gray-700 text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
        {label}
      </span>
    </button>
  );
}

export function Sidebar({ onSettings, onLeaveSettings, settingsActive = false }: SidebarProps) {
  const { activeProjectId, setActiveProject } = useProjectStore();
  const { activeTab, setActiveTab } = useEditorStore();

  return (
    <aside className="w-14 bg-[#111111] border-r border-gray-800 flex flex-col items-center py-3 gap-1 shrink-0 h-full select-none">
      {/* Logo — klik wraca do siatki projektów (i wychodzi z Ustawień jeśli były otwarte) */}
      <button
        onClick={() => {
          onLeaveSettings();
          setActiveProject(null);
        }}
        title="Projekty"
        className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors flex items-center justify-center mb-2 shrink-0"
      >
        <span className="text-white font-bold text-sm">P</span>
      </button>

      <div className="w-8 h-px bg-gray-800 mb-1 shrink-0" />

      {/* Zakładki projektu — widoczne tylko gdy projekt otwarty */}
      {activeProjectId && (
        <nav className="flex flex-col gap-1">
          {PROJECT_TABS.map(({ id, Icon, label }) => (
            <NavBtn
              key={id}
              Icon={Icon}
              label={label}
              active={!settingsActive && activeTab === id}
              onClick={() => {
                onLeaveSettings();
                setActiveTab(id);
              }}
            />
          ))}
        </nav>
      )}

      <div className="flex-1" />

      {/* Ustawienia */}
      <NavBtn
        Icon={Settings}
        label="Ustawienia"
        active={settingsActive}
        onClick={onSettings}
      />
    </aside>
  );
}
