import { useEffect, useState, useCallback } from "react";
import { MousePointer2, Loader2, Ruler } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import { useMaterialsStore } from "../../stores/materialsStore";
import { saveCanvasToStore, resizeSelectedElement } from "../../lib/paperCanvas";
import { CostPanelContent } from "./CostPanel";

// ── MaterialPicker ────────────────────────────────────────────────────────────

interface MaterialPickerProps {
  label: string;
  selectedMaterialId: string;
  onChange: (id: string) => void;
}

function MaterialPicker({ label, selectedMaterialId, onChange }: MaterialPickerProps) {
  const { categories, materials, photoCache, isLoading } = useMaterialsStore();

  const selectedMaterial = materials.find((m) => m.id === selectedMaterialId) ?? null;
  const [categorySlug, setCategorySlug] = useState<string>(
    selectedMaterial?.category ?? categories[0]?.slug ?? ""
  );

  useEffect(() => {
    if (selectedMaterial) setCategorySlug(selectedMaterial.category);
  }, [selectedMaterialId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!categories.some((c) => c.slug === categorySlug) && categories.length > 0) {
      setCategorySlug(categories[0].slug);
    }
  }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredMaterials = materials.filter((m) => m.category === categorySlug);

  function handleCategoryChange(slug: string) {
    setCategorySlug(slug);
    if (selectedMaterial && selectedMaterial.category !== slug) onChange("");
  }

  function handleMaterialChange(id: string) {
    onChange(id);
    if (id) {
      const mat = materials.find((m) => m.id === id);
      if (mat?.category) setCategorySlug(mat.category);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        <label className="text-xs text-gray-500 font-medium block">{label}</label>
        <div className="flex items-center gap-2 text-gray-600 text-xs">
          <Loader2 className="w-3 h-3 animate-spin" />
          Ładowanie…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-gray-500 font-medium block">{label}</label>

      {categories.length > 1 && (
        <select
          value={categorySlug}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="w-full bg-[#252525] border border-gray-700 text-gray-400 text-xs rounded px-2 py-1.5 appearance-none focus:outline-none focus:border-blue-500"
        >
          {categories.map((cat) => (
            <option key={cat.id} value={cat.slug}>{cat.name}</option>
          ))}
        </select>
      )}

      <select
        value={selectedMaterialId}
        onChange={(e) => handleMaterialChange(e.target.value)}
        className="w-full bg-[#252525] border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 appearance-none focus:outline-none focus:border-blue-500"
      >
        <option value="">Brak materiału</option>
        {filteredMaterials.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>

      {selectedMaterialId && photoCache[selectedMaterialId] && (
        <div className="rounded overflow-hidden border border-gray-800 h-14 bg-[#111]">
          <img src={photoCache[selectedMaterialId]} alt="" className="w-full h-full object-cover" />
        </div>
      )}
    </div>
  );
}

// ── PropertiesTab ─────────────────────────────────────────────────────────────

function PropertiesTab() {
  const { selectedElementId, selectedItemBounds, nodeOverrides, setNodeOverride } = useEditorStore();
  const { refresh, materials, cuttingRates } = useMaterialsStore();

  const [materialId, setMaterialId] = useState("");
  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");

  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedItemBounds) {
      setWidthInput(selectedItemBounds.widthMm.toFixed(1));
      setHeightInput(selectedItemBounds.heightMm.toFixed(1));
    } else {
      setWidthInput("");
      setHeightInput("");
    }
  }, [selectedItemBounds]);

  useEffect(() => {
    if (!selectedElementId) {
      setMaterialId("");
      return;
    }
    const override = nodeOverrides[selectedElementId];
    setMaterialId(override?.materialId ?? "");
  }, [selectedElementId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedMaterial = materials.find((m) => m.id === materialId) ?? null;
  const override = selectedElementId ? nodeOverrides[selectedElementId] : null;
  const isDistans = selectedMaterial?.category === "dystans";

  // Dostępne grubości dla wybranego materiału
  const materialRates = selectedMaterial
    ? cuttingRates.filter((r) => r.material_id === selectedMaterial.id)
    : [];

  const handleMaterialChange = useCallback(
    (id: string) => {
      if (!selectedElementId) return;
      setMaterialId(id);
      const mat = materials.find((m) => m.id === id);
      const currentFill = nodeOverrides[selectedElementId]?.fill ?? "#ffffff";
      const color = mat?.color_hex ?? currentFill;
      // Reset grubości do domyślnej materiału
      const defaultThickness = mat?.default_thickness_mm ?? null;
      setNodeOverride(selectedElementId, { materialId: id || null, fill: color, thicknessMm: defaultThickness });
      saveCanvasToStore();
    },
    [selectedElementId, materials, nodeOverrides, setNodeOverride]
  );

  const handleThicknessChange = useCallback(
    (val: string) => {
      if (!selectedElementId) return;
      const t = val === "" ? null : parseFloat(val);
      setNodeOverride(selectedElementId, { thicknessMm: t != null && isFinite(t) ? t : null });
    },
    [selectedElementId, setNodeOverride]
  );

  const handleQuantityChange = useCallback(
    (val: string) => {
      if (!selectedElementId) return;
      const q = parseInt(val);
      setNodeOverride(selectedElementId, { quantity: isFinite(q) && q > 0 ? q : null });
    },
    [selectedElementId, setNodeOverride]
  );

  const commitResize = useCallback(() => {
    if (!selectedItemBounds) return;
    const w = parseFloat(widthInput);
    const h = parseFloat(heightInput);
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
      setWidthInput(selectedItemBounds.widthMm.toFixed(1));
      setHeightInput(selectedItemBounds.heightMm.toFixed(1));
      return;
    }
    resizeSelectedElement(w, h);
  }, [selectedItemBounds, widthInput, heightInput]);

  const handleDimensionKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitResize();
      if (e.key === "Escape" && selectedItemBounds) {
        setWidthInput(selectedItemBounds.widthMm.toFixed(1));
        setHeightInput(selectedItemBounds.heightMm.toFixed(1));
      }
    },
    [commitResize, selectedItemBounds]
  );

  const currentThickness = override?.thicknessMm ?? selectedMaterial?.default_thickness_mm ?? null;

  if (!selectedElementId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <MousePointer2 className="w-6 h-6 text-gray-700 mb-3" />
        <p className="text-gray-600 text-xs">
          Kliknij element na kanwasie, aby wyświetlić jego właściwości
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Materiał */}
      <MaterialPicker
        label="Materiał"
        selectedMaterialId={materialId}
        onChange={handleMaterialChange}
      />

      {/* Grubość — jeśli materiał ma stawki cięcia lub pricing_unit !== per_piece */}
      {selectedMaterial && selectedMaterial.pricing_unit !== "per_piece" && (
        <div className="space-y-1.5">
          <label className="text-xs text-gray-500 font-medium block">Grubość</label>
          <div className="flex gap-2">
            {materialRates.length > 0 ? (
              <select
                value={currentThickness != null ? String(currentThickness) : ""}
                onChange={(e) => handleThicknessChange(e.target.value)}
                className="flex-1 bg-[#252525] border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 appearance-none focus:outline-none focus:border-blue-500"
              >
                <option value="">Domyślna</option>
                {materialRates.map((r) => (
                  <option key={r.id} value={String(r.thickness_mm)}>{r.thickness_mm} mm</option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={currentThickness != null ? String(currentThickness) : ""}
                onChange={(e) => handleThicknessChange(e.target.value)}
                placeholder="mm"
                className="flex-1 bg-[#252525] border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
            )}
          </div>
        </div>
      )}

      {/* Ilość sztuk — dla dystansów */}
      {isDistans && (
        <div className="space-y-1.5">
          <label className="text-xs text-gray-500 font-medium block">Ilość sztuk</label>
          <input
            type="number"
            min="1"
            step="1"
            value={override?.quantity ?? 1}
            onChange={(e) => handleQuantityChange(e.target.value)}
            className="w-full bg-[#252525] border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      )}

      {/* Wymiary */}
      {selectedItemBounds && (
        <div className="space-y-1.5 pt-1 border-t border-gray-800">
          <label className="text-xs text-gray-500 font-medium flex items-center gap-1.5">
            <Ruler className="w-3 h-3" />
            Wymiary
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
              <div className="text-gray-600 text-[10px] uppercase tracking-wider mb-0.5">Szerokość</div>
              <div className="flex items-baseline gap-1">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={widthInput}
                  onChange={(e) => setWidthInput(e.target.value)}
                  onBlur={commitResize}
                  onKeyDown={handleDimensionKey}
                  className="w-full bg-transparent text-gray-200 text-sm font-mono focus:outline-none focus:text-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-gray-600 text-[10px] shrink-0">mm</span>
              </div>
            </div>
            <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
              <div className="text-gray-600 text-[10px] uppercase tracking-wider mb-0.5">Wysokość</div>
              <div className="flex items-baseline gap-1">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={heightInput}
                  onChange={(e) => setHeightInput(e.target.value)}
                  onBlur={commitResize}
                  onKeyDown={handleDimensionKey}
                  className="w-full bg-transparent text-gray-200 text-sm font-mono focus:outline-none focus:text-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-gray-600 text-[10px] shrink-0">mm</span>
              </div>
            </div>
          </div>
          <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
            <div className="text-gray-600 text-[10px] uppercase tracking-wider">Powierzchnia</div>
            <div className="text-gray-200 text-sm font-mono">
              {(selectedItemBounds.areaMm2 / 100).toFixed(2)} cm²
            </div>
          </div>
          {selectedItemBounds.pathLengthMm > 0 && (
            <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
              <div className="text-gray-600 text-[10px] uppercase tracking-wider">Długość cięcia</div>
              <div className="text-gray-200 text-sm font-mono">
                {selectedItemBounds.pathLengthMm >= 1000
                  ? `${(selectedItemBounds.pathLengthMm / 1000).toFixed(3)} m`
                  : `${selectedItemBounds.pathLengthMm.toFixed(1)} mm`}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ElementPanel — dwie zakładki ──────────────────────────────────────────────

type PanelTab = "wlasciwosci" | "wycena";

export function ElementPanel() {
  const [activeTab, setActiveTab] = useState<PanelTab>("wlasciwosci");

  return (
    <aside className="w-64 shrink-0 bg-[#1a1a1a] border-l border-gray-800 flex flex-col overflow-hidden">
        {/* Zakładki */}
        <div className="flex border-b border-gray-800 shrink-0">
          <button
            onClick={() => setActiveTab("wlasciwosci")}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === "wlasciwosci"
                ? "text-white border-b-2 border-blue-500 -mb-px"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Właściwości
          </button>
          <button
            onClick={() => setActiveTab("wycena")}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === "wycena"
                ? "text-white border-b-2 border-blue-500 -mb-px"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Wycena
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === "wlasciwosci" ? <PropertiesTab /> : <CostPanelContent />}
        </div>
    </aside>
  );
}
