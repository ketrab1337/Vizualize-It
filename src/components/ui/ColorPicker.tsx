import { useEffect, useRef, useState } from "react";

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}

/** Normalizuje wpisany tekst do `#rrggbb` (przyjmuje też skrót `#rgb`). null = niepełny/błędny. */
function normalizeHex(raw: string): string | null {
  let s = raw.trim().replace(/^#+/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) {
    s = s.split("").map((c) => c + c).join("");
  }
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  return null;
}

export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  // Lokalny draft pola tekstowego — pozwala wpisywać częściowy hex bez odrzucania w trakcie.
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  // Synchronizuj draft z value tylko gdy pole nie jest aktywnie edytowane.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  function commitDraft(raw: string) {
    const hex = normalizeHex(raw);
    if (hex) {
      onChange(hex);
      setDraft(hex);
    } else {
      // Niepoprawny wpis → wróć do aktualnej wartości.
      setDraft(value);
    }
  }

  const normalizedDraft = normalizeHex(draft);
  const swatchColor = normalizedDraft ?? value;

  return (
    <div className="flex items-center gap-2">
        {label && <span className="text-sm text-gray-400">{label}</span>}

        {/* Swatch = natywny picker (kliknięcie otwiera systemowy wybór koloru) */}
        <div className="relative w-9 h-9 shrink-0">
          <input
            type="color"
            value={swatchColor}
            onChange={(e) => {
              setDraft(e.target.value);
              onChange(e.target.value);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label="Wybierz kolor"
          />
          <div
            className="w-full h-full rounded-md border border-gray-700 pointer-events-none"
            style={{ backgroundColor: swatchColor }}
          />
        </div>

        {/* Pole HEX — edytowalne bezpośrednio */}
        <div className="flex items-center bg-[#161616] border border-gray-700 rounded-md focus-within:border-blue-500 transition-colors">
          <span className="pl-2.5 text-gray-500 font-mono text-sm select-none">#</span>
          <input
            type="text"
            value={draft.replace(/^#/, "")}
            spellCheck={false}
            maxLength={7}
            onFocus={() => { focusedRef.current = true; }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => { focusedRef.current = false; commitDraft(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.currentTarget.blur(); }
              if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); }
            }}
            placeholder="rrggbb"
            className="w-24 bg-transparent pr-2.5 py-1.5 text-sm text-gray-200 font-mono uppercase placeholder-gray-600 focus:outline-none"
          />
        </div>
    </div>
  );
}
