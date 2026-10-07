import type { LibraryEntry, Position } from '../types';

/** Episodes watched per season → total count. */
export function watchedCount(watched: Record<string, number[]>): number {
  let n = 0;
  for (const k in watched) n += watched[k].length;
  return n;
}

export function totalEpisodes(sizes: number[] | undefined): number {
  return (sizes ?? []).reduce((a, b) => a + b, 0);
}

/** Everything up to and including `pos` (earlier seasons fully). */
export function positionToWatched(pos: Position, sizes: number[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (let s = 1; s <= Math.min(pos.season, sizes.length); s++) {
    const upto = s < pos.season ? sizes[s - 1] : Math.min(pos.episode, sizes[s - 1]);
    if (upto > 0) out[s] = range(1, upto);
  }
  return out;
}

export function allWatched(sizes: number[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  sizes.forEach((n, i) => {
    if (n > 0) out[i + 1] = range(1, n);
  });
  return out;
}

export function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/** The furthest watched episode. */
export function lastWatched(watched: Record<string, number[]>): Position | undefined {
  const seasons = Object.keys(watched)
    .map(Number)
    .filter((s) => watched[s]?.length)
    .sort((a, b) => b - a);
  if (!seasons.length) return undefined;
  const s = seasons[0];
  return { season: s, episode: Math.max(...watched[s]) };
}

/**
 * Next episode to watch: the first unwatched episode after the furthest
 * watched one (so skipping a filler episode doesn't send you back).
 */
export function nextUp(entry: Pick<LibraryEntry, 'watched' | 'position' | 'seasonSizes'>): Position | undefined {
  const sizes = entry.seasonSizes ?? [];
  const last = lastWatched(entry.watched) ?? (entry.position && entry.position.episode > 0 ? entry.position : undefined);
  if (!sizes.length) {
    if (!last) return entry.position ? { season: entry.position.season, episode: Math.max(1, entry.position.episode + 1) } : { season: 1, episode: 1 };
    return { season: last.season, episode: last.episode + 1 };
  }
  let s = last?.season ?? 1;
  let e = (last?.episode ?? 0) + 1;
  while (s <= sizes.length) {
    if (e <= sizes[s - 1]) return { season: s, episode: e };
    s += 1;
    e = 1;
  }
  return undefined; // caught up
}

export interface Progress {
  watched: number;
  total: number;
  pct: number;
  next?: Position;
  caughtUp: boolean;
}

export function progressOf(entry: LibraryEntry): Progress {
  const total = totalEpisodes(entry.seasonSizes);
  let watched = watchedCount(entry.watched);
  if (!watched && entry.position && entry.seasonSizes?.length) watched = watchedCount(positionToWatched(entry.position, entry.seasonSizes));
  if (entry.status === 'completed' && total && !watched) watched = total;
  const next = entry.status === 'completed' ? undefined : nextUp(entry);
  const pct = total ? Math.min(100, Math.round((watched / total) * 100)) : entry.status === 'completed' ? 100 : 0;
  return { watched, total, pct, next, caughtUp: total > 0 && watched >= total };
}

export const fmtEp = (p: Position | undefined) => (p ? `S${p.season}·E${String(p.episode).padStart(2, '0')}` : '');
