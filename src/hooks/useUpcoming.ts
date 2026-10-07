import { useEffect } from 'react';
import { create } from 'zustand';
import type { EpisodeInfo, LibraryEntry, ShowSummary } from '../types';
import { getDetail } from '../providers';
import { mapLimit } from '../providers/http';
import { useLibrary } from '../store/library';
import { safeLocalStorage } from '../store/settings';
import { localIso } from '../lib/airing';

/**
 * Upcoming and newly-aired episodes for the shows you follow (watching,
 * watchlist, on hold, and finished shows that are still running).
 * Details are cached by the providers, so refreshing is cheap.
 */

export interface AiringItem {
  entry: LibraryEntry;
  show: ShowSummary;
  episode: EpisodeInfo;
  /** yyyy-mm-dd */
  airDate: string;
  /** Whole days from today (0 = today, negative = already aired). */
  days: number;
  /** Aired since your last visit and not yet ticked off. */
  isNew: boolean;
}

interface UpcomingState {
  status: 'idle' | 'loading' | 'ready';
  upcoming: AiringItem[];
  /** Recently aired (last 14 days), newest first. */
  recent: AiringItem[];
  loadedAt?: number;
  lastVisit?: string;
  progress: { done: number; total: number };
}

export const useUpcomingStore = create<UpcomingState>()(() => ({ status: 'idle', upcoming: [], recent: [], progress: { done: 0, total: 0 } }));

const VISIT_KEY = 'dealo:lastVisit';
const TTL = 60 * 60_000;

const BASE_KEY = 'dealo:visitBase';

const dayDiff = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00`) - Date.parse(`${localIso()}T12:00:00`)) / 86_400_000);

/**
 * "Since your last visit" baseline. Read once per browser session and then
 * frozen, so refreshing mid-session doesn't make new episodes stop being new;
 * the stored visit time moves to now at the start of each session.
 */
function visitBaseline(): string | undefined {
  let ss: Storage | undefined;
  try {
    ss = sessionStorage;
  } catch {
    ss = undefined;
  }
  const frozen = ss?.getItem(BASE_KEY);
  if (frozen != null) return frozen || undefined;
  const ls = safeLocalStorage();
  const prev = ls.getItem(VISIT_KEY) ?? '';
  ss?.setItem(BASE_KEY, prev);
  ls.setItem(VISIT_KEY, new Date().toISOString());
  return prev || undefined;
}

function follows(e: LibraryEntry): boolean {
  if (e.status === 'dropped') return false;
  if (e.status === 'completed') return e.show.airStatus === 'ongoing' || e.show.airStatus === 'upcoming';
  return true;
}

let running: Promise<void> | undefined;

export function refreshUpcoming(force = false): Promise<void> {
  const st = useUpcomingStore.getState();
  if (running) return running;
  if (!force && st.loadedAt && Date.now() - st.loadedAt < TTL) return Promise.resolve();
  running = (async () => {
    const lastVisit = visitBaseline();
    // Air dates are local calendar dates, so compare with the visit's *local* date (not its UTC date).
    const visitDay = lastVisit ? localIso(new Date(lastVisit)) : undefined;
    const entries = Object.values(useLibrary.getState().entries).filter(follows);
    useUpcomingStore.setState({ status: 'loading', lastVisit, progress: { done: 0, total: entries.length } });
    const upcoming: AiringItem[] = [];
    const recent: AiringItem[] = [];
    let done = 0;
    await mapLimit(entries, 3, async (entry) => {
      try {
        const d = await getDetail(entry.id, entry.show);
        const watched = (s: number, n: number) => entry.watched[s]?.includes(n);
        const push = (episode: EpisodeInfo | undefined, list: AiringItem[]) => {
          if (!episode?.airDate) return;
          const days = dayDiff(episode.airDate);
          const isNew = days <= 0 && !!visitDay && episode.airDate >= visitDay && !watched(episode.season, episode.number);
          list.push({ entry, show: entry.show, episode, airDate: episode.airDate, days, isNew });
        };
        if (d.nextEpisode) push(d.nextEpisode, upcoming);
        // Further announced episodes when the provider embeds them (TVmaze).
        for (const s of d.seasons)
          for (const e of s.episodes ?? [])
            if (e.airDate && dayDiff(e.airDate) > 0 && !(d.nextEpisode && e.season === d.nextEpisode.season && e.number === d.nextEpisode.number) && dayDiff(e.airDate) <= 60) push(e, upcoming);
        if (d.lastEpisode && d.lastEpisode.airDate && dayDiff(d.lastEpisode.airDate) >= -14) push(d.lastEpisode, recent);
      } catch {
        /* offline / unknown show */
      } finally {
        useUpcomingStore.setState({ progress: { done: ++done, total: entries.length } });
      }
    });
    upcoming.sort((a, b) => a.airDate.localeCompare(b.airDate));
    recent.sort((a, b) => b.airDate.localeCompare(a.airDate));
    useUpcomingStore.setState({ status: 'ready', upcoming, recent, loadedAt: Date.now() });
  })().finally(() => {
    running = undefined;
  });
  return running;
}

/** Subscribe to upcoming episodes; triggers a (cached) refresh once the library is loaded. */
export function useUpcoming() {
  const hydrated = useLibrary((s) => s.hydrated);
  const st = useUpcomingStore();
  useEffect(() => {
    if (hydrated) void refreshUpcoming();
  }, [hydrated]);
  return st;
}
