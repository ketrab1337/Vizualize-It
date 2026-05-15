import { Sun, Sunset, Moon, Home, Minus } from "lucide-react";
import { useGenerationStore } from "../../stores/generationStore";
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

function OptionBtn({
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
          : "border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-300 hover:bg-[#222]"
      }`}
    >
      <Icon className={`w-5 h-5 ${active ? activeIcon : ""}`} />
      <span className="text-xs font-medium leading-none">{label}</span>
      <span
        className={`text-[10px] leading-tight text-center ${
          active ? "opacity-75" : "text-gray-600"
        }`}
      >
        {description}
      </span>
    </button>
  );
}

export function TimeOfDayPanel() {
  const { timeOfDay, setTimeOfDay } = useGenerationStore();

  return (
    <section className="bg-[#1a1a1a] rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-100 uppercase tracking-wide">
        Środowisko
      </h3>

      <div className="grid grid-cols-3 gap-2">
        {TIME_OPTIONS.map((opt) => (
          <OptionBtn
            key={opt.id}
            opt={opt}
            active={timeOfDay === opt.id}
            onClick={() => setTimeOfDay(opt.id)}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {EXTRA_OPTIONS.map((opt) => (
          <OptionBtn
            key={opt.id}
            opt={opt}
            active={timeOfDay === opt.id}
            onClick={() => setTimeOfDay(opt.id)}
          />
        ))}
      </div>
    </section>
  );
}
