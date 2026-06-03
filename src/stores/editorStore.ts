import { create } from "zustand";
import type { NodeOverride, SignElement, PerspectiveCorners } from "../types";

export type ProjectTab = "edytor" | "generowanie" | "galeria";

export interface SelectedItemBounds {
  widthMm: number;
  heightMm: number;
  pathLengthMm: number;
  areaMm2: number;
}

export interface LedProjectConfig {
  materialId: string | null;
  lengthM: number | null;
  hasPowerSupply: boolean;
  powerSupplyPrice: number | null;
}

const LED_CONFIG_DEFAULT: LedProjectConfig = {
  materialId: null,
  lengthM: null,
  hasPowerSupply: false,
  powerSupplyPrice: null,
};

interface EditorStore {
  elements: SignElement[];
  selectedElementId: string | null;
  selectedItemBounds: SelectedItemBounds | null;
  boundsPerElement: Record<string, SelectedItemBounds>;
  /** Mapa child nodeId → parent nodeId. Używana w wycenie do pominięcia dzieci
   *  gdy przodek ma już przypisany materiał (unikanie podwójnego liczenia). */
  parentMap: Record<string, string>;
  activeTab: ProjectTab;
  svgContent: string | null;
  backgroundDataUrl: string | null;
  backgroundPath: string | null;
  nodeOverrides: Record<string, NodeOverride>;
  ledConfig: LedProjectConfig;
  /**
   * 4 punkty perspektywy ściany (znormalizowane 0..1 do wymiarów tła).
   * `null` = bez warpu (SVG na płasko). Persystencja per projekt w
   * `projects.perspective_corners` (migracja 018).
   */
  perspectiveCorners: PerspectiveCorners | null;
  /**
   * UI flag — czy pokazywać overlay z 4 handlami w edytorze. Stan UI, NIE
   * persystowany. Odpalany togglem w toolbarze. Sam `perspectiveCorners`
   * decyduje czy captureCanvas() warpuje (UI mode pokazuje tylko narożniki).
   */
  perspectiveEditing: boolean;
  setElements: (elements: SignElement[]) => void;
  setSelectedElement: (id: string | null) => void;
  setSelectedItemBounds: (bounds: SelectedItemBounds | null) => void;
  setBoundsForElement: (nodeId: string, bounds: SelectedItemBounds) => void;
  removeBoundsForElement: (nodeId: string) => void;
  clearBoundsPerElement: () => void;
  setParentMap: (map: Record<string, string>) => void;
  setChildParent: (childId: string, parentId: string) => void;
  removeFromParentMap: (childId: string) => void;
  selectedElementIds: string[];
  setSelectedElementIds: (ids: string[]) => void;
  setActiveTab: (tab: ProjectTab) => void;
  setSvgContent: (content: string | null) => void;
  setBackground: (dataUrl: string, path: string) => void;
  clearBackground: () => void;
  setNodeOverride: (id: string, override: Partial<NodeOverride>) => void;
  renameNodeOverride: (oldId: string, newId: string) => void;
  removeNodeOverride: (id: string) => void;
  clearNodeOverrides: () => void;
  setLedConfig: (patch: Partial<LedProjectConfig>) => void;
  setPerspectiveCorners: (corners: PerspectiveCorners | null) => void;
  setPerspectiveEditing: (active: boolean) => void;
  resetEditor: () => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  elements: [],
  selectedElementId: null,
  selectedItemBounds: null,
  boundsPerElement: {},
  parentMap: {},
  activeTab: "edytor",
  svgContent: null,
  backgroundDataUrl: null,
  backgroundPath: null,
  nodeOverrides: {},
  ledConfig: { ...LED_CONFIG_DEFAULT },
  perspectiveCorners: null,
  perspectiveEditing: false,
  selectedElementIds: [],
  setSelectedElementIds: (ids) => set({ selectedElementIds: ids }),
  setElements: (elements) => set({ elements }),
  setSelectedElement: (id) => set({ selectedElementId: id }),
  setSelectedItemBounds: (bounds) => set({ selectedItemBounds: bounds }),
  setBoundsForElement: (nodeId, bounds) =>
    set((state) => ({
      boundsPerElement: { ...state.boundsPerElement, [nodeId]: bounds },
    })),
  removeBoundsForElement: (nodeId) =>
    set((state) => {
      if (!(nodeId in state.boundsPerElement)) return state;
      const next = { ...state.boundsPerElement };
      delete next[nodeId];
      return { boundsPerElement: next };
    }),
  clearBoundsPerElement: () => set({ boundsPerElement: {} }),
  setParentMap: (map) => set({ parentMap: map }),
  setChildParent: (childId, parentId) =>
    set((state) => ({ parentMap: { ...state.parentMap, [childId]: parentId } })),
  removeFromParentMap: (childId) =>
    set((state) => {
      if (!(childId in state.parentMap)) return state;
      const next = { ...state.parentMap };
      delete next[childId];
      return { parentMap: next };
    }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSvgContent: (content) => set({ svgContent: content }),
  setBackground: (dataUrl, path) =>
    set((state) => {
      if (state.backgroundDataUrl?.startsWith("blob:")) URL.revokeObjectURL(state.backgroundDataUrl);
      return { backgroundDataUrl: dataUrl, backgroundPath: path };
    }),
  clearBackground: () =>
    set((state) => {
      if (state.backgroundDataUrl?.startsWith("blob:")) URL.revokeObjectURL(state.backgroundDataUrl);
      return { backgroundDataUrl: null, backgroundPath: null };
    }),
  setNodeOverride: (id, override) =>
    set((state) => ({
      nodeOverrides: {
        ...state.nodeOverrides,
        [id]: { ...state.nodeOverrides[id], ...override } as NodeOverride,
      },
    })),
  renameNodeOverride: (oldId, newId) =>
    set((state) => {
      if (oldId === newId) return state;
      const existing = state.nodeOverrides[oldId];
      if (!existing) return state;
      const next = { ...state.nodeOverrides };
      delete next[oldId];
      next[newId] = { ...existing, ...next[newId] } as NodeOverride;
      return { nodeOverrides: next };
    }),
  removeNodeOverride: (id) =>
    set((state) => {
      if (!(id in state.nodeOverrides)) return state;
      const next = { ...state.nodeOverrides };
      delete next[id];
      return { nodeOverrides: next };
    }),
  clearNodeOverrides: () => set({ nodeOverrides: {} }),
  setLedConfig: (patch) =>
    set((state) => ({ ledConfig: { ...state.ledConfig, ...patch } })),
  setPerspectiveCorners: (corners) => set({ perspectiveCorners: corners }),
  setPerspectiveEditing: (active) => set({ perspectiveEditing: active }),
  resetEditor: () =>
    // UWAGA: NIE resetujemy `activeTab` — to nawigacja UI, nie dane projektu.
    // Reset tutaj powodował bug: po wyjściu z Ustawień MainArea się remountował,
    // wołał loadEditorState → resetEditor → activeTab="edytor", co nadpisywało
    // wybór tab-a z Sidebar (Galeria/Generowanie zawsze lądowały na Edytorze).
    set({
      elements: [],
      selectedElementId: null,
      selectedItemBounds: null,
      boundsPerElement: {},
      parentMap: {},
      selectedElementIds: [],
      svgContent: null,
      backgroundDataUrl: null,
      backgroundPath: null,
      nodeOverrides: {},
      ledConfig: { ...LED_CONFIG_DEFAULT },
      perspectiveCorners: null,
      perspectiveEditing: false,
    }),
}));
