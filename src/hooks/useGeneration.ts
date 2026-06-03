import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../lib/db";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useGenerationStore } from "../stores/generationStore";
import { useToastStore } from "../stores/toastStore";
import { useMaterialsStore } from "../stores/materialsStore";
import { assemblePrompt, getProductNoun, buildTimeOfDayPrompt } from "../lib/promptAssembler";
import type { VisualInputs, PresetEntry } from "../lib/promptAssembler";
import { buildElements } from "../lib/buildElements";
import { captureCanvas } from "../lib/paperCanvas";
import type { SignConfig, GeneratedImageFile } from "../types";

/** Pobiera base64 z data URL (format "data:mime;base64,XXX"). */
function dataUrlToBase64(dataUrl: string): { data: string; mime_type: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { data: match[2], mime_type: match[1] };
}

/**
 * Wyciąga wszystkie teksty z SVG (z <text> i <tspan>). AI musi je odwzorować
 * DOSŁOWNIE — bez tego Nano Banana 2/Pro modyfikują nazwy (np. "Green-partners.pl"
 * → "G&N partners", "GREEN PARTNER INTERNATIONAL").
 */
function extractSvgTexts(svgContent: string | null): string[] {
  if (!svgContent) return [];
  try {
    const doc = new DOMParser().parseFromString(svgContent, "image/svg+xml");
    const texts: string[] = [];
    doc.querySelectorAll("text, tspan").forEach((el) => {
      const t = (el.textContent ?? "").trim();
      if (t && !texts.includes(t)) texts.push(t);
    });
    return texts;
  } catch {
    return [];
  }
}

/**
 * Wczytuje pełne dane aktywnych presetów (id, label, text), wzbogaca o anchory
 * i nakłada `textOverrides` (per-instancyjne edycje z PromptPanel). Zachowuje
 * kolejność wg `ids` (toggle order, po reorderowaniu w activePresetIds).
 */
async function loadPresetEntries(
  ids: string[],
  anchors: Record<string, string>,
  textOverrides: Record<string, string>
): Promise<PresetEntry[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const rows = await db.select<{ id: string; label: string; text: string }[]>(
    `SELECT id, label, text FROM prompt_presets WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id): PresetEntry | null => {
      const row = byId.get(id);
      if (!row) return null;
      return {
        id: row.id,
        label: row.label,
        text: textOverrides[id] ?? row.text,
        anchor: anchors[id] ?? "__end__",
      };
    })
    .filter((x): x is PresetEntry => x !== null);
}

export function useGeneration() {
  const [generating, setGenerating] = useState(false);

  const { projects, activeProjectId } = useProjectStore();
  const { nodeOverrides, backgroundPath, backgroundDataUrl, svgContent, perspectiveCorners, setActiveTab } = useEditorStore();
  const { materials, categories } = useMaterialsStore();
  const {
    model,
    format,
    count,
    led,
    camera,
    cameraDirty,
    prompt,
    timeOfDay,
    timeOfDayTextOverride,
    timeOfDayAnchor,
    referenceImages,
    activePresetIds,
    presetAnchors,
    presetTextOverrides,
    batchMode,
    setLastGeneratedImageIds,
  } = useGenerationStore();
  const addToast = useToastStore((s) => s.addToast);

  const generate = useCallback(async () => {
    const project = projects.find((p) => p.id === activeProjectId);
    if (!project) return;

    setGenerating(true);
    try {
      // Kompozyt canvas (tło + SVG bez etykiet — etykiety były dosłownie rysowane przez AI)
      const capture = captureCanvas();

      // buildElements używa nodeId jako label — te same identyfikatory trafiają do
      // promptu, AI rozpoznaje elementy po kolorach hex (nie po wizualnych etykietach).
      const elements = buildElements(nodeOverrides, materials, categories);

      // Przygotuj obrazy wejściowe.
      // WAŻNE: captureCanvas() zwraca KOMPOZYT (tło + SVG) gdy jest tło.
      // Wysyłanie tła osobno DODATKOWO myli model (widzi 2 obrazy z tłem — przed/po)
      // i powoduje że losowo bierze jedno lub miesza. Dlatego:
      //   - jest SVG + (opcjonalnie tło) → wysyłamy TYLKO kompozyt jako svgImageInput
      //   - brak SVG, ale jest tło → wysyłamy samo tło jako backgroundImageInput
      //   - brak obu → wysyłamy nic z edytora
      // UWAGA: capture != null NIE oznacza że jest SVG — pusty canvas też zwraca PNG.
      // Używamy svgContent (store) jako sygnał że SVG faktycznie jest załadowany.
      let backgroundImageInput: { data: string; mime_type: string } | null = null;
      let svgImageInput: { data: string; mime_type: string } | null = null;

      if (capture && svgContent) {
        svgImageInput = { data: capture.pngBase64, mime_type: "image/png" };
      } else if (backgroundDataUrl) {
        backgroundImageInput = dataUrlToBase64(backgroundDataUrl);
      }

      const referenceImageInputs = referenceImages
        .map((img) => dataUrlToBase64(img.dataUrl))
        .filter((x): x is { data: string; mime_type: string } => x !== null);

      // `hasBackground` mówi assemblerowi czy w scenie z edytora JEST tło — niezależnie
      // od tego, w którym slocie (`background_image` / `svg_image` jako kompozyt). Daje to
      // assemblerowi sygnał do gałęzi KOMPOZYT (tło + SVG nałożony) lub samo tło,
      // zamiast "czysty SVG bez tła".
      const visualInputs: VisualInputs = {
        hasBackground: !!backgroundDataUrl,
        hasSvg: !!svgImageInput,
        referenceImageCount: referenceImageInputs.length,
        referenceDescriptions: referenceImages.map((img) => img.description ?? ""),
        svgTexts: extractSvgTexts(svgContent),
      };
      const signConfig: SignConfig = {
        elements,
        hasDistances: elements.some((e) => e.hasDistances),
        distanceMaterial: elements.find((e) => e.hasDistances)?.material ?? null,
        led,
        camera,
        background: backgroundPath ?? null,
        timeOfDay,
        productType: project.product_type,
      };

      // Jeden prompt = albo użytkownik nadpisał ręcznie (`prompt: string`), albo
      // assembler składa z bieżącej konfiguracji + presetów na ich anchorach.
      const presetEntries = await loadPresetEntries(activePresetIds, presetAnchors, presetTextOverrides);

      const productNoun = getProductNoun(project.product_type ?? null);
      const ledActive = led.backlit.enabled || led.frontlit.enabled;
      const hasBg = !!backgroundDataUrl;
      const todAutoText = buildTimeOfDayPrompt(timeOfDay, ledActive, hasBg, productNoun);
      const todText = timeOfDayTextOverride ?? todAutoText;
      const timeOfDayPreset =
        timeOfDay !== "brak" && todText
          ? { text: todText, anchor: timeOfDayAnchor }
          : null;

      const targetModel = model === "gpt-image-2" ? "openai" : "gemini";
      const finalPrompt =
        prompt ?? assemblePrompt(signConfig, visualInputs, { cameraDirty, presets: presetEntries, timeOfDayPreset, targetModel, hasPerspective: !!perspectiveCorners });

      const generationInput = {
        project_slug: project.slug,
        prompt: finalPrompt,
        model,
        format,
        count,
        material_images: [] as { data: string; mime_type: string }[],
        background_image: backgroundImageInput,
        svg_image: svgImageInput,
        reference_images: referenceImageInputs,
      };

      if (batchMode) {
        const jobId = crypto.randomUUID();
        await invoke("save_batch_payload", {
          projectSlug: project.slug,
          jobId,
          payloadJson: JSON.stringify(generationInput),
        });
        const db = await getDb();
        const now = new Date().toISOString();
        await db.execute(
          `INSERT INTO batch_jobs (id, project_id, project_slug, status, model, format, count, created_at, updated_at)
           VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$7)`,
          [jobId, project.id, project.slug, model, format, count, now]
        );
        addToast("Zadanie dodane do kolejki batch.", "success");
        setActiveTab("galeria");
        return;
      }

      const files = await invoke<GeneratedImageFile[]>("generate_image", {
        input: generationInput,
      });

      if (files.length === 0) {
        addToast("Generowanie zakończyło się bez obrazów.", "error");
        return;
      }

      const db = await getDb();
      const sessionId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.execute(
        `INSERT INTO generation_sessions
           (id, project_id, prompt_assembled, model, format, count,
            camera_rotate, camera_tilt, camera_distance,
            led_backlit_enabled, led_backlit_color,
            led_frontlit_enabled, led_frontlit_color, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          sessionId,
          project.id,
          finalPrompt,
          model,
          format,
          count,
          camera.rotateDeg,
          camera.verticalTilt,
          camera.moveForward,
          led.backlit.enabled ? 1 : 0,
          led.backlit.enabled ? led.backlit.color : null,
          led.frontlit.enabled ? 1 : 0,
          led.frontlit.enabled ? led.frontlit.color : null,
          now,
        ]
      );

      const newIds: string[] = [];
      for (const f of files) {
        const imgId = crypto.randomUUID();
        newIds.push(imgId);
        await db.execute(
          `INSERT INTO generated_images
             (id, session_id, project_id, file_path, width, height, is_favorite, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [imgId, sessionId, project.id, f.file_path, null, null, 0, now]
        );
      }

      setLastGeneratedImageIds(newIds);
      const n = files.length;
      addToast(
        `Wygenerowano ${n} ${n === 1 ? "obraz" : n < 5 ? "obrazy" : "obrazów"}.`,
        "success"
      );
      setActiveTab("galeria");
    } catch (e) {
      // fn musi przejść przez ref — `generate` self-reference w body useCallback
      // tworzyło stale closure (toast pamiętał starszą wersję funkcji niż aktualnie
      // zarejestrowana, więc retry używał nieaktualnych depsów).
      addToast(`Błąd generowania: ${e}`, "error", {
        label: "Spróbuj ponownie",
        fn: () => { void generateRef.current?.(); },
      });
    } finally {
      setGenerating(false);
    }
  }, [
    projects,
    activeProjectId,
    nodeOverrides,
    materials,
    backgroundPath,
    backgroundDataUrl,
    svgContent,
    perspectiveCorners,
    model,
    format,
    count,
    led,
    camera,
    cameraDirty,
    prompt,
    timeOfDay,
    timeOfDayTextOverride,
    timeOfDayAnchor,
    referenceImages,
    activePresetIds,
    presetAnchors,
    presetTextOverrides,
    batchMode,
    addToast,
    setActiveTab,
    setLastGeneratedImageIds,
  ]);

  // Aktualizuj ref na każdym renderze — fn w toast retry'u czyta przez generateRef.current.
  const generateRef = useRef<typeof generate>(generate);
  useEffect(() => {
    generateRef.current = generate;
  });

  return { generate, generating };
}
