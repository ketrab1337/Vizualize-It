import { CheckCircle2, Clock, Loader2, Trash2, X, XCircle } from "lucide-react";
import type { BatchJob } from "../../types";

interface BatchQueuePanelProps {
  jobs: BatchJob[];
  onCancel: (job: BatchJob) => void;
  onDismiss: (job: BatchJob) => void;
}

function modelLabel(model: string): string {
  if (model === "nano-banana-pro") return "Nano Banana Pro";
  if (model === "gpt-image-2") return "GPT Image 2";
  return "Nano Banana 2";
}

function StatusIcon({ status }: { status: BatchJob["status"] }) {
  if (status === "pending")
    return <Clock className="w-4 h-4 text-gray-400 shrink-0" />;
  if (status === "running")
    return <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />;
  if (status === "done")
    return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
  if (status === "error")
    return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
  return <X className="w-4 h-4 text-gray-600 shrink-0" />;
}

function statusLabel(status: BatchJob["status"]): string {
  if (status === "pending") return "Wysyłanie do dostawcy...";
  if (status === "running") return "W kolejce dostawcy (do 24h)";
  if (status === "done") return "Gotowe";
  if (status === "error") return "Błąd";
  return "Anulowano";
}

export function BatchQueuePanel({ jobs, onCancel, onDismiss }: BatchQueuePanelProps) {
  const active = jobs.filter(
    (j) => j.status === "pending" || j.status === "running" || j.status === "error"
  );

  if (active.length === 0) return null;

  return (
    <div className="border-b border-gray-800 bg-[#151515] px-5 py-3 shrink-0">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
        Kolejka batch ({active.length})
      </p>
      <div className="space-y-1.5">
        {active.map((job) => (
          <div
            key={job.id}
            className="flex items-center gap-3 bg-[#1a1a1a] rounded-md px-3 py-2"
          >
            <StatusIcon status={job.status} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-200 truncate">
                {modelLabel(job.model)} · {job.format} · {job.count}{" "}
                {job.count === 1 ? "obraz" : "obrazy"}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">{statusLabel(job.status)}</p>
              {job.status === "error" && job.error_text && (
                <p className="text-xs text-red-400 mt-0.5 truncate">{job.error_text}</p>
              )}
            </div>
            <p className="text-xs text-gray-700 shrink-0">
              {new Date(job.created_at).toLocaleTimeString("pl-PL", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {(job.status === "pending" || job.status === "running") && (
              <button
                onClick={() => onCancel(job)}
                className="p-1 rounded hover:bg-[#2a2a2a] text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                title="Anuluj"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {job.status === "error" && (
              <button
                onClick={() => onDismiss(job)}
                className="p-1 rounded hover:bg-red-900/30 text-gray-500 hover:text-red-300 transition-colors shrink-0"
                title="Usuń z kolejki"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
