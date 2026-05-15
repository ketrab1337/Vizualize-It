import { X, CheckCircle, AlertCircle, Info } from "lucide-react";
import { useToastStore } from "../../stores/toastStore";

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
} as const;

const COLORS = {
  success: "border-green-700 bg-green-950 text-green-200",
  error: "border-red-700 bg-red-950 text-red-200",
  info: "border-gray-700 bg-[#1a1a1a] text-gray-300",
} as const;

const ICON_COLORS = {
  success: "text-green-400",
  error: "text-red-400",
  info: "text-gray-400",
} as const;

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg pointer-events-auto animate-in slide-in-from-right-4 ${COLORS[toast.type]}`}
          >
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${ICON_COLORS[toast.type]}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm leading-snug">{toast.message}</p>
              {toast.action && (
                <button
                  onClick={() => { toast.action!.fn(); removeToast(toast.id); }}
                  className="mt-1.5 text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
