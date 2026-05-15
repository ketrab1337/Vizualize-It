import { create } from "zustand";
import type { NodeOverride, SignElement } from "../types";

export type ProjectTab = "edytor" | "generowanie" | "galeria";

export interface SelectedItemBounds {
  widthMm: number;
  heightMm: number;
  pathLengthMm: number;
  areaMm2: number;
}

interface EditorStore {
  elements: SignElement[];
  selectedElementId: string | null;
  selectedItemBounds: SelectedItemBounds | null;
  boundsPerElement: Record<string, SelectedItemBounds>;
  activeTab: ProjectTab;
  svgContent: string | null;
  backgroundDataUrl: string | null;
  backgroundPath: string | null;
  nodeOverrides: Record<string, NodeOverride>;
  setElements: (elements: SignElement[]) => void;
  setSelectedElement: (id: string | null) => void;
  setSelectedItemBounds: (bounds: SelectedItemBounds | null) => void;
  setBoundsForElement: (nodeId: string, bounds: SelectedItemBounds) => void;
  clearBoundsPerElement: () => void;
  setActiveTab: (tab: ProjectTab) => void;
  setSvgContent: (content: string | null) => void;
  setBackground: (dataUrl: string, path: string) => void;
  clearBackground: () => void;
  setNodeOverride: (id: string, override: Partial<NodeOverride>) => void;
  renameNodeOverride: (oldId: string, newId: string) => void;
  removeNodeOverride: (id: string) => void;
  clearNodeOverrides: () => void;
  resetEditor: () => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  elements: [],
  selectedElementId: null,
  selectedItemBounds: null,
  boundsPerElement: {},
  activeTab: "edytor",
  svgContent: null,
  backgroundDataUrl: null,
  backgroundPath: null,
  nodeOverrides: {},
  setElements: (elements) => set({ elements }),
  setSelectedElement: (id) => set({ selectedElementId: id }),
  setSelectedItemBounds: (bounds) => set({ selectedItemBounds: bounds }),
  setBoundsForElement: (nodeId, bounds) =>
    set((state) => ({
      boundsPerElement: { ...state.boundsPerElement, [nodeId]: bounds },
    })),
  clearBoundsPerElement: () => set({ boundsPerElement: {} }),
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
      svgContent: null,
      backgroundDataUrl: null,
      backgroundPath: null,
      nodeOverrides: {},
    }),
}));
