import { useEffect, useState, useCallback } from "react";
import { MousePointer2, Loader2, Ruler } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import { useMaterialsStore } from "../../stores/materialsStore";
import { saveCanvasToStore, resizeSelectedElement, pushCanvasHistory } from "../../lib/paperCanvas";
import { applyFillByName, collectDescendantNames } from "./canvas/paperUtils";
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
        <label className="text-xs text-gray-400 font-medium block">{label}</label>
        <div className="flex items-center gap-2 text-gray-600 text-xs">
          <Loader2 className="w-3 h-3 animate-spin" />
          Ładowanie…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-gray-400 font-medium block">{label}</label>

      {categories.length > 1 && (
        <select
          value={categorySlug}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="w-full bg-[#252525] border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5 appearance-none focus:outline-none focus:border-blue-500"
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
  const { selectedElementId, selectedElementIds, selectedItemBounds, nodeOverrides, setNodeOverride } = useEditorStore();
  const { refresh, materials, globalCuttingRates } = useMaterialsStore();

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

  // Globalne stawki cięcia dla kategorii wybranego materiału (zawsze, niezależnie od pricing_unit)
  const categoryRates = selectedMaterial
    ? globalCuttingRates.filter((r) => r.category === selectedMaterial.category)
    : [];

  const handleMaterialChange = useCallback(
    (id: string) => {
      if (!selectedElementId) return;
      setMaterialId(id);
      const mat = materials.find((m) => m.id === id);
      const currentFill = nodeOverrides[selectedElementId]?.fill ?? "#ffffff";
      const color = mat?.color_hex ?? currentFill;
      // Auto-wybierz pierwszą grubość z globalnych stawek dla kategorii materiału
      const rates = mat ? globalCuttingRates.filter((r) => r.category === mat.category) : [];
      const defaultThickness = rates.length > 0 ? rates[0].thickness_mm : null;
      const override = { materialId: id || null, fill: color, thicknessMm: defaultThickness };
      setNodeOverride(selectedElementId, override);

      // Kaskaduj materiał na wszystkich potomków grupy
      const descendants = collectDescendantNames(selectedElementId);
      for (const childName of descendants) {
        setNodeOverride(childName, override);
        applyFillByName(childName, color);
      }

      saveCanvasToStore();
      // Wypchnij wpis historii po renderze (nodeOverridesRef musi być świeży)
      setTimeout(() => pushCanvasHistory(), 0);
    },
    [selectedElementId, materials, nodeOverrides, setNodeOverride, globalCuttingRates]
  );

  const handleThicknessChange = useCallback(
    (val: string) => {
      if (!selectedElementId) return;
      const t = val === "" ? null : parseFloat(val);
      setNodeOverride(selectedElementId, { thicknessMm: t != null && isFinite(t) ? t : null });
      setTimeout(() => pushCanvasHistory(), 0);
    },
    [selectedElementId, setNodeOverride]
  );

  const handleQuantityChange = useCallback(
    (val: string) => {
      if (!selectedElementId) return;
      const q = parseInt(val);
      setNodeOverride(selectedElementId, { quantity: isFinite(q) && q > 0 ? q : null });
      setTimeout(() => pushCanvasHistory(), 0);
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

  // ── Multi-zaznaczenie ─────────────────────────────────────────────────────────
  if (selectedElementIds.length > 1) {
    const matIds = selectedElementIds.map((id) => nodeOverrides[id]?.materialId ?? null);
    const allSame = matIds.every((id) => id === matIds[0]);
    const sharedMat = allSame && matIds[0] ? materials.find((m) => m.id === matIds[0]) ?? null : null;

    return (
      <div className="p-4 space-y-4">
        <div className="text-xs text-gray-500">
          {selectedElementIds.length} elementy zaznaczone
        </div>

        {/* Info o materiale */}
        <div className="space-y-1">
          <div className="text-xs text-gray-400 font-medium">Materiał</div>
          {sharedMat ? (
            <div className="text-sm text-gray-200">{sharedMat.name}</div>
          ) : (
            <div className="text-sm text-gray-500 italic">Różne materiały</div>
          )}
        </div>

        {/* Łączne wymiary */}
        {selectedItemBounds && (
          <div className="space-y-1.5 pt-1 border-t border-gray-800">
            <label className="text-xs text-gray-400 font-medium flex items-center gap-1.5">
              <Ruler className="w-3 h-3" />
              Łączne wymiary zaznaczenia
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
                <div className="text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">Szerokość</div>
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
                  <span className="text-gray-400 text-[10px] shrink-0">mm</span>
                </div>
              </div>
              <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
                <div className="text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">Wysokość</div>
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
                  <span className="text-gray-400 text-[10px] shrink-0">mm</span>
                </div>
              </div>
            </div>
            <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
              <div className="text-gray-400 text-[10px] uppercase tracking-wider">Powierzchnia (łącznie)</div>
              <div className="text-gray-200 text-sm font-mono">
                {(selectedItemBounds.areaMm2 / 100).toFixed(2)} cm²
              </div>
            </div>
            {selectedItemBounds.pathLengthMm > 0 && (
              <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
                <div className="text-gray-400 text-[10px] uppercase tracking-wider">Długość cięcia (łącznie)</div>
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

  // ── Brak zaznaczenia ──────────────────────────────────────────────────────────
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

  // ── Pojedynczy element ────────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-5">
      {/* Materiał */}
      <MaterialPicker
        label="Materiał"
        selectedMaterialId={materialId}
        onChange={handleMaterialChange}
      />

      {/* Grubość — dla każdego materiału który ma stawki w globalnych ustawieniach */}
      {selectedMaterial && selectedMaterial.pricing_unit !== "per_piece" && categoryRates.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400 font-medium block">Grubość</label>
          <select
            value={currentThickness != null ? String(currentThickness) : ""}
            onChange={(e) => handleThicknessChange(e.target.value)}
            className="w-full bg-[#252525] border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 appearance-none focus:outline-none focus:border-blue-500"
          >
            {categoryRates.map((r) => (
              <option key={r.id} value={String(r.thickness_mm)}>
                {r.thickness_mm} mm — {r.price_per_m.toFixed(2)} zł/mb
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Ilość sztuk — dla dystansów */}
      {isDistans && (
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400 font-medium block">Ilość sztuk</label>
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
          <label className="text-xs text-gray-400 font-medium flex items-center gap-1.5">
            <Ruler className="w-3 h-3" />
            Wymiary
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
              <div className="text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">Szerokość</div>
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
                <span className="text-gray-400 text-[10px] shrink-0">mm</span>
              </div>
            </div>
            <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
              <div className="text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">Wysokość</div>
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
                <span className="text-gray-400 text-[10px] shrink-0">mm</span>
              </div>
            </div>
          </div>
          <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
            <div className="text-gray-400 text-[10px] uppercase tracking-wider">Powierzchnia</div>
            <div className="text-gray-200 text-sm font-mono">
              {(selectedItemBounds.areaMm2 / 100).toFixed(2)} cm²
            </div>
          </div>
          {selectedItemBounds.pathLengthMm > 0 && (
            <div className="bg-[#252525] rounded px-2 py-1.5 border border-gray-700">
              <div className="text-gray-400 text-[10px] uppercase tracking-wider">Długość cięcia</div>
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
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Właściwości
          </button>
          <button
            onClick={() => setActiveTab("wycena")}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === "wycena"
                ? "text-white border-b-2 border-blue-500 -mb-px"
                : "text-gray-400 hover:text-gray-200"
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
