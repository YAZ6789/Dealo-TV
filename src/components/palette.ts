import { create } from 'zustand';

export const usePalette = create<{ open: boolean; query: string; setOpen: (v: boolean, query?: string) => void }>()((set) => ({
  open: false,
  query: '',
  setOpen: (open, query = '') => set({ open, query }),
}));
