import type { ActivityEvent, LibraryDoc, LibraryEntry, WatchStatus } from '../types';
import { catalogSummary, getCatalogShow } from '../providers/catalog';
import { defaultTaste, DOC_VERSION } from '../store/library';
import { allWatched, positionToWatched } from './progress';

/**
 * A realistic sample library built from the offline catalog — lets you explore
 * every screen (recommendations, stats, heatmap…) before importing your own data.
 */
const PLAN: [slug: string, status: WatchStatus, rating?: number, extra?: { pos?: [number, number]; fav?: boolean; daysAgo?: number }][] = [
  ['breaking-bad', 'completed', 10, { fav: true, daysAgo: 300 }],
  ['better-call-saul', 'completed', 9, { daysAgo: 220 }],
  ['dark', 'completed', 9, { fav: true, daysAgo: 160 }],
  ['severance', 'watching', 9, { pos: [2, 6], daysAgo: 1 }],
  ['the-bear', 'watching', 8, { pos: [3, 4], daysAgo: 3 }],
  ['andor', 'watching', undefined, { pos: [1, 9], daysAgo: 6 }],
  ['slow-horses', 'watching', 8, { pos: [2, 3], daysAgo: 12 }],
  ['succession', 'completed', 9, { daysAgo: 120 }],
  ['chernobyl', 'completed', 10, { daysAgo: 400 }],
  ['mr-robot', 'completed', 8, { daysAgo: 500 }],
  ['true-detective', 'completed', 8, { daysAgo: 600 }],
  ['arcane', 'completed', 9, { daysAgo: 90 }],
  ['the-last-of-us', 'completed', 8, { daysAgo: 70 }],
  ['shogun', 'completed', 9, { daysAgo: 45 }],
  ['mindhunter', 'on_hold', 8, { pos: [2, 4], daysAgo: 200 }],
  ['game-of-thrones', 'completed', 7, { daysAgo: 900 }],
  ['the-office-us', 'dropped', 4, { pos: [2, 6], daysAgo: 700 }],
  ['friends', 'dropped', 3, { pos: [1, 8], daysAgo: 800 }],
  ['stranger-things', 'completed', 7, { daysAgo: 250 }],
  ['the-wire', 'plan'],
  ['fargo', 'plan'],
  ['black-mirror', 'plan'],
  ['the-boys', 'plan'],
  ['squid-game', 'completed', 7, { daysAgo: 330 }],
];

export function buildDemoDoc(now = Date.now()): LibraryDoc {
  const day = 86_400_000;
  const entries: Record<string, LibraryEntry> = {};
  const activity: ActivityEvent[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  for (const [slug, status, rating, extra = {}] of PLAN) {
    const c = getCatalogShow(slug);
    if (!c) continue;
    const show = catalogSummary(c);
    const sizes = c.seasons;
    const last = now - (extra.daysAgo ?? 30) * day;
    const watched = status === 'completed' ? allWatched(sizes) : extra.pos ? positionToWatched({ season: extra.pos[0], episode: extra.pos[1] }, sizes) : {};
    // Spread the episodes over the weeks before `last`, a few per viewing day (binge-y).
    const eps = Object.entries(watched).flatMap(([s, list]) => list.map((e) => [Number(s), e] as const));
    let t = last - eps.length * 0.9 * day;
    for (const [s, e] of eps) {
      if (t > now - 380 * day) activity.push({ kind: 'episode', id: show.id, at: new Date(t).toISOString(), season: s, episode: e, minutes: c.runtime });
      t += rand() < 0.55 ? 0.04 * day : (1 + Math.floor(rand() * 2)) * day;
      t = Math.min(t, last);
    }
    entries[show.id] = {
      id: show.id,
      show,
      status,
      rating,
      favorite: extra.fav,
      watched,
      seasonSizes: sizes,
      addedAt: new Date(last - (eps.length + 20) * day).toISOString(),
      updatedAt: new Date(last).toISOString(),
      startedAt: eps.length ? new Date(last - eps.length * day).toISOString() : undefined,
      completedAt: status === 'completed' ? new Date(last).toISOString() : undefined,
      lastWatchedAt: eps.length ? new Date(last).toISOString() : undefined,
      origin: 'manual',
    };
  }
  activity.sort((a, b) => a.at.localeCompare(b.at));
  return {
    version: DOC_VERSION,
    entries,
    blocked: {},
    feedback: {},
    taste: { ...defaultTaste(), genres: { reality: -1 } },
    activity,
    importSources: [],
    updatedAt: new Date(now).toISOString(),
  };
}
