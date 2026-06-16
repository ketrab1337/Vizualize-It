import { useState } from "react";
import { MaterialLibrary } from "./MaterialLibrary";
import { BackgroundLibrary } from "./BackgroundLibrary";
import { ApiKeys } from "./ApiKeys";
import { Templates } from "./Templates";
import { PricingSettings } from "./PricingSettings";
import { ModelSettings } from "./ModelSettings";

type SettingsTab = "materialy" | "tla" | "api" | "szablony" | "wycena" | "modele";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "materialy", label: "Biblioteka materiałów" },
  { id: "tla", label: "Biblioteka teł" },
  { id: "api", label: "Klucze API" },
  { id: "szablony", label: "Szablony" },
  { id: "wycena", label: "Stawki" },
  { id: "modele", label: "Modele AI" },
];

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("materialy");

  return (
    <main className="flex-1 flex bg-[#0f0f0f] overflow-hidden">
      {/* Sub-sidebar z zakładkami ustawień */}
      <nav className="w-56 bg-[#111111] border-r border-gray-800 flex flex-col py-4 px-3 shrink-0">
        <h2 className="text-white font-semibold text-sm px-3 mb-4 select-none">Ustawienia</h2>
        <ul className="space-y-0.5">
          {TABS.map((tab) => (
            <li key={tab.id}>
              <button
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  activeTab === tab.id
                    ? "bg-blue-900/30 text-blue-300"
                    : "text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-200"
                }`}
              >
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Zawartość zakładki */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "materialy" && <MaterialLibrary />}
        {activeTab === "tla" && <BackgroundLibrary />}
        {activeTab === "api" && <ApiKeys />}
        {activeTab === "szablony" && <Templates />}
        {activeTab === "wycena" && <PricingSettings />}
        {activeTab === "modele" && <ModelSettings />}
      </div>
    </main>
  );
}
