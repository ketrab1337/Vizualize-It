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

/**
 * Snapshot stanu generowania zapisywany per-projekt w `projects.generation_state_json`.
 * `prompt: null` oznacza tryb automatyczny (assembler składa z konfiguracji); string =
 * użytkownik nadpisał ręcznie i odtąd to on rządzi treścią aż do resetu.
 */
export interface GenerationSnapshot {
  prompt: string | null;
  activePresetIds: string[];
  referenceImages: ReferenceImage[];
  led: LedConfig;
  camera: CameraConfig;
  cameraDirty: boolean;
  model: AiModel;
  format: ImageFormat;
  count: 1 | 2 | 3 | 4;
  timeOfDay: TimeOfDay;
}

interface GenerationStore {
  led: LedConfig;
  camera: CameraConfig;
  cameraDirty: boolean;
  model: AiModel;
  format: ImageFormat;
  count: 1 | 2 | 3 | 4;
  /** Jeden, ujednolicony prompt. `null` = auto-assembler składa z bieżącej konfiguracji. */
  prompt: string | null;
  lastGeneratedImageIds: string[];
  timeOfDay: TimeOfDay;
  referenceImages: ReferenceImage[];
  /** Tylko ID aktywnych presetów — teksty doczytujemy z biblioteki przy generowaniu. */
  activePresetIds: string[];
  angleEditMode: boolean;
  batchMode: boolean;

  setLedBacklit: (patch: Partial<LedConfig["backlit"]>) => void;
  setLedFrontlit: (patch: Partial<LedConfig["frontlit"]>) => void;
  setCamera: (camera: CameraConfig) => void;
  resetCamera: () => void;
  setModel: (model: AiModel) => void;
  setFormat: (format: ImageFormat) => void;
  setCount: (count: 1 | 2 | 3 | 4) => void;
  setPrompt: (prompt: string | null) => void;
  setLastGeneratedImageIds: (ids: string[]) => void;
  setTimeOfDay: (timeOfDay: TimeOfDay) => void;
  addReferenceImage: (img: ReferenceImage) => void;
  removeReferenceImage: (index: number) => void;
  togglePresetId: (id: string) => void;
  setAngleEditMode: (enabled: boolean) => void;
  setBatchMode: (enabled: boolean) => void;
  resetGeneration: () => void;
  /** Wczytaj snapshot z zapisanego stanu projektu (lub `null` → reset do defaults). */
  applySnapshot: (snapshot: GenerationSnapshot | null) => void;
  /** Zrzut bieżącego stanu do zapisania w DB. */
  toSnapshot: () => GenerationSnapshot;
}

const DEFAULTS = {
  led: DEFAULT_LED,
  camera: DEFAULT_CAMERA,
  cameraDirty: false,
  model: "nano-banana-2" as AiModel,
  format: "16:9" as ImageFormat,
  count: 1 as 1 | 2 | 3 | 4,
  prompt: null,
  lastGeneratedImageIds: [] as string[],
  timeOfDay: "brak" as TimeOfDay,
  referenceImages: [] as ReferenceImage[],
  activePresetIds: [] as string[],
} as const;

export const useGenerationStore = create<GenerationStore>((set, get) => ({
  ...DEFAULTS,
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
  setPrompt: (prompt) => set({ prompt }),
  setLastGeneratedImageIds: (ids) => set({ lastGeneratedImageIds: ids }),
  setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  addReferenceImage: (img) => set((s) => ({ referenceImages: [...s.referenceImages, img] })),
  removeReferenceImage: (index) =>
    set((s) => ({ referenceImages: s.referenceImages.filter((_, i) => i !== index) })),
  togglePresetId: (id) =>
    set((s) => ({
      activePresetIds: s.activePresetIds.includes(id)
        ? s.activePresetIds.filter((x) => x !== id)
        : [...s.activePresetIds, id],
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
      prompt: null,
      lastGeneratedImageIds: [],
      timeOfDay: "brak",
      referenceImages: [],
      activePresetIds: [],
    }),

  applySnapshot: (snapshot) => {
    if (!snapshot) {
      set({
        led: DEFAULT_LED,
        camera: DEFAULT_CAMERA,
        cameraDirty: false,
        model: "nano-banana-2",
        format: "16:9",
        count: 1,
        prompt: null,
        timeOfDay: "brak",
        referenceImages: [],
        activePresetIds: [],
        lastGeneratedImageIds: [],
      });
      return;
    }
    set({
      led: snapshot.led ?? DEFAULT_LED,
      camera: snapshot.camera ?? DEFAULT_CAMERA,
      cameraDirty: snapshot.cameraDirty ?? false,
      model: snapshot.model ?? "nano-banana-2",
      format: snapshot.format ?? "16:9",
      count: snapshot.count ?? 1,
      prompt: snapshot.prompt ?? null,
      timeOfDay: snapshot.timeOfDay ?? "brak",
      referenceImages: snapshot.referenceImages ?? [],
      activePresetIds: snapshot.activePresetIds ?? [],
      lastGeneratedImageIds: [],
    });
  },

  toSnapshot: () => {
    const s = get();
    return {
      prompt: s.prompt,
      activePresetIds: s.activePresetIds,
      referenceImages: s.referenceImages,
      led: s.led,
      camera: s.camera,
      cameraDirty: s.cameraDirty,
      model: s.model,
      format: s.format,
      count: s.count,
      timeOfDay: s.timeOfDay,
    };
  },
}));
