import { create } from "zustand";
import type { LedConfig, CameraConfig, AiModel, ImageFormat, TimeOfDay } from "../types";

const DEFAULT_LED: LedConfig = {
  backlit: { enabled: false, color: "#FFC87A", colorName: "ciepłobiały (3000K)", lumens: null, kelvin: null },
  frontlit: { enabled: false, color: "#FFC87A", colorName: "ciepłobiały (3000K)", lumens: null, kelvin: null },
};

const DEFAULT_CAMERA: CameraConfig = {
  rotateDeg: 0,
  moveForward: 5,
  verticalTilt: 0,
};

export interface ReferenceImage {
  dataUrl: string;
  name: string;
}

export interface ActivePreset {
  id: string;
  text: string;
}

interface GenerationStore {
  led: LedConfig;
  camera: CameraConfig;
  cameraDirty: boolean;
  model: AiModel;
  format: ImageFormat;
  count: 1 | 2 | 3 | 4;
  userPrompt: string;
  promptOverride: string | null;
  lastGeneratedImageIds: string[];
  timeOfDay: TimeOfDay;
  referenceImages: ReferenceImage[];
  activePresets: ActivePreset[];
  angleEditMode: boolean;
  batchMode: boolean;

  setLedBacklit: (patch: Partial<LedConfig["backlit"]>) => void;
  setLedFrontlit: (patch: Partial<LedConfig["frontlit"]>) => void;
  setCamera: (camera: CameraConfig) => void;
  resetCamera: () => void;
  setModel: (model: AiModel) => void;
  setFormat: (format: ImageFormat) => void;
  setCount: (count: 1 | 2 | 3 | 4) => void;
  setUserPrompt: (prompt: string) => void;
  setPromptOverride: (override: string | null) => void;
  setLastGeneratedImageIds: (ids: string[]) => void;
  setTimeOfDay: (timeOfDay: TimeOfDay) => void;
  addReferenceImage: (img: ReferenceImage) => void;
  removeReferenceImage: (index: number) => void;
  togglePreset: (preset: ActivePreset) => void;
  setAngleEditMode: (enabled: boolean) => void;
  setBatchMode: (enabled: boolean) => void;
  resetGeneration: () => void;
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  led: DEFAULT_LED,
  camera: DEFAULT_CAMERA,
  cameraDirty: false,
  model: "nano-banana-2",
  format: "16:9",
  count: 1,
  userPrompt: "",
  promptOverride: null,
  lastGeneratedImageIds: [],
  timeOfDay: "brak",
  referenceImages: [],
  activePresets: [],
  angleEditMode: false,
  batchMode: false,

  setLedBacklit: (patch) =>
    set((s) => ({ led: { ...s.led, backlit: { ...s.led.backlit, ...patch } } })),
  setLedFrontlit: (patch) =>
    set((s) => ({ led: { ...s.led, frontlit: { ...s.led.frontlit, ...patch } } })),
  setCamera: (camera) => set({ camera, cameraDirty: true }),
  resetCamera: () => set({ camera: DEFAULT_CAMERA, cameraDirty: false }),
  setModel: (model) => set({ model }),
  setFormat: (format) => set({ format }),
  setCount: (count) => set({ count }),
  setUserPrompt: (userPrompt) => set({ userPrompt }),
  setPromptOverride: (promptOverride) => set({ promptOverride }),
  setLastGeneratedImageIds: (ids) => set({ lastGeneratedImageIds: ids }),
  setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  addReferenceImage: (img) => set((s) => ({ referenceImages: [...s.referenceImages, img] })),
  removeReferenceImage: (index) =>
    set((s) => ({ referenceImages: s.referenceImages.filter((_, i) => i !== index) })),
  togglePreset: (preset) =>
    set((s) => ({
      activePresets: s.activePresets.some((p) => p.id === preset.id)
        ? s.activePresets.filter((p) => p.id !== preset.id)
        : [...s.activePresets, preset],
    })),
  setAngleEditMode: (enabled) => set({ angleEditMode: enabled }),
  setBatchMode: (enabled) => set({ batchMode: enabled }),
  resetGeneration: () =>
    set({
      led: DEFAULT_LED,
      camera: DEFAULT_CAMERA,
      cameraDirty: false,
      model: "nano-banana-2",
      format: "16:9",
      count: 1,
      userPrompt: "",
      promptOverride: null,
      lastGeneratedImageIds: [],
      timeOfDay: "brak",
      referenceImages: [],
      activePresets: [],
    }),
}));
