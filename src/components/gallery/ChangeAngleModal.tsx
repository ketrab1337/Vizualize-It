import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Modal } from "../ui/Modal";
import { CameraWidget } from "../generation/CameraWidget";
import { buildCameraPrompt } from "../../lib/promptAssembler";
import { getDb } from "../../lib/db";
import { useToastStore } from "../../stores/toastStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { CameraConfig } from "../../types";
import type { GalleryImage } from "../../hooks/useGallery";

const DEFAULT_CAMERA: CameraConfig = { rotateDeg: 0, moveForward: 5, verticalTilt: 0 };

function modelLabel(m: string): string {
  if (m === "nano-banana-pro") return "Nano Banana Pro";
  if (m === "gpt-image-2") return "GPT Image 2";
  return "Nano Banana 2";
}

interface ChangeAngleModalProps {
  img: GalleryImage;
  projectSlug: string;
  open: boolean;
  onClose: () => void;
  onNewImage: (img: GalleryImage) => void;
}

function buildEditPrompt(cam: CameraConfig): string {
  const camText = buildCameraPrompt(cam.rotateDeg, cam.moveForward, cam.verticalTilt);
  const base =
    "Zmień WYŁĄCZNIE perspektywę kamery. Absolutnie nie wolno zmieniać: " +
    "kolorów materiałów, tekstów, napisów, logo, układu elementów szyldu, oświetlenia ani tła. " +
    "Zachowaj IDENTYCZNIE cały wygląd i treść szyldu.";
  if (camText) {
    return `${base} Nowy kąt kamery: ${camText}.`;
  }
  return `${base} Ustaw kamerę na widok frontalny ze średniej odległości.`;
}


export function ChangeAngleModal({
  img,
  projectSlug,
  open,
  onClose,
  onNewImage,
}: ChangeAngleModalProps) {
  const [camera, setCamera] = useState<CameraConfig>(DEFAULT_CAMERA);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);
  const changeAngleModel = useSettingsStore((s) => s.changeAngleModel);

  const handleClose = useCallback(() => {
    if (generating) return;
    setError(null);
    onClose();
  }, [generating, onClose]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);

    const prompt = buildEditPrompt(camera);

    try {
      const result = await invoke<{ file_path: string; abs_path: string; mime_type: string }>(
        "edit_image_angle",
        {
          input: {
            project_slug: projectSlug,
            file_path: img.file_path,
            camera_prompt: prompt,
            model: changeAngleModel,
          },
        }
      );

      // Zapisz nową sesję i obraz do SQLite
      const db = await getDb();
      const sessionId = crypto.randomUUID();
      const imageId = crypto.randomUUID();
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
          img.project_id,
          prompt,
          null,
          changeAngleModel,
          img.format || "1:1",
          1,
          camera.rotateDeg,
          camera.verticalTilt,
          camera.moveForward,
          0,
          null,
          0,
          null,
          now,
        ]
      );

      await db.execute(
        `INSERT INTO generated_images
           (id, session_id, project_id, file_path, width, height, is_favorite, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [imageId, sessionId, img.project_id, result.file_path, null, null, 0, now]
      );

      onNewImage({
        id: imageId,
        session_id: sessionId,
        project_id: img.project_id,
        file_path: result.file_path,
        width: null,
        height: null,
        is_favorite: 0,
        created_at: now,
        model: changeAngleModel,
        format: img.format || "1:1",
      });

      addToast("Wygenerowano wariant z nowym kątem kamery.", "success");
      setCamera(DEFAULT_CAMERA);
      setError(null);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }, [camera, img, projectSlug, onNewImage, addToast, onClose, changeAngleModel]);

  return (
    <Modal title="Zmień kąt kamery" open={open} onClose={handleClose} size="lg">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Ustaw nową perspektywę — model AI z ustawień (
          <span className="text-gray-300">{modelLabel(changeAngleModel)}</span>
          ) wygeneruje wariant szyldu z wybranego kąta. Materiały i styl zostaną zachowane.
        </p>

        {/* Widget kamery w trybie kontrolowanym */}
        <CameraWidget value={camera} onChange={setCamera} />

        {/* Podgląd tekstu promptu kamerowego */}
        <div className="bg-[#111] border border-gray-800 rounded-md px-3 py-2 text-xs text-gray-500 font-mono">
          {buildEditPrompt(camera)}
        </div>

        {/* Błąd */}
        {error && (
          <div className="flex items-start gap-2.5 bg-red-950/40 border border-red-800/50 rounded-md px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">{error}</p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={handleClose}
            disabled={generating}
            className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            {generating ? "Generuję wariant…" : "Generuj wariant"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
