import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | "idle"        // brak aktualizacji / jeszcze nie sprawdzono
  | "available"   // znaleziono aktualizację, czeka na decyzję użytkownika
  | "downloading" // trwa pobieranie (mamy pasek postępu)
  | "installing"  // pobrano, trwa instalacja
  | "ready"       // zainstalowano, czeka na restart
  | "error";      // błąd pobierania/instalacji

export interface AppUpdateState {
  status: UpdateStatus;
  update: Update | null;
  /** Postęp pobierania 0–100 (–1 = nieznany rozmiar, pokazujemy spinner). */
  progress: number;
  error: string | null;
  /** Pobierz i zainstaluj dostępną aktualizację. */
  install: () => Promise<void>;
  /** Zrestartuj aplikację po zakończonej instalacji. */
  restart: () => Promise<void>;
  /** Zamknij okno aktualizacji (odłóż na później). */
  dismiss: () => void;
}

/**
 * Sprawdza dostępność aktualizacji przy starcie i steruje przepływem
 * pobierania/instalacji. Logika trzymana tu (nie w App.tsx) — komponent
 * UpdateModal jest czystym widokiem sterowanym tym hookiem.
 */
export function useAppUpdate(delayMs = 3000): AppUpdateState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // contentLength z eventu "Started" — do liczenia procentów.
  const downloadedRef = useRef(0);
  const totalRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await check();
        if (cancelled || !found?.available) return;
        setUpdate(found);
        setStatus("available");
      } catch {
        // ignoruj błędy sprawdzania aktualizacji (brak sieci, offline itp.)
      }
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [delayMs]);

  const install = useCallback(async () => {
    if (!update) return;
    setError(null);
    downloadedRef.current = 0;
    totalRef.current = 0;
    setProgress(0);
    setStatus("downloading");

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalRef.current = event.data.contentLength ?? 0;
            setProgress(totalRef.current > 0 ? 0 : -1);
            break;
          case "Progress":
            downloadedRef.current += event.data.chunkLength;
            if (totalRef.current > 0) {
              setProgress(
                Math.min(100, Math.round((downloadedRef.current / totalRef.current) * 100))
              );
            }
            break;
          case "Finished":
            setProgress(100);
            setStatus("installing");
            break;
        }
      });
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [update]);

  const restart = useCallback(async () => {
    await relaunch();
  }, []);

  const dismiss = useCallback(() => {
    // Nie pozwól zamknąć w trakcie pobierania/instalacji.
    if (status === "downloading" || status === "installing") return;
    setStatus("idle");
    setUpdate(null);
  }, [status]);

  return { status, update, progress, error, install, restart, dismiss };
}
