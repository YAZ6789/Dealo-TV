import type { LibraryDoc } from '../types';
import type { Stats } from './compute';

/**
 * Achievements with bronze / silver / gold tiers, derived from your library
 * and episode history. Nothing is stored — badges are recomputed, so they
 * always agree with the data (un-ticking episodes can lose a tier).
 */

export type BadgeIcon = 'flame' | 'zap' | 'trophy' | 'clock' | 'star' | 'globe' | 'history' | 'compass' | 'moon' | 'ban' | 'repeat' | 'sunrise';

export interface Badge {
  id: string;
  name: string;
  icon: BadgeIcon;
  /** What the tiers count, e.g. "days in a row". */
  unit: string;
  hint: string;
  value: number;
  tiers: [number, number, number];
  /** 0 = locked, 1 bronze, 2 silver, 3 gold. */
  tier: 0 | 1 | 2 | 3;
  /** Target for the next tier (undefined once gold). */
  next?: number;
  /** 0–1 progress from the current tier towards the next. */
  progress: number;
}

type Def = Omit<Badge, 'tier' | 'next' | 'progress' | 'value'> & { value: (d: Ctx) => number };
interface Ctx {
  doc: Pick<LibraryDoc, 'entries' | 'activity' | 'blocked'>;
  stats: Stats;
}

const seen = (c: Ctx) => Object.values(c.doc.entries).filter((e) => e.status !== 'plan');
const distinct = <T>(xs: (T | undefined)[]) => new Set(xs.filter((x): x is T => x != null)).size;

/**
 * Episodes ticked within a local-time window of the day. Only each episode's
 * latest event counts (un-ticking cancels), and bulk ticks — a whole season or
 * "up to here" in the same second — count once, so backfilling a backlog at 1am
 * doesn't make you a night owl.
 */
const ticksBetween = (c: Ctx, from: number, to: number) => {
  const last = new Map<string, (typeof c.doc.activity)[number]>();
  for (const a of c.doc.activity) if (a.kind === 'episode' || a.kind === 'unepisode') last.set(`${a.id}|${a.season}|${a.episode}`, a);
  const moments = new Set<string>();
  for (const a of last.values()) {
    if (a.kind !== 'episode') continue;
    const h = new Date(a.at).getHours();
    if (h >= from && h < to) moments.add(`${a.id}|${a.at.slice(0, 19)}`);
  }
  return moments.size;
};

const DEFS: Def[] = [
  { id: 'streak', name: 'On a Roll', icon: 'flame', unit: 'days in a row', hint: 'Watch at least one episode every day', tiers: [3, 7, 30], value: (c) => c.stats.streak.longest },
  { id: 'marathon', name: 'Marathoner', icon: 'zap', unit: 'episodes in one day', hint: 'Binge a lot in a single day', tiers: [5, 10, 20], value: (c) => c.stats.bingeKing?.episodes ?? 0 },
  { id: 'completionist', name: 'Completionist', icon: 'trophy', unit: 'shows finished', hint: 'Finish shows all the way through', tiers: [5, 25, 100], value: (c) => c.stats.byStatus.completed },
  { id: 'hours', name: 'Screen Time', icon: 'clock', unit: 'hours watched', hint: 'Lifetime hours, including imported shows', tiers: [100, 500, 2000], value: (c) => c.stats.lifetimeHours },
  { id: 'critic', name: 'Critic', icon: 'star', unit: 'shows rated', hint: 'Rate shows — it sharpens your recommendations', tiers: [10, 50, 150], value: (c) => c.stats.ratedCount },
  { id: 'globetrotter', name: 'Globetrotter', icon: 'globe', unit: 'languages', hint: 'Watch shows in different languages', tiers: [3, 5, 8], value: (c) => distinct(seen(c).map((e) => e.show.language)) },
  { id: 'decades', name: 'Time Traveller', icon: 'history', unit: 'decades', hint: 'Watch shows from different decades', tiers: [3, 5, 7], value: (c) => distinct(seen(c).map((e) => (e.show.year ? Math.floor(e.show.year / 10) : undefined))) },
  { id: 'genres', name: 'Explorer', icon: 'compass', unit: 'genres', hint: 'Branch out across genres', tiers: [8, 12, 16], value: (c) => new Set(seen(c).flatMap((e) => e.show.genres)).size },
  { id: 'night', name: 'Night Owl', icon: 'moon', unit: 'episodes after midnight', hint: 'Tick episodes between midnight and 5am', tiers: [5, 25, 100], value: (c) => ticksBetween(c, 0, 5) },
  { id: 'early', name: 'Early Bird', icon: 'sunrise', unit: 'episodes before 9am', hint: 'Tick episodes between 5am and 9am', tiers: [5, 25, 100], value: (c) => ticksBetween(c, 5, 9) },
  { id: 'gatekeeper', name: 'Gatekeeper', icon: 'ban', unit: 'shows ruled out', hint: 'Mark shows “not interested” to train the recommender', tiers: [10, 30, 75], value: (c) => Object.keys(c.doc.blocked).length },
  {
    id: 'rewatch',
    name: 'Comfort Zone',
    icon: 'repeat',
    unit: 'rewatches',
    hint: 'Rewatch a show you love',
    tiers: [1, 3, 10],
    value: (c) => Object.values(c.doc.entries).reduce((n, e) => n + (e.rewatchCount ?? 0), 0),
  },
];

export function computeBadges(doc: Ctx['doc'], stats: Stats): Badge[] {
  const ctx: Ctx = { doc, stats };
  return DEFS.map(({ value, ...d }) => {
    const v = Math.floor(value(ctx));
    const tier = (d.tiers.filter((t) => v >= t).length as Badge['tier']);
    const next = tier < 3 ? (d.tiers as number[])[tier] : undefined;
    const prev = tier > 0 ? d.tiers[tier - 1] : 0;
    const progress = next == null ? 1 : Math.max(0, Math.min(1, (v - prev) / (next - prev)));
    return { ...d, value: v, tier, next, progress };
  }).sort((a, b) => b.tier - a.tier || b.progress - a.progress);
}

export const TIER_NAME = ['Locked', 'Bronze', 'Silver', 'Gold'] as const;

/** Today's streak status, for the "keep it alive" nudge. */
export function streakStatus(stats: Stats, now = new Date()): 'none' | 'safe' | 'at-risk' {
  if (!stats.streak.current) return 'none';
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const today = stats.heatmap.find((d) => d.day === key);
  return today && today.count > 0 ? 'safe' : 'at-risk';
}
