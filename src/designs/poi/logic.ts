import type { LibraryEntry, Position } from '../../types';
import type { Collection, Item } from '../useCollections';
import { hash } from '../../lib/ambient';
import { lastWatched, positionToWatched } from '../../lib/progress';

/**
 * Pure helpers for the Person of Interest design: the Machine's vocabulary
 * for your library, deterministic "surveillance" ids, the surveillance log
 * and keyboard navigation across the wall of feeds.
 */

export type FeedKind = 'closed' | 'active' | 'incoming' | 'dormant' | 'threat' | 'suggest';

export interface KindMeta {
  /** The Machine's word for it (decorative, uppercase in the UI). */
  code: string;
  /** Plain-language meaning, always shown next to the code. */
  plain: string;
  /** Box colour: yellow = your current numbers, white = known / civilians, red = threats. */
  tone: 'yellow' | 'white' | 'red';
  /** Dashed boxes are not yet "acquired". */
  dashed?: boolean;
}

export const KIND: Record<FeedKind, KindMeta> = {
  closed: { code: 'Case closed', plain: 'Watched', tone: 'white' },
  active: { code: 'Active number', plain: 'Watching', tone: 'yellow' },
  incoming: { code: 'Incoming number', plain: 'Watchlist', tone: 'yellow', dashed: true },
  dormant: { code: 'Dormant', plain: 'On hold', tone: 'white', dashed: true },
  threat: { code: 'Threat', plain: 'Dropped', tone: 'red' },
  suggest: { code: 'Machine suggests', plain: 'Recommended', tone: 'white' },
};

export function kindOf(item: Pick<Item, 'rec'> & { entry?: Pick<LibraryEntry, 'status'> }): FeedKind {
  switch (item.entry?.status) {
    case 'completed':
      return 'closed';
    case 'watching':
      return 'active';
    case 'plan':
      return 'incoming';
    case 'on_hold':
      return 'dormant';
    case 'dropped':
      return 'threat';
    default:
      return 'suggest';
  }
}

export interface Section {
  id: 'closed' | 'active' | 'incoming' | 'dormant' | 'suggest';
  kind: FeedKind;
  title: string;
  plain: string;
  items: Item[];
}

const SECTION_OF: Partial<Record<Collection['id'], Section['id']>> = {
  watched: 'closed',
  continue: 'active',
  watchlist: 'incoming',
  onhold: 'dormant',
  foryou: 'suggest',
};

/** Library first, in the user's order (Watched → Watching → Watchlist → On hold), recommendations last. */
export const SECTION_ORDER: Section['id'][] = ['closed', 'active', 'incoming', 'dormant', 'suggest'];

export function buildSections(collections: Collection[]): Section[] {
  const out: Section[] = [];
  for (const id of SECTION_ORDER) {
    const col = collections.find((c) => SECTION_OF[c.id] === id);
    if (!col) continue;
    const kind = id as FeedKind;
    out.push({ id, kind, title: KIND[kind].code, plain: KIND[kind].plain, items: col.items });
  }
  return out;
}

/** An SSN-style number, stable per show (never a real-looking 000/666 area). */
export function ssnFor(id: string): string {
  const h = hash(`ssn:${id}`);
  let area = 100 + (h % 799);
  if (area === 666) area = 667;
  const group = 10 + ((h >>> 10) % 90);
  const serial = 1000 + ((h >>> 17) % 9000);
  return `${area}-${group}-${serial}`;
}

/** Camera id, stable per show. */
export function camFor(id: string): string {
  return `CAM-${String(100 + (hash(`cam:${id}`) % 900))}`;
}

/** A plausible on-screen timecode, stable per show (optionally offset in seconds). */
export function timecodeFor(id: string, offset = 0): string {
  const h = hash(`tc:${id}`);
  const t = ((h % 86400) + offset + 86400) % 86400;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}

/** Fake but stable grid coordinates for the dossier still. */
export function coordsFor(id: string): string {
  const h = hash(`geo:${id}`);
  const lat = 40.6 + ((h % 2000) / 10000);
  const lon = 73.9 + (((h >>> 11) % 2000) / 10000);
  return `${lat.toFixed(4)}°N ${lon.toFixed(4)}°W`;
}

/** Pick `n` other feeds to flash through during a cut — varied but deterministic per subject and seed. */
export function cutFrames<T extends { show: { id: string } }>(pool: T[], subjectId: string, n = 2, seed = 0): T[] {
  const others = pool.filter((p) => p.show.id !== subjectId);
  if (others.length <= n) return others;
  const picked: T[] = [];
  let h = hash(`${subjectId}:${seed}`);
  const used = new Set<number>();
  while (picked.length < n) {
    const i = h % others.length;
    if (!used.has(i)) {
      used.add(i);
      picked.push(others[i]);
    }
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    if (used.size >= others.length) break;
  }
  return picked;
}

export interface LogRow {
  season: number;
  /** Watched flag per episode (index 0 = episode 1). */
  eps: boolean[];
  watched: number;
}

/** Per-season episode grid for the "surveillance log". */
export function seasonLog(entry: Pick<LibraryEntry, 'status' | 'watched' | 'position' | 'seasonSizes'>): LogRow[] {
  const sizes = entry.seasonSizes ?? [];
  if (!sizes.length) return [];
  let watched = entry.watched;
  const empty = !Object.values(watched).some((l) => l.length);
  if (empty && entry.position && entry.position.episode > 0) watched = positionToWatched(entry.position, sizes);
  const all = empty && entry.status === 'completed';
  return sizes.map((size, i) => {
    const s = i + 1;
    const set = new Set(watched[s] ?? []);
    const eps = Array.from({ length: size }, (_, e) => all || set.has(e + 1));
    return { season: s, eps, watched: eps.filter(Boolean).length };
  });
}

/** The furthest episode you've seen ("last seen S2·E07"). */
export function lastSeen(entry: Pick<LibraryEntry, 'status' | 'watched' | 'position' | 'seasonSizes'>): Position | undefined {
  const w = lastWatched(entry.watched);
  if (w) return w;
  if (entry.position && entry.position.episode > 0) return entry.position;
  if (entry.status === 'completed' && entry.seasonSizes?.length) {
    const s = entry.seasonSizes.length;
    return { season: s, episode: entry.seasonSizes[s - 1] };
  }
  return undefined;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Spatial keyboard navigation across the wall: ← → step through feeds in
 * reading order; ↑ ↓ jump to the nearest feed in the row above / below
 * (rows can come from different sections and different column counts).
 */
export function nextFeed(boxes: Box[], from: number, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): number {
  if (!boxes.length) return -1;
  if (from < 0 || from >= boxes.length) return 0;
  if (key === 'ArrowLeft') return Math.max(0, from - 1);
  if (key === 'ArrowRight') return Math.min(boxes.length - 1, from + 1);
  const c = boxes[from];
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const down = key === 'ArrowDown';
  let bestRow = Infinity;
  const rowOf: number[] = [];
  boxes.forEach((b, i) => {
    const by = b.y + b.h / 2;
    const dy = down ? by - cy : cy - by;
    if (i !== from && dy > Math.min(b.h, c.h) / 2) {
      rowOf[i] = dy;
      bestRow = Math.min(bestRow, dy);
    }
  });
  if (bestRow === Infinity) return from;
  let best = from;
  let bestDx = Infinity;
  boxes.forEach((b, i) => {
    const dy = rowOf[i];
    if (dy === undefined || dy > bestRow + Math.min(b.h, c.h) / 2) return;
    const dx = Math.abs(b.x + b.w / 2 - cx);
    if (dx < bestDx) {
      bestDx = dx;
      best = i;
    }
  });
  return best;
}

/** Columns for the wall: 2 on phones, up to 5 on wide screens; more on short landscape screens. */
export function wallColumns(width: number, height: number): number {
  let cols = width < 560 ? 2 : width < 900 ? 3 : width < 1250 ? 4 : 5;
  if (height < 520 && width >= 640) cols = Math.max(cols, width < 900 ? 4 : 6);
  return cols;
}
