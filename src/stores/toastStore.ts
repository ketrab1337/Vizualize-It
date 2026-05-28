import { create } from "zustand";

export type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  fn: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, action?: ToastAction) => void;
  removeToast: (id: string) => void;
}

// Mapa timerów poza store — żeby zmiany nie powodowały re-renderów subskrybentów.
// Klucz: id toastu. Czyszczona w `removeToast` (ręczne zamknięcie) i w callbacku
// `setTimeout` (auto-dismiss po TTL).
const timers = new Map<string, number>();

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type = "info", action) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, type, action }] }));
    const ttl = action ? 8000 : 3500;
    const timerId = window.setTimeout(() => {
      timers.delete(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, ttl);
    timers.set(id, timerId);
  },
  removeToast: (id) => {
    // Anuluj auto-dismiss żeby uniknąć podwójnego setState na nieistniejącym już id.
    const timerId = timers.get(id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
