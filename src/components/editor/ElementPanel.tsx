import { useEffect, useState, useCallback } from "react";
import { MousePointer2, Loader2, Ruler } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import { useMaterialsStore } from "../../stores/materialsStore";
import { saveCanvasToStore, resizeSelectedElement, pushCanvasHistory } from "../../lib/paperCanvas";
import { applyFillByName, collectDescendantNames } from "./canvas/paperUtils";
import { CostPanelContent } from "./CostPanel";
import type { ElementRole } from "../../types";

/**
 * Etykiety ról elementów — pokazywane w dropdownie. "Dystans" jest też
 * implikowany automatycznie z kategorii materiału (dystans), ale user może
 * dodatkowo ustawić rolę ręcznie dla elementu który NIE ma kategorii dystans
 * (np. cienki łącznik z plexy traktowany jako dystans w prompcie).
 */
const ROLE_OPTIONS: Array<{ value: ElementRole; label: string }> = [
  { value: "backplate", label: "Tło szyldu" },
  { value: "text", label: "Napis" },
  { value: "logo", label: "Logo" },
  { value: "decoration", label: "Dekoracja" },
  { value: "cutout", label: "Warstwa z wycięciem" },
  { value: "distance", label: "Dystans" },
];

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
  const { refresh, categories, materials, globalCuttingRates } = useMaterialsStore();

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

  // Reaguj na zmiany selectedElementId ORAZ na zewnętrzne zmiany materialId
  // (np. drag&drop, undo/redo, presety) — bez nodeOverrides w deps stan
  // wewnętrzny `materialId` zostaje rozsynchronizowany.
  const externalMaterialId = selectedElementId
    ? nodeOverrides[selectedElementId]?.materialId ?? ""
    : "";
  useEffect(() => {
    setMaterialId(externalMaterialId);
  }, [selectedElementId, externalMaterialId]);

  const selectedMaterial = materials.find((m) => m.id === materialId) ?? null;
  const override = selectedElementId ? nodeOverrides[selectedElementId] : null;
  const selectedCat = categories.find((c) => c.slug === selectedMaterial?.category);
  const isDistans = selectedCat?.is_distance === 1;

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
      applyFillByName(selectedElementId, color);

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

  const handleRoleChange = useCallback(
    (val: string) => {
      if (!selectedElementId) return;
      const role = (val || null) as ElementRole | null;
      setNodeOverride(selectedElementId, { role });
      saveCanvasToStore();
      setTimeout(() => pushCanvasHistory(), 0);
    },
    [selectedElementId, setNodeOverride]
  );

  const handleLedBacklitChange = useCallback(
    (checked: boolean) => {
      if (!selectedElementId) return;
      setNodeOverride(selectedElementId, { ledBacklit: checked ? true : null });
      saveCanvasToStore();
      setTimeout(() => pushCanvasHistory(), 0);
    },
    [selectedElementId, setNodeOverride]
  );

  const handleLedFrontlitChange = useCallback(
    (checked: boolean) => {
      if (!selectedElementId) return;
      setNodeOverride(selectedElementId, { ledFrontlit: checked ? true : null });
      saveCanvasToStore();
      setTimeout(() => pushCanvasHistory(), 0);
    },
    [selectedElementId, setNodeOverride]
  );

  const handleCutoutBackingChange = useCallback(
    (val: string) => {
      if (!selectedElementId) return;
      setNodeOverride(selectedElementId, { cutoutBackingId: val || null });
      saveCanvasToStore();
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
                    name="multi_width_mm"
                    aria-label="Łączna szerokość zaznaczenia w mm"
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
                    name="multi_height_mm"
                    aria-label="Łączna wysokość zaznaczenia w mm"
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

      {/* Rola w prompcie AI — zawsze widoczna. Dla elementu z materiałem kategorii
          „dystans" rola „Dystans" jest auto-domyślna (gdy `override.role` jest null),
          ale user może też wybrać inną wartość ręcznie. */}
      <div className="space-y-1.5">
        <label className="text-xs text-gray-400 font-medium block">
          Rola w prompcie AI
          <span className="ml-1 text-[10px] text-gray-600 font-normal">(warstwowość)</span>
        </label>
        <select
          value={override?.role ?? ""}
          onChange={(e) => handleRoleChange(e.target.value)}
          className="w-full bg-[#252525] border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 appearance-none focus:outline-none focus:border-blue-500"
        >
          <option value="">
            {isDistans ? "— Auto: Dystans (z kategorii materiału) —" : "— Nie określono —"}
          </option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Warstwa z wycięciem — widoczna tylko dla roli "cutout". User wybiera
          który INNY element pokazuje się przez wycięcia (np. plexa pod spodem). */}
      {override?.role === "cutout" && (
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400 font-medium block">
            Co widoczne przez wycięcia
            <span className="ml-1 text-[10px] text-gray-600 font-normal">(warstwa pod spodem)</span>
          </label>
          <select
            value={override?.cutoutBackingId ?? ""}
            onChange={(e) => handleCutoutBackingChange(e.target.value)}
            className="w-full bg-[#252525] border border-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 appearance-none focus:outline-none focus:border-blue-500"
          >
            <option value="">— Wybierz warstwę pod spodem —</option>
            {Object.entries(nodeOverrides)
              .filter(([id]) => id !== selectedElementId)
              .reduce<Array<{ id: string; label: string }>>(
                (acc, [id, ov]) => {
                  const matName = materials.find((m) => m.id === ov.materialId)?.name;
                  const colorHex = ov.fill || "—";
                  const label = `${colorHex}${matName ? ` · ${matName}` : ""}`;
                  if (!acc.some((x) => x.label === label)) acc.push({ id, label });
                  return acc;
                },
                []
              )
              .map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
          </select>
        </div>
      )}

      {/* Podświetlenie LED per element — kolor/temperatura/lumeny brane z globalnego
          LedConfig w panelu Generowanie. Gdy żaden element nie ma flagi, działa
          globalny toggle backlit/frontlit. */}
      <div className="space-y-1.5">
        <label className="text-xs text-gray-400 font-medium block">
          Podświetlenie LED
          <span className="ml-1 text-[10px] text-gray-600 font-normal">(per element)</span>
        </label>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              name="el_led_backlit"
              type="checkbox"
              checked={override?.ledBacklit === true}
              onChange={(e) => handleLedBacklitChange(e.target.checked)}
              className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-gray-300 group-hover:text-gray-100">
              Backlit (świeci od tyłu)
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              name="el_led_frontlit"
              type="checkbox"
              checked={override?.ledFrontlit === true}
              onChange={(e) => handleLedFrontlitChange(e.target.checked)}
              className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-gray-300 group-hover:text-gray-100">
              Front-lit (świeci od przodu)
            </span>
          </label>
        </div>
      </div>

      {/* Ilość sztuk — dla dystansów */}
      {isDistans && (
        <div className="space-y-1.5">
          <label htmlFor="el-quantity" className="text-xs text-gray-400 font-medium block">Ilość sztuk</label>
          <input
            id="el-quantity"
            name="el_quantity"
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
                  name="el_width_mm"
                  aria-label="Szerokość elementu w mm"
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
                  name="el_height_mm"
                  aria-label="Wysokość elementu w mm"
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
