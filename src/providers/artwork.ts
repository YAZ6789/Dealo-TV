import { useEffect, useState } from 'react';
import type { ShowId, ShowSummary } from '../types';
import { titleSimilarity } from '../lib/text';
import { cached, DAY, peek } from './cache';
import { getTmdb } from './index';
import { tvmaze } from './tvmaze';
import { useLibrary } from '../store/library';

/**
 * Finds real artwork for shows that don't carry any (built-in catalog, rows
 * imported from your sheet):
 * - Answers already cached on this device come back immediately (no queue).
 * - Network lookups go through a small rate-limited queue (TVmaze allows ~20
 *   calls / 10 s; TMDB is far more generous), most-recently-requested first, so
 *   what's on screen resolves first.
 * - Anything found for a show in your library is saved onto the library entry,
 *   so next time its poster loads straight away with no lookup at all.
 */

export interface Artwork {
  poster?: string;
  backdrop?: string;
}

const memo = new Map<string, Artwork | null>();
const listeners = new Map<string, Set<(a: Artwork | null) => void>>();
const queue: ShowSummary[] = [];
const queued = new Set<string>();
let active = 0;

const limits = () => (getTmdb() ? { max: 4, gap: 80 } : { max: 2, gap: 350 });
const keyFor = (s: ShowSummary) => `art:${getTmdb() ? 'tmdb' : 'tvmaze'}:${s.title.toLowerCase()}:${s.year ?? ''}`;

export const needsArtwork = (s: ShowSummary) => !s.poster && (s.source === 'catalog' || s.source === 'custom');

async function lookup(s: ShowSummary): Promise<Artwork | null> {
  const tmdb = getTmdb();
  return cached(keyFor(s), 30 * DAY, async () => {
    const hits = tmdb ? await tmdb.search(s.title, s.year) : await tvmaze.search(s.title);
    const best = hits
      .map((h) => ({ h, v: titleSimilarity(h.title, s.title) + (h.year && s.year ? (Math.abs(h.year - s.year) <= 1 ? 0.2 : -0.4) : 0) }))
      .filter((x) => x.v >= 0.85 && x.h.poster)
      .sort((a, b) => b.v - a.v)[0]?.h;
    if (!best) return null;
    return { poster: best.poster, backdrop: best.backdrop ?? best.poster?.replace('/medium_portrait/', '/original_untouched/') };
  });
}

/* Library entries: found artwork is written back in small batches (one storage write, not dozens). */
let pendingSave: Record<ShowId, Artwork> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveToLibrary(id: ShowId, art: Artwork) {
  if (!art.poster || !useLibrary.getState().entries[id]) return;
  pendingSave[id] = art;
  saveTimer ??= setTimeout(() => {
    const batch = pendingSave;
    pendingSave = {};
    saveTimer = undefined;
    useLibrary.getState().setArtwork(batch);
  }, 1200);
}

function deliver(s: ShowSummary, art: Artwork | null) {
  memo.set(s.id, art);
  if (art) saveToLibrary(s.id, art);
  listeners.get(s.id)?.forEach((fn) => fn(art));
  listeners.delete(s.id);
}

function pump() {
  const { max, gap } = limits();
  while (active < max && queue.length) {
    const s = queue.pop()!; // LIFO: most recently requested (visible) first
    active++;
    lookup(s)
      .catch(() => null)
      .then((art) => deliver(s, art))
      .finally(() => {
        queued.delete(s.id);
        setTimeout(() => {
          active--;
          pump();
        }, gap);
      });
  }
}

function enqueue(s: ShowSummary) {
  if (queued.has(s.id) || memo.has(s.id)) return;
  queued.add(s.id);
  // Fast path: a cached answer skips the rate-limited queue entirely.
  void peek<Artwork | null>(keyFor(s)).then((hit) => {
    if (hit !== undefined) {
      queued.delete(s.id);
      deliver(s, hit);
      return;
    }
    const i = queue.findIndex((q) => q.id === s.id);
    if (i >= 0) queue.splice(i, 1);
    queue.push(s);
    if (queue.length > 150) queued.delete(queue.shift()!.id);
    pump();
  });
}

export function requestArtwork(s: ShowSummary, cb: (a: Artwork | null) => void): () => void {
  if (memo.has(s.id)) {
    cb(memo.get(s.id)!);
    return () => undefined;
  }
  if (!listeners.has(s.id)) listeners.set(s.id, new Set());
  listeners.get(s.id)!.add(cb);
  enqueue(s);
  return () => listeners.get(s.id)?.delete(cb);
}

/** Warm the browser's image cache so a picture is already there when it scrolls/flies into view. */
const warmed = new Set<string>();
export function warmImage(url?: string) {
  if (!url || warmed.has(url) || typeof Image === 'undefined') return;
  warmed.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

/**
 * Get artwork ready for shows that are about to be shown (the next cards in a
 * carousel or tunnel). Pass them in priority order — the first is fetched first.
 */
export function prefetchArtwork(shows: ShowSummary[], kind: 'poster' | 'backdrop' = 'poster') {
  for (const s of [...shows].reverse()) {
    if (!needsArtwork(s)) warmImage(kind === 'poster' ? s.poster : s.backdrop ?? s.poster);
    else if (memo.has(s.id)) warmImage(memo.get(s.id)?.[kind] ?? memo.get(s.id)?.poster);
    else requestArtwork(s, (a) => warmImage(a?.[kind] ?? a?.poster));
  }
}

/** Background job: look up missing posters for the whole library once, watching shows first. */
export function backfillLibraryArtwork() {
  const rank = { watching: 0, completed: 1, plan: 2, on_hold: 3, dropped: 4 } as const;
  const todo = Object.values(useLibrary.getState().entries)
    .filter((e) => needsArtwork(e.show))
    .sort((a, b) => rank[a.status] - rank[b.status]);
  // reversed so the highest-priority ones are popped (LIFO) first; visible posters requested later still jump ahead
  for (const e of todo.reverse()) enqueue(e.show);
}

/**
 * Artwork for a show — its own images if present, otherwise looked up once it
 * is near the screen. `eager` skips the visibility check (3D designs, heroes,
 * the focused card) and looks it up straight away.
 */
export function useArtwork(show: ShowSummary, el: React.RefObject<Element | null>, eager = false): Artwork {
  const needs = needsArtwork(show);
  const [art, setArt] = useState<Artwork | null | undefined>(() => (needs ? memo.get(show.id) : undefined));

  useEffect(() => {
    if (!needs) return;
    if (memo.has(show.id)) {
      setArt(memo.get(show.id));
      return;
    }
    if (eager || typeof IntersectionObserver === 'undefined') return requestArtwork(show, setArt);
    const node = el.current;
    if (!node) return requestArtwork(show, setArt);
    let cancel: (() => void) | undefined;
    const io = new IntersectionObserver(
      (ents) => {
        if (ents.some((e) => e.isIntersecting)) {
          io.disconnect();
          cancel = requestArtwork(show, setArt);
        }
      },
      { rootMargin: '600px' },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      cancel?.();
    };
  }, [needs, show, el, eager]);

  if (!needs) return { poster: show.poster, backdrop: show.backdrop };
  return { poster: art?.poster, backdrop: art?.backdrop };
}
