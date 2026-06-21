import { useState } from "react";
import { Sun, Sunset, Moon, Home, Minus, Pencil } from "lucide-react";
import { useGenerationStore } from "../../stores/generationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useEditorStore } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import { buildTimeOfDayPrompt, getProductNoun } from "../../lib/promptAssembler";
import { EditTimeOfDayModal } from "./EditTimeOfDayModal";
import type { TimeOfDay } from "../../types";

interface Option {
  id: TimeOfDay;
  label: string;
  Icon: React.FC<{ className?: string }>;
  description: string;
  activeClass: string;
  activeIcon: string;
}

const TIME_OPTIONS: Option[] = [
  {
    id: "dzien",
    label: "Dzień",
    Icon: Sun,
    description: "Pełne słońce",
    activeClass: "bg-amber-500/15 border-amber-500/40 text-amber-300",
    activeIcon: "text-amber-400",
  },
  {
    id: "wieczor",
    label: "Wieczór",
    Icon: Sunset,
    description: "Złota godzina",
    activeClass: "bg-orange-500/15 border-orange-500/40 text-orange-300",
    activeIcon: "text-orange-400",
  },
  {
    id: "noc",
    label: "Noc",
    Icon: Moon,
    description: "Sztuczne światło",
    activeClass: "bg-blue-500/15 border-blue-500/40 text-blue-300",
    activeIcon: "text-blue-400",
  },
];

const EXTRA_OPTIONS: Option[] = [
  {
    id: "wnetrze",
    label: "Wnętrze",
    Icon: Home,
    description: "Biuro / sklep / hall",
    activeClass: "bg-teal-500/15 border-teal-500/40 text-teal-300",
    activeIcon: "text-teal-400",
  },
  {
    id: "brak",
    label: "Pomiń",
    Icon: Minus,
    description: "Bez opisu otoczenia",
    activeClass: "bg-gray-600/20 border-gray-500/40 text-gray-300",
    activeIcon: "text-gray-400",
  },
];

function EditableOptionBtn({
  opt,
  active,
  onClick,
  onEdit,
}: {
  opt: Option;
  active: boolean;
  onClick: () => void;
  onEdit: () => void;
}) {
  const { Icon, label, description, activeClass, activeIcon } = opt;
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`w-full flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border transition-all ${
          active
            ? activeClass
            : "border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200 hover:bg-[#222]"
        }`}
      >
        <Icon className={`w-5 h-5 ${active ? activeIcon : ""}`} />
        <span className="text-xs font-medium leading-none">{label}</span>
        <span
          className={`text-[10px] leading-tight text-center ${
            active ? "opacity-75" : "text-gray-400"
          }`}
        >
          {description}
        </span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="absolute right-1 top-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-gray-200 hover:bg-gray-800"
        title="Edytuj tekst środowiska"
      >
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  );
}

function PlainOptionBtn({
  opt,
  active,
  onClick,
}: {
  opt: Option;
  active: boolean;
  onClick: () => void;
}) {
  const { Icon, label, description, activeClass, activeIcon } = opt;
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border transition-all ${
        active
          ? activeClass
          : "border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200 hover:bg-[#222]"
      }`}
    >
      <Icon className={`w-5 h-5 ${active ? activeIcon : ""}`} />
      <span className="text-xs font-medium leading-none">{label}</span>
      <span className={`text-[10px] leading-tight text-center ${active ? "opacity-75" : "text-gray-400"}`}>
        {description}
      </span>
    </button>
  );
}

export function TimeOfDayPanel() {
  const { timeOfDay, setTimeOfDay, led } = useGenerationStore();
  const { timeOfDayTextOverrides, setTimeOfDayTextOverride } = useSettingsStore();
  const { backgroundPath } = useEditorStore();
  const { projects, activeProjectId } = useProjectStore();
  const productType = projects.find((p) => p.id === activeProjectId)?.product_type ?? null;
  const productNoun = getProductNoun(productType);
  const ledActive = led.backlit.enabled || led.frontlit.enabled;

  const [editingOption, setEditingOption] = useState<Option | null>(null);

  function getAutoText(optId: TimeOfDay) {
    return buildTimeOfDayPrompt(optId, ledActive, !!backgroundPath, productNoun);
  }

  return (
    <section className="bg-[#1a1a1a] rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-100 uppercase tracking-wide">
        Środowisko
      </h3>

      <div className="grid grid-cols-3 gap-2">
        {TIME_OPTIONS.map((opt) => (
          <EditableOptionBtn
            key={opt.id}
            opt={opt}
            active={timeOfDay === opt.id}
            onClick={() => setTimeOfDay(opt.id)}
            onEdit={() => setEditingOption(opt)}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {EXTRA_OPTIONS.map((opt) =>
          opt.id === "brak" ? (
            <PlainOptionBtn
              key={opt.id}
              opt={opt}
              active={timeOfDay === opt.id}
              onClick={() => setTimeOfDay(opt.id)}
            />
          ) : (
            <EditableOptionBtn
              key={opt.id}
              opt={opt}
              active={timeOfDay === opt.id}
              onClick={() => setTimeOfDay(opt.id)}
              onEdit={() => setEditingOption(opt)}
            />
          )
        )}
      </div>

      {editingOption && (
        <EditTimeOfDayModal
          open
          optionId={editingOption.id}
          optionLabel={editingOption.label}
          autoText={getAutoText(editingOption.id)}
          currentOverride={timeOfDayTextOverrides[editingOption.id] ?? null}
          onClose={() => setEditingOption(null)}
          onSave={(text) => setTimeOfDayTextOverride(editingOption.id, text)}
        />
      )}
    </section>
  );
}
