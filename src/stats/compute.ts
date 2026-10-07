import type { ActivityEvent, GenreKey, LibraryDoc, LibraryEntry, ShowId, WatchStatus } from '../types';
import { STATUS_ORDER } from '../types';
import { progressOf } from '../lib/progress';

export interface WatchedEpisode {
  id: ShowId;
  day: string; // yyyy-mm-dd (local)
  minutes: number;
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Net watched episodes (later un-ticks cancel earlier ticks), each with the day it was watched. */
export function netEpisodes(activity: ActivityEvent[], fallbackRuntime: (id: ShowId) => number): WatchedEpisode[] {
  const last = new Map<string, ActivityEvent>();
  for (const a of activity) {
    if (a.kind !== 'episode' && a.kind !== 'unepisode') continue;
    last.set(`${a.id}|${a.season}|${a.episode}`, a);
  }
  const out: WatchedEpisode[] = [];
  for (const a of last.values()) if (a.kind === 'episode') out.push({ id: a.id, day: localDay(a.at), minutes: a.minutes ?? fallbackRuntime(a.id) });
  return out;
}

export function streaks(days: Set<string>, today = new Date()): { current: number; longest: number } {
  if (!days.size) return { current: 0, longest: 0 };
  const sorted = [...days].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.round((Date.parse(`${sorted[i]}T12:00:00`) - Date.parse(`${sorted[i - 1]}T12:00:00`)) / 86_400_000);
    run = diff === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  let current = 0;
  const d = new Date(today);
  // A streak is still alive if you watched yesterday but not yet today.
  if (!days.has(localDay(d.toISOString()))) d.setDate(d.getDate() - 1);
  while (days.has(localDay(d.toISOString()))) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  return { current, longest };
}

export interface Stats {
  total: number;
  byStatus: Record<WatchStatus, number>;
  trackedEpisodes: number;
  trackedHours: number;
  /** Lifetime estimate incl. imported "completed" shows without per-episode history. */
  lifetimeEpisodes: number;
  lifetimeHours: number;
  avgRating?: number;
  ratedCount: number;
  ratingHist: number[]; // index 0 → rating 1
  genres: { genre: GenreKey; value: number; count: number }[];
  decades: { label: string; value: number }[];
  networks: { label: string; value: number }[];
  languages: { label: string; value: number }[];
  heatmap: { day: string; count: number }[]; // last 371 days, oldest first
  months: { label: string; key: string; episodes: number }[]; // last 12 months
  weekdays: number[]; // Sun..Sat episode counts
  streak: { current: number; longest: number };
  activeDays: number;
  topRated: LibraryEntry[];
  bingeKing?: { entry: LibraryEntry; episodes: number; day: string };
  completionRate?: number;
}

export function computeStats(doc: Pick<LibraryDoc, 'entries' | 'activity'>, now = new Date()): Stats {
  const entries = Object.values(doc.entries);
  const runtime = (id: ShowId) => doc.entries[id]?.show.runtime ?? 42;
  const eps = netEpisodes(doc.activity, runtime);

  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<WatchStatus, number>;
  for (const e of entries) byStatus[e.status]++;

  // Lifetime: per show, max(tracked episodes, progress-derived episodes).
  const trackedPerShow = new Map<ShowId, number>();
  for (const e of eps) trackedPerShow.set(e.id, (trackedPerShow.get(e.id) ?? 0) + 1);
  let lifetimeEpisodes = 0;
  let lifetimeMinutes = 0;
  for (const e of entries) {
    const p = progressOf(e);
    let n = Math.max(p.watched, trackedPerShow.get(e.id) ?? 0);
    if (!n && e.status === 'completed') n = e.show.episodeCount ?? 0;
    lifetimeEpisodes += n;
    lifetimeMinutes += n * (e.show.runtime ?? 42);
  }

  const rated = entries.filter((e) => e.rating != null);
  const ratingHist = Array.from({ length: 10 }, () => 0);
  for (const e of rated) ratingHist[Math.min(9, Math.max(0, Math.round(e.rating!) - 1))]++;

  // Genre engagement: weight by how invested you were.
  const gw = new Map<GenreKey, { value: number; count: number }>();
  const engagement = (e: LibraryEntry) => {
    const base = { completed: 1, watching: 0.8, on_hold: 0.4, dropped: 0.15, plan: 0.25 }[e.status];
    return base * (e.rating != null ? 0.5 + e.rating / 10 : 1) * (e.favorite ? 1.3 : 1);
  };
  for (const e of entries) {
    const w = engagement(e);
    for (const g of e.show.genres) {
      const cur = gw.get(g) ?? { value: 0, count: 0 };
      gw.set(g, { value: cur.value + w, count: cur.count + 1 });
    }
  }
  const genres = [...gw.entries()].map(([genre, v]) => ({ genre, value: Math.round(v.value * 10) / 10, count: v.count })).sort((a, b) => b.value - a.value);

  const tally = (keys: (string | undefined)[]) => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const seenish = entries.filter((e) => e.status !== 'plan');
  const decades = tally(seenish.map((e) => (e.show.year ? `${Math.floor(e.show.year / 10) * 10}s` : undefined))).sort((a, b) => a.label.localeCompare(b.label));
  const networks = tally(seenish.map((e) => e.show.networks?.[0])).slice(0, 8);
  let dn: Intl.DisplayNames | undefined;
  try {
    dn = new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    dn = undefined;
  }
  const languages = tally(seenish.map((e) => (e.show.language ? dn?.of(e.show.language) ?? e.show.language : undefined))).slice(0, 6);

  // Calendar heatmap: 53 weeks ending this week (Sunday-aligned).
  const perDay = new Map<string, number>();
  for (const e of eps) perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1);
  const end = new Date(now);
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (52 * 7 + end.getDay()));
  const heatmap: { day: string; count: number }[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = localDay(d.toISOString());
    heatmap.push({ day: key, count: perDay.get(key) ?? 0 });
  }

  const months: Stats['months'] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: d.toLocaleDateString(undefined, { month: 'short' }), episodes: 0 });
  }
  const monthIdx = new Map(months.map((m, i) => [m.key, i]));
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  for (const e of eps) {
    const i = monthIdx.get(e.day.slice(0, 7));
    if (i != null) months[i].episodes++;
    weekdays[new Date(`${e.day}T12:00:00`).getDay()]++;
  }

  // Biggest single-day binge of one show.
  const binge = new Map<string, number>();
  for (const e of eps) binge.set(`${e.id}|${e.day}`, (binge.get(`${e.id}|${e.day}`) ?? 0) + 1);
  let bingeKing: Stats['bingeKing'];
  for (const [k, n] of binge) {
    if (n < 3 || (bingeKing && n <= bingeKing.episodes)) continue;
    const [id, day] = k.split('|');
    const entry = doc.entries[id];
    if (entry) bingeKing = { entry, episodes: n, day };
  }

  const finished = byStatus.completed;
  const startedish = finished + byStatus.dropped + byStatus.watching + byStatus.on_hold;

  return {
    total: entries.length,
    byStatus,
    trackedEpisodes: eps.length,
    trackedHours: Math.round(eps.reduce((a, e) => a + e.minutes, 0) / 60),
    lifetimeEpisodes,
    lifetimeHours: Math.round(lifetimeMinutes / 60),
    avgRating: rated.length ? Math.round((rated.reduce((a, e) => a + e.rating!, 0) / rated.length) * 10) / 10 : undefined,
    ratedCount: rated.length,
    ratingHist,
    genres,
    decades,
    networks,
    languages,
    heatmap,
    months,
    weekdays,
    streak: streaks(new Set(perDay.keys()), now),
    activeDays: perDay.size,
    topRated: [...rated].sort((a, b) => b.rating! - a.rating! || (b.show.rating ?? 0) - (a.show.rating ?? 0)).slice(0, 10),
    bingeKing,
    completionRate: startedish ? Math.round((finished / startedish) * 100) : undefined,
  };
}
