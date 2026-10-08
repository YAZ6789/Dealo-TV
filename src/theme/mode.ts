import { useSyncExternalStore } from 'react';
import { useSettings, type ColorMode } from '../store/settings';

/** Light/dark, resolved: 'auto' follows the device setting (and changes with it). */
export type ResolvedMode = 'dark' | 'light';

const query = () => (typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: light)') : undefined);

export function resolveMode(mode: ColorMode, theme = useSettings.getState().theme): ResolvedMode {
  if (theme === 'contrast') return 'dark'; // High Contrast is built on pure black — it stays dark
  if (mode !== 'auto') return mode;
  return query()?.matches ? 'light' : 'dark';
}

const THEME_COLOR = { dark: '#03060d', light: '#f6f7fb' } as const;

/** Write the resolved mode onto <html> (CSS keys off data-mode) and the browser chrome colour. */
export function applyMode(mode: ColorMode = useSettings.getState().mode): ResolvedMode {
  const resolved = resolveMode(mode);
  document.documentElement.dataset.mode = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
  return resolved;
}

/** Keep 'auto' in step with the device (e.g. phones switching to dark at sunset). */
export function watchSystemMode() {
  query()?.addEventListener('change', () => {
    if (useSettings.getState().mode === 'auto') applyMode('auto');
  });
}

function subscribe(cb: () => void) {
  const q = query();
  q?.addEventListener('change', cb);
  const unsub = useSettings.subscribe(cb);
  return () => {
    q?.removeEventListener('change', cb);
    unsub();
  };
}

/** The mode currently on screen, for components that render differently in light. */
export function useResolvedMode(): ResolvedMode {
  return useSyncExternalStore(subscribe, () => resolveMode(useSettings.getState().mode), () => 'dark');
}
