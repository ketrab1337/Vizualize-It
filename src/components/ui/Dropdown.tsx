import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Opcjonalny dodatkowy opis pokazywany na liście pod etykietą. */
  description?: string;
}

interface DropdownProps<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (v: T) => void;
  /** Tekst gdy żadna wartość nie jest wybrana. */
  placeholder?: string;
  disabled?: boolean;
  /** Szerokość menu rozwijanego. Default: matchTrigger. */
  menuWidth?: "matchTrigger" | "auto";
  className?: string;
}

/**
 * Custom animowany dropdown z opisami opcji.
 *
 * - Trigger po lewej tekst, po prawej chevron (rotuje się w górę gdy otwarte)
 * - Menu animuje się przez opacity + scaleY z transform-origin top
 * - Outside-click + Escape zamyka menu
 * - Klawisze ↑/↓ + Enter nawigują (basic accessibility)
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  placeholder = "Wybierz…",
  disabled = false,
  menuWidth = "matchTrigger",
  className = "",
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(() =>
    Math.max(0, options.findIndex((o) => o.value === value))
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(options.length - 1, h + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const sel = options[highlight];
        if (sel) {
          onChange(sel.value);
          setOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, options, highlight, onChange]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
          setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
        }}
        disabled={disabled}
        className={`flex items-center justify-between gap-2 min-w-[180px] px-3 py-1.5 rounded-md border text-sm transition-colors ${
          disabled
            ? "bg-[#1a1a1a] border-gray-800 text-gray-600 cursor-not-allowed"
            : open
            ? "bg-[#1f1f1f] border-blue-500/60 text-gray-100"
            : "bg-[#1a1a1a] border-gray-700 text-gray-200 hover:border-gray-600"
        }`}
      >
        <span className="truncate text-left">{selected?.label ?? placeholder}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-gray-500 transition-transform duration-150 ${
            open ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {/* Menu — zawsze renderowane, animowane przez opacity + scaleY */}
      <div
        className={`absolute z-30 mt-1 rounded-md border border-gray-700 bg-[#1a1a1a] shadow-xl overflow-hidden transition-all duration-150 ease-out ${
          open ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
        style={{
          transformOrigin: "top",
          pointerEvents: open ? "auto" : "none",
          width: menuWidth === "matchTrigger" ? "100%" : "auto",
          minWidth: menuWidth === "matchTrigger" ? undefined : "200px",
        }}
        role="listbox"
      >
        <ul className="py-1 max-h-72 overflow-y-auto">
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isHighlighted = i === highlight;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${
                    isHighlighted
                      ? "bg-[#252525]"
                      : isSelected
                      ? "bg-blue-900/15"
                      : "bg-transparent"
                  }`}
                >
                  <Check
                    className={`w-3.5 h-3.5 mt-0.5 shrink-0 transition-opacity ${
                      isSelected ? "opacity-100 text-blue-400" : "opacity-0"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-tight ${isSelected ? "text-blue-200" : "text-gray-200"}`}>
                      {opt.label}
                    </p>
                    {opt.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
