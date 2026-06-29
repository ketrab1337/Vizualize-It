import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore, type LedProjectConfig } from "../stores/editorStore";
import { useGenerationStore, type GenerationSnapshot } from "../stores/generationStore";
import { useToastStore } from "../stores/toastStore";
import { updateSvgWithOverrides } from "../lib/svgHelpers";
import { getDb } from "../lib/db";
import type { Project, ImageFormat } from "../types";

export function useProject() {
  const { projects, setProjects, activeProjectId, setActiveProject } = useProjectStore();
  const { resetEditor, setSvgContent, setBackground, setLedConfig } = useEditorStore();
  const addToast = useToastStore((s) => s.addToast);

  // Czyta stan bezpośrednio ze store w momencie wywołania — bez stale closure
  const saveEditorState = useCallback(async (projectId: string) => {
    try {
      const { svgContent, nodeOverrides, backgroundPath, ledConfig } = useEditorStore.getState();
      const svgToSave = svgContent
        ? updateSvgWithOverrides(svgContent, nodeOverrides)
        : null;
      const db = await getDb();
      const now = new Date().toISOString();
      await db.execute(
        "UPDATE projects SET svg_content = $1, background_path = $2, updated_at = $3, led_config_json = $4 WHERE id = $5",
        [svgToSave ?? null, backgroundPath ?? null, now, JSON.stringify(ledConfig), projectId]
      );
    } catch (e) {
      console.error("Błąd zapisu stanu edytora:", e);
      addToast(`Nie udało się zapisać projektu: ${e}`, "error");
    }
  }, [addToast]);

  const loadEditorState = useCallback(
    async (projectId: string) => {
      resetEditor();
      try {
        const db = await getDb();
        const rows = await db.select<{
          svg_content: string | null;
          background_path: string | null;
          led_config_json: string | null;
        }[]>(
          "SELECT svg_content, background_path, led_config_json FROM projects WHERE id = $1",
          [projectId]
        );
        const row = rows[0];
        if (!row) return;

        if (row.svg_content) {
          setSvgContent(row.svg_content);
        }

        if (row.led_config_json) {
          try {
            const cfg = JSON.parse(row.led_config_json) as Partial<LedProjectConfig>;
            setLedConfig(cfg);
          } catch {
            // ignoruj nieprawidłowy JSON
          }
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
    [resetEditor, setSvgContent, setBackground, setLedConfig]
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

        try {
          await db.execute(
            "INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
            [project.id, project.name, project.slug, project.created_at, project.updated_at]
          );
        } catch (insertErr) {
          // INSERT do DB padł (np. UNIQUE) — folder utworzony przez backend zostałby sierotą.
          // Rollback: usuń folder. Błąd cleanup logujemy, ale i tak rzucamy oryginalny błąd.
          await invoke("delete_project", { id: project.id, slug: project.slug }).catch((e) =>
            console.warn("Rollback create_project: nie udało się usunąć folderu:", e)
          );
          throw insertErr;
        }

        setProjects([project, ...projects]);
        setActiveProject(project.id);
        return project;
      } catch (e) {
        const msg = String(e);
        // Kolizja slugu (folderu) — Rust zwraca komunikat o „identyfikatorze folderu".
        // Pokazujemy go bezpośrednio, bo wyjaśnia dlaczego unikatowa nazwa wciąż się odbija.
        if (msg.includes("identyfikator folderu")) {
          addToast(msg.replace(/^Error:\s*/i, ""), "error");
        } else if (
          msg.includes("UNIQUE") ||
          msg.includes("unique") ||
          msg.toLowerCase().includes("already exists") ||
          msg.includes("już istnieje")
        ) {
          // Kolizja nazwy w DB (powinno być rzadkie po check-u w linii 102, ale możliwe
          // race między select a INSERT, lub kolizja slug-u przez UNIQUE w DB gdy Rust
          // check by się nie wykonał — np. po edycie ścieżki data_dir).
          addToast(`Projekt o nazwie „${trimmed}" już istnieje (lub generuje taki sam identyfikator folderu). Wybierz inną nazwę.`, "error");
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

  /**
   * Aktualizuje typ produktu projektu (np. "szyld", "tabliczka_informacyjna" lub
   * dowolny tekst dla wartości "Inne"). Trafia do `projects.product_type` i
   * wykorzystywane jest w promptAssembler do odmiany "szyld → tabliczka → numer"
   * w opisach dla AI.
   */
  const updateProductType = useCallback(
    async (id: string, productType: string | null): Promise<boolean> => {
      try {
        const db = await getDb();
        const value = productType?.trim() || null;
        const now = new Date().toISOString();
        await db.execute(
          "UPDATE projects SET product_type = $1, updated_at = $2 WHERE id = $3",
          [value, now, id]
        );
        setProjects(
          projects.map((p) =>
            p.id === id ? { ...p, product_type: value, updated_at: now } : p
          )
        );
        return true;
      } catch (e) {
        addToast(`Błąd zapisu typu produktu: ${e}`, "error");
        return false;
      }
    },
    [projects, setProjects, addToast]
  );

  /**
   * Zapisuje proporcję canvasu projektu ("16:9".."9:16"). Trafia do
   * `projects.aspect_ratio` i wyznacza zarówno kształt strony w edytorze, jak i
   * proporcję obrazu renderowanego do AI (koniec przycinania tła do viewportu).
   */
  const updateAspectRatio = useCallback(
    async (id: string, aspect: ImageFormat): Promise<boolean> => {
      try {
        const db = await getDb();
        const now = new Date().toISOString();
        await db.execute(
          "UPDATE projects SET aspect_ratio = $1, updated_at = $2 WHERE id = $3",
          [aspect, now, id]
        );
        setProjects(
          projects.map((p) =>
            p.id === id ? { ...p, aspect_ratio: aspect, updated_at: now } : p
          )
        );
        return true;
      } catch (e) {
        addToast(`Błąd zapisu proporcji canvasu: ${e}`, "error");
        return false;
      }
    },
    [projects, setProjects, addToast]
  );

  // ── Per-projekt stan generowania (prompt + presety + ustawienia panelu) ─────
  // JSON w `projects.generation_state_json` — patrz migracja 014. Powód: bez tego
  // wybór presetów i prompt wyciekały między projektami (cały generationStore był
  // globalny w pamięci).

  const saveGenerationState = useCallback(async (projectId: string) => {
    try {
      const snapshot = useGenerationStore.getState().toSnapshot();
      const db = await getDb();
      await db.execute(
        "UPDATE projects SET generation_state_json = $1 WHERE id = $2",
        [JSON.stringify(snapshot), projectId]
      );
    } catch (e) {
      console.error("Błąd zapisu stanu generowania:", e);
    }
  }, []);

  const loadGenerationState = useCallback(async (projectId: string) => {
    const { applySnapshot } = useGenerationStore.getState();
    try {
      const db = await getDb();
      const rows = await db.select<{ generation_state_json: string | null }[]>(
        "SELECT generation_state_json FROM projects WHERE id = $1",
        [projectId]
      );
      const raw = rows[0]?.generation_state_json;
      if (!raw) {
        applySnapshot(null);
        return;
      }
      try {
        const snapshot = JSON.parse(raw) as GenerationSnapshot;
        applySnapshot(snapshot);
      } catch {
        applySnapshot(null);
      }
    } catch (e) {
      console.error("Błąd ładowania stanu generowania:", e);
      applySnapshot(null);
    }
  }, []);

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
    updateProductType,
    updateAspectRatio,
    saveEditorState,
    loadEditorState,
    saveGenerationState,
    loadGenerationState,
  };
}
