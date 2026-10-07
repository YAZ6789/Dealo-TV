import { useEffect, useState } from 'react';
import type { ShowSummary } from '../types';
import { titleSimilarity } from '../lib/text';
import { cached, DAY } from './cache';
import { getTmdb } from './index';
import { tvmaze } from './tvmaze';

/**
 * Lazily finds real artwork for shows that don't carry any (built-in catalog,
 * custom imports). Only shows that scroll into view are looked up, through a
 * small rate-limited queue (TVmaze allows ~20 calls / 10 s), newest-first so
 * what you're looking at resolves first. Results are cached in IndexedDB.
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
const MAX_ACTIVE = 2;
const GAP_MS = 350;

async function lookup(s: ShowSummary): Promise<Artwork | null> {
  const tmdb = getTmdb();
  const key = `art:${tmdb ? 'tmdb' : 'tvmaze'}:${s.title.toLowerCase()}:${s.year ?? ''}`;
  return cached(key, 30 * DAY, async () => {
    const hits = tmdb ? await tmdb.search(s.title, s.year) : await tvmaze.search(s.title);
    const best = hits
      .map((h) => ({ h, v: titleSimilarity(h.title, s.title) + (h.year && s.year ? (Math.abs(h.year - s.year) <= 1 ? 0.2 : -0.4) : 0) }))
      .filter((x) => x.v >= 0.85 && x.h.poster)
      .sort((a, b) => b.v - a.v)[0]?.h;
    if (!best) return null;
    return { poster: best.poster, backdrop: best.backdrop ?? best.poster?.replace('/medium_portrait/', '/original_untouched/') };
  });
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const s = queue.pop()!; // LIFO: most recently requested (visible) first
    active++;
    lookup(s)
      .catch(() => null)
      .then((art) => {
        memo.set(s.id, art);
        listeners.get(s.id)?.forEach((fn) => fn(art));
        listeners.delete(s.id);
      })
      .finally(() => {
        queued.delete(s.id);
        setTimeout(() => {
          active--;
          pump();
        }, GAP_MS);
      });
  }
}

export function requestArtwork(s: ShowSummary, cb: (a: Artwork | null) => void): () => void {
  if (memo.has(s.id)) {
    cb(memo.get(s.id)!);
    return () => undefined;
  }
  if (!listeners.has(s.id)) listeners.set(s.id, new Set());
  listeners.get(s.id)!.add(cb);
  if (!queued.has(s.id)) {
    queued.add(s.id);
    queue.push(s);
    if (queue.length > 120) {
      const dropped = queue.shift()!;
      queued.delete(dropped.id);
    }
    pump();
  }
  return () => listeners.get(s.id)?.delete(cb);
}

/** Artwork for a show — its own images if present, otherwise looked up once visible. */
export function useArtwork(show: ShowSummary, el: React.RefObject<Element | null>): Artwork {
  const needs = !show.poster && (show.source === 'catalog' || show.source === 'custom');
  const [art, setArt] = useState<Artwork | null | undefined>(() => (needs ? memo.get(show.id) : undefined));

  useEffect(() => {
    if (!needs || memo.has(show.id)) {
      if (needs) setArt(memo.get(show.id));
      return;
    }
    const node = el.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    let cancel: (() => void) | undefined;
    const io = new IntersectionObserver(
      (ents) => {
        if (ents.some((e) => e.isIntersecting)) {
          io.disconnect();
          cancel = requestArtwork(show, setArt);
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      cancel?.();
    };
  }, [needs, show, el]);

  if (!needs) return { poster: show.poster, backdrop: show.backdrop };
  return { poster: art?.poster, backdrop: art?.backdrop };
}
