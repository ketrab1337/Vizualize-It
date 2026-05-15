import { useEffect, useState } from "react";
import { Plus, ImageIcon, Pencil, Trash2, Loader2, X, Upload, Tag, ChevronDown, ChevronRight } from "lucide-react";
import { useMaterials, useCategories, type MaterialInput } from "../../hooks/useMaterials";
import { useMaterialsStore } from "../../stores/materialsStore";
import { ColorPicker } from "../ui/ColorPicker";
import { useToastStore } from "../../stores/toastStore";
import type { Material, MaterialCategory } from "../../types";

// ── Typy ──────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  category: string;
  material_type: "matowa" | "mleczna" | "polysk" | "lustro" | null;
  color_hex: string;
  photo_path: string | null;
  pricing_unit: "per_piece" | "per_m2" | "per_mb_cut" | null;
  base_price: string;
  default_thickness_mm: string;
}

const DEFAULT_FORM: FormState = {
  name: "",
  category: "plexa",
  material_type: "matowa",
  color_hex: "#ffffff",
  photo_path: null,
  pricing_unit: "per_m2",
  base_price: "",
  default_thickness_mm: "",
};

const THICKNESS_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

const PRICING_UNIT_LABELS: Record<string, string> = {
  per_piece: "za sztukę",
  per_m2: "za m² powierzchni",
  per_mb_cut: "za mb cięcia",
};

const TYPE_LABELS: Record<string, string> = {
  matowa: "Matowa",
  mleczna: "Mleczna",
  polysk: "Połysk",
  lustro: "Lustro",
};

// ── MaterialCard ──────────────────────────────────────────────────────────────

interface MaterialCardProps {
  material: Material;
  photoUrl: string | undefined;
  onEdit: (m: Material) => void;
}

function MaterialCard({ material, photoUrl, onEdit }: MaterialCardProps) {
  return (
    <button
      onClick={() => onEdit(material)}
      className="group relative bg-[#1e1e1e] border border-gray-800 rounded-lg overflow-hidden hover:border-gray-600 transition-colors text-left"
    >
      <div className="aspect-square bg-[#161616] flex items-center justify-center relative overflow-hidden">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={material.name}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : material.color_hex ? (
          <div className="w-full h-full" style={{ backgroundColor: material.color_hex }} />
        ) : (
          <ImageIcon className="w-8 h-8 text-gray-700" />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Pencil className="w-4 h-4 text-white drop-shadow" />
        </div>
      </div>
      <div className="p-2.5">
        <p className="text-gray-200 text-xs font-medium truncate">{material.name}</p>
        <p className="text-gray-600 text-[11px] mt-0.5">
          {material.category === "plexa"
            ? (material.material_type ? TYPE_LABELS[material.material_type] ?? material.material_type : "Plexa")
            : material.material_type
              ? TYPE_LABELS[material.material_type] ?? material.material_type
              : null}
          {material.color_hex && (
            <span
              className="inline-block w-2 h-2 rounded-full ml-1.5 align-middle border border-gray-700"
              style={{ backgroundColor: material.color_hex }}
            />
          )}
        </p>
      </div>
    </button>
  );
}

// ── CategorySection ───────────────────────────────────────────────────────────

interface CategorySectionProps {
  category: MaterialCategory;
  materials: Material[];
  photoCache: Record<string, string>;
  onEdit: (m: Material) => void;
  onAddInCategory: (categorySlug: string) => void;
}

function CategorySection({ category, materials, photoCache, onEdit, onAddInCategory }: CategorySectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-gray-200 transition-colors"
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : <ChevronDown className="w-3.5 h-3.5" />}
          <span className="text-xs font-semibold uppercase tracking-wider">{category.name}</span>
          <span className="text-[11px] text-gray-600 ml-1">{materials.length}</span>
        </button>
        <div className="flex-1 h-px bg-gray-800" />
        <button
          onClick={() => onAddInCategory(category.slug)}
          className="text-[11px] text-gray-600 hover:text-blue-400 transition-colors flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Dodaj
        </button>
      </div>

      {!collapsed && (
        materials.length === 0 ? (
          <p className="text-gray-700 text-xs italic pl-5">Brak materiałów w tej kategorii</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
            {materials.map((mat) => (
              <MaterialCard
                key={mat.id}
                material={mat}
                photoUrl={photoCache[mat.id]}
                onEdit={onEdit}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── CategoryManagerModal ──────────────────────────────────────────────────────

interface CategoryManagerModalProps {
  categories: MaterialCategory[];
  onClose: () => void;
  onChanged: () => void;
}

function CategoryManagerModal({ categories, onClose, onChanged }: CategoryManagerModalProps) {
  const { createCategory, deleteCategory } = useCategories();
  const addToast = useToastStore((s) => s.addToast);
  const [newName, setNewName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setIsAdding(true);
    try {
      await createCategory(trimmed);
      setNewName("");
      addToast(`Kategoria "${trimmed}" dodana`, "success");
      onChanged();
    } catch (e) {
      addToast(`Błąd dodawania kategorii: ${e}`, "error");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    try {
      await deleteCategory(id);
      addToast(`Kategoria "${name}" usunięta`, "info");
      setConfirmDeleteId(null);
      onChanged();
    } catch (e) {
      addToast(`Błąd usuwania kategorii: ${e}`, "error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#1e1e1e] rounded-lg shadow-xl w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-white font-medium text-sm">Zarządzaj kategoriami</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Lista kategorii */}
          <ul className="space-y-1.5">
            {categories.map((cat) => (
              <li key={cat.id} className="flex items-center justify-between gap-2 py-1.5 px-3 rounded-md bg-[#161616]">
                <div className="flex items-center gap-2 min-w-0">
                  <Tag className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                  <span className="text-gray-200 text-sm truncate">{cat.name}</span>
                </div>

                {confirmDeleteId === cat.id ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] text-red-400">Usuń?</span>
                      <button
                        onClick={() => handleDelete(cat.id, cat.name)}
                        className="px-2 py-1 rounded text-[11px] bg-red-700 hover:bg-red-600 text-white transition-colors"
                      >
                        Tak
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 rounded text-[11px] text-gray-400 hover:text-gray-200 transition-colors"
                      >
                        Nie
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(cat.id)}
                      className="text-gray-700 hover:text-red-400 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
              </li>
            ))}
          </ul>

          {/* Dodaj nową kategorię */}
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">Nowa kategoria</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="np. Akryl, Dibond..."
                className="flex-1 bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleAdd}
                disabled={isAdding || !newName.trim()}
                className="flex items-center gap-1 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isAdding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Dodaj
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MaterialModal ─────────────────────────────────────────────────────────────

interface MaterialModalProps {
  material: Material | null;
  defaultCategory?: string;
  categories: MaterialCategory[];
  onClose: () => void;
  onSaved: () => void;
}

function MaterialModal({ material, defaultCategory, categories, onClose, onSaved }: MaterialModalProps) {
  const { createMaterial, updateMaterial, deleteMaterial, pickAndCopyPhoto, getPhotoDataUrl } =
    useMaterials();
  const { refresh } = useMaterialsStore();
  const addToast = useToastStore((s) => s.addToast);

  const initialCategory = material?.category ?? defaultCategory ?? "plexa";

  const [form, setForm] = useState<FormState>(
    material
      ? {
          name: material.name,
          category: material.category,
          material_type: material.material_type as FormState["material_type"],
          color_hex: material.color_hex ?? "#ffffff",
          photo_path: material.photo_path ?? null,
          pricing_unit: material.pricing_unit ?? "per_m2",
          base_price: material.base_price != null ? String(material.base_price) : "",
          default_thickness_mm: material.default_thickness_mm != null ? String(material.default_thickness_mm) : "",
        }
      : { ...DEFAULT_FORM, category: initialCategory }
  );
  const [photoPreview, setPhotoPreview] = useState<string>("");
  const [isPickingPhoto, setIsPickingPhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (material?.photo_path) {
      getPhotoDataUrl(material.photo_path)
        .then(setPhotoPreview)
        .catch(() => setPhotoPreview(""));
    }
  }, [material?.photo_path]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePickPhoto() {
    setIsPickingPhoto(true);
    try {
      const path = await pickAndCopyPhoto();
      if (!path) return;
      setField("photo_path", path);
      const preview = await getPhotoDataUrl(path);
      setPhotoPreview(preview);
    } catch (e) {
      addToast(`Błąd wczytywania zdjęcia: ${e}`, "error");
    } finally {
      setIsPickingPhoto(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      addToast("Podaj nazwę materiału", "error");
      return;
    }
    setIsSaving(true);
    try {
      const basePrice = form.base_price !== "" ? parseFloat(form.base_price) : null;
      const defThickness = form.default_thickness_mm !== "" ? parseFloat(form.default_thickness_mm) : null;
      const input: MaterialInput = {
        name: form.name.trim(),
        category: form.category,
        material_type: form.category === "plexa" ? form.material_type : null,
        color_hex: form.color_hex || null,
        photo_path: form.photo_path,
        pricing_unit: form.pricing_unit,
        base_price: basePrice != null && isFinite(basePrice) ? basePrice : null,
        default_thickness_mm: defThickness != null && isFinite(defThickness) ? defThickness : null,
      };
      if (material) {
        await updateMaterial(material.id, input);
        addToast("Materiał zaktualizowany", "success");
      } else {
        await createMaterial(input);
        addToast("Materiał dodany", "success");
      }
      await refresh();
      onSaved();
    } catch (e) {
      addToast(`Błąd zapisu: ${e}`, "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!material) return;
    try {
      await deleteMaterial(material.id);
      addToast("Materiał usunięty", "info");
      onSaved();
    } catch (e) {
      addToast(`Błąd usuwania: ${e}`, "error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#1e1e1e] rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-white font-medium text-sm">
            {material ? "Edytuj materiał" : "Nowy materiał"}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Nazwa */}
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">Nazwa</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="np. Złote lustro 3mm"
              className="w-full bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Kategoria */}
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">Kategoria</label>
            <select
              value={form.category}
              onChange={(e) => {
                const cat = e.target.value;
                setField("category", cat);
                if (cat !== "plexa") setField("material_type", null);
                else setField("material_type", "matowa");
              }}
              className="w-full bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.slug}>{cat.name}</option>
              ))}
            </select>
          </div>

          {/* Typ powierzchni — tylko dla plexa */}
          {form.category === "plexa" && (
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">Typ powierzchni</label>
              <select
                value={form.material_type ?? "matowa"}
                onChange={(e) => setField("material_type", e.target.value as FormState["material_type"])}
                className="w-full bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="matowa">Matowa</option>
                <option value="mleczna">Mleczna</option>
                <option value="polysk">Połysk</option>
                <option value="lustro">Lustro</option>
              </select>
            </div>
          )}

          {/* Kolor */}
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">Kolor</label>
            <ColorPicker
              value={form.color_hex}
              onChange={(hex) => setField("color_hex", hex)}
            />
          </div>

          {/* Zdjęcie referencyjne */}
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">Zdjęcie referencyjne</label>
            <div className="flex items-start gap-3">
              <button
                onClick={handlePickPhoto}
                disabled={isPickingPhoto}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-gray-300 bg-[#252525] hover:bg-[#2e2e2e] border border-gray-700 transition-colors disabled:opacity-50 shrink-0"
              >
                {isPickingPhoto ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                Wybierz plik
              </button>
              {photoPreview ? (
                <div className="relative w-14 h-14 rounded-md overflow-hidden border border-gray-700 shrink-0">
                  <img src={photoPreview} alt="Podgląd" className="w-full h-full object-cover" />
                  <button
                    onClick={() => { setField("photo_path", null); setPhotoPreview(""); }}
                    className="absolute top-0.5 right-0.5 bg-black/70 rounded text-white p-0.5"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ) : (
                <div className="w-14 h-14 rounded-md border border-gray-800 bg-[#161616] flex items-center justify-center shrink-0">
                  <ImageIcon className="w-5 h-5 text-gray-700" />
                </div>
              )}
            </div>
          </div>

          {/* ── Wycena ─────────────────────────────────────────────── */}
          <div className="border-t border-gray-800 pt-4 space-y-3">
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Wycena</p>

            {/* Jednostka rozliczania */}
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">Rozliczanie</label>
              <select
                value={form.pricing_unit ?? "per_m2"}
                onChange={(e) => setField("pricing_unit", e.target.value as FormState["pricing_unit"])}
                className="w-full bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {Object.entries(PRICING_UNIT_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {/* Cena bazowa */}
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">
                Cena (zł / {PRICING_UNIT_LABELS[form.pricing_unit ?? "per_m2"]})
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.base_price}
                onChange={(e) => setField("base_price", e.target.value)}
                placeholder="0.00"
                className="w-full bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>

            {/* Domyślna grubość */}
            {form.pricing_unit !== "per_piece" && (
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">Domyślna grubość (mm)</label>
                <div className="flex gap-2">
                  <select
                    value={THICKNESS_OPTIONS.includes(Number(form.default_thickness_mm)) ? form.default_thickness_mm : ""}
                    onChange={(e) => setField("default_thickness_mm", e.target.value)}
                    className="flex-1 bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">— wybierz —</option>
                    {THICKNESS_OPTIONS.map((t) => (
                      <option key={t} value={String(t)}>{t} mm</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={form.default_thickness_mm}
                    onChange={(e) => setField("default_thickness_mm", e.target.value)}
                    placeholder="lub wpisz"
                    className="w-24 bg-[#161616] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            )}

            {/* Stawki cięcia konfigurowane globalnie w Ustawieniach → Stawki cięcia */}
            {form.pricing_unit === "per_mb_cut" && (
              <p className="text-gray-600 text-xs italic">
                Stawki cięcia per grubość konfigurowane globalnie w Ustawieniach → Stawki cięcia
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-800">
          <div>
            {material && !confirmDelete && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Usuń
              </button>
            )}
            {material && confirmDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Na pewno?</span>
                <button
                  onClick={handleDelete}
                  className="px-2.5 py-1.5 rounded text-xs bg-red-700 hover:bg-red-600 text-white transition-colors"
                >
                  Usuń
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Anuluj
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            >
              Anuluj
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {material ? "Zapisz zmiany" : "Dodaj materiał"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MaterialLibrary (główny komponent) ────────────────────────────────────────

export function MaterialLibrary() {
  const { categories, materials, photoCache, isLoading, refresh } = useMaterialsStore();
  const addToast = useToastStore((s) => s.addToast);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [defaultCategory, setDefaultCategory] = useState<string>("plexa");
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  useEffect(() => {
    refresh().catch((e) => addToast(`Błąd ładowania materiałów: ${e}`, "error"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd(categorySlug?: string) {
    setDefaultCategory(categorySlug ?? categories[0]?.slug ?? "plexa");
    setEditingMaterial(null);
    setModalOpen(true);
  }

  function openEdit(m: Material) {
    setEditingMaterial(m);
    setModalOpen(true);
  }

  function handleModalClose() {
    setModalOpen(false);
    setEditingMaterial(null);
  }

  function handleSaved() {
    setModalOpen(false);
    setEditingMaterial(null);
    refresh().catch((e) => addToast(`Błąd odświeżania: ${e}`, "error"));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <div>
          <h2 className="text-white font-medium">Biblioteka materiałów</h2>
          <p className="text-gray-600 text-xs mt-0.5">
            {materials.length} {materials.length === 1 ? "materiał" : "materiałów"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCategoryManagerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-[#252525] border border-gray-800 transition-colors"
          >
            <Tag className="w-3.5 h-3.5" />
            Kategorie
          </button>
          <button
            onClick={() => openAdd()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj materiał
          </button>
        </div>
      </div>

      {/* Sekcje materiałów pogrupowane po kategorii */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
          </div>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <p className="text-gray-500 text-sm">Brak kategorii materiałów</p>
          </div>
        ) : (
          categories.map((cat) => (
            <CategorySection
              key={cat.id}
              category={cat}
              materials={materials.filter((m) => m.category === cat.slug)}
              photoCache={photoCache}
              onEdit={openEdit}
              onAddInCategory={openAdd}
            />
          ))
        )}
      </div>

      {/* Modal materiału */}
      {modalOpen && (
        <MaterialModal
          material={editingMaterial}
          defaultCategory={defaultCategory}
          categories={categories}
          onClose={handleModalClose}
          onSaved={handleSaved}
        />
      )}

      {/* Modal zarządzania kategoriami */}
      {categoryManagerOpen && (
        <CategoryManagerModal
          categories={categories}
          onClose={() => setCategoryManagerOpen(false)}
          onChanged={() => refresh().catch((e) => addToast(`Błąd odświeżania: ${e}`, "error"))}
        />
      )}
    </div>
  );
}
