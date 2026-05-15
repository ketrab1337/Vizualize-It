import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../lib/db";

export interface GalleryImage {
  id: string;
  session_id: string;
  project_id: string;
  file_path: string;
  width: number | null;
  height: number | null;
  is_favorite: number;
  created_at: string;
  model: string;
  format: string;
}

export function useGallery() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(false);

  const loadImages = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const db = await getDb();
      const rows = await db.select<GalleryImage[]>(
        `SELECT gi.id, gi.session_id, gi.project_id, gi.file_path,
                gi.width, gi.height, gi.is_favorite, gi.created_at,
                COALESCE(gs.model, '') AS model,
                COALESCE(gs.format, '') AS format
         FROM generated_images gi
         LEFT JOIN generation_sessions gs ON gi.session_id = gs.id
         WHERE gi.project_id = $1
         ORDER BY gi.created_at DESC`,
        [projectId]
      );
      setImages(rows);
    } catch (e) {
      console.error("Błąd ładowania galerii:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleFavorite = useCallback(async (imageId: string, current: number) => {
    const newValue = current === 1 ? 0 : 1;
    const db = await getDb();
    await db.execute(
      `UPDATE generated_images SET is_favorite = $1 WHERE id = $2`,
      [newValue, imageId]
    );
    setImages((prev) =>
      prev.map((img) =>
        img.id === imageId ? { ...img, is_favorite: newValue } : img
      )
    );
  }, []);

  const deleteImage = useCallback(async (imageId: string, filePath: string) => {
    await invoke("delete_image_file", { filePath });
    const db = await getDb();
    await db.execute(`DELETE FROM generated_images WHERE id = $1`, [imageId]);
    setImages((prev) => prev.filter((img) => img.id !== imageId));
  }, []);

  const addImage = useCallback((img: GalleryImage) => {
    setImages((prev) => [img, ...prev]);
  }, []);

  return { images, loading, loadImages, toggleFavorite, deleteImage, addImage };
}
