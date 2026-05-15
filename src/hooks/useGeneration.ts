import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../lib/db";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useGenerationStore } from "../stores/generationStore";
import { useToastStore } from "../stores/toastStore";
import { useMaterialsStore } from "../stores/materialsStore";
import { assemblePrompt } from "../lib/promptAssembler";
import type { VisualInputs } from "../lib/promptAssembler";
import { buildElements } from "../lib/buildElements";
import { captureCanvas } from "../lib/paperCanvas";
import type { SignConfig, GeneratedImageFile } from "../types";

/** Pobiera base64 z data URL (format "data:mime;base64,XXX"). */
function dataUrlToBase64(dataUrl: string): { data: string; mime_type: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { data: match[2], mime_type: match[1] };
}

export function useGeneration() {
  const [generating, setGenerating] = useState(false);

  const { projects, activeProjectId } = useProjectStore();
  const { nodeOverrides, backgroundPath, backgroundDataUrl, setActiveTab } = useEditorStore();
  const { materials } = useMaterialsStore();
  const { model, format, count, led, camera, cameraDirty, userPrompt, promptOverride, timeOfDay, referenceImages, activePresets, batchMode, setLastGeneratedImageIds } =
    useGenerationStore();
  const addToast = useToastStore((s) => s.addToast);

  const generate = useCallback(async () => {
    const project = projects.find((p) => p.id === activeProjectId);
    if (!project) return;

    setGenerating(true);
    try {
      const elements = buildElements(nodeOverrides, materials);

      // Zbierz zdjęcia referencyjne materiałów
      const materialImages: { data: string; mime_type: string }[] = [];
      for (const el of elements) {
        if (el.material?.photo_path) {
          try {
            const dataUrl = await invoke<string>("get_material_photo", {
              path: el.material.photo_path,
            });
            const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
            if (match) {
              materialImages.push({ data: match[2], mime_type: match[1] });
            }
          } catch {
            // brak zdjęcia nie blokuje generowania
          }
        }
      }

      // Przygotuj obrazy wejściowe: tło i zrzut canvasu (SVG z nałożonymi kolorami materiałów)
      let backgroundImageInput: { data: string; mime_type: string } | null = null;
      let svgImageInput: { data: string; mime_type: string } | null = null;

      if (backgroundDataUrl) {
        backgroundImageInput = dataUrlToBase64(backgroundDataUrl);
      }

      const canvasPng = captureCanvas();
      if (canvasPng) {
        svgImageInput = { data: canvasPng, mime_type: "image/png" };
      }

      // Zbuduj prompt
      const visualInputs: VisualInputs = {
        hasBackground: !!backgroundImageInput,
        hasSvg: !!svgImageInput,
      };
      const signConfig: SignConfig = {
        elements,
        hasDistances: elements.some((e) => e.hasDistances),
        distanceMaterial: elements.find((e) => e.hasDistances)?.material ?? null,
        led,
        camera,
        background: backgroundPath ?? null,
        timeOfDay,
      };
      // Presety lecą jako część assembled promptu (są też widoczne w podglądzie).
      // User prompt zostaje osobny — to swobodny tekst od użytkownika.
      const presetTexts = activePresets.map((p) => p.text).filter(Boolean);
      const finalPrompt =
        promptOverride ?? assemblePrompt(signConfig, visualInputs, { cameraDirty, presetTexts });
      const finalUserPrompt = promptOverride ? null : (userPrompt.trim() || null);

      const referenceImageInputs = referenceImages
        .map((img) => dataUrlToBase64(img.dataUrl))
        .filter((x): x is { data: string; mime_type: string } => x !== null);

      const generationInput = {
        project_slug: project.slug,
        prompt: finalPrompt,
        user_prompt: finalUserPrompt,
        model,
        format,
        count,
        material_images: materialImages,
        background_image: backgroundImageInput,
        svg_image: svgImageInput,
        reference_images: referenceImageInputs,
      };

      if (batchMode) {
        // Tryb batch: zapisz payload na dysk + dodaj rekord do kolejki
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

      // Tryb normalny: wywołaj komendę Rust bezpośrednio
      const files = await invoke<GeneratedImageFile[]>("generate_image", {
        input: generationInput,
      });

      if (files.length === 0) {
        addToast("Generowanie zakończyło się bez obrazów.", "error");
        return;
      }

      // Zapisz sesję i obrazy do SQLite
      const db = await getDb();
      const sessionId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.execute(
        `INSERT INTO generation_sessions
           (id, project_id, prompt_assembled, prompt_user, model, format, count,
            camera_rotate, camera_tilt, camera_distance,
            led_backlit_enabled, led_backlit_color,
            led_frontlit_enabled, led_frontlit_color, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          sessionId,
          project.id,
          finalPrompt,
          promptOverride ? null : userPrompt || null,
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
      addToast(`Błąd generowania: ${e}`, "error", { label: "Spróbuj ponownie", fn: generate });
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
    model,
    format,
    count,
    led,
    camera,
    cameraDirty,
    userPrompt,
    promptOverride,
    timeOfDay,
    referenceImages,
    activePresets,
    batchMode,
    addToast,
    setActiveTab,
    setLastGeneratedImageIds,
  ]);

  return { generate, generating };
}
