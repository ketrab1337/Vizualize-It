import { useState, useMemo, useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText, DollarSign, Zap, Layers } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { useMaterialsStore } from "../../stores/materialsStore";
import { useToastStore } from "../../stores/toastStore";
import { usePricing } from "../../hooks/usePricing";
import type { GroupedCostItem } from "../../lib/pricing";

// ── Formatowanie ──────────────────────────────────────────────────────────────

function formatPln(v: number): string {
  return v.toFixed(2) + " zł";
}

// ── Wiersz grupujący z rozwijaniem ────────────────────────────────────────────

function GroupedRow({ group, showMargin, marginPct }: {
  group: GroupedCostItem;
  showMargin: boolean;
  marginPct: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const multiElement = group.elements.length > 1;
  const displayCost = showMargin ? group.totalCost * (1 + marginPct / 100) : group.totalCost;

  return (
    <div className="bg-[#252525] rounded overflow-hidden">
      {/* Wiersz nagłówkowy grupy */}
      <div
        className={`flex items-center gap-2 px-2.5 py-2 text-xs ${multiElement ? "cursor-pointer hover:bg-[#2a2a2a] transition-colors" : ""}`}
        onClick={() => multiElement && setExpanded((e) => !e)}
      >
        <div className="w-3.5 shrink-0 flex items-center justify-center">
          {multiElement ? (
            expanded
              ? <ChevronDown className="w-3 h-3 text-gray-500" />
              : <ChevronRight className="w-3 h-3 text-gray-500" />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-gray-200 font-medium truncate">
            {group.materialName ?? "LED"}
            {group.thicknessMm != null && (
              <span className="text-gray-500 font-normal"> • {group.thicknessMm} mm</span>
            )}
          </div>
          <div className="text-gray-500 mt-0.5 space-x-2">
            {group.elements.length > 1 && (
              <span>{group.elements.length} elementy</span>
            )}
            {group.totalAreaCm2 != null && (
              <span>Pow. {group.totalAreaCm2.toFixed(2)} cm²</span>
            )}
            {group.totalPathLengthM != null && group.lineType !== "led" && (
              <span>Cięcie {group.totalPathLengthM.toFixed(3)} m</span>
            )}
            {group.lineType === "led" && group.totalPathLengthM != null && (
              <span>LED {group.totalPathLengthM.toFixed(2)} mb × {formatPln(group.unitCost)}/mb</span>
            )}
            {group.totalQuantity != null && (
              <span>{group.totalQuantity} szt. × {formatPln(group.unitCost)}/szt.</span>
            )}
          </div>
        </div>
        <span className="text-gray-100 font-mono shrink-0">{formatPln(displayCost)}</span>
      </div>

      {/* Per-element szczegóły (po rozwinięciu) */}
      {expanded && multiElement && (
        <div className="border-t border-gray-800/60">
          {group.elements.map((el) => {
            const elCost = showMargin ? el.totalCost * (1 + marginPct / 100) : el.totalCost;
            return (
              <div key={el.nodeId} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-800/40 last:border-0 bg-[#1f1f1f]">
                <div className="w-3.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-gray-400 text-[11px] truncate">{el.label}</span>
                  {el.areaCm2 != null && (
                    <span className="text-gray-600 text-[11px] ml-2">{el.areaCm2.toFixed(2)} cm²</span>
                  )}
                  {el.pathLengthM != null && el.lineType !== "led" && (
                    <span className="text-gray-600 text-[11px] ml-2">{el.pathLengthM.toFixed(3)} m</span>
                  )}
                  {el.quantity != null && (
                    <span className="text-gray-600 text-[11px] ml-2">{el.quantity} szt.</span>
                  )}
                </div>
                <span className="text-gray-400 font-mono text-[11px] shrink-0">{formatPln(elCost)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sekcja zgrupowanych pozycji ───────────────────────────────────────────────

interface GroupedSectionProps {
  title: string;
  icon: ReactNode;
  groups: GroupedCostItem[];
  showMargin: boolean;
  marginPct: number;
}

function GroupedSection({ title, icon, groups, showMargin, marginPct }: GroupedSectionProps) {
  if (groups.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-gray-500">{icon}</span>
        <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <div className="space-y-1">
        {groups.map((g) => (
          <GroupedRow key={g.key} group={g} showMargin={showMargin} marginPct={marginPct} />
        ))}
      </div>
    </div>
  );
}

// ── LedSection — projekt-poziom: wybór materiału LED + długość ───────────────

function isLedCategory(cat: { slug: string; name: string }) {
  const hay = (cat.slug + " " + cat.name).toLowerCase();
  return hay.includes("led");
}

function LedSection({ totalLed }: { totalLed: number }) {
  const { ledConfig, setLedConfig } = useEditorStore();
  const { categories, materials, refresh } = useMaterialsStore();

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ledMaterials = useMemo(() => {
    const ledCats = categories.filter(isLedCategory);
    if (ledCats.length > 0) {
      const slugs = new Set(ledCats.map((c) => c.slug));
      return materials.filter((m) => slugs.has(m.category));
    }
    return materials;
  }, [categories, materials]);

  const hasLed = !!ledConfig.materialId;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-gray-500" />
          <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Taśma LED</span>
        </div>
        {hasLed && totalLed > 0 && (
          <span className="text-gray-100 font-mono text-xs">{formatPln(totalLed)}</span>
        )}
      </div>

      <div className="bg-[#252525] rounded px-2.5 py-2.5 space-y-2">
        {/* Materiał LED */}
        <div>
          <div className="text-gray-400 text-[10px] mb-0.5">Materiał</div>
          <select
            value={ledConfig.materialId ?? ""}
            onChange={(e) => setLedConfig({ materialId: e.target.value || null })}
            className="w-full bg-[#161616] border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 appearance-none focus:outline-none focus:border-blue-500"
          >
            <option value="">Brak LEDów</option>
            {ledMaterials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.base_price != null ? ` — ${m.base_price.toFixed(2)} zł/mb` : ""}
              </option>
            ))}
          </select>
        </div>

        {hasLed && (
          <>
            {/* Długość */}
            <div>
              <div className="text-gray-400 text-[10px] mb-0.5">Długość taśmy</div>
              <div className="flex items-center gap-1.5">
                <input
                  name="led_strip_length_m"
                  aria-label="Długość taśmy LED w metrach bieżących"
                  type="number"
                  min="0"
                  step="0.1"
                  value={ledConfig.lengthM ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : parseFloat(e.target.value);
                    setLedConfig({ lengthM: v != null && isFinite(v) && v > 0 ? v : null });
                  }}
                  placeholder="0"
                  className="flex-1 bg-[#161616] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-gray-400 text-[10px] shrink-0">mb</span>
              </div>
            </div>

            {/* Zasilacz */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer select-none">
                <input
                  name="led_has_power_supply"
                  type="checkbox"
                  checked={ledConfig.hasPowerSupply}
                  onChange={(e) => setLedConfig({ hasPowerSupply: e.target.checked })}
                  className="rounded border-gray-600 bg-[#161616] text-blue-500 focus:ring-0"
                />
                <span className="text-xs text-gray-400">Zasilacz LED</span>
              </label>
              {ledConfig.hasPowerSupply && (
                <div className="flex items-center gap-1.5">
                  <input
                    name="led_power_supply_price"
                    aria-label="Cena zasilacza LED za sztukę"
                    type="number"
                    min="0"
                    step="0.01"
                    value={ledConfig.powerSupplyPrice ?? ""}
                    onChange={(e) => setLedConfig({ powerSupplyPrice: parseFloat(e.target.value) || null })}
                    placeholder="0.00"
                    className="flex-1 bg-[#161616] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-gray-400 text-[10px] shrink-0">zł/szt.</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── CostPanel ─────────────────────────────────────────────────────────────────

export function CostPanelContent() {
  const pricing = usePricing();
  const { projects, activeProjectId } = useProjectStore();
  const { categories } = useMaterialsStore();
  const addToast = useToastStore((s) => s.addToast);

  // Slug kategorii → czytelna nazwa typu (np. "pleksa" → "Pleksa") na potrzeby PDF.
  const categoryLabel = (slug: string | null): string | null =>
    slug ? (categories.find((c) => c.slug === slug)?.name ?? slug) : null;
  const [marginPct, setMarginPct] = useState(30);
  const [exporting, setExporting] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const materialGroups = pricing.groupedItems.filter((g) => g.lineType === "material");
  const dystansGroups = pricing.groupedItems.filter((g) => g.lineType === "dystans");


  const hasAnyData = pricing.items.length > 0 || pricing.totalLed > 0;

  async function exportPdf(isQuote: boolean) {
    if (!activeProject) return;
    setExporting(true);
    try {
      const savePath = await save({
        defaultPath: isQuote
          ? `Wycena_${activeProject.name}.pdf`
          : `Koszty_${activeProject.name}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!savePath) return;

      await invoke("export_costs_pdf", {
        input: {
          project_name: activeProject.name,
          save_path: savePath,
          items: pricing.items.map((item) => ({
            label: item.label,
            material_name: item.materialName,
            thickness_mm: item.thicknessMm,
            area_cm2: item.areaCm2,
            path_length_m: item.pathLengthM,
            quantity: item.quantity,
            unit_cost: item.unitCost,
            total_cost: item.totalCost,
            line_type: item.lineType,
          })),
          grouped_items: pricing.groupedItems.map((g) => ({
            line_type: g.lineType,
            material_name: g.materialName,
            category_label: categoryLabel(g.category),
            thickness_mm: g.thicknessMm,
            total_area_cm2: g.totalAreaCm2,
            total_path_length_m: g.totalPathLengthM,
            total_quantity: g.totalQuantity,
            total_cost: g.totalCost,
          })),
          total_material: pricing.totalMaterial,
          total_cutting: pricing.totalCutting,
          total_led: pricing.totalLed,
          grand_total: pricing.grandTotal,
          margin_pct: isQuote ? marginPct : 0,
          is_quote: isQuote,
        },
      });
      addToast(`PDF zapisany`, "success");
    } catch (e) {
      addToast(`Błąd eksportu PDF: ${e}`, "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {!hasAnyData ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <DollarSign className="w-6 h-6 text-gray-700 mb-2" />
            <p className="text-gray-600 text-xs">
              Przypisz materiały z cenami do elementów
            </p>
          </div>
        ) : (
          <>
            <GroupedSection
              title="Materiały"
              icon={<Layers className="w-3 h-3" />}
              groups={[...materialGroups, ...dystansGroups]}
              showMargin={false}
              marginPct={0}
            />
            <LedSection totalLed={pricing.totalLed} />
          </>
        )}
      </div>

      {/* Podsumowanie */}
      {hasAnyData && (
        <div className="border-t border-gray-800 px-3 py-3 space-y-1.5 shrink-0">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Materiały</span>
            <span className="font-mono">{formatPln(pricing.totalMaterial)}</span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>Cięcie</span>
            <span className="font-mono">{formatPln(pricing.totalCutting)}</span>
          </div>
          {pricing.totalLed > 0 && (
            <div className="flex justify-between text-xs text-gray-500">
              <span>LED</span>
              <span className="font-mono">{formatPln(pricing.totalLed)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-semibold text-gray-200 pt-1 border-t border-gray-800">
            <span>Koszty własne</span>
            <span className="font-mono">{formatPln(pricing.grandTotal)}</span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <label htmlFor="cost-margin" className="text-gray-500 text-xs">Marża</label>
            <input
              id="cost-margin"
              name="cost_margin_pct"
              type="number"
              min="0"
              max="999"
              step="1"
              value={marginPct}
              onChange={(e) => setMarginPct(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-14 bg-[#252525] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 text-center focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-gray-500 text-xs">%</span>
            <span className="ml-auto text-gray-200 text-xs font-mono">
              {formatPln(pricing.grandTotal * (1 + marginPct / 100))}
            </span>
          </div>
        </div>
      )}

      {/* Przyciski PDF */}
      <div className="border-t border-gray-800 px-3 py-3 space-y-2 shrink-0">
        <button
          onClick={() => exportPdf(true)}
          disabled={exporting || !hasAnyData}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-gray-300 bg-[#252525] hover:bg-[#2e2e2e] border border-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <FileText className="w-3.5 h-3.5" />
          Pobierz wycenę (PDF)
        </button>
        <button
          onClick={() => exportPdf(false)}
          disabled={exporting || !hasAnyData}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-gray-300 bg-[#252525] hover:bg-[#2e2e2e] border border-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <FileText className="w-3.5 h-3.5" />
          Pobierz koszty (PDF)
        </button>
      </div>
    </div>
  );
}
