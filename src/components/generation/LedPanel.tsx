import { useEffect, useState, useRef } from "react";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { useGenerationStore } from "../../stores/generationStore";
import { useLedPresets } from "../../hooks/useLedPresets";
import type { LedPreset } from "../../types";
import { ConfirmModal } from "../ui/ConfirmModal";

interface ChannelProps {
  channelId: string;
  title: string;
  enabled: boolean;
  color: string;
  colorName: string;
  lumens: number | null;
  kelvin: number | null;
  selectedPresetId: string | null;
  presets: LedPreset[];
  onToggle: (enabled: boolean) => void;
  onColor: (hex: string, colorName: string) => void;
  onLumens: (lumens: number | null) => void;
  onKelvin: (kelvin: number | null) => void;
  onSelectPreset: (presetId: string | null) => void;
  onAddPreset: (label: string, hex: string, colorName: string, lumens: number | null, kelvin: number | null) => Promise<LedPreset>;
  onUpdatePreset: (id: string, label: string, hex: string, colorName: string, lumens: number | null, kelvin: number | null) => Promise<void>;
  onDeletePreset: (id: string) => Promise<void>;
}

function LedChannel({
  channelId, title, enabled, color, colorName, lumens, kelvin,
  selectedPresetId, presets, onToggle, onColor, onLumens, onKelvin, onSelectPreset,
  onAddPreset, onUpdatePreset, onDeletePreset,
}: ChannelProps) {
  // Zaznaczony preset przychodzi z propa (storowane w generationStore) — dzięki
  // czemu przeżywa unmount LedPanel przy zmianie zakładki Edytor/Galeria/Ustawienia.
  const selectedId = selectedPresetId;
  const setSelectedId = onSelectPreset;

  const [editingId, setEditingId] = useState<string | null>(null);
  const editingPreset = editingId ? presets.find((p) => p.id === editingId) ?? null : null;
  const [editLabel, setEditLabel] = useState("");

  // Lokalne stringi dla pól liczbowych — walidacja dopiero na blur
  const [kelvinStr, setKelvinStr] = useState(kelvin != null ? String(kelvin) : "");
  const [lumensStr, setLumensStr] = useState(lumens != null ? String(lumens) : "");

  // Synchronizuj stringi gdy wartości zmieniają się z zewnątrz (np. wybór presetu)
  useEffect(() => { setKelvinStr(kelvin != null ? String(kelvin) : ""); }, [kelvin]);
  useEffect(() => { setLumensStr(lumens != null ? String(lumens) : ""); }, [lumens]);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const newLabelRef = useRef<HTMLInputElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function handleSelectPreset(p: LedPreset) {
    setSelectedId(p.id);
    setEditingId(null);
    onColor(p.hex, p.color_name);
    onKelvin(p.kelvin);
    onLumens(p.lumens);
  }

  function handlePencil(p: LedPreset) {
    handleSelectPreset(p);
    setEditingId(p.id);
    setEditLabel(p.label);
    setShowNewForm(false);
  }

  async function handleSaveEdit() {
    if (!editingId || !editingPreset) return;
    await onUpdatePreset(editingId, editLabel.trim() || editingPreset.label, color, colorName, lumens, kelvin);
    setEditingId(null);
  }

  function handleCancelEdit() {
    if (editingPreset) {
      onColor(editingPreset.hex, editingPreset.color_name);
      onKelvin(editingPreset.kelvin);
      onLumens(editingPreset.lumens);
    }
    setEditingId(null);
  }

  function handleCustom() {
    setSelectedId(null);
    setEditingId(null);
    // Czyść wartości kanału
    onColor("#ffffff", "niestandardowy");
    onLumens(null);
    onKelvin(null);
    setShowNewForm(true);
    setTimeout(() => newLabelRef.current?.focus(), 50);
  }

  async function handleAddPreset() {
    const label = newLabel.trim();
    if (!label) return;
    const created = await onAddPreset(label, color, colorName, lumens, kelvin);
    setSelectedId(created.id);
    setNewLabel("");
    setShowNewForm(false);
  }

  function handleDelete(id: string) {
    setConfirmId(id);
  }

  function handleDeleteConfirm() {
    if (!confirmId) return;
    if (selectedId === confirmId) setSelectedId(null);
    if (editingId === confirmId) setEditingId(null);
    onDeletePreset(confirmId);
    setConfirmId(null);
  }

  function commitKelvin(raw: string) {
    if (raw.trim() === "") { onKelvin(null); return; }
    const v = parseInt(raw);
    if (!isNaN(v)) onKelvin(Math.min(10000, Math.max(1000, v)));
  }

  function commitLumens(raw: string) {
    if (raw.trim() === "") { onLumens(null); return; }
    const v = parseInt(raw);
    if (!isNaN(v)) onLumens(Math.max(0, v));
  }

  const inputCls = "bg-[#2a2a2a] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200">{title}</span>
        <button
          onClick={() => onToggle(!enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${enabled ? "bg-blue-600" : "bg-gray-700"}`}
          aria-pressed={enabled}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${enabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {enabled && (
        <div className="space-y-3">
          {/* Lista presetów */}
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const isActive = p.id === selectedId;
              const isEditing = p.id === editingId;
              return (
                <div key={p.id} className="flex items-center gap-0.5">
                  <button
                    onClick={() => handleSelectPreset(p)}
                    className={`px-2.5 py-1 rounded-l text-xs font-medium transition-colors ${
                      isEditing ? "bg-amber-600 text-white"
                      : isActive ? "bg-blue-600 text-white"
                      : "bg-[#2a2a2a] text-gray-300 hover:bg-[#333] hover:text-white"
                    }`}
                    title={p.color_name}
                  >
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: p.hex }} />
                    {p.label}
                    {p.kelvin != null && <span className="ml-1 opacity-60">{p.kelvin}K</span>}
                    {p.lumens != null && <span className="ml-1 opacity-60">{p.lumens}lm</span>}
                  </button>
                  <button
                    onClick={() => handlePencil(p)}
                    title="Edytuj preset"
                    className={`px-1.5 py-1 transition-colors ${
                      isEditing ? "bg-amber-600 text-white hover:bg-amber-700"
                      : isActive ? "bg-blue-700 text-blue-200 hover:bg-blue-800"
                      : "bg-[#2a2a2a] text-gray-500 hover:bg-[#333] hover:text-gray-300"
                    }`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    title="Usuń preset"
                    className="px-1.5 py-1 rounded-r bg-[#2a2a2a] text-gray-500 hover:bg-red-900 hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            <button
              onClick={handleCustom}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                !selectedId && !showNewForm
                  ? "bg-blue-600 text-white"
                  : "bg-[#2a2a2a] text-gray-300 hover:bg-[#333] hover:text-white"
              }`}
            >
              + Custom
            </button>
          </div>

          {/* Formularz nowego presetu */}
          {showNewForm && (
            <div className="flex items-center gap-2">
              <input
                ref={newLabelRef}
                type="text"
                placeholder="Nazwa presetu"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddPreset();
                  if (e.key === "Escape") { setShowNewForm(false); setNewLabel(""); }
                }}
                className="w-36 bg-[#2a2a2a] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
              />
              <button onClick={handleAddPreset} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white">Dodaj</button>
              <button onClick={() => { setShowNewForm(false); setNewLabel(""); }} className="px-2 py-1 bg-[#2a2a2a] hover:bg-[#333] rounded text-xs text-gray-400">Anuluj</button>
            </div>
          )}

          {/* Kolor */}
          {(() => {
            const locked = selectedId !== null && editingId === null;
            return (
              <div className="flex items-center gap-3">
                <div
                  className={`w-7 h-7 rounded border shrink-0 ${locked ? "border-gray-800 cursor-default" : "border-gray-700 cursor-pointer"}`}
                  style={{ backgroundColor: color }}
                  onClick={() => !locked && document.getElementById(`${channelId}-picker`)?.click()}
                />
                <input
                  id={`${channelId}-picker`}
                  type="color"
                  value={color}
                  onChange={(e) => { setSelectedId(null); onColor(e.target.value, "niestandardowy"); }}
                  className="sr-only"
                  disabled={locked}
                />
                <span className={`text-xs font-mono ${locked ? "text-gray-600" : "text-gray-500"}`}>{color}</span>
              </div>
            );
          })()}

          {/* Jasność + Temp */}
          {(() => {
            const locked = selectedId !== null && editingId === null;
            return (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className={`text-xs shrink-0 ${locked ? "text-gray-600" : "text-gray-400"}`}>Jasność:</span>
                  {locked ? (
                    <span className="w-24 px-2 py-1 text-xs text-gray-600">{lumens != null ? lumens : "—"}</span>
                  ) : (
                    <input
                      type="number"
                      placeholder="np. 2400"
                      value={lumensStr}
                      onChange={(e) => setLumensStr(e.target.value)}
                      onBlur={(e) => commitLumens(e.target.value)}
                      className={`w-24 ${inputCls}`}
                    />
                  )}
                  <span className={`text-xs ${locked ? "text-gray-600" : "text-gray-500"}`}>lm</span>
                  {!locked && lumens != null && (
                    <button onClick={() => { onLumens(null); setLumensStr(""); }} className="text-gray-500 hover:text-gray-300 transition-colors"><X className="w-3 h-3" /></button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs shrink-0 ${locked ? "text-gray-600" : "text-gray-400"}`}>Temp.:</span>
                  {locked ? (
                    <span className="w-24 px-2 py-1 text-xs text-gray-600">{kelvin != null ? kelvin : "—"}</span>
                  ) : (
                    <input
                      type="number"
                      placeholder="np. 3000"
                      value={kelvinStr}
                      onChange={(e) => setKelvinStr(e.target.value)}
                      onBlur={(e) => commitKelvin(e.target.value)}
                      className={`w-24 ${inputCls}`}
                    />
                  )}
                  <span className={`text-xs ${locked ? "text-gray-600" : "text-gray-500"}`}>K</span>
                  {!locked && kelvin != null && (
                    <button onClick={() => { onKelvin(null); setKelvinStr(""); }} className="text-gray-500 hover:text-gray-300 transition-colors"><X className="w-3 h-3" /></button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Tryb edycji presetu */}
          {editingId && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-400">Edytujesz: {editingPreset?.label}</span>
              <button onClick={handleSaveEdit} className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-500 rounded text-xs text-white">
                <Check className="w-3 h-3" /> Zapisz
              </button>
              <button onClick={handleCancelEdit} className="flex items-center gap-1 px-2 py-1 bg-[#2a2a2a] hover:bg-[#333] rounded text-xs text-gray-400">
                <X className="w-3 h-3" /> Anuluj
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmId !== null}
        message={`Usunąć preset „${presets.find((p) => p.id === confirmId)?.label ?? ""}"?`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}

export function LedPanel() {
  const { led, setLedBacklit, setLedFrontlit } = useGenerationStore();
  const { loadPresets, createPreset, updatePreset, deletePreset } = useLedPresets();
  const [presets, setPresets] = useState<LedPreset[]>([]);

  useEffect(() => {
    loadPresets().then(setPresets).catch(() => {});
  }, [loadPresets]);

  async function handleAddPreset(label: string, hex: string, colorName: string, lumens: number | null, kelvin: number | null): Promise<LedPreset> {
    const created = await createPreset(label, hex, colorName, lumens, kelvin);
    setPresets((prev) => [...prev, created]);
    return created;
  }

  async function handleUpdatePreset(id: string, label: string, hex: string, colorName: string, lumens: number | null, kelvin: number | null) {
    await updatePreset(id, label, hex, colorName, lumens, kelvin);
    setPresets((prev) => prev.map((p) => p.id === id ? { ...p, label, hex, color_name: colorName, lumens, kelvin } : p));
  }

  async function handleDeletePreset(id: string) {
    await deletePreset(id);
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <section className="bg-[#1a1a1a] rounded-lg p-4 space-y-5">
      <h3 className="text-sm font-semibold text-gray-100 uppercase tracking-wide">
        Podświetlenie LED
      </h3>

      <LedChannel
        channelId="backlit"
        title="Backlit (za szyldem)"
        enabled={led.backlit.enabled}
        color={led.backlit.color}
        colorName={led.backlit.colorName}
        lumens={led.backlit.lumens}
        kelvin={led.backlit.kelvin}
        selectedPresetId={led.backlit.presetId}
        presets={presets}
        onToggle={(enabled) => setLedBacklit({ enabled })}
        onColor={(color, colorName) => setLedBacklit({ color, colorName })}
        onLumens={(lumens) => setLedBacklit({ lumens })}
        onKelvin={(kelvin) => setLedBacklit({ kelvin })}
        onSelectPreset={(presetId) => setLedBacklit({ presetId })}
        onAddPreset={handleAddPreset}
        onUpdatePreset={handleUpdatePreset}
        onDeletePreset={handleDeletePreset}
      />

      <div className="border-t border-gray-800" />

      <LedChannel
        channelId="frontlit"
        title="Front-lit (litery)"
        enabled={led.frontlit.enabled}
        color={led.frontlit.color}
        colorName={led.frontlit.colorName}
        lumens={led.frontlit.lumens}
        kelvin={led.frontlit.kelvin}
        selectedPresetId={led.frontlit.presetId}
        presets={presets}
        onToggle={(enabled) => setLedFrontlit({ enabled })}
        onColor={(color, colorName) => setLedFrontlit({ color, colorName })}
        onLumens={(lumens) => setLedFrontlit({ lumens })}
        onKelvin={(kelvin) => setLedFrontlit({ kelvin })}
        onSelectPreset={(presetId) => setLedFrontlit({ presetId })}
        onAddPreset={handleAddPreset}
        onUpdatePreset={handleUpdatePreset}
        onDeletePreset={handleDeletePreset}
      />
    </section>
  );
}
