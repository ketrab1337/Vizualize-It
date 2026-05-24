import { useState, useEffect, useMemo } from "react";
import { PRODUCT_TYPE_PRESETS } from "../../types";
import { useProjectStore } from "../../stores/projectStore";
import { useProject } from "../../hooks/useProject";

/**
 * Wybór typu produktu (per projekt) — używany w prompcie AI do zastąpienia
 * hardcoded "szyld" konkretnym typem ("tabliczka informacyjna", "numer na dom"…).
 * Wartość zapisywana w `projects.product_type` (migracja 016). Dla wartości
 * "inne" pojawia się dodatkowe pole tekstowe na własny opis (zapisywany
 * bezpośrednio jako product_type bez prefiksu).
 */
export function ProductTypeSelector() {
  const { projects, activeProjectId } = useProjectStore();
  const { updateProductType } = useProject();
  const project = projects.find((p) => p.id === activeProjectId);

  // Określ czy wartość z DB to jeden z presetów czy custom text ("Inne")
  const presetIds = useMemo(() => new Set(PRODUCT_TYPE_PRESETS.map((p) => p.id)), []);

  // selectValue: "szyld" / "tabliczka_…" / "__other__" — UI dropdown
  const [selectValue, setSelectValue] = useState<string>("");
  const [customText, setCustomText] = useState<string>("");

  // Synchronizacja UI z DB gdy zmieni się projekt (lub po pierwszym wczytaniu)
  useEffect(() => {
    if (!project) {
      setSelectValue("");
      setCustomText("");
      return;
    }
    if (project.product_type == null) {
      setSelectValue("");
      setCustomText("");
    } else if (presetIds.has(project.product_type)) {
      setSelectValue(project.product_type);
      setCustomText("");
    } else {
      setSelectValue("__other__");
      setCustomText(project.product_type);
    }
  }, [project?.id, project?.product_type, presetIds]);

  if (!project) return null;

  function handleSelectChange(val: string) {
    setSelectValue(val);
    if (!project) return;
    if (val === "") {
      // "Domyślnie (szyld)" — wyczyść product_type w DB
      updateProductType(project.id, null);
    } else if (val === "__other__") {
      // Pusty preset "Inne" — czekamy aż user wpisze tekst (zapis przy blur input)
      updateProductType(project.id, customText.trim() || null);
    } else {
      updateProductType(project.id, val);
    }
  }

  function handleCustomBlur() {
    if (!project) return;
    if (selectValue !== "__other__") return;
    updateProductType(project.id, customText.trim() || null);
  }

  return (
    <section className="bg-[#1a1a1a] rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-100 uppercase tracking-wide">
        Typ produktu
      </h3>
      <p className="text-[10px] text-gray-500 -mt-1">
        Wpływa na opis w prompcie AI
      </p>

      <select
        value={selectValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        className="w-full bg-[#252525] border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 appearance-none focus:outline-none focus:border-blue-500"
      >
        <option value="">— Domyślnie (szyld) —</option>
        {PRODUCT_TYPE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
        <option value="__other__">Inne (wpisz opis…)</option>
      </select>

      {selectValue === "__other__" && (
        <input
          type="text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onBlur={handleCustomBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="np. menu kawiarni, dekoracja choinkowa, prezent…"
          className="w-full bg-[#252525] border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 placeholder:text-gray-600"
        />
      )}
    </section>
  );
}
