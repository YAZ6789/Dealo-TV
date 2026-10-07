import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, ChevronRight } from 'lucide-react';
import { useUpcoming, useUpcomingStore, type AiringItem } from '../hooks/useUpcoming';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { epCode, episodeKey, episodeTitle, pendingNotifications, rememberNotified, summarizeEpisodes } from '../lib/airing';

/* ───────────── Shared airing state (used by the banner and the Airing page) ───────────── */

const NOTIFY_KEY = 'dealo:notify';
const NOTIFIED_KEY = 'dealo:notified';
const STICKY_KEY = 'dealo:airingNew';

function readJSON<T>(store: () => Storage, key: string, fallback: T): T {
  try {
    const raw = store().getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(store: () => Storage, key: string, value: unknown) {
  try {
    store().setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled */
  }
}

export const itemKey = (i: AiringItem) => episodeKey(i.entry.id, i.episode.season, i.episode.number);

/**
 * Episodes that were "new since your last visit" stay new for the rest of the
 * session (a manual refresh moves the last-visit marker, which would otherwise
 * make them vanish before you've seen them).
 */
const sticky = new Set<string>(readJSON<string[]>(() => sessionStorage, STICKY_KEY, []));
function markSticky(keys: string[]) {
  let changed = false;
  for (const k of keys)
    if (!sticky.has(k)) {
      sticky.add(k);
      changed = true;
    }
  if (changed) writeJSON(() => sessionStorage, STICKY_KEY, [...sticky].slice(-200));
}

/** Live "has the user ticked this episode off" check (the item's entry is a snapshot). */
export function useIsWatched() {
  const entries = useLibrary((s) => s.entries);
  return useMemo(() => (i: AiringItem) => !!entries[i.entry.id]?.watched[i.episode.season]?.includes(i.episode.number), [entries]);
}

/** Recently aired episodes that are new since your last visit, plus whether each is still unwatched. */
export function useNewEpisodes(recent: AiringItem[]) {
  const isWatched = useIsWatched();
  return useMemo(() => {
    markSticky(recent.filter((i) => i.isNew).map(itemKey));
    const all = recent.filter((i) => i.isNew || sticky.has(itemKey(i)));
    return { all, unwatched: all.filter((i) => !isWatched(i)), isWatched };
  }, [recent, isWatched]);
}

export type NotifyState = 'unsupported' | 'default' | 'denied' | 'granted';

export function notifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}
export function notifyPermission(): NotifyState {
  return notifySupported() ? (Notification.permission as NotifyState) : 'unsupported';
}
export function notifyPref(): boolean {
  try {
    return localStorage.getItem(NOTIFY_KEY) === '1';
  } catch {
    return false;
  }
}
export function setNotifyPref(on: boolean) {
  try {
    localStorage.setItem(NOTIFY_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Record episodes as already announced (e.g. the ones on screen when notifications are switched on). */
export function markNotified(keys: string[]) {
  const notified = readJSON<string[]>(() => localStorage, NOTIFIED_KEY, []);
  writeJSON(() => localStorage, NOTIFIED_KEY, rememberNotified(notified, pendingNotifications(keys, notified)));
}

/** Show a system notification (service worker when available — required on Android — else the page API). */
export async function showSystemNotification(title: string, opts: NotificationOptions & { onClickHash?: string }): Promise<void> {
  if (notifyPermission() !== 'granted') return;
  const { onClickHash, ...options } = opts;
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) {
      await reg.showNotification(title, { ...options, data: { hash: onClickHash } }); // click handled in pwa/sw.js
      return;
    }
  } catch {
    /* fall through to the page API */
  }
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      if (onClickHash) window.location.hash = onClickHash;
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

/**
 * After each refresh, if "Notify me" is on, pop a system notification for every
 * new episode we haven't announced yet. Safe to mount in several places: the
 * notified list in localStorage is updated synchronously, so nothing doubles up.
 */
export function useAiringNotifications() {
  const status = useUpcomingStore((s) => s.status);
  const recent = useUpcomingStore((s) => s.recent);
  const spoilerFree = useSettings((s) => s.spoilerFree);
  const { unwatched } = useNewEpisodes(recent);
  useEffect(() => {
    if (status !== 'ready' || !unwatched.length || !notifyPref() || notifyPermission() !== 'granted') return;
    const notified = readJSON<string[]>(() => localStorage, NOTIFIED_KEY, []);
    const keys = unwatched.map(itemKey);
    const pending = new Set(pendingNotifications(keys, notified));
    if (!pending.size) return;
    writeJSON(() => localStorage, NOTIFIED_KEY, rememberNotified(notified, [...pending]));
    for (const i of unwatched) {
      const k = itemKey(i);
      if (!pending.has(k)) continue;
      const name = episodeTitle(i.episode, { spoilerFree, watched: false });
      void showSystemNotification(`${i.show.title} ${epCode(i.episode.season, i.episode.number)} is out`, {
        body: `${name} — aired ${new Date(`${i.airDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`,
        tag: k,
        icon: i.show.poster ?? `${import.meta.env.BASE_URL}favicon.svg`,
        onClickHash: '#/upcoming',
      });
    }
  }, [status, unwatched, spoilerFree]);
}

/* ───────────── Banner ───────────── */

/** Compact "2 new episodes: Severance S2·E8, The Bear S3·E4 →" link to /upcoming. Renders nothing when there are none. */
export function NewEpisodesBanner() {
  const { recent } = useUpcoming();
  const { unwatched } = useNewEpisodes(recent);
  useAiringNotifications();
  if (!unwatched.length) return null;
  const summary = summarizeEpisodes(unwatched.map((i) => ({ title: i.show.title, season: i.episode.season, number: i.episode.number })));
  const n = unwatched.length;
  return (
    <Link to="/upcoming" className="neb" aria-label={`${n} new episode${n === 1 ? '' : 's'}: ${summary}. Open Airing`}>
      <span className="neb__icon" aria-hidden>
        <BellRing size={16} />
      </span>
      <span className="neb__text">
        <strong>
          {n} new episode{n === 1 ? '' : 's'}
        </strong>
        <span className="neb__sep" aria-hidden>
          :
        </span>{' '}
        <span className="neb__list">{summary}</span>
      </span>
      <ChevronRight size={16} className="neb__arrow" aria-hidden />
    </Link>
  );
}

export default NewEpisodesBanner;
