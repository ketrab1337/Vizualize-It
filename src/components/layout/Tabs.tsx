import { useEditorStore, type ProjectTab } from "../../stores/editorStore";

const TABS: { id: ProjectTab; label: string }[] = [
  { id: "edytor", label: "Edytor" },
  { id: "generowanie", label: "Generowanie" },
  { id: "galeria", label: "Galeria" },
];

export function Tabs() {
  const { activeTab, setActiveTab } = useEditorStore();

  return (
    <div className="flex border-b border-gray-800 bg-[#111111] shrink-0">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`relative px-5 py-2.5 text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? "text-white"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          {tab.label}
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500 rounded-t" />
          )}
        </button>
      ))}
    </div>
  );
}
