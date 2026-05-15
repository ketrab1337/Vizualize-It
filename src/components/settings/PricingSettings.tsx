import { useState, useEffect, useCallback } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { getDb } from "../../lib/db";
import { useMaterialsStore } from "../../stores/materialsStore";
import { useToastStore } from "../../stores/toastStore";
import type { GlobalCuttingRate } from "../../types";

const THICKNESS_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];

export function PricingSettings() {
  const { categories, globalCuttingRates, refreshGlobalRates } = useMaterialsStore();
  const addToast = useToastStore((s) => s.addToast);
  const [loading, setLoading] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newThickness, setNewThickness] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await refreshGlobalRates();
    } finally {
      setLoading(false);
    }
  }, [refreshGlobalRates]);

  useEffect(() => {
    load();
    if (categories.length > 0 && !newCategory) setNewCategory(categories[0].slug);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (categories.length > 0 && !newCategory) setNewCategory(categories[0].slug);
  }, [categories, newCategory]);

  async function handleAdd() {
    const t = parseFloat(newThickness);
    const p = parseFloat(newPrice);
    if (!newCategory || !isFinite(t) || t <= 0 || !isFinite(p) || p < 0) {
      addToast("Podaj kategorię, grubość i cenę", "error");
      return;
    }
    setSaving(true);
    try {
      const db = await getDb();
      const id = crypto.randomUUID();
      await db.execute(
        `INSERT INTO cutting_rates_global (id, category, thickness_mm, price_per_m)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(category, thickness_mm) DO UPDATE SET price_per_m = $4`,
        [id, newCategory, t, p]
      );
      setNewThickness("");
      setNewPrice("");
      await refreshGlobalRates();
    } catch (e) {
      addToast(`Błąd zapisu stawki: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rate: GlobalCuttingRate) {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM cutting_rates_global WHERE id=$1", [rate.id]);
      await refreshGlobalRates();
    } catch (e) {
      addToast(`Błąd usuwania: ${e}`, "error");
    }
  }

  // Group rates by category for display
  const ratesByCategory = new Map<string, GlobalCuttingRate[]>();
  for (const rate of globalCuttingRates) {
    if (!ratesByCategory.has(rate.category)) ratesByCategory.set(rate.category, []);
    ratesByCategory.get(rate.category)!.push(rate);
  }

  const categoryLabel = (slug: string) =>
    categories.find((c) => c.slug === slug)?.name ?? slug;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <div>
          <h2 className="text-white font-medium">Stawki</h2>
          <p className="text-gray-600 text-xs mt-0.5">
            Globalne stawki cięcia per kategoria materiału i grubość
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Formularz dodawania */}
        <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4 space-y-3">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Dodaj stawkę</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-gray-500 text-xs mb-1">Kategoria</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.slug}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1">Grubość (mm)</label>
              <div className="flex gap-1.5">
                <select
                  value={THICKNESS_OPTIONS.includes(Number(newThickness)) ? newThickness : ""}
                  onChange={(e) => setNewThickness(e.target.value)}
                  className="flex-1 bg-[#161616] border border-gray-700 rounded-md px-2 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="">—</option>
                  {THICKNESS_OPTIONS.map((t) => (
                    <option key={t} value={String(t)}>{t} mm</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={newThickness}
                  onChange={(e) => setNewThickness(e.target.value)}
                  placeholder="lub wpisz"
                  className="w-20 bg-[#161616] border border-gray-700 rounded-md px-2 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1">Cena (zł/mb)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="0.00"
                className="w-full bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          <button
            onClick={handleAdd}
            disabled={saving || !newCategory || !newThickness || !newPrice}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Dodaj stawkę
          </button>
        </div>

        {/* Tabela stawek */}
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
          </div>
        ) : globalCuttingRates.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-8">
            Brak stawek cięcia — wycena per mb cięcia użyje ceny bazowej materiału
          </p>
        ) : (
          <div className="space-y-4">
            {[...ratesByCategory.entries()].map(([slug, rates]) => (
              <div key={slug}>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
                  {categoryLabel(slug)}
                </p>
                <div className="space-y-1">
                  {rates.map((rate) => (
                    <div
                      key={rate.id}
                      className="flex items-center justify-between bg-[#1e1e1e] border border-gray-800 rounded-md px-3 py-2"
                    >
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-gray-500 w-16 shrink-0">{rate.thickness_mm} mm</span>
                        <span className="text-gray-200 font-mono">{rate.price_per_m.toFixed(2)} zł/mb</span>
                      </div>
                      <button
                        onClick={() => handleDelete(rate)}
                        className="text-gray-700 hover:text-red-400 transition-colors"
                        title="Usuń stawkę"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
