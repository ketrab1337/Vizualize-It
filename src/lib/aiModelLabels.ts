// Jedyne źródło prawdy dla etykiet modeli AI w UI. Wcześniej kopiowane do 7 plików,
// co powodowało regresje (np. "GPT-4o" zamiast "GPT Image 2" po refactor).

/** Pełna nazwa modelu — do tooltipów, dropdown'ów i list szczegółowych. */
export function modelLabel(model: string): string {
  switch (model) {
    case "nano-banana-2":   return "Nano Banana 2";
    case "nano-banana-pro": return "Nano Banana Pro";
    case "gpt-image-2":     return "GPT Image 2";
    default:                return model;
  }
}

/** Zwięzła nazwa — do kompaktowych list szablonów (badges, wąskie kolumny). */
export function modelLabelShort(model: string): string {
  switch (model) {
    case "nano-banana-2":   return "NB2";
    case "nano-banana-pro": return "NB Pro";
    case "gpt-image-2":     return "GPT Image 2";
    default:                return model;
  }
}
