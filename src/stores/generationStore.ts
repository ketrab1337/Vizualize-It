import { create } from "zustand";
import type { LedConfig, CameraConfig, AiModel, ImageFormat, TimeOfDay } from "../types";

const DEFAULT_LED: LedConfig = {
  backlit: { enabled: false, color: "#FFC87A", colorName: "ciepłobiały (3000K)", lumens: null, kelvin: null, presetId: null },
  frontlit: { enabled: false, color: "#FFC87A", colorName: "ciepłobiały (3000K)", lumens: null, kelvin: null, presetId: null },
};

/** Merge snapshot.led z defaultami — zachowuje backward-compat dla starych snapshotów bez `presetId`. */
function mergeLed(s: Partial<LedConfig> | undefined): LedConfig {
  return {
    backlit: { ...DEFAULT_LED.backlit, ...(s?.backlit ?? {}) },
    frontlit: { ...DEFAULT_LED.frontlit, ...(s?.frontlit ?? {}) },
  };
}

const DEFAULT_CAMERA: CameraConfig = {
  rotateDeg: 0,
  moveForward: 5,
  verticalTilt: 0,
};

export interface ReferenceImage {
  dataUrl: string;
  name: string;
  /**
   * Opcjonalny opis roli zdjęcia w prompcie (np. "inspiracja kolorystyczna",
   * "styl oświetlenia", "referencja kompozycji"). Trafia bezpośrednio do
   * promptu — pozwala AI traktować to zdjęcie zgodnie z intencją usera zamiast
   * generycznego "Obraz N to dodatkowa inspiracja".
   */
  description?: string;
}

/**
 * Snapshot stanu generowania zapisywany per-projekt w `projects.generation_state_json`.
 * `prompt: null` oznacza tryb automatyczny (assembler składa z konfiguracji); string =
 * użytkownik nadpisał ręcznie i odtąd to on rządzi treścią aż do resetu.
 */
export interface GenerationSnapshot {
  prompt: string | null;
  activePresetIds: string[];
  /**
   * Pozycja wstawienia każdego aktywnego presetu w prompcie. Klucz: presetId,
   * wartość: ID fragmentu po którym preset ma się pojawić (np. "materials"),
   * lub "__start__"/"__end__". Brak wpisu → domyślnie "__end__".
   */
  presetAnchors: Record<string, string>;
  /**
   * Per-instancyjne nadpisanie tekstu presetu w prompcie. Klucz: presetId,
   * wartość: zmodyfikowany tekst. Edycja w panelu prompta zapisuje tutaj —
   * nie modyfikuje globalnego presetu w bibliotece (toggling off + on zachowuje
   * override aż do następnej zmiany lub usunięcia z biblioteki).
   */
  presetTextOverrides: Record<string, string>;
  referenceImages: ReferenceImage[];
  led: LedConfig;
  camera: CameraConfig;
  cameraDirty: boolean;
  model: AiModel;
  format: ImageFormat;
  count: 1 | 2 | 3 | 4;
  timeOfDay: TimeOfDay;
  /** Nadpisany tekst fragmentu "Środowisko" w prompcie (null = auto-generowany). */
  timeOfDayTextOverride?: string | null;
  /** Anchor fragmentu "Środowisko" — jak presety, gdzie stoi w prompcie. */
  timeOfDayAnchor?: string;
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
  /** Nadpisany tekst fragmentu "Środowisko" w prompcie (null = auto-generowany). */
  timeOfDayTextOverride: string | null;
  /** Anchor fragmentu "Środowisko" — pozycja w prompcie jak preset. Brak = "__end__". */
  timeOfDayAnchor: string;
  referenceImages: ReferenceImage[];
  /** Tylko ID aktywnych presetów — teksty doczytujemy z biblioteki przy generowaniu. */
  activePresetIds: string[];
  /** Mapa presetId → anchor (ID fragmentu lub "__start__"/"__end__"). Brak = "__end__". */
  presetAnchors: Record<string, string>;
  /** Mapa presetId → nadpisany tekst tej instancji w prompcie (edycja inline w PromptPanel). */
  presetTextOverrides: Record<string, string>;
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
  setTimeOfDayTextOverride: (text: string | null) => void;
  setTimeOfDayAnchor: (anchor: string) => void;
  addReferenceImage: (img: ReferenceImage) => void;
  removeReferenceImage: (index: number) => void;
  setReferenceDescription: (index: number, description: string) => void;
  togglePresetId: (id: string) => void;
  setPresetAnchor: (presetId: string, anchor: string) => void;
  /** Ustaw tekst nadpisania dla danego presetu (pusty string = clear). */
  setPresetTextOverride: (presetId: string, text: string) => void;
  /** Przenieś preset w `activePresetIds` na pozycję `newIdx` (clamped do długości). */
  reorderActivePresetId: (presetId: string, newIdx: number) => void;
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
  timeOfDayTextOverride: null as string | null,
  timeOfDayAnchor: "__end__" as string,
  referenceImages: [] as ReferenceImage[],
  activePresetIds: [] as string[],
  presetAnchors: {} as Record<string, string>,
  presetTextOverrides: {} as Record<string, string>,
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
  setTimeOfDay: (timeOfDay) => set({ timeOfDay, timeOfDayTextOverride: null }),
  setTimeOfDayTextOverride: (text) => set({ timeOfDayTextOverride: text }),
  setTimeOfDayAnchor: (anchor) => set({ timeOfDayAnchor: anchor }),
  addReferenceImage: (img) => set((s) => ({ referenceImages: [...s.referenceImages, img] })),
  removeReferenceImage: (index) =>
    set((s) => ({ referenceImages: s.referenceImages.filter((_, i) => i !== index) })),
  setReferenceDescription: (index, description) =>
    set((s) => ({
      referenceImages: s.referenceImages.map((img, i) =>
        i === index ? { ...img, description } : img
      ),
    })),
  togglePresetId: (id) =>
    set((s) => {
      const isActive = s.activePresetIds.includes(id);
      if (isActive) {
        // Wyłącz: usuń anchor i override (sprzątanie po sobie)
        const nextAnchors = { ...s.presetAnchors };
        const nextOverrides = { ...s.presetTextOverrides };
        delete nextAnchors[id];
        delete nextOverrides[id];
        return {
          activePresetIds: s.activePresetIds.filter((x) => x !== id),
          presetAnchors: nextAnchors,
          presetTextOverrides: nextOverrides,
        };
      }
      return { activePresetIds: [...s.activePresetIds, id] };
    }),
  setPresetAnchor: (presetId, anchor) =>
    set((s) => ({ presetAnchors: { ...s.presetAnchors, [presetId]: anchor } })),
  setPresetTextOverride: (presetId, text) =>
    set((s) => {
      const next = { ...s.presetTextOverrides };
      if (text === "") {
        delete next[presetId];
      } else {
        next[presetId] = text;
      }
      return { presetTextOverrides: next };
    }),
  reorderActivePresetId: (presetId, newIdx) =>
    set((s) => {
      if (!s.activePresetIds.includes(presetId)) return s;
      const filtered = s.activePresetIds.filter((x) => x !== presetId);
      const clamped = Math.max(0, Math.min(newIdx, filtered.length));
      return {
        activePresetIds: [
          ...filtered.slice(0, clamped),
          presetId,
          ...filtered.slice(clamped),
        ],
      };
    }),
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
      timeOfDayTextOverride: null,
      timeOfDayAnchor: "__end__",
      referenceImages: [],
      activePresetIds: [],
      presetAnchors: {},
      presetTextOverrides: {},
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
        presetAnchors: {},
        presetTextOverrides: {},
        lastGeneratedImageIds: [],
      });
      return;
    }
    set({
      led: mergeLed(snapshot.led),
      camera: snapshot.camera ?? DEFAULT_CAMERA,
      cameraDirty: snapshot.cameraDirty ?? false,
      model: snapshot.model ?? "nano-banana-2",
      format: snapshot.format ?? "16:9",
      count: snapshot.count ?? 1,
      prompt: snapshot.prompt ?? null,
      timeOfDay: snapshot.timeOfDay ?? "brak",
      timeOfDayTextOverride: snapshot.timeOfDayTextOverride ?? null,
      timeOfDayAnchor: snapshot.timeOfDayAnchor ?? "__end__",
      referenceImages: snapshot.referenceImages ?? [],
      activePresetIds: snapshot.activePresetIds ?? [],
      presetAnchors: snapshot.presetAnchors ?? {},
      presetTextOverrides: (snapshot as { presetTextOverrides?: Record<string, string> }).presetTextOverrides ?? {},
      lastGeneratedImageIds: [],
    });
  },

  toSnapshot: () => {
    const s = get();
    return {
      prompt: s.prompt,
      activePresetIds: s.activePresetIds,
      presetAnchors: s.presetAnchors,
      presetTextOverrides: s.presetTextOverrides,
      referenceImages: s.referenceImages,
      led: s.led,
      camera: s.camera,
      cameraDirty: s.cameraDirty,
      model: s.model,
      format: s.format,
      count: s.count,
      timeOfDay: s.timeOfDay,
      timeOfDayTextOverride: s.timeOfDayTextOverride,
      timeOfDayAnchor: s.timeOfDayAnchor,
    };
  },
}));
