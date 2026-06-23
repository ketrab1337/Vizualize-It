import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { getDb } from "../../lib/db";
import { useProjectStore } from "../../stores/projectStore";
import { useProject } from "../../hooks/useProject";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import type { Project } from "../../types";

interface ProjectsGridProps {
  onNewProject: () => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const PREVIEW_COLORS: [string, string][] = [
  ["#1e3a5f", "#0d1f35"],
  ["#1a3a2a", "#0d1f16"],
  ["#3a1a2a", "#1f0d16"],
  ["#2a1a3a", "#160d1f"],
  ["#3a2a1a", "#1f160d"],
  ["#1a2a3a", "#0d161f"],
  ["#2a3a1a", "#161f0d"],
  ["#3a1a1a", "#1f0d0d"],
];

function getPreviewColors(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  }
  return PREVIEW_COLORS[Math.abs(hash) % PREVIEW_COLORS.length];
}

interface ProjectCardProps {
  project: Project;
  thumbnail: string | undefined;
  onOpen: (id: string) => void;
  onDelete: (project: Project) => void;
  onRename: (id: string, name: string) => Promise<boolean>;
}

function ProjectCard({ project, thumbnail, onOpen, onDelete, onRename }: ProjectCardProps) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [from, to] = getPreviewColors(project.name);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(project.name);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }

  async function commitEdit(e?: React.MouseEvent) {
    e?.stopPropagation();
    const ok = await onRename(project.id, draft);
    if (ok) setEditing(false);
  }

  function cancelEdit(e?: React.MouseEvent) {
    e?.stopPropagation();
    setDraft(project.name);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") cancelEdit();
  }

  return (
    <div
      className={`rounded-xl overflow-hidden border transition-all bg-[#1a1a1a] ${
        editing
          ? "border-blue-600/50"
          : "border-gray-800 hover:border-gray-600 hover:shadow-lg hover:shadow-black/40 cursor-pointer"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !editing && onOpen(project.id)}
    >
      {/* Nazwa u góry */}
      <div className="px-4 pt-3.5 pb-3 flex items-center gap-2 min-w-0">
        {editing ? (
          <>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent border-b border-blue-500 text-white text-base font-medium focus:outline-none py-0.5"
            />
            <button
              onClick={commitEdit}
              title="Zapisz"
              className="shrink-0 p-1.5 rounded text-green-400 hover:bg-green-900/30 transition-colors"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={cancelEdit}
              title="Anuluj"
              className="shrink-0 p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <span className="text-white text-base font-medium truncate flex-1">
              {project.name}
            </span>
            <button
              onClick={startEdit}
              title="Zmień nazwę"
              className={`shrink-0 p-1.5 rounded transition-colors ${
                hovered
                  ? "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                  : "text-gray-700"
              }`}
            >
              <Pencil className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Podgląd */}
      <div className="h-48 mx-4 rounded-lg overflow-hidden">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
          >
            <span
              className="text-8xl font-black select-none"
              style={{ color: from, filter: "brightness(2) opacity(0.4)" }}
            >
              {project.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Data i kosz */}
      <div className="px-4 py-3.5 flex items-center justify-between gap-2">
        <span className="text-gray-500 text-sm">{formatDate(project.updated_at)}</span>
        {hovered && !editing ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(project);
            }}
            className="p-1.5 rounded-md text-gray-600 hover:text-red-400 hover:bg-red-950/30 transition-colors shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        ) : (
          <div className="w-[30px] h-[30px]" />
        )}
      </div>
    </div>
  );
}

export function ProjectsGrid({ onNewProject }: ProjectsGridProps) {
  const { projects, setActiveProject } = useProjectStore();
  const { deleteProject, renameProject } = useProject();
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const blobUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (projects.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const db = await getDb();
        const rows = await db.select<{ project_id: string; file_path: string }[]>(`
          SELECT gi.project_id, gi.file_path
          FROM generated_images gi
          INNER JOIN (
            SELECT project_id, MAX(created_at) AS max_created
            FROM generated_images
            GROUP BY project_id
          ) latest ON gi.project_id = latest.project_id
                   AND gi.created_at = latest.max_created
          GROUP BY gi.project_id
        `);

        if (cancelled) return;

        for (const row of rows) {
          if (cancelled) break;
          try {
            const absPath = await invoke<string>("get_abs_path", { filePath: row.file_path });
            if (cancelled) break;
            const bytes = await readFile(absPath);
            if (cancelled) break;

            const ext = row.file_path.split(".").pop()?.toLowerCase() ?? "";
            const mime =
              ext === "jpg" || ext === "jpeg"
                ? "image/jpeg"
                : ext === "webp"
                ? "image/webp"
                : "image/png";

            if (blobUrlsRef.current[row.project_id]) {
              URL.revokeObjectURL(blobUrlsRef.current[row.project_id]);
            }
            const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
            blobUrlsRef.current[row.project_id] = url;

            setThumbnails((prev) => ({ ...prev, [row.project_id]: url }));
          } catch {
            // brak pliku lub błąd odczytu — ignoruj, zostaje placeholder
          }
        }
      } catch {
        // błąd zapytania — ignoruj
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projects]);

  // Zwolnij blob URL przy odmontowaniu
  useEffect(() => {
    return () => {
      for (const url of Object.values(blobUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    await deleteProject(confirmDelete);
    setConfirmDelete(null);
  }

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col bg-[#0f0f0f]">
      <div className="flex-1 overflow-y-auto p-8 pb-28">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 text-center select-none">
            {/* Ilustracja */}
            <div className="relative">
              <div className="w-28 h-28 rounded-3xl bg-[#1a1a1a] border border-gray-800 flex items-center justify-center shadow-xl shadow-black/40">
                <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true">
                  <rect x="4" y="14" width="44" height="28" rx="4" fill="#1e3a5f" stroke="#2563eb" strokeWidth="1.5"/>
                  <rect x="10" y="20" width="20" height="4" rx="2" fill="#60a5fa" opacity="0.8"/>
                  <rect x="10" y="28" width="14" height="2.5" rx="1.25" fill="#3b82f6" opacity="0.5"/>
                  <circle cx="38" cy="26" r="6" fill="#1e3a5f" stroke="#3b82f6" strokeWidth="1.5"/>
                  <path d="M38 23v6M35 26h6" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-blue-600/20 border border-blue-600/30" />
              <div className="absolute -bottom-1 -left-3 w-3 h-3 rounded-full bg-blue-500/15 border border-blue-500/20" />
            </div>

            <div className="space-y-1.5">
              <p className="text-gray-200 text-base font-semibold">Brak projektów</p>
              <p className="text-gray-500 text-sm max-w-[260px] leading-relaxed">
                Każdy projekt przechowuje elementy SVG, materiały i wygenerowane wizualizacje.
              </p>
            </div>

            <button
              onClick={onNewProject}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-blue-900/30"
            >
              <Plus className="w-4 h-4" />
              Utwórz pierwszy projekt
            </button>
          </div>
        ) : (
          <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))" }}>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                thumbnail={thumbnails[project.id]}
                onOpen={setActiveProject}
                onDelete={setConfirmDelete}
                onRename={renameProject}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pływający przycisk */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-8 pointer-events-none">
        <button
          onClick={onNewProject}
          className="pointer-events-auto flex items-center gap-2.5 px-7 py-3.5 rounded-2xl bg-[#1e1e1e]/95 backdrop-blur-sm border border-gray-700 text-white text-sm font-medium shadow-2xl shadow-black/60 hover:bg-[#272727] hover:border-gray-500 transition-all"
        >
          <Plus className="w-4 h-4" />
          Nowy projekt
        </button>
      </div>

      {/* Modal potwierdzenia usunięcia */}
      {confirmDelete && (
        <ConfirmDeleteOverlay
          name={confirmDelete.name}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}

interface ConfirmDeleteOverlayProps {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}

// Wydzielony komponent — useEscapeKey wymaga komponentu React, nie inline JSX.
function ConfirmDeleteOverlay({ name, onCancel, onConfirm }: ConfirmDeleteOverlayProps) {
  useEscapeKey(true, onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="bg-[#1e1e1e] rounded-lg shadow-xl w-full max-w-sm mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white font-medium mb-2">Usuń projekt</h2>
        <p className="text-gray-400 text-sm mb-5">
          Czy na pewno chcesz usunąć projekt{" "}
          <span className="text-white font-medium">„{name}"</span>?
          Wszystkie pliki projektu zostaną trwale usunięte.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-md bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors"
          >
            Usuń
          </button>
        </div>
      </div>
    </div>
  );
}
