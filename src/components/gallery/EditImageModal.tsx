import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  AlertTriangle,
  Brush,
  Eraser,
  ImagePlus,
  Loader2,
  Redo2,
  RotateCcw,
  Undo2,
  Wand2,
  X,
  ZoomIn,
} from "lucide-react";
import { Modal } from "../ui/Modal";
import { getDb } from "../../lib/db";
import { useToastStore } from "../../stores/toastStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { GalleryImage } from "../../hooks/useGallery";
import type { GeneratedImageFile } from "../../types";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Lokalna nazwa różna od `ReferenceImage` z generationStore — tamten typ ma tylko
// { dataUrl, name }, a edycja wymaga jeszcze surowych bajtów base64 + mimeType
// do wysłania w multipart do API (Google Gemini / OpenAI images.edits).
interface EditReferenceImage {
  data: string; // base64 (bez prefiksu)
  mimeType: string;
  dataUrl: string; // do podglądu
  name: string;
}

interface EditImageModalProps {
  img: GalleryImage;
  /** data URL obrazu źródłowego (jeśli już załadowany w galerii). */
  src: string | undefined;
  projectSlug: string;
  open: boolean;
  onClose: () => void;
  onNewImage: (img: GalleryImage) => void;
}

type Tool = "brush" | "eraser";

const MAX_HISTORY = 25;
const MIN_BRUSH = 8;
const MAX_BRUSH = 200;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

/**
 * Zunifikowany modal edycji wizualizacji.
 *
 * Dwa tryby w jednym UI:
 * - **Bez maski**: prompt opisuje co zmienić → backend wywołuje `edit_image_angle` z modelem
 *   z ustawień (`useSettingsStore.editTextModel`).
 * - **Z maską**: użytkownik maluje pędzlem obszar → backend wywołuje `edit_image_inpaint`
 *   z OpenAI GPT Image 2 (jedyny obsługujący maski).
 *
 * Pozostałe ficzery:
 * - Live podgląd rozmiaru pędzla/gumki (kółko obok slidera)
 * - Zoom (scroll) + pan (drag środkowym przyciskiem lub shift+lewy)
 * - Undo/Redo z Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (działają tylko nad obszarem canvasa)
 */
export function EditImageModal({
  img,
  src,
  projectSlug,
  open,
  onClose,
  onNewImage,
}: EditImageModalProps) {
  // Canvasy
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Rysowanie
  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const panningRef = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);

  // Historia (snapshoty maski)
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef<number>(-1);

  // Stan UI
  const [prompt, setPrompt] = useState("");
  const [tool, setTool] = useState<Tool | null>(null);
  const [brushSize, setBrushSize] = useState(48);
  const [hasMask, setHasMask] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  /**
   * Pozycja kursora-pędzla w **canvas internal coords** (te same w których rysujemy).
   * Renderowany jest WEWNĄTRZ wrappera (z CSS transform), więc automatycznie skaluje
   * się razem z canvasem i jest zawsze w 1:1 z rysowanym strokiem.
   */
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [referenceImages, setReferenceImages] = useState<EditReferenceImage[]>([]);

  const addToast = useToastStore((s) => s.addToast);
  const editTextModel = useSettingsStore((s) => s.editTextModel);

  async function handleAddReferenceImage() {
    try {
      const path = await openDialog({
        filters: [{ name: "Obrazy", extensions: ["jpg", "jpeg", "png", "webp"] }],
        multiple: false,
      });
      if (!path || Array.isArray(path)) return;
      const bytes = await readFile(path);
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const base64 = uint8ToBase64(bytes);
      const dataUrl = `data:${mimeType};base64,${base64}`;
      const name = path.split(/[\\/]/).pop() ?? path;
      setReferenceImages((prev) => [...prev, { data: base64, mimeType, dataUrl, name }]);
    } catch (e) {
      addToast(`Błąd dodawania zdjęcia: ${e}`, "error");
    }
  }

  function handleRemoveReferenceImage(index: number) {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Helpery historii ─────────────────────────────────────────────────────
  const refreshUndoRedoState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const pushHistory = useCallback(() => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Wytnij gałąź "redo" po obecnym indeksie i dodaj nowy stan
    historyRef.current.splice(historyIndexRef.current + 1);
    historyRef.current.push(snapshot);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current = historyRef.current.length - 1;
    }
    historyIndexRef.current = historyRef.current.length - 1;
    refreshUndoRedoState();
  }, [refreshUndoRedoState]);

  const restoreFromHistory = useCallback(
    (index: number) => {
      const canvas = maskCanvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
      const snapshot = historyRef.current[index];
      if (!canvas || !ctx || !snapshot) return;
      ctx.putImageData(snapshot, 0, 0);
      // Sprawdź czy są jakiekolwiek nieprzezroczyste piksele
      let hasAny = false;
      const data = snapshot.data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) {
          hasAny = true;
          break;
        }
      }
      setHasMask(hasAny);
    },
    []
  );

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    restoreFromHistory(historyIndexRef.current);
    refreshUndoRedoState();
  }, [restoreFromHistory, refreshUndoRedoState]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    restoreFromHistory(historyIndexRef.current);
    refreshUndoRedoState();
  }, [restoreFromHistory, refreshUndoRedoState]);

  // ── Załaduj obraz i ustaw rozmiar canvasów ───────────────────────────────
  useEffect(() => {
    if (!open || !src) return;
    const imageCanvas = imageCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!imageCanvas || !maskCanvas) return;

    const image = new Image();
    image.onload = () => {
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      imageCanvas.width = w;
      imageCanvas.height = h;
      maskCanvas.width = w;
      maskCanvas.height = h;
      // Czyścimy ewentualne wcześniejsze style.width/height — canvas ma renderować się
      // w swoim INTRINSIC rozmiarze (CSS px = internal px, 1:1). Skalowanie do widoku
      // zapewnia wrapper przez CSS transform.
      imageCanvas.style.width = "";
      imageCanvas.style.height = "";
      maskCanvas.style.width = "";
      maskCanvas.style.height = "";

      const ictx = imageCanvas.getContext("2d");
      if (ictx) {
        ictx.clearRect(0, 0, w, h);
        ictx.drawImage(image, 0, 0);
      }
      const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
      if (mctx) mctx.clearRect(0, 0, w, h);

      // Reset historii — początkowy pusty stan
      historyRef.current = [mctx ? mctx.getImageData(0, 0, w, h) : new ImageData(w, h)];
      historyIndexRef.current = 0;
      refreshUndoRedoState();
      setHasMask(false);

      // Wylicz fit-to-viewport scale (wrapper się od razu skurczy żeby zmieścić obraz)
      const viewportEl = viewportRef.current;
      if (viewportEl) {
        const vw = viewportEl.clientWidth - 16; // mały margines
        const vh = viewportEl.clientHeight - 16;
        const fit = Math.min(vw / w, vh / h, 1);
        setView({ scale: fit, tx: 0, ty: 0 });
      } else {
        setView({ scale: 1, tx: 0, ty: 0 });
      }
    };
    image.src = src;
  }, [open, src, refreshUndoRedoState]);

  // ── Pozycja myszy w pikselach canvasa (uwzględnia transform CSS) ─────────
  const getCanvasPos = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);


  // ── Drawing ──────────────────────────────────────────────────────────────
  const drawAt = useCallback(
    (x: number, y: number, prevX?: number, prevY?: number) => {
      const canvas = maskCanvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !ctx) return;

      const radius = brushSize / 2;
      if (tool === "brush") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#ff3333";
        ctx.strokeStyle = "#ff3333";
      } else {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (prevX !== undefined && prevY !== undefined) {
        ctx.lineWidth = brushSize;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      setHasMask(true);
    },
    [brushSize, tool]
  );

  // ── Pointer events ───────────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (generating) return;
      // Pan: środkowy przycisk, shift+lewy lub brak aktywnego narzędzia
      if (e.button === 1 || (e.button === 0 && e.shiftKey) || (e.button === 0 && tool === null)) {
        e.preventDefault();
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        panningRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startTx: view.tx,
          startTy: view.ty,
        };
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      drawingRef.current = true;
      const pos = getCanvasPos(e);
      if (!pos) return;
      lastPosRef.current = pos;
      drawAt(pos.x, pos.y);
    },
    [generating, tool, getCanvasPos, drawAt, view.tx, view.ty]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const panning = panningRef.current;
      if (panning) {
        const dx = e.clientX - panning.startX;
        const dy = e.clientY - panning.startY;
        setView((v) => ({ ...v, tx: panning.startTx + dx, ty: panning.startTy + dy }));
        setCursorPos(null);
        return;
      }
      if (tool === null) return;
      const pos = getCanvasPos(e);
      if (pos) setCursorPos(pos);
      if (!drawingRef.current || !pos) return;
      const prev = lastPosRef.current;
      drawAt(pos.x, pos.y, prev?.x, prev?.y);
      lastPosRef.current = pos;
    },
    [tool, getCanvasPos, drawAt]
  );

  const handlePointerEnter = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (tool === null) return;
      const pos = getCanvasPos(e);
      if (pos) setCursorPos(pos);
    },
    [tool, getCanvasPos]
  );

  const handlePointerLeave = useCallback(() => {
    setCursorPos(null);
    if (panningRef.current) {
      panningRef.current = null;
      return;
    }
    if (drawingRef.current) {
      drawingRef.current = false;
      lastPosRef.current = null;
      pushHistory();
    }
  }, [pushHistory]);

  const handlePointerUp = useCallback(() => {
    if (panningRef.current) {
      panningRef.current = null;
      return;
    }
    if (drawingRef.current) {
      drawingRef.current = false;
      lastPosRef.current = null;
      pushHistory();
    }
  }, [pushHistory]);

  // ── Scroll: Ctrl = zoom, Shift = pan poziomo, zwykły = pan pionowo ──────────
  // Musi być non-passive (preventDefault) — wpinamy ręcznie przez useEffect,
  // bo React 18 rejestruje onWheel jako passive co blokuje preventDefault w WebKit.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const step = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        setView((prev) => {
          const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.scale * step));
          if (next === prev.scale) return prev;
          const f = next / prev.scale;
          return { scale: next, tx: cx * (1 - f) + prev.tx * f, ty: cy * (1 - f) + prev.ty * f };
        });
      } else if (e.shiftKey) {
        setView((prev) => ({ ...prev, tx: prev.tx - e.deltaY }));
      } else {
        setView((prev) => ({ ...prev, ty: prev.ty - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  const handleResetZoom = useCallback(() => {
    setView({ scale: 1, tx: 0, ty: 0 });
  }, []);

  // ── Clear maska ──────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasMask(false);
    pushHistory();
  }, [pushHistory]);

  // ── Eksport maski jako PNG (alpha=0 dla pomalowanego obszaru) ────────────
  // Format zgodny z OpenAI /v1/images/edits: piksele przezroczyste = obszar do zmiany.
  const exportMaskBase64 = useCallback((): string | null => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return null;
    const out = document.createElement("canvas");
    out.width = maskCanvas.width;
    out.height = maskCanvas.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(maskCanvas, 0, 0);
    const dataUrl = out.toDataURL("image/png");
    const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
    return match ? match[1] : null;
  }, []);

  // ── Eksport obrazu z visual overlay (dla Gemini, który nie ma natywnej maski) ──
  // Komponuje oryginał + półprzezroczysty czerwony obszar w miejscu maski.
  // Wynik pokazuje modelowi WIZUALNIE gdzie ma edytować — prompt instruuje go
  // żeby zignorował sam kolor czerwony i edytował tylko ten region.
  const exportImageWithOverlay = useCallback((): string | null => {
    const imageCanvas = imageCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!imageCanvas || !maskCanvas) return null;

    const out = document.createElement("canvas");
    out.width = imageCanvas.width;
    out.height = imageCanvas.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;

    // 1) Oryginał
    ctx.drawImage(imageCanvas, 0, 0);
    // 2) Wpal półprzezroczysty overlay z maski (piksele już są czerwone — patrz drawAt)
    ctx.globalAlpha = 0.55;
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalAlpha = 1.0;

    const dataUrl = out.toDataURL("image/png");
    const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
    return match ? match[1] : null;
  }, []);

  // ── Skróty klawiszowe (Ctrl+Z / Ctrl+Shift+Z — identycznie jak w edytorze) ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (generating) return;
      const target = e.target as HTMLElement | null;
      // Nie blokuj edycji w polu prompt — pozwól textarea/inputowi obsłużyć własne Ctrl+Z
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      // Używamy e.code (lokalizacja klawisza fizycznie) zamiast e.key (znak po Shifcie)
      if (e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undo();
      } else if (e.code === "KeyZ" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        redo();
      } else if (e.code === "KeyY") {
        // Dodatkowo akceptujemy Ctrl+Y jako alternatywa dla redo
        e.preventDefault();
        e.stopPropagation();
        redo();
      }
    };
    // Capture phase — przechwytujemy event ZANIM React syntetyczne handlery go zjedzą
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, generating, undo, redo]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    if (generating) return;
    setError(null);
    setPrompt("");
    setReferenceImages([]);
    setTool(null);
    onClose();
  }, [generating, onClose]);

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    setGenerating(true);
    setError(null);
    const useMask = hasMask;
    try {
      let result: GeneratedImageFile;
      let usedModel: string;

      const refsForBackend = referenceImages.map((r) => ({ data: r.data, mime_type: r.mimeType }));

      if (useMask) {
        if (editTextModel === "gpt-image-2") {
          // OpenAI — natywna maska przez /v1/images/edits (najlepsza jakość)
          const maskB64 = exportMaskBase64();
          if (!maskB64) {
            setError("Nie udało się przygotować maski.");
            setGenerating(false);
            return;
          }
          result = await invoke<GeneratedImageFile>("edit_image_inpaint", {
            input: {
              project_slug: projectSlug,
              file_path: img.file_path,
              mask_base64: maskB64,
              prompt: trimmed,
              reference_images: refsForBackend,
            },
          });
          usedModel = "gpt-image-2";
        } else {
          // Google (Gemini / Nano Banana) — brak natywnej maski w API,
          // komponujemy obraz z wpalonym czerwonym overlay-em i instruujemy
          // model wprost w prompcie, żeby edytował tylko ten obszar i zignorował
          // sam kolor markera.
          const composedB64 = exportImageWithOverlay();
          if (!composedB64) {
            setError("Nie udało się przygotować obrazu z zaznaczeniem.");
            setGenerating(false);
            return;
          }
          const overlayPrompt =
            `Edytuj wyłącznie obszar zaznaczony półprzezroczystym czerwonym kolorem. ` +
            `Czerwone zaznaczenie to wyłącznie marker regionu — NIE może pojawić się w wyniku, ` +
            `zignoruj ten kolor i wygeneruj naturalną treść w jego miejscu. ` +
            `Cały obszar BEZ czerwonego markera musi pozostać identyczny jak w wejściu — bez żadnych zmian.\n\n` +
            `Zmiana w zaznaczonym obszarze: ${trimmed}`;
          result = await invoke<GeneratedImageFile>("edit_image_marked", {
            input: {
              project_slug: projectSlug,
              image_base64: composedB64,
              prompt: overlayPrompt,
              model: editTextModel,
              reference_images: refsForBackend,
            },
          });
          usedModel = editTextModel;
        }
      } else {
        // Edycja tekstowa bez maski — model z ustawień
        result = await invoke<GeneratedImageFile>("edit_image_angle", {
          input: {
            project_slug: projectSlug,
            file_path: img.file_path,
            camera_prompt: trimmed,
            model: editTextModel,
            reference_images: refsForBackend,
          },
        });
        usedModel = editTextModel;
      }

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
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,5,0,NULL,0,NULL,$8)`,
        [
          sessionId,
          img.project_id,
          trimmed,
          null,
          usedModel,
          img.format || "1:1",
          1,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: usedModel as any,
        format: img.format || "1:1",
      });

      addToast(
        useMask ? "Wygenerowano inpainting." : "Wygenerowano wariant z edycją.",
        "success"
      );
      setPrompt("");
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }, [prompt, hasMask, exportMaskBase64, exportImageWithOverlay, img, projectSlug, editTextModel, referenceImages, onNewImage, addToast, onClose]);

  // ── UI ───────────────────────────────────────────────────────────────────
  const modelLabel = useMaskModelLabel(hasMask, editTextModel);

  return (
    <Modal title="Edytuj wizualizację" open={open} onClose={handleClose} size="xl">
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap bg-[#1a1a1a] rounded-md px-3 py-2">
          <button
            onClick={() => setTool(tool === "brush" ? null : "brush")}
            disabled={generating}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              tool === "brush"
                ? "bg-blue-600 text-white"
                : "bg-[#252525] text-gray-400 hover:text-gray-200"
            }`}
          >
            <Brush className="w-3.5 h-3.5" />
            Pędzel
          </button>
          <button
            onClick={() => setTool(tool === "eraser" ? null : "eraser")}
            disabled={generating}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              tool === "eraser"
                ? "bg-blue-600 text-white"
                : "bg-[#252525] text-gray-400 hover:text-gray-200"
            }`}
          >
            <Eraser className="w-3.5 h-3.5" />
            Gumka
          </button>

          <button
            onClick={handleClear}
            disabled={generating || !hasMask}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-[#252525] text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
            title="Wyczyść maskę"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Wyczyść maskę
          </button>

          {/* Slider rozmiaru */}
          <div className="flex items-center gap-3 ml-2 pl-3 border-l border-gray-700">
            <input
              type="range"
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              step={2}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              disabled={generating}
              className="w-32 accent-blue-500"
            />
            <span className="text-xs text-gray-400 font-mono w-10 text-right">{brushSize}px</span>
          </div>

          <div className="flex-1" />

          {/* Undo/redo */}
          <button
            onClick={undo}
            disabled={!canUndo || generating}
            className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium bg-[#252525] text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
            title="Cofnij (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo || generating}
            className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium bg-[#252525] text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
            title="Ponów (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleResetZoom}
            disabled={generating}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-[#252525] text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
            title="Resetuj zoom"
          >
            <ZoomIn className="w-3.5 h-3.5" />
            {Math.round(view.scale * 100)}%
          </button>
        </div>

        {/* Canvas viewport — elastyczny: kurczy się gdy modal jest niski,
            ale ma sensowne min/max */}
        <div
          ref={viewportRef}
          className="relative bg-[#111] rounded-md overflow-hidden flex items-center justify-center select-none"
          style={{ height: "min(55vh, max(200px, calc(100vh - 420px)))" }}
        >
          {src ? (
            <div
              ref={wrapperRef}
              className="relative"
              style={{
                transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
                transformOrigin: "50% 50%",
                willChange: "transform",
              }}
            >
              <canvas ref={imageCanvasRef} className="block" />
              <canvas
                ref={maskCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerEnter={handlePointerEnter}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerLeave}
                onPointerLeave={handlePointerLeave}
                className="absolute inset-0 touch-none"
                style={{
                  opacity: 0.5,
                  cursor: tool === null
                    ? (panningRef.current ? "grabbing" : "grab")
                    : "none",
                }}
              />
              {/* Kursor-pędzel — tylko gdy aktywny pędzel lub gumka */}
              {cursorPos && tool !== null && (
                <div
                  className="absolute pointer-events-none rounded-full"
                  style={{
                    left: cursorPos.x - brushSize / 2,
                    top: cursorPos.y - brushSize / 2,
                    width: brushSize,
                    height: brushSize,
                    border: `${Math.max(1, 2 / view.scale)}px solid rgba(255,255,255,0.95)`,
                    boxShadow: `0 0 0 ${Math.max(1, 1 / view.scale)}px rgba(0,0,0,0.7)`,
                    boxSizing: "border-box",
                  }}
                />
              )}
            </div>
          ) : (
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
          )}

        </div>

        {/* Zdjęcia referencyjne */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium text-gray-400">
              Zdjęcia referencyjne (opcjonalne)
            </label>
            <button
              onClick={handleAddReferenceImage}
              disabled={generating}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-white bg-[#2a2a2a] hover:bg-[#333] transition-colors disabled:opacity-50"
            >
              <ImagePlus className="w-3 h-3" />
              Dodaj zdjęcie
            </button>
          </div>
          {referenceImages.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {referenceImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    title={img.name}
                    className="w-14 h-14 object-cover rounded border border-gray-700"
                  />
                  <button
                    onClick={() => handleRemoveReferenceImage(i)}
                    disabled={generating}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-800 border border-gray-600 text-gray-400 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-gray-700">
              Dodaj zdjęcia z których model ma czerpać inspirację (styl, kolor, kompozycja, materiały).
            </p>
          )}
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            {hasMask
              ? "Co ma się pojawić w zaznaczonym obszarze?"
              : "Co chcesz zmienić w wizualizacji?"}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              hasMask
                ? "np. Zmień te litery na świecące neony w kolorze niebieskim…"
                : "np. Zmień kolor tła na ciemnoniebieski, dodaj efekt świecących liter…"
            }
            rows={3}
            disabled={generating}
            className="w-full bg-[#111] border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-gray-500 transition-colors disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2.5 bg-red-950/40 border border-red-800/50 rounded-md px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <span className="text-xs text-gray-500 mr-auto">
            Model: <span className="text-gray-400">{modelLabel}</span>
          </span>
          <button
            onClick={handleClose}
            disabled={generating}
            className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wand2 className="w-3.5 h-3.5" />
            )}
            {generating ? "Generuję…" : hasMask ? "Generuj (inpainting)" : "Generuj"}
          </button>
        </div>
      </div>
    </Modal>
  );
}


function useMaskModelLabel(hasMask: boolean, editTextModel: string): string {
  const base =
    editTextModel === "nano-banana-pro"
      ? "Nano Banana Pro"
      : editTextModel === "gpt-image-2"
      ? "GPT Image 2"
      : "Nano Banana 2";
  if (!hasMask) return base;
  // Z maską: OpenAI ma prawdziwy inpainting, Google używa wizualnego markera.
  if (editTextModel === "gpt-image-2") return `${base} (inpainting z maską)`;
  return `${base} (inpainting przez visual marker)`;
}
