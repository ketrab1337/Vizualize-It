import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, AlertTriangle } from "lucide-react";
import { CameraWidget } from "./CameraWidget";
import { buildCameraPrompt } from "../../lib/promptAssembler";
import { getDb } from "../../lib/db";
import { useGenerationStore } from "../../stores/generationStore";
import { useEditorStore } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import { useToastStore } from "../../stores/toastStore";

export function CameraAngleSection() {
  const { camera, angleEditMode, setAngleEditMode, resetCamera } = useGenerationStore();
  const { backgroundPath, setActiveTab } = useEditorStore();
  const { projects, activeProjectId } = useProjectStore();
  const addToast = useToastStore((s) => s.addToast);
  const [applying, setApplying] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleApply = useCallback(async () => {
    if (!backgroundPath || !activeProject) return;
    setApplying(true);
    try {
      const camText = buildCameraPrompt(camera.rotateDeg, camera.moveForward, camera.verticalTilt);
      const prompt = camText
        ? `Zmień WYŁĄCZNIE perspektywę kamery. Absolutnie nie wolno zmieniać: kolorów materiałów, tekstów, napisów, logo, układu elementów szyldu, oświetlenia ani tła. Zachowaj IDENTYCZNIE cały wygląd i treść szyldu. Nowy kąt kamery: ${camText}.`
        : "Zmień WYŁĄCZNIE perspektywę kamery na widok frontalny ze średniej odległości. Absolutnie nie wolno zmieniać: kolorów materiałów, tekstów, napisów, logo, układu elementów szyldu, oświetlenia ani tła.";

      const result = await invoke<{ file_path: string; abs_path: string; mime_type: string }>(
        "edit_background_angle",
        {
          input: {
            project_slug: activeProject.slug,
            abs_path: backgroundPath,
            camera_prompt: prompt,
          },
        }
      );

      const db = await getDb();
      const sessionId = crypto.randomUUID();
      const imageId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.execute(
        `INSERT INTO generation_sessions
           (id, project_id, prompt_assembled, model, format, count,
            camera_rotate, camera_tilt, camera_distance,
            led_backlit_enabled, led_backlit_color,
            led_frontlit_enabled, led_frontlit_color, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          sessionId, activeProject.id, prompt,
          "nano-banana-2", "16:9", 1,
          camera.rotateDeg, camera.verticalTilt, camera.moveForward,
          0, null, 0, null, now,
        ]
      );

      await db.execute(
        `INSERT INTO generated_images
           (id, session_id, project_id, file_path, width, height, is_favorite, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [imageId, sessionId, activeProject.id, result.file_path, null, null, 0, now]
      );

      addToast("Wygenerowano nowy kąt tła.", "success");
      // Navigate to gallery so ImageGrid remounts and reloads from DB
      setActiveTab("galeria");
    } catch (e) {
      addToast(`Błąd: ${e}`, "error");
    } finally {
      setApplying(false);
    }
  }, [backgroundPath, activeProject, camera, addToast, setActiveTab]);

  return (
    <div className="space-y-2">
      {/* Nagłówek z togglem */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Kąt kamery</span>
        <label className="relative cursor-pointer shrink-0">
          <input
            type="checkbox"
            className="sr-only"
            checked={angleEditMode}
            onChange={(e) => {
              setAngleEditMode(e.target.checked);
              if (!e.target.checked) resetCamera();
            }}
          />
          <div
            className={`w-10 h-5 rounded-full transition-colors ${
              angleEditMode ? "bg-blue-600" : "bg-gray-700"
            }`}
          />
          <div
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              angleEditMode ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </label>
      </div>

      {/* Widget kamery — przyciemniony gdy tryb wyłączony */}
      <div className={`relative transition-opacity ${angleEditMode ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
        <CameraWidget />
      </div>

      {/* Akcja: Zastosuj kąt do tła */}
      {angleEditMode && (
        <div className="space-y-2">
          {!backgroundPath ? (
            <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-800/40 rounded px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-400/80">
                Dodaj tło w edytorze żeby zmienić kąt zdjęcia.
              </p>
            </div>
          ) : (
            <button
              onClick={handleApply}
              disabled={applying || !activeProject}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium bg-blue-700/30 hover:bg-blue-600/40 text-blue-300 hover:text-blue-200 border border-blue-700/40 transition-colors disabled:opacity-50"
            >
              {applying && <Loader2 className="w-3 h-3 animate-spin" />}
              {applying ? "Generuję…" : "Zastosuj kąt do tła"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
