import type { AiModel } from "../types";

/** Dostawca AI — Google (Gemini/Nano Banana) lub OpenAI (GPT Image). */
export type Provider = "gemini" | "openai";

/** Mapuje konkretny model na dostawcę. Oba modele Nano Banana → "gemini". */
export function providerForModel(model: AiModel): Provider {
  return model === "gpt-image-2" ? "openai" : "gemini";
}

/** Krótka, czytelna nazwa dostawcy do UI. */
export const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: "Google (Nano Banana)",
  openai: "OpenAI (GPT Image)",
};
