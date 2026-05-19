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

async function loadPresetTexts(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const rows = await db.select<{ id: string; text: string }[]>(
    `SELECT id, text FROM prompt_presets WHERE id IN (${placeholders})`,
    ids
  );
  // Zachowaj kolejność wg `ids` (toggle order), żeby zmiana kolejności kafelków
  // przekładała się na kolejność doklejania w prompcie.
  const byId = new Map(rows.map((r) => [r.id, r.text]));
  return ids.map((id) => byId.get(id) ?? "").filter(Boolean);
}

export function useGeneration() {
  const [generating, setGenerating] = useState(false);

  const { projects, activeProjectId } = useProjectStore();
  const { nodeOverrides, backgroundPath, backgroundDataUrl, svgContent, setActiveTab } = useEditorStore();
  const { materials } = useMaterialsStore();
  const {
    model,
    format,
    count,
    led,
    camera,
    cameraDirty,
    prompt,
    timeOfDay,
    referenceImages,
    activePresetIds,
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
      const elements = buildElements(nodeOverrides, materials);

      // Zbierz zdjęcia referencyjne materiałów — DEDUPLIKACJA per material_id.
      // Wcześniej każdy element z tym samym materiałem wysyłał osobne zdjęcie,
      // przez co dla szyldu z 7 literami plexy "Niebieska" AI dostawała 7 kopii tego
      // samego obrazu. Teraz: jeden materiał = jeden Image, wszystkie elementy
      // używające tego materiału referują do tego samego numeru.
      const materialImages: { data: string; mime_type: string }[] = [];
      const materialIdToImageIdx: Record<string, number> = {};
      const seenMaterialIds = new Set<string>();
      for (const el of elements) {
        const matId = el.material?.id;
        if (!matId || !el.material?.photo_path) continue;
        if (seenMaterialIds.has(matId)) continue;
        seenMaterialIds.add(matId);
        try {
          const dataUrl = await invoke<string>("get_material_photo", {
            path: el.material.photo_path,
          });
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
          if (match) {
            materialIdToImageIdx[matId] = materialImages.length; // relatywny indeks w tablicy
            materialImages.push({ data: match[2], mime_type: match[1] });
          }
        } catch {
          // brak zdjęcia nie blokuje generowania
        }
      }

      // Przygotuj obrazy wejściowe.
      // WAŻNE: captureCanvas() zwraca KOMPOZYT (tło + SVG + etykiety) gdy jest tło.
      // Wysyłanie tła osobno DODATKOWO myli model (widzi 2 obrazy z tłem — przed/po)
      // i powoduje że losowo bierze jedno lub miesza. Dlatego:
      //   - jest kompozyt → wysyłamy TYLKO kompozyt (zawiera już tło)
      //   - brak kompozytu, ale jest tło → wysyłamy samo tło
      //   - brak obu → wysyłamy nic z edytora
      let backgroundImageInput: { data: string; mime_type: string } | null = null;
      let svgImageInput: { data: string; mime_type: string } | null = null;

      if (capture) {
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
        materialImageCount: materialImages.length,
        referenceImageCount: referenceImageInputs.length,
        svgTexts: extractSvgTexts(svgContent),
        materialIdToImageIdx,
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

      // Jeden prompt = albo użytkownik nadpisał ręcznie (`prompt: string`), albo
      // assembler składa z bieżącej konfiguracji + tekstów aktywnych presetów.
      const presetTexts = await loadPresetTexts(activePresetIds);
      const finalPrompt =
        prompt ?? assemblePrompt(signConfig, visualInputs, { cameraDirty, presetTexts });

      const generationInput = {
        project_slug: project.slug,
        prompt: finalPrompt,
        model,
        format,
        count,
        material_images: materialImages,
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
           (id, project_id, prompt_assembled, prompt_user, model, format, count,
            camera_rotate, camera_tilt, camera_distance,
            led_backlit_enabled, led_backlit_color,
            led_frontlit_enabled, led_frontlit_color, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          sessionId,
          project.id,
          finalPrompt,
          // `prompt_user` zostawiamy w schemacie (legacy) — zapisujemy null po unifikacji.
          null,
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
    svgContent,
    model,
    format,
    count,
    led,
    camera,
    cameraDirty,
    prompt,
    timeOfDay,
    referenceImages,
    activePresetIds,
    batchMode,
    addToast,
    setActiveTab,
    setLastGeneratedImageIds,
  ]);

  return { generate, generating };
}
