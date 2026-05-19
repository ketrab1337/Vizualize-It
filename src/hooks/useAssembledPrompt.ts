import { useEffect, useMemo } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useGenerationStore } from "../stores/generationStore";
import { useMaterialsStore } from "../stores/materialsStore";
import { usePromptPresets } from "./usePromptPresets";
import { assemblePrompt, type VisualInputs } from "../lib/promptAssembler";
import { buildElements } from "../lib/buildElements";
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
export function useAssembledPrompt(): string {
  const { nodeOverrides, backgroundPath, svgContent } = useEditorStore();
  const { materials } = useMaterialsStore();
  const { led, camera, cameraDirty, timeOfDay, referenceImages, activePresetIds } = useGenerationStore();
  const { presets, loadPresets } = usePromptPresets();
  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  return useMemo(() => {
    const elements = buildElements(nodeOverrides, materials);
    const signConfig: SignConfig = {
      elements,
      hasDistances: elements.some((el) => el.hasDistances),
      distanceMaterial: elements.find((el) => el.hasDistances)?.material ?? null,
      led,
      camera,
      background: backgroundPath ?? null,
      timeOfDay,
    };

    // Wyciągnij teksty z SVG (z <text>/<tspan>) — AI ma je odwzorować dosłownie.
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

    // Podgląd nie wykonuje captureCanvas — zaznaczamy tylko czy SVG jest obecny.
    const materialImageCount = elements.filter((el) => el.material?.photo_path).length;
    const visualInputs: VisualInputs = {
      hasBackground: !!backgroundPath,
      hasSvg: !!svgContent,
      materialImageCount,
      referenceImageCount: referenceImages.length,
      svgTexts,
    };

    // Teksty presetów — zachowaj kolejność wg activePresetIds (toggle order).
    const byId = new Map(presets.map((p) => [p.id, p.text]));
    const presetTexts = activePresetIds.map((id) => byId.get(id) ?? "").filter(Boolean);

    return assemblePrompt(signConfig, visualInputs, { cameraDirty, presetTexts });
  }, [
    nodeOverrides,
    materials,
    led,
    camera,
    cameraDirty,
    backgroundPath,
    svgContent,
    timeOfDay,
    referenceImages.length,
    activePresetIds,
    presets,
  ]);
}
