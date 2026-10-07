import { flushSync } from 'react-dom';
import { THEME_IDS, useSettings, type DesignId, type ThemeId } from '../store/settings';

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let busy = false;

/**
 * Switch theme with a theme-specific cinematic transition. `origin` is the
 * click point (the Aurora bloom grows from there).
 */
export function switchTheme(next: ThemeId, origin?: { x: number; y: number }): void {
  const root = document.documentElement;
  const current = useSettings.getState().theme;
  if (current === next || busy) return;

  const x = origin?.x ?? innerWidth / 2;
  const y = origin?.y ?? innerHeight / 2;
  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 40}px`);

  const apply = () => {
    root.dataset.theme = next;
    root.dataset.vtPhase = 'new';
    flushSync(() => useSettings.getState().setTheme(next));
  };

  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || reduceMotion()) {
    apply();
    delete root.dataset.vtPhase;
    if (!reduceMotion()) {
      const flash = document.createElement('div');
      flash.className = 'vt-fallback';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 700);
    }
    return;
  }

  busy = true;
  root.dataset.transition = next;
  root.dataset.vtPhase = 'old';
  const t = doc.startViewTransition(apply);
  t.finished.finally(() => {
    delete root.dataset.transition;
    delete root.dataset.vtPhase;
    busy = false;
  });
}

export function cycleTheme(dir = 1, origin?: { x: number; y: number }): void {
  const cur = useSettings.getState().theme;
  const i = THEME_IDS.indexOf(cur);
  switchTheme(THEME_IDS[(i + dir + THEME_IDS.length) % THEME_IDS.length], origin);
}

/** Apply the persisted theme on boot (no animation). */
export function applyInitialTheme(): void {
  document.documentElement.dataset.theme = useSettings.getState().theme;
}

/** Switch the browsing design with a "warp" transition (skin-independent). */
export function switchDesign(next: DesignId): void {
  const root = document.documentElement;
  if (useSettings.getState().design === next || busy) return;
  const apply = () => flushSync(() => useSettings.getState().setDesign(next));
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || reduceMotion()) return apply();
  busy = true;
  root.dataset.transition = 'design';
  const t = doc.startViewTransition(apply);
  t.finished.finally(() => {
    delete root.dataset.transition;
    busy = false;
  });
}
