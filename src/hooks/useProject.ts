import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useToastStore } from "../stores/toastStore";
import { updateSvgWithOverrides } from "../lib/svgHelpers";
import { getDb } from "../lib/db";
import type { Project } from "../types";

export function useProject() {
  const { projects, setProjects, activeProjectId, setActiveProject } = useProjectStore();
  const { resetEditor, setSvgContent, setBackground } = useEditorStore();
  const addToast = useToastStore((s) => s.addToast);

  // Czyta stan bezpośrednio ze store w momencie wywołania — bez stale closure
  const saveEditorState = useCallback(async (projectId: string) => {
    try {
      const { svgContent, nodeOverrides, backgroundPath } = useEditorStore.getState();
      // Bake overrides into SVG at save time — fixes race between setNodeOverride and saveFnRef
      const svgToSave = svgContent
        ? updateSvgWithOverrides(svgContent, nodeOverrides)
        : null;
      const db = await getDb();
      const now = new Date().toISOString();
      await db.execute(
        "UPDATE projects SET svg_content = $1, background_path = $2, updated_at = $3 WHERE id = $4",
        [svgToSave ?? null, backgroundPath ?? null, now, projectId]
      );
    } catch (e) {
      console.error("Błąd zapisu stanu edytora:", e);
    }
  }, []);

  const loadEditorState = useCallback(
    async (projectId: string) => {
      resetEditor();
      try {
        const db = await getDb();
        const rows = await db.select<{ svg_content: string | null; background_path: string | null }[]>(
          "SELECT svg_content, background_path FROM projects WHERE id = $1",
          [projectId]
        );
        const row = rows[0];
        if (!row) return;

        // nodeOverrides zostaną przywrócone automatycznie przez Canvas
        // na podstawie atrybutów data-* zawartych w SVG
        if (row.svg_content) {
          setSvgContent(row.svg_content);
        }

        if (row.background_path) {
          try {
            const ext = row.background_path.split(".").pop()?.toLowerCase() ?? "";
            const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
            const bytes = await readFile(row.background_path);
            const prevUrl = useEditorStore.getState().backgroundDataUrl;
            if (prevUrl?.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
            const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
            setBackground(blobUrl, row.background_path);
          } catch {
            // plik tła nie istnieje — ignoruj
          }
        }
      } catch (e) {
        console.error("Błąd ładowania stanu edytora:", e);
      }
    },
    [resetEditor, setSvgContent, setBackground]
  );

  const loadProjects = useCallback(async () => {
    try {
      const db = await getDb();
      const rows = await db.select<Project[]>(
        "SELECT * FROM projects ORDER BY updated_at DESC"
      );
      setProjects(rows);
    } catch (e) {
      addToast(`Nie można wczytać projektów: ${e}`, "error");
    }
  }, [setProjects, addToast]);

  const createProject = useCallback(
    async (name: string): Promise<Project | null> => {
      const trimmed = name.trim();
      try {
        const db = await getDb();
        const existing = await db.select<{ id: string }[]>(
          "SELECT id FROM projects WHERE name = $1 LIMIT 1",
          [trimmed]
        );
        if (existing.length > 0) {
          addToast(`Projekt o nazwie „${trimmed}" już istnieje. Wybierz inną nazwę.`, "error");
          return null;
        }

        const project = await invoke<Project>("create_project", {
          input: { name: trimmed },
        });

        await db.execute(
          "INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
          [project.id, project.name, project.slug, project.created_at, project.updated_at]
        );

        setProjects([project, ...projects]);
        setActiveProject(project.id);
        return project;
      } catch (e) {
        const msg = String(e);
        if (
          msg.includes("UNIQUE") ||
          msg.includes("unique") ||
          msg.toLowerCase().includes("already exists") ||
          msg.includes("już istnieje")
        ) {
          addToast(`Projekt o nazwie „${trimmed}" już istnieje. Wybierz inną nazwę.`, "error");
        } else {
          addToast(`Błąd tworzenia projektu: ${e}`, "error");
        }
        return null;
      }
    },
    [projects, setProjects, setActiveProject, addToast]
  );

  const deleteProject = useCallback(
    async (project: Project): Promise<boolean> => {
      try {
        const db = await getDb();
        await db.execute("DELETE FROM projects WHERE id = $1", [project.id]);

        await invoke("delete_project", { id: project.id, slug: project.slug }).catch(
          (e) => console.warn("Nie udało się usunąć folderu projektu:", e)
        );

        const remaining = projects.filter((p) => p.id !== project.id);
        setProjects(remaining);

        if (activeProjectId === project.id) {
          setActiveProject(remaining[0]?.id ?? null);
        }

        addToast(`Projekt „${project.name}" został usunięty`, "info");
        return true;
      } catch (e) {
        addToast(`Błąd usuwania projektu: ${e}`, "error");
        return false;
      }
    },
    [projects, activeProjectId, setProjects, setActiveProject, addToast]
  );

  const renameProject = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (trimmed.length < 2) {
        addToast("Nazwa projektu musi mieć co najmniej 2 znaki.", "error");
        return false;
      }
      try {
        const db = await getDb();
        const existing = await db.select<{ id: string }[]>(
          "SELECT id FROM projects WHERE name = $1 AND id != $2 LIMIT 1",
          [trimmed, id]
        );
        if (existing.length > 0) {
          addToast(`Projekt o nazwie „${trimmed}" już istnieje. Wybierz inną nazwę.`, "error");
          return false;
        }
        const now = new Date().toISOString();
        await db.execute(
          "UPDATE projects SET name = $1, updated_at = $2 WHERE id = $3",
          [trimmed, now, id]
        );
        setProjects(
          projects.map((p) =>
            p.id === id ? { ...p, name: trimmed, updated_at: now } : p
          )
        );
        return true;
      } catch (e) {
        const msg = String(e);
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          addToast(`Projekt o nazwie „${trimmed}" już istnieje. Wybierz inną nazwę.`, "error");
        } else {
          addToast(`Błąd zmiany nazwy: ${e}`, "error");
        }
        return false;
      }
    },
    [projects, setProjects, addToast]
  );

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return {
    projects,
    activeProject,
    activeProjectId,
    setActiveProject,
    loadProjects,
    createProject,
    deleteProject,
    renameProject,
    saveEditorState,
    loadEditorState,
  };
}
