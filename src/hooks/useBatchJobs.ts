import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../lib/db";
import type { BatchJob, PollBatchResult } from "../types";

/**
 * Hook zarządzający kolejką zadań Batch API.
 *
 * Cykl życia zadania:
 *   pending → (submit_batch_to_provider) → running → (poll_batch_status) → done/error/cancelled
 *
 * Polling co 30s — Batch API ma SLA 24h, więc nie ma sensu częstego pollowania.
 * Pierwsze sprawdzenie po wczytaniu hooka odbywa się od razu.
 */
const POLL_INTERVAL_MS = 30_000;

interface SubmitBatchOutput {
  batch_id: string;
  input_file_id: string | null;
}

export function useBatchJobs(projectId: string | null) {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  /** Set ID zadań aktualnie przetwarzanych (submit lub poll w toku) — zapobiega podwójnym wywołaniom. */
  const inFlightRef = useRef<Set<string>>(new Set());

  const loadJobs = useCallback(async () => {
    if (!projectId) return;
    try {
      const db = await getDb();
      const rows = await db.select<BatchJob[]>(
        `SELECT * FROM batch_jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [projectId]
      );
      setJobs(rows);
      // Natychmiastowy poll running jobów tuż po załadowaniu listy —
      // bez tego pierwsze sprawdzenie byłoby dopiero po 30 sekundach.
      // pollJob jest stabilny (useCallback []) — celowo poza deps, by uniknąć
      // odwołania do niego przed deklaracją (TDZ) w tablicy zależności.
      for (const job of rows) {
        if (job.status === "running" && job.provider_batch_id && !inFlightRef.current.has(job.id)) {
          pollJob(job);
        }
      }
    } catch {
      // ignoruj błędy odczytu
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Submit pending → provider ──────────────────────────────────────────────

  const submitJob = useCallback(async (job: BatchJob) => {
    if (inFlightRef.current.has(job.id)) return;
    inFlightRef.current.add(job.id);
    const db = await getDb();
    const startedAt = new Date().toISOString();
    try {
      const result = await invoke<SubmitBatchOutput>("submit_batch_to_provider", {
        jobId: job.id,
        projectSlug: job.project_slug,
      });
      await db.execute(
        `UPDATE batch_jobs
         SET status='running', provider_batch_id=$1, provider_input_file_id=$2, updated_at=$3
         WHERE id=$4`,
        [result.batch_id, result.input_file_id, startedAt, job.id]
      );
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: "running",
                provider_batch_id: result.batch_id,
                provider_input_file_id: result.input_file_id,
                updated_at: startedAt,
              }
            : j
        )
      );
    } catch (e) {
      const errText = String(e);
      const errAt = new Date().toISOString();
      try {
        await db.execute(
          `UPDATE batch_jobs SET status='error', error_text=$1, updated_at=$2 WHERE id=$3`,
          [errText, errAt, job.id]
        );
      } catch {}
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, status: "error", error_text: errText, updated_at: errAt } : j
        )
      );
    } finally {
      inFlightRef.current.delete(job.id);
    }
  }, []);

  // ── Poll running → wynik ──────────────────────────────────────────────────

  const pollJob = useCallback(async (job: BatchJob) => {
    if (!job.provider_batch_id || inFlightRef.current.has(job.id)) return;
    inFlightRef.current.add(job.id);
    try {
      const result = await invoke<PollBatchResult>("poll_batch_status", {
        jobId: job.id,
        projectSlug: job.project_slug,
        model: job.model,
        batchId: job.provider_batch_id,
      });

      if (result.status === "pending" || result.status === "running") {
        // brak zmiany — spróbujemy ponownie przy następnym polling
        return;
      }

      const db = await getDb();
      const now = new Date().toISOString();

      if (result.status === "succeeded") {
        // Zapisz sesję + obrazy do galerii
        const sessionId = crypto.randomUUID();
        await db.execute(
          `INSERT INTO generation_sessions
             (id, project_id, prompt_assembled, model, format, count,
              camera_rotate, camera_tilt, camera_distance,
              led_backlit_enabled, led_backlit_color,
              led_frontlit_enabled, led_frontlit_color, created_at)
           VALUES ($1,$2,NULL,$3,$4,$5,0,0,5,0,NULL,0,NULL,$6)`,
          [sessionId, job.project_id, job.model, job.format, job.count, now]
        );

        const imageIds: string[] = [];
        for (const f of result.files) {
          const imgId = crypto.randomUUID();
          imageIds.push(imgId);
          await db.execute(
            `INSERT INTO generated_images
               (id, session_id, project_id, file_path, width, height, is_favorite, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [imgId, sessionId, job.project_id, f.file_path, null, null, 0, now]
          );
        }

        const resultIds = imageIds.join(",");
        await db.execute(
          `UPDATE batch_jobs SET status='done', result_image_ids=$1, updated_at=$2 WHERE id=$3`,
          [resultIds, now, job.id]
        );
        await invoke("delete_batch_payload", {
          projectSlug: job.project_slug,
          jobId: job.id,
        }).catch(() => {});

        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "done", result_image_ids: resultIds, updated_at: now }
              : j
          )
        );
      } else if (result.status === "failed") {
        await db.execute(
          `UPDATE batch_jobs SET status='error', error_text=$1, updated_at=$2 WHERE id=$3`,
          [result.error, now, job.id]
        );
        await invoke("delete_batch_payload", {
          projectSlug: job.project_slug,
          jobId: job.id,
        }).catch(() => {});
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "error", error_text: result.error, updated_at: now }
              : j
          )
        );
      } else if (result.status === "cancelled") {
        await db.execute(
          `UPDATE batch_jobs SET status='cancelled', updated_at=$1 WHERE id=$2`,
          [now, job.id]
        );
        await invoke("delete_batch_payload", {
          projectSlug: job.project_slug,
          jobId: job.id,
        }).catch(() => {});
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, status: "cancelled", updated_at: now } : j))
        );
      }
    } catch {
      // błędy sieciowe ignorujemy — następny polling spróbuje ponownie
    } finally {
      inFlightRef.current.delete(job.id);
    }
  }, []);

  // ── Dismiss (usuń z kolejki — używane dla statusu error/cancelled) ────────

  const dismissJob = useCallback(async (job: BatchJob) => {
    const db = await getDb();
    try {
      // Sprzątanie ewentualnego payloadu na dysku (idempotentne)
      await invoke("delete_batch_payload", {
        projectSlug: job.project_slug,
        jobId: job.id,
      }).catch(() => {});
      await db.execute(`DELETE FROM batch_jobs WHERE id=$1`, [job.id]);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch {
      // ignoruj — następna iteracja loadJobs odświeży stan
    }
  }, []);

  // ── Cancel ─────────────────────────────────────────────────────────────────

  const cancelJob = useCallback(async (job: BatchJob) => {
    const db = await getDb();
    const now = new Date().toISOString();
    try {
      // Anuluj po stronie dostawcy tylko jeśli zostało już wysłane
      if (job.provider_batch_id && (job.status === "running" || job.status === "pending")) {
        await invoke("cancel_batch_at_provider", {
          model: job.model,
          batchId: job.provider_batch_id,
        }).catch(() => {});
      }
      await db.execute(
        `UPDATE batch_jobs SET status='cancelled', updated_at=$1 WHERE id=$2`,
        [now, job.id]
      );
      await invoke("delete_batch_payload", {
        projectSlug: job.project_slug,
        jobId: job.id,
      }).catch(() => {});
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: "cancelled", updated_at: now } : j))
      );
    } catch {}
  }, []);

  // ── Polling loop ───────────────────────────────────────────────────────────

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Submit każde nowe pending od razu (bez czekania na polling)
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === "pending" && !inFlightRef.current.has(job.id)) {
        submitJob(job);
      }
    }
  }, [jobs, submitJob]);

  // Poll running co POLL_INTERVAL_MS — jeden trwały interwał na cały hook.
  // loadJobs() samodzielnie poluje running joby tuż po odświeżeniu listy z DB,
  // więc dodatkowy tick() jest zbędny.
  useEffect(() => {
    const interval = setInterval(() => {
      loadJobs();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadJobs]);

  return { jobs, loadJobs, cancelJob, dismissJob };
}
