import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/** Skin = colours + fonts + small decorative touches. Applies to every design. */
export type ThemeId = 'hud' | 'neon' | 'aurora' | 'terminal' | 'surveillance' | 'daylight' | 'contrast';
export const THEME_IDS: ThemeId[] = ['hud', 'neon', 'aurora', 'terminal', 'surveillance', 'daylight', 'contrast'];

/** Design = the whole browsing experience on the home screen. */
export type DesignId = 'stream' | 'ring' | 'constellation' | 'tunnel' | 'swipe' | 'channel' | 'timeline' | 'mission';
export const DESIGN_IDS: DesignId[] = ['ring', 'constellation', 'tunnel', 'swipe', 'channel', 'timeline', 'mission', 'stream'];

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
  /** Root text scale: 1 = normal, 1.12 = large, 1.25 = extra large. */
  textScale: number;
  /** Tint the background with the colours of the show you're looking at. */
  ambientColors: boolean;
  /** Hide episode titles, synopses and stills you haven't reached yet. */
  spoilerFree: boolean;
  /** Show the microphone button for voice commands. */
  voiceEnabled: boolean;
  /** Anthropic API key for the AI assistant (stored only in this browser). */
  anthropicKey: string;
  onboarded: boolean;
  setTheme: (t: ThemeId) => void;
  setDesign: (d: DesignId) => void;
  setTmdbKey: (key: string, valid?: boolean) => void;
  setRegion: (r: string) => void;
  setReduceFx: (v: boolean) => void;
  setTextScale: (v: number) => void;
  setAmbientColors: (v: boolean) => void;
  setSpoilerFree: (v: boolean) => void;
  setVoiceEnabled: (v: boolean) => void;
  setAnthropicKey: (v: string) => void;
  setOnboarded: (v: boolean) => void;
}

/**
 * Build-time default key (optional). The GitHub Pages workflow fills it from the
 * TMDB_API_KEY repository secret, so every device gets TMDB without pasting a key.
 */
const ENV_KEY = ((import.meta.env?.VITE_TMDB_KEY as string | undefined) ?? '').trim();
export const SITE_TMDB_KEY = ENV_KEY;

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'hud',
      design: 'ring',
      tmdbKey: ENV_KEY,
      region: guessRegion(),
      reduceFx: false,
      textScale: 1,
      ambientColors: true,
      spoilerFree: false,
      voiceEnabled: true,
      anthropicKey: '',
      onboarded: false,
      setTheme: (theme) => set({ theme }),
      setDesign: (design) => set({ design }),
      setTmdbKey: (tmdbKey, tmdbValid) => set({ tmdbKey: tmdbKey.trim(), tmdbValid }),
      setRegion: (region) => set({ region }),
      setReduceFx: (reduceFx) => set({ reduceFx }),
      setTextScale: (textScale) => set({ textScale }),
      setAmbientColors: (ambientColors) => set({ ambientColors }),
      setSpoilerFree: (spoilerFree) => set({ spoilerFree }),
      setVoiceEnabled: (voiceEnabled) => set({ voiceEnabled }),
      setAnthropicKey: (anthropicKey) => set({ anthropicKey: anthropicKey.trim() }),
      setOnboarded: (onboarded) => set({ onboarded }),
    }),
    {
      name: 'dealo:settings',
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage()),
      // An empty saved key means "use the site's key" — so adding the secret later
      // reaches browsers that already saved settings.
      partialize: (s) => ({ ...s, tmdbKey: s.tmdbKey === ENV_KEY ? '' : s.tmdbKey }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return p.tmdbKey ? { ...current, ...p } : { ...current, ...p, tmdbKey: ENV_KEY, tmdbValid: undefined };
      },
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
