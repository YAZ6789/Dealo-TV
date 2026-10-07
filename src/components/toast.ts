import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  ttl: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = seq++;
    const toast: Toast = { ttl: t.action ? 6000 : 3200, ...t, id };
    set((s) => ({ toasts: [...s.toasts.slice(-3), toast] }));
    setTimeout(() => get().dismiss(id), toast.ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = (message: string, action?: Toast['action']) => useToasts.getState().push({ message, action });
