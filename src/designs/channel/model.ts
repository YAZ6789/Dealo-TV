import { LIBRARY_COLLECTIONS, type Collection, type CollectionId, type Item } from '../useCollections';

/** One show on one network. Channel numbers run 1…n across networks, library first. */
export interface Channel {
  no: number;
  cid: CollectionId;
  net: string;
  netIdx: number;
  /** Position inside its network. */
  idx: number;
  item: Item;
}

export interface Tuned {
  /** Undefined until the viewer picks a network → follow the library-first default. */
  cid?: CollectionId;
  showId?: string;
  idx: number;
}

export const keyOf = (c: Channel) => `${c.cid}:${c.item.show.id}`;

export function buildChannels(collections: Collection[]): Channel[] {
  const out: Channel[] = [];
  collections.forEach((c, netIdx) => c.items.forEach((item, idx) => out.push({ no: out.length + 1, cid: c.id, net: c.label, netIdx, idx, item })));
  return out;
}

/**
 * What's on screen for a tuning request. The tuned show is found by id, so it
 * survives list re-orders. If it moved to another library list (e.g. "Start
 * watching" moves it Watchlist → Watching) the TV follows it; otherwise the
 * slot it was in is kept (the next show slides into place).
 */
export function resolveTuned(channels: Channel[], tuned: Tuned, fallback: CollectionId): { cid: CollectionId; current?: Channel } {
  const cid = tuned.cid ?? fallback;
  const inNet = channels.filter((c) => c.cid === cid);
  const exact = tuned.showId ? inNet.find((c) => c.item.show.id === tuned.showId) : undefined;
  if (exact) return { cid, current: exact };
  if (tuned.showId && LIBRARY_COLLECTIONS.includes(cid)) {
    const moved = channels.find((c) => c.item.show.id === tuned.showId && LIBRARY_COLLECTIONS.includes(c.cid));
    if (moved) return { cid: moved.cid, current: moved };
  }
  if (inNet.length) return { cid, current: inNet[Math.min(Math.max(0, tuned.idx), inNet.length - 1)] };
  return { cid };
}

/** Channel `d` steps away, wrapping around the dial. */
export function stepChannel(channels: Channel[], current: Channel | undefined, d: number): Channel | undefined {
  const n = channels.length;
  if (!n) return undefined;
  const base = current ? current.no - 1 : d > 0 ? -1 : 0;
  return channels[(((base + d) % n) + n) % n];
}

/** The channels around `current` (nearest first), for prefetching their pictures. */
export function neighbours(channels: Channel[], current: Channel | undefined, radius = 3): Channel[] {
  const n = channels.length;
  if (!current || n < 2) return [];
  const out: Channel[] = [];
  const seen = new Set([current.no]);
  for (let r = 1; r <= radius; r++)
    for (const d of [r, -r]) {
      const c = channels[(((current.no - 1 + d) % n) + n) % n];
      if (!seen.has(c.no)) {
        seen.add(c.no);
        out.push(c);
      }
    }
  return out;
}
