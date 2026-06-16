import { useEffect, useMemo } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useGenerationStore } from "../stores/generationStore";
import { useMaterialsStore } from "../stores/materialsStore";
import { useProjectStore } from "../stores/projectStore";
import { usePromptPresets } from "./usePromptPresets";
import {
  assemblePrompt,
  assemblePromptItems,
  getProductNoun,
  buildTimeOfDayPrompt,
  type VisualInputs,
  type PromptItem,
  type PresetEntry,
} from "../lib/promptAssembler";
import { buildElements } from "../lib/buildElements";
import { providerForModel } from "../lib/provider";
import type { SignConfig } from "../types";

/**
 * Składa prompt z bieżącej konfiguracji panelu generowania + tekstów aktywnych presetów.
 * To "podgląd na żywo" — faktyczne generowanie używa tego samego assemblera w
 * `useGeneration`, ale z zadanymi obrazami (kompozyt z canvasa, zdjęcia materiałów).
 *
 * `usePromptPresets` ma lokalny `useState`, więc każda instancja hooka ma własny
 * stan — ładujemy presety także tutaj, żeby podgląd działał niezależnie od tego,
 * czy `PresetsKanban` zdążył je już doczytać.
 */
/**
 * Wewnętrzny helper — buduje config + visualInputs + listę presetów z anchorami
 * z aktualnego stanu stores. Używany przez oba hooki niżej (string + items).
 */
function useAssembleArgs() {
  const { nodeOverrides, backgroundPath, svgContent } = useEditorStore();
  const { materials, categories } = useMaterialsStore();
  const {
    led, camera, cameraDirty, timeOfDay, timeOfDayTextOverride, timeOfDayAnchor,
    referenceImages, activePresetIds, presetAnchors, presetTextOverrides, model,
  } = useGenerationStore();
  // productType pochodzi z aktywnego projektu (per projekt, nie per generowanie).
  const { projects, activeProjectId } = useProjectStore();
  const productType = projects.find((p) => p.id === activeProjectId)?.product_type ?? null;
  const { presets, loadPresets } = usePromptPresets();
  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  return useMemo(() => {
    const elements = buildElements(nodeOverrides, materials, categories);
    const signConfig: SignConfig = {
      elements,
      hasDistances: elements.some((el) => el.hasDistances),
      distanceMaterial: elements.find((el) => el.hasDistances)?.material ?? null,
      led,
      camera,
      background: backgroundPath ?? null,
      timeOfDay,
      productType,
    };

    const svgTexts: string[] = [];
    if (svgContent) {
      try {
        const doc = new DOMParser().parseFromString(svgContent, "image/svg+xml");
        doc.querySelectorAll("text, tspan").forEach((el) => {
          const t = (el.textContent ?? "").trim();
          if (t && !svgTexts.includes(t)) svgTexts.push(t);
        });
      } catch {
        // ignore
      }
    }

    const visualInputs: VisualInputs = {
      hasBackground: !!backgroundPath,
      hasSvg: !!svgContent,
      referenceImageCount: referenceImages.length,
      referenceDescriptions: referenceImages.map((img) => img.description ?? ""),
      svgTexts,
    };

    // Buduj presety z anchorami — zachowaj kolejność wg activePresetIds.
    // Tekst: override (z PromptPanel inline edit) > oryginalny preset.text.
    const byId = new Map(presets.map((p) => [p.id, p]));
    const presetEntries: PresetEntry[] = activePresetIds
      .map((id): PresetEntry | null => {
        const p = byId.get(id);
        if (!p) return null;
        return {
          id: p.id,
          label: p.label,
          text: presetTextOverrides[id] ?? p.text,
          anchor: presetAnchors[id] ?? "__end__",
        };
      })
      .filter((x): x is PresetEntry => x !== null);

    // Pseudo-preset "Środowisko" — auto-tekst lub ręczny override.
    const productNoun = getProductNoun(productType);
    const ledActive = led.backlit.enabled || led.frontlit.enabled;
    const hasBg2 = !!backgroundPath;
    const todAutoText = buildTimeOfDayPrompt(timeOfDay, ledActive, hasBg2, productNoun);
    const todText = timeOfDayTextOverride ?? todAutoText;
    const timeOfDayPreset: { text: string; anchor?: string } | null =
      timeOfDay !== "brak" && todText
        ? { text: todText, anchor: timeOfDayAnchor }
        : null;

    const targetModel = providerForModel(model);

    return {
      signConfig,
      visualInputs,
      options: { cameraDirty, presets: presetEntries, timeOfDayPreset, targetModel },
    };
  }, [
    nodeOverrides, materials, categories, led, camera, cameraDirty, backgroundPath,
    svgContent, timeOfDay, timeOfDayTextOverride, timeOfDayAnchor,
    referenceImages, activePresetIds, presetAnchors, presetTextOverrides, presets, productType, model,
  ]);
}

export function useAssembledPrompt(): string {
  const args = useAssembleArgs();
  return useMemo(
    () => assemblePrompt(args.signConfig, args.visualInputs, args.options),
    [args]
  );
}

/**
 * Zwraca strukturalną listę elementów promptu (fragmenty + presety inline).
 * UI w PromptPanel używa tej funkcji do renderowania badges presetów między
 * auto-fragmentami z możliwością drag&drop, usuwania i edycji.
 */
export function useAssembledPromptItems(): PromptItem[] {
  const args = useAssembleArgs();
  return useMemo(
    () => assemblePromptItems(args.signConfig, args.visualInputs, args.options),
    [args]
  );
}
