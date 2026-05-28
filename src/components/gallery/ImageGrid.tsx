import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Download,
  FileText,
  Heart,
  ImageIcon,
  LayoutGrid,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { ZoomableImage } from "../ui/ZoomableImage";
import { modelLabel } from "../../lib/aiModelLabels";
import { useGallery, type GalleryImage } from "../../hooks/useGallery";
import { useBatchJobs } from "../../hooks/useBatchJobs";
import { useEditorStore } from "../../stores/editorStore";
import { useGenerationStore } from "../../stores/generationStore";
import { useProjectStore } from "../../stores/projectStore";
import { useToastStore } from "../../stores/toastStore";
import { BatchQueuePanel } from "./BatchQueuePanel";
import { CompareModal } from "./CompareModal";
import { ChangeAngleModal } from "./ChangeAngleModal";
import { EditImageModal } from "./EditImageModal";

interface ImageGridProps {
  projectId: string;
}

type Filter = "wszystkie" | "ulubione";

// ---------------------------------------------------------------------------
// Karta pojedynczego obrazu
// ---------------------------------------------------------------------------
interface ImageCardProps {
  img: GalleryImage;
  src: string | undefined;
  isNew: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (img: GalleryImage) => void;
  onToggleFavorite: (id: string, current: number) => void;
  onDelete: (id: string, filePath: string) => void;
}

function ImageCard({
  img,
  src,
  isNew,
  selected,
  onSelect,
  onOpen,
  onToggleFavorite,
  onDelete,
}: ImageCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={`group relative rounded-lg overflow-hidden bg-[#1a1a1a] border transition-all cursor-pointer ${
        isNew
          ? "border-blue-500 ring-2 ring-blue-500/40"
          : selected
          ? "border-blue-400"
          : "border-gray-800 hover:border-gray-600"
      }`}
      onClick={() => !confirmDelete && onOpen(img)}
    >
      {/* Miniatura */}
      <div className="aspect-video flex items-center justify-center bg-[#111111]">
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : (
          <Loader2 className="w-6 h-6 text-gray-700 animate-spin" />
        )}
      </div>

      {/* Overlay potwierdzenia usunięcia */}
      {confirmDelete && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-white text-xs font-medium">Usunąć obraz?</span>
          <div className="flex gap-2">
            <button
              onClick={() => onDelete(img.id, img.file_path)}
              className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
            >
              Usuń
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1 rounded bg-[#333] hover:bg-[#444] text-gray-200 text-xs font-medium transition-colors"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Checkbox do porównania */}
      <div
        className="absolute top-2 left-2 z-10"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(img.id);
        }}
      >
        <div
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            selected
              ? "bg-blue-500 border-blue-500"
              : "bg-black/50 border-gray-500 opacity-0 group-hover:opacity-100"
          }`}
        >
          {selected && (
            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 6l3 3 5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Przyciski hover — serce + kosz */}
      <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="p-1 rounded bg-black/50 hover:bg-black/70 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(img.id, img.is_favorite);
          }}
        >
          <Heart
            className={`w-4 h-4 transition-colors ${
              img.is_favorite ? "fill-red-500 text-red-500" : "text-white"
            }`}
          />
        </button>
        <button
          className="p-1 rounded bg-black/50 hover:bg-red-700/70 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(true);
          }}
        >
          <Trash2 className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Informacje */}
      <div className="px-3 py-2">
        <p className="text-xs text-gray-200 truncate">{modelLabel(img.model)}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {new Date(img.created_at).toLocaleDateString("pl-PL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal pełnego podglądu
// ---------------------------------------------------------------------------
interface ImageViewModalProps {
  img: GalleryImage;
  src: string | undefined;
  onClose: () => void;
  onToggleFavorite: (id: string, current: number) => void;
  onDelete: (id: string, filePath: string) => void;
  onChangeAngle: () => void;
  onEdit: () => void;
}

function ImageViewModal({
  img,
  src,
  onClose,
  onToggleFavorite,
  onDelete,
  onChangeAngle,
  onEdit,
}: ImageViewModalProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const handleDownload = useCallback(async () => {
    if (!src) return;
    try {
      const ext = img.file_path.split(".").pop()?.toLowerCase() ?? "png";
      const filterName = ext === "jpg" || ext === "jpeg" ? "JPEG" : ext === "webp" ? "WebP" : "PNG";
      const dest = await save({
        defaultPath: `szyld_${img.id.slice(0, 8)}.${ext}`,
        filters: [{ name: filterName, extensions: [ext] }],
        title: "Zapisz zdjęcie jako…",
      });
      if (!dest) return;
      const sourceAbs = await invoke<string>("get_abs_path", { filePath: img.file_path });
      await invoke("copy_image_to_path", { sourceAbs, destPath: dest });
      addToast("Zapisano zdjęcie", "success");
    } catch (e) {
      addToast(`Błąd zapisu zdjęcia: ${e}`, "error");
    }
  }, [src, img.id, img.file_path, addToast]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#1a1a1a] rounded-xl overflow-hidden flex flex-col max-w-5xl max-h-[90vh] w-full shadow-2xl border border-gray-800">
        {/* Nagłówek */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div>
            <p className="text-sm text-white font-medium">{modelLabel(img.model)}</p>
            <p className="text-xs text-gray-400">
              {new Date(img.created_at).toLocaleDateString("pl-PL", {
                day: "2-digit",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Obraz z zoomem */}
        <ZoomableImage src={src} />

        {/* Pasek akcji */}
        <div className="px-4 py-3 border-t border-gray-800 flex items-center gap-2 shrink-0">
          <button
            onClick={handleDownload}
            disabled={!src}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Pobierz
          </button>

          <button
            onClick={onEdit}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#252525] hover:bg-[#2e2e2e] text-gray-300 text-xs font-medium transition-colors"
            title="Edycja tekstowa lub inpainting (pędzel + tekst)"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Edytuj
          </button>

          <button
            onClick={onChangeAngle}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#252525] hover:bg-[#2e2e2e] text-gray-300 text-xs font-medium transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Zmień kąt
          </button>

          <button
            onClick={() => onToggleFavorite(img.id, img.is_favorite)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              img.is_favorite
                ? "bg-red-900/30 text-red-400 hover:bg-red-900/50"
                : "bg-[#252525] hover:bg-[#2e2e2e] text-gray-300"
            }`}
          >
            <Heart
              className={`w-3.5 h-3.5 ${img.is_favorite ? "fill-red-400" : ""}`}
            />
            {img.is_favorite ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
          </button>

          <div className="flex-1" />

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Usunąć obraz?</span>
              <button
                onClick={() => {
                  onDelete(img.id, img.file_path);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-md bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors"
              >
                Usuń
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-md bg-[#252525] hover:bg-[#2e2e2e] text-gray-300 text-xs font-medium transition-colors"
              >
                Anuluj
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#252525] hover:bg-red-900/30 text-gray-400 hover:text-red-400 text-xs font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Usuń
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Główny komponent galerii
// ---------------------------------------------------------------------------
export function ImageGrid({ projectId }: ImageGridProps) {
  const { images, loading, loadImages, toggleFavorite, deleteImage, addImage } = useGallery();
  const { lastGeneratedImageIds, setLastGeneratedImageIds, led } = useGenerationStore();
  const { elements, setActiveTab } = useEditorStore();
  const { projects, activeProjectId } = useProjectStore();
  const addToast = useToastStore((s) => s.addToast);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const { jobs: batchJobs, cancelJob, dismissJob, loadJobs: reloadBatchJobs } = useBatchJobs(activeProjectId);

  const [filter, setFilter] = useState<Filter>("wszystkie");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dataUrls, setDataUrls] = useState<Record<string, string>>({});
  const blobUrlsRef = useRef<Record<string, string>>({});
  const [viewImage, setViewImage] = useState<GalleryImage | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [changeAngleImg, setChangeAngleImg] = useState<GalleryImage | null>(null);
  const [editImg, setEditImg] = useState<GalleryImage | null>(null);

  // Ładujemy obrazy przy zmianie projektu
  useEffect(() => {
    loadImages(projectId);
    setSelected(new Set());
  }, [projectId, loadImages]);

  // Odśwież galerię gdy zadanie batch kończy się sukcesem
  const prevJobsRef = useRef<typeof batchJobs>([]);
  useEffect(() => {
    const justDone = batchJobs.filter(
      (j) =>
        j.status === "done" &&
        !prevJobsRef.current.find((prev) => prev.id === j.id && prev.status === "done")
    );
    if (justDone.length > 0) {
      loadImages(projectId);
      reloadBatchJobs();
    }
    prevJobsRef.current = batchJobs;
  }, [batchJobs, loadImages, projectId, reloadBatchJobs]);

  // Ładujemy obrazy binarnie (bez base64) i tworzymy blob URL
  const loadingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const img of images) {
      if (dataUrls[img.id] || loadingRef.current.has(img.id)) continue;
      loadingRef.current.add(img.id);
      invoke<string>("get_abs_path", { filePath: img.file_path })
        .then((absPath) => {
          const ext = img.file_path.split(".").pop()?.toLowerCase() ?? "";
          const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
          return readFile(absPath).then((bytes) => {
            const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
            blobUrlsRef.current[img.id] = url;
            setDataUrls((prev) => ({ ...prev, [img.id]: url }));
          });
        })
        .catch(() => loadingRef.current.delete(img.id));
    }
  }, [images, dataUrls]);

  // Zwalniamy blob URL gdy komponent jest odmontowywany
  useEffect(() => {
    return () => {
      for (const url of Object.values(blobUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  // Wyczyść "nowe" po 4s
  useEffect(() => {
    if (lastGeneratedImageIds.length === 0) return;
    const t = setTimeout(() => setLastGeneratedImageIds([]), 4000);
    return () => clearTimeout(t);
  }, [lastGeneratedImageIds, setLastGeneratedImageIds]);

  const handleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const [exporting, setExporting] = useState(false);

  const handleExportPdf = useCallback(async () => {
    if (selected.size === 0 || !activeProject) return;
    setExporting(true);
    try {
      const savePath = await save({
        title: "Zapisz ofertę PDF",
        defaultPath: `oferta_${activeProject.name.replace(/\s+/g, "_")}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!savePath) return;

      const selectedImgs = images.filter((i) => selected.has(i.id));
      const materialsSpec = elements.map((el) => ({
        label: el.label,
        material_name: el.material?.name ?? null,
        color_name: el.colorName ?? null,
        has_distances: el.hasDistances,
        distance_material_name: el.distanceMaterial?.name ?? null,
      }));

      await invoke("export_offer_pdf", {
        input: {
          project_name: activeProject.name,
          save_path: savePath,
          images: selectedImgs.map((img) => ({
            file_path: img.file_path,
            model: img.model,
            created_at: img.created_at,
          })),
          materials: materialsSpec,
          led: {
            backlit_enabled: led.backlit.enabled,
            backlit_color_name: led.backlit.enabled ? led.backlit.colorName : null,
            frontlit_enabled: led.frontlit.enabled,
            frontlit_color_name: led.frontlit.enabled ? led.frontlit.colorName : null,
          },
        },
      });

      addToast("PDF oferty zapisany pomyślnie.", "success");
    } catch (e) {
      addToast(`Błąd eksportu PDF: ${e}`, "error");
    } finally {
      setExporting(false);
    }
  }, [selected, images, activeProject, elements, led, addToast]);

  const handleToggleFavorite = useCallback(
    async (id: string, current: number) => {
      try {
        await toggleFavorite(id, current);
      } catch (e) {
        addToast(`Błąd: ${e}`, "error");
      }
      // Aktualizuj viewImage jeśli jest otwarty
      setViewImage((prev) =>
        prev?.id === id ? { ...prev, is_favorite: current === 1 ? 0 : 1 } : prev
      );
    },
    [toggleFavorite, addToast]
  );

  const handleDelete = useCallback(
    async (id: string, filePath: string) => {
      try {
        await deleteImage(id, filePath);
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setDataUrls((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (blobUrlsRef.current[id]) {
          URL.revokeObjectURL(blobUrlsRef.current[id]);
          delete blobUrlsRef.current[id];
        }
      } catch (e) {
        addToast(`Błąd usuwania: ${e}`, "error");
      }
    },
    [deleteImage, addToast]
  );

  const filtered = filter === "ulubione" ? images.filter((i) => i.is_favorite) : images;
  const selectedImages = images.filter((i) => selected.has(i.id));

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Pasek narzędzi */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800 shrink-0">
        {/* Filtr */}
        <div className="flex rounded-md overflow-hidden border border-gray-700">
          {(["wszystkie", "ulubione"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              {f === "wszystkie" ? "Wszystkie" : "Ulubione"}
            </button>
          ))}
        </div>

        <span className="text-xs text-gray-400">
          {filtered.length} {filtered.length === 1 ? "obraz" : "obrazów"}
        </span>

        <div className="flex-1" />

        {/* Przyciski akcji dla zaznaczonych */}
        {selected.size >= 2 && selected.size <= 4 && (
          <button
            onClick={() => setCompareOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#252525] hover:bg-[#2e2e2e] text-gray-300 text-xs font-medium transition-colors"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Porównaj ({selected.size})
          </button>
        )}
        {selected.size >= 1 && (
          <button
            onClick={handleExportPdf}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium transition-colors"
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            Eksportuj PDF oferty ({selected.size})
          </button>
        )}
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#252525] hover:bg-[#2e2e2e] text-gray-400 text-xs transition-colors"
          >
            <X className="w-3 h-3" />
            Odznacz
          </button>
        )}
      </div>

      {/* Kolejka batch */}
      <BatchQueuePanel jobs={batchJobs} onCancel={cancelJob} onDismiss={dismissJob} />

      {/* Siatka */}
      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1a1a1a] flex items-center justify-center">
              <ImageIcon className="w-8 h-8 text-gray-700" />
            </div>
            <div className="space-y-1">
              <p className="text-gray-400 text-sm font-medium">
                {filter === "ulubione" ? "Brak ulubionych obrazów" : "Brak wygenerowanych obrazów"}
              </p>
              <p className="text-gray-600 text-xs">
                {filter === "ulubione"
                  ? "Kliknij serce na karcie obrazu, aby dodać do ulubionych."
                  : "Skonfiguruj materiały i wygeneruj pierwszą wizualizację."}
              </p>
            </div>
            {filter !== "ulubione" && (
              <button
                onClick={() => setActiveTab("generowanie")}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generuj pierwszą wizualizację
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {filtered.map((img) => (
              <ImageCard
                key={img.id}
                img={img}
                src={dataUrls[img.id]}
                isNew={lastGeneratedImageIds.includes(img.id)}
                selected={selected.has(img.id)}
                onSelect={handleSelect}
                onOpen={setViewImage}
                onToggleFavorite={handleToggleFavorite}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal pełnego podglądu */}
      {viewImage && (
        <ImageViewModal
          img={viewImage}
          src={dataUrls[viewImage.id]}
          onClose={() => setViewImage(null)}
          onToggleFavorite={handleToggleFavorite}
          onDelete={handleDelete}
          onChangeAngle={() => {
            setChangeAngleImg(viewImage);
            setViewImage(null);
          }}
          onEdit={() => {
            setEditImg(viewImage);
            setViewImage(null);
          }}
        />
      )}

      {/* Modal porównania */}
      {compareOpen && (
        <CompareModal
          images={selectedImages}
          dataUrls={dataUrls}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {/* Modal zmiany kąta */}
      {changeAngleImg && activeProject && (
        <ChangeAngleModal
          img={changeAngleImg}
          projectSlug={activeProject.slug}
          open={true}
          onClose={() => setChangeAngleImg(null)}
          onNewImage={(newImg) => {
            addImage(newImg);
            setChangeAngleImg(null);
          }}
        />
      )}

      {/* Modal edycji tekstowej */}
      {editImg && activeProject && (
        <EditImageModal
          img={editImg}
          src={dataUrls[editImg.id]}
          projectSlug={activeProject.slug}
          open={true}
          onClose={() => setEditImg(null)}
          onNewImage={(newImg) => {
            addImage(newImg);
            setEditImg(null);
          }}
        />
      )}
    </div>
  );
}
