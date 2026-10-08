import { create } from 'zustand';
import { toast } from './components/toast';

/**
 * Install-as-app + offline support. The service worker (pwa/sw.js, emitted by
 * the build) only runs in production builds; in dev everything is live.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  /** Chrome/Edge/Android: the browser's install prompt is available. */
  canInstall: boolean;
  /** Running as an installed app (standalone window). */
  installed: boolean;
  offline: boolean;
}

let deferred: InstallPromptEvent | null = null;

const standalone = () =>
  typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const usePwa = create<PwaState>(() => ({
  canInstall: false,
  installed: standalone(),
  offline: typeof navigator !== 'undefined' && !navigator.onLine,
}));

export const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

export async function installApp(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  usePwa.setState({ canInstall: false });
  return outcome === 'accepted';
}

export function setupPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    usePwa.setState({ canInstall: false, installed: true });
    toast('Dealo TV installed — find it with your other apps');
  });
  window.addEventListener('online', () => usePwa.setState({ offline: false }));
  window.addEventListener('offline', () => {
    usePwa.setState({ offline: true });
    toast('You’re offline — your library still works; new show data will load when you’re back');
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // When a new version takes over (from "Reload" in this or any other tab), every open tab reloads:
  // the old version's lazy chunks are no longer cached and are gone from the server.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  // Notification clicks on a window the worker doesn't control yet.
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string; hash?: string }>) => {
    if (e.data?.type === 'dealo:navigate' && e.data.hash) location.hash = e.data.hash;
  });
  // A new version waits for "Reload" — or is applied quietly the next time the app goes to the
  // background (switching apps, locking the phone), so you come back to it already up to date.
  let waiting: ServiceWorker | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && waiting) waiting.postMessage('skipWaiting');
  });
  const offerUpdate = (worker: ServiceWorker) => {
    waiting = worker;
    toast('A new version of Dealo TV is ready', {
      label: 'Reload',
      run: () => worker.postMessage('skipWaiting'),
    });
  };
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            // `controller` is null on the very first install — nothing to update then.
            if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
          });
        });
        // Check for a new deploy when you come back to the tab, at most hourly.
        let last = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && Date.now() - last > 3_600_000) {
            last = Date.now();
            void reg.update().catch(() => undefined);
          }
        });
      })
      .catch(() => undefined);
  });
}
