import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/** Skin = colours + fonts + small decorative touches. Applies to every design. */
export type ThemeId = 'hud' | 'neon' | 'aurora' | 'terminal';
export const THEME_IDS: ThemeId[] = ['hud', 'neon', 'aurora', 'terminal'];

/** Design = the whole browsing experience on the home screen. */
export type DesignId = 'stream' | 'ring' | 'constellation' | 'tunnel';
export const DESIGN_IDS: DesignId[] = ['stream', 'ring', 'constellation', 'tunnel'];

export interface SettingsState {
  theme: ThemeId;
  design: DesignId;
  /** TMDB v3 key or v4 read token, entered by the user (never committed). */
  tmdbKey: string;
  tmdbValid?: boolean;
  /** ISO 3166-1 region for "where to watch" + content ratings. */
  region: string;
  /** Turn off heavy background effects (also auto-off with prefers-reduced-motion). */
  reduceFx: boolean;
  onboarded: boolean;
  setTheme: (t: ThemeId) => void;
  setDesign: (d: DesignId) => void;
  setTmdbKey: (key: string, valid?: boolean) => void;
  setRegion: (r: string) => void;
  setReduceFx: (v: boolean) => void;
  setOnboarded: (v: boolean) => void;
}

/** Build-time default key (optional): set VITE_TMDB_KEY when deploying your own copy. */
const ENV_KEY = (import.meta.env?.VITE_TMDB_KEY as string | undefined) ?? '';

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'hud',
      design: 'ring',
      tmdbKey: ENV_KEY,
      region: guessRegion(),
      reduceFx: false,
      onboarded: false,
      setTheme: (theme) => set({ theme }),
      setDesign: (design) => set({ design }),
      setTmdbKey: (tmdbKey, tmdbValid) => set({ tmdbKey: tmdbKey.trim(), tmdbValid }),
      setRegion: (region) => set({ region }),
      setReduceFx: (reduceFx) => set({ reduceFx }),
      setOnboarded: (onboarded) => set({ onboarded }),
    }),
    {
      name: 'dealo:settings',
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage()),
    },
  ),
);

function guessRegion(): string {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    const m = /[-_]([A-Z]{2})\b/.exec(loc);
    return m?.[1] ?? 'US';
  } catch {
    return 'US';
  }
}

/** localStorage that degrades to memory (private mode, tests, SSR). */
export function safeLocalStorage(): Storage {
  try {
    const k = '__dealo_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      get length() {
        return mem.size;
      },
      clear: () => mem.clear(),
      getItem: (k) => mem.get(k) ?? null,
      key: (i) => [...mem.keys()][i] ?? null,
      removeItem: (k) => void mem.delete(k),
      setItem: (k, v) => void mem.set(k, v),
    };
  }
}
