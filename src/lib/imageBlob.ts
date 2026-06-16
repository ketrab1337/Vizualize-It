import { readFile } from "@tauri-apps/plugin-fs";

/** Zgaduje MIME type z rozszerzenia ścieżki pliku obrazu. */
export function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/**
 * Wczytuje plik obrazu z dysku (przez plugin-fs, scope $DOCUMENT/**) i zwraca blob URL
 * do użycia w <img src>. Pamiętaj o URL.revokeObjectURL gdy URL już niepotrzebny.
 */
export async function fileToBlobUrl(path: string, mime?: string): Promise<string> {
  const bytes = await readFile(path);
  return URL.createObjectURL(new Blob([bytes], { type: mime ?? mimeFromPath(path) }));
}
