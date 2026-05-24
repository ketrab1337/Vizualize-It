export interface Project {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  /**
   * Typ produktu — identyfikator z `PRODUCT_TYPE_PRESETS` (np. "tabliczka_informacyjna")
   * LUB dowolny tekst (gdy user wybrał "Inne" i wpisał własny opis).
   * NULL = domyślnie "szyld" (kompat-wstecz; istniejące projekty bez ustawionego typu).
   */
  product_type: string | null;
}

/**
 * Predefiniowane typy produktów — dropdown w ustawieniach projektu. `id` zapisywany
 * w `projects.product_type`, `noun*` używane w promptAssembler do polskiej odmiany.
 * Wartość "inne" obsługiwana specjalnie: w UI pokazuje pole tekstowe na własny opis,
 * a w DB zapisywany jest sam tekst (bez prefiksu "inne:").
 */
export interface ProductTypePreset {
  id: string;
  label: string;
  /** Mianownik (np. "szyld"). */
  nounNominative: string;
  /** Dopełniacz (np. "szyldu"). */
  nounGenitive: string;
}

export const PRODUCT_TYPE_PRESETS: ProductTypePreset[] = [
  { id: "szyld",                 label: "Szyld",                 nounNominative: "szyld",                 nounGenitive: "szyldu" },
  { id: "tabliczka_informacyjna", label: "Tabliczka informacyjna", nounNominative: "tabliczka informacyjna", nounGenitive: "tabliczki informacyjnej" },
  { id: "numer_na_dom",          label: "Numer na dom",          nounNominative: "numer na dom",          nounGenitive: "numeru na dom" },
  { id: "tablica_weselna",       label: "Tablica weselna",       nounNominative: "tablica weselna",       nounGenitive: "tablicy weselnej" },
  { id: "dekoracja_scienna",     label: "Dekoracja ścienna",     nounNominative: "dekoracja ścienna",     nounGenitive: "dekoracji ściennej" },
  { id: "litery_3d",             label: "Litery 3D",             nounNominative: "litery 3D",             nounGenitive: "liter 3D" },
];

/** Wynik zapisu obrazu przez backend (generate_image, edit_image_angle, edit_background_angle). */
export interface GeneratedImageFile {
  file_path: string;
  abs_path: string;
  mime_type: string;
}

export interface MaterialCategory {
  id: string;
  name: string;
  slug: string;
  is_system: number;
  sort_order: number;
  created_at: string;
}

export interface Material {
  id: string;
  name: string;
  category: string;
  material_type: "matowa" | "mleczna" | "polysk" | "lustro" | null;
  color_hex: string | null;
  photo_path: string | null;
  created_at: string;
  pricing_unit: "per_piece" | "per_m2" | "per_mb_cut" | null;
  base_price: number | null;
  default_thickness_mm: number | null;
}

export interface CuttingRate {
  id: string;
  material_id: string;
  thickness_mm: number;
  price_per_m: number;
}

export interface GlobalCuttingRate {
  id: string;
  category: string;
  thickness_mm: number;
  price_per_m: number;
}

export interface GenerationSession {
  id: string;
  project_id: string;
  prompt_assembled: string | null;
  prompt_user: string | null;
  model: "nano-banana-2" | "nano-banana-pro" | "gpt-image-2";
  format: "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  count: number;
  camera_rotate: number;
  camera_tilt: number;
  camera_distance: number;
  led_backlit_enabled: number;
  led_backlit_color: string | null;
  led_frontlit_enabled: number;
  led_frontlit_color: string | null;
  created_at: string;
}

export interface GeneratedImage {
  id: string;
  session_id: string;
  project_id: string;
  file_path: string;
  width: number | null;
  height: number | null;
  is_favorite: number;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  config_json: string;
  created_at: string;
}

export interface NodeOverride {
  fill: string;
  materialId: string | null;
  thicknessMm: number | null;
  quantity: number | null;
  ledLengthM: number | null;
  ledPricePerM: number | null;
  hasPowerSupply: boolean | null;
  powerSupplyPrice: number | null;
  /** Rola elementu w prompcie AI (backplate/napis/logo/dekoracja/dystans). */
  role: ElementRole | null;
  /**
   * Per-element flag czy element ma podświetlenie LED od TYŁU (backlit).
   * Kolor/temperatura/lumeny brane z globalnej konfiguracji `LedConfig.backlit`.
   * null/false → element nie świeci. Gdy ŻADEN element nie ma flag (cały szyld
   * bez per-element ustawień), globalny toggle `LedConfig.backlit.enabled`
   * decyduje czy cały produkt jest opisany jako podświetlony (backward-compat).
   */
  ledBacklit: boolean | null;
  /** Per-element flag dla podświetlenia FRONTOWEGO (front-lit, litery od przodu). */
  ledFrontlit: boolean | null;
  /**
   * Dla roli "cutout" — nodeId elementu który widoczny jest PRZEZ wycięcia.
   * Np. plexa z wyciętymi literami pokazuje plexę pod spodem (`cutoutBackingId`
   * = nodeId tej dolnej plexy). Prompt opisuje: "regiony X to plexa NAD plexą Y
   * z fizycznie wyciętymi otworami — przez wycięcia widać kolor Y".
   */
  cutoutBackingId: string | null;
}

/**
 * Rola elementu w hierarchii szyldu — używana w promptach AI do opisu warstwowości.
 * Bez tego AI dostaje płaską mapę kolorów i nie wie czy napis jest NA backplate'cie
 * czy w jednej płaszczyźnie z nim.
 */
export type ElementRole = "backplate" | "text" | "logo" | "decoration" | "distance" | "cutout";

export interface SignElement {
  id: string;
  label: string;
  nodeId: string;
  material: Material | null;
  colorHex: string | null;
  colorName: string | null;
  hasDistances: boolean;
  distanceMaterial: Material | null;
  /** Grubość materiału w mm — używana w prompcie AI do opisu głębokości. */
  thicknessMm: number | null;
  /** Rola elementu (backplate/napis/logo/...) — używana w prompcie AI do opisu warstwowości. */
  role: ElementRole | null;
  /** Czy element świeci backlit (per-element override globalnego LED toggle). */
  ledBacklit: boolean;
  /** Czy element świeci front-lit. */
  ledFrontlit: boolean;
  /** Dla roli "cutout" — nodeId elementu pokazującego się przez wycięcia. */
  cutoutBackingId: string | null;
}

export interface LedConfig {
  backlit: {
    enabled: boolean;
    color: string;
    colorName: string;
    lumens: number | null;
    kelvin: number | null;
    /** ID wybranego presetu (zachowywane między zakładkami i sesjami). null = custom. */
    presetId: string | null;
  };
  frontlit: {
    enabled: boolean;
    color: string;
    colorName: string;
    lumens: number | null;
    kelvin: number | null;
    presetId: string | null;
  };
}

export interface LedPreset {
  id: string;
  label: string;
  color_name: string;
  hex: string;
  lumens: number | null;
  kelvin: number | null;
  created_at: string;
}

export interface CameraConfig {
  rotateDeg: number;    // całkowite stopnie, zakres −90..90, krok 1
  moveForward: number;  // 0..10, krok 1
  verticalTilt: number; // −1..1, krok 0.2 (11 pozycji)
}

export interface SignConfig {
  elements: SignElement[];
  hasDistances: boolean;
  distanceMaterial: Material | null;
  led: LedConfig;
  camera: CameraConfig;
  background: string | null;
  timeOfDay: TimeOfDay;
  /** Typ produktu — z `projects.product_type`. null/undefined = domyślnie "szyld". */
  productType?: string | null;
}

export type AiModel = "nano-banana-2" | "nano-banana-pro" | "gpt-image-2";
export type ImageFormat = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
export type TimeOfDay = "dzien" | "wieczor" | "noc" | "wnetrze" | "brak";

export interface BatchJob {
  id: string;
  project_id: string;
  project_slug: string;
  /**
   * - `pending`: zapisane lokalnie, jeszcze niewysłane do dostawcy
   * - `running`: wysłane do Batch API dostawcy, czeka na wynik (do 24h)
   * - `done`: ukończone, obrazy w galerii
   * - `error`: błąd po stronie dostawcy lub przy wysyłaniu
   * - `cancelled`: anulowane przez użytkownika
   */
  status: "pending" | "running" | "done" | "error" | "cancelled";
  model: AiModel;
  format: ImageFormat;
  count: number;
  result_image_ids: string | null;
  error_text: string | null;
  /** ID zadania po stronie dostawcy (np. `batch_xxx` lub `batches/xxx`). */
  provider_batch_id: string | null;
  /** Tylko OpenAI: ID pliku wejściowego (do usunięcia po zakończeniu). */
  provider_input_file_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Wynik pollowania batcha — odzwierciedla enum `PollBatchOutput` z Rust. */
export type PollBatchResult =
  | { status: "pending" }
  | { status: "running" }
  | { status: "succeeded"; files: GeneratedImageFile[] }
  | { status: "failed"; error: string }
  | { status: "cancelled" };

export interface GenerationConfig {
  projectId: string;
  sign: SignConfig;
  model: AiModel;
  format: ImageFormat;
  count: 1 | 2 | 3 | 4;
}
