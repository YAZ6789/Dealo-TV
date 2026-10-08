import type { LibraryEntry, Position } from '../../types';
import type { Item } from '../useCollections';
import { fmtEp, progressOf } from '../../lib/progress';

/** The episode after `pos`, using known season sizes (undefined = end of the show). */
export function epAfter(pos: Position, sizes?: number[]): Position | undefined {
  if (!sizes?.length) return { season: pos.season, episode: pos.episode + 1 };
  if (pos.episode < (sizes[pos.season - 1] ?? 0)) return { season: pos.season, episode: pos.episode + 1 };
  for (let s = pos.season + 1; s <= sizes.length; s++) if (sizes[s - 1] > 0) return { season: s, episode: 1 };
  return undefined;
}

export type SlotKind = 'now' | 'premiere' | 'rerun' | 'paused' | 'pilot' | 'next' | 'offair';

export interface Slot {
  kind: SlotKind;
  /** Short tag shown in front of the episode, e.g. NOW / NEXT. */
  tag: string;
  ep?: Position;
  label: string;
}

const TAG: Record<SlotKind, string> = { now: 'Now', premiere: 'Premiere', rerun: 'Rerun', paused: 'Paused', pilot: 'Pilot', next: 'Next', offair: 'Off air' };

/**
 * A channel's "schedule": what's on now and what follows, derived from where you
 * are in the show. Watching → your next episode; watchlist / recommendations →
 * the pilot; watched → a rerun from the top; on hold → where you paused.
 */
export function schedule(item: Item, entry: LibraryEntry | undefined = item.entry, count = 4): Slot[] {
  const sizes = entry?.seasonSizes;
  let kind: SlotKind;
  let start: Position | undefined;
  if (entry?.status === 'watching') {
    kind = 'now';
    start = progressOf(entry).next;
  } else if (entry?.status === 'on_hold') {
    kind = 'paused';
    start = progressOf(entry).next ?? { season: 1, episode: 1 };
  } else if (entry?.status === 'completed') {
    kind = 'rerun';
    start = { season: 1, episode: 1 };
  } else if (entry?.status === 'plan') {
    kind = 'premiere';
    start = { season: 1, episode: 1 };
  } else {
    kind = 'pilot';
    start = { season: 1, episode: 1 };
  }
  if (!start) return [{ kind: 'offair', tag: 'Caught up', label: 'New episodes soon' }];
  const out: Slot[] = [];
  let ep: Position | undefined = start;
  for (let i = 0; i < count; i++) {
    if (!ep) {
      out.push({ kind: 'offair', tag: TAG.offair, label: kind === 'now' ? 'Season finale' : 'End of series' });
      break;
    }
    const k: SlotKind = i === 0 ? kind : 'next';
    out.push({ kind: k, tag: TAG[k], ep, label: fmtEp(ep) });
    ep = epAfter(ep, sizes);
  }
  return out;
}

/** Programme length in minutes for the guide's timeline. */
export const slotMinutes = (runtime?: number) => Math.max(20, Math.min(70, Math.round(runtime || 45)));

/** "NOW S2·E07 · NEXT S2·E08" — the lower-third schedule line. */
export function scheduleLine(slots: Slot[]): { tag: string; text: string }[] {
  return slots.slice(0, 2).map((s) => ({ tag: s.tag, text: s.label }));
}
