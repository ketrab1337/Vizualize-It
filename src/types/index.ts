export interface Project {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

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
}

export interface SignElement {
  id: string;
  label: string;
  nodeId: string;
  material: Material | null;
  colorHex: string | null;
  colorName: string | null;
  hasDistances: boolean;
  distanceMaterial: Material | null;
}

export interface LedConfig {
  backlit: {
    enabled: boolean;
    color: string;
    colorName: string;
    lumens: number | null;
    kelvin: number | null;
  };
  frontlit: {
    enabled: boolean;
    color: string;
    colorName: string;
    lumens: number | null;
    kelvin: number | null;
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
  userPrompt: string;
}
