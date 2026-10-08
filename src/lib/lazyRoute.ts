import { lazy, type ComponentType } from 'react';

/**
 * Pages and Home designs are separate files that load on first visit. When a
 * new version is deployed, GitHub Pages replaces every file, so a tab (or an
 * installed app resumed from the background) still running the old version
 * asks for files that no longer exist. Instead of crashing, we retry once and
 * then reload into the new version — once; a second failure soon after is
 * shown by the RouteErrorBoundary (e.g. offline before that page was cached).
 */

const KEY = 'dealo:versionReload';
const GAP_MS = 20_000;

/** Reloads into the latest version unless we just did (prevents reload loops). Returns true if reloading. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < GAP_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage unavailable — still try one reload */
  }
  location.reload();
  return true;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRoute<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (err) {
      await pause(400); // a flaky mobile connection: try again once
      try {
        return await load();
      } catch {
        /* still missing — most likely a newer deploy */
      }
      if (navigator.onLine !== false && reloadForNewVersion()) return new Promise<never>(() => undefined); // keep the loading state until the reload
      throw err;
    }
  });
}
