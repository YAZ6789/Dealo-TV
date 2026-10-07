import { useMemo } from 'react';
import type { LibraryEntry, Recommendation, ShowSummary } from '../types';
import { useLibrary } from '../store/library';
import { useRecommendations } from '../hooks/useRecommendations';

export interface Item {
  show: ShowSummary;
  rec?: Recommendation;
  entry?: LibraryEntry;
}

export type CollectionId = 'foryou' | 'continue' | 'watchlist' | 'watched' | 'gems' | 'binge' | 'onhold';

export interface Collection {
  id: CollectionId;
  label: string;
  items: Item[];
}

const byRecent = (a: LibraryEntry, b: LibraryEntry) => (b.lastWatchedAt ?? b.completedAt ?? b.updatedAt).localeCompare(a.lastWatchedAt ?? a.completedAt ?? a.updatedAt);

/** The same data every design browses, shaped as named collections. */
export function useCollections() {
  const entries = useLibrary((s) => s.entries);
  const recs = useRecommendations();
  const collections = useMemo<Collection[]>(() => {
    const list = Object.values(entries);
    const lib = (pred: (e: LibraryEntry) => boolean, sort = byRecent) => list.filter(pred).sort(sort).map((e) => ({ show: e.show, entry: e }));
    const out = recs.output;
    const forYou: Item[] = out ? [...out.picks, ...out.ranked.filter((r) => !out.picks.some((p) => p.show.id === r.show.id))].slice(0, 40).map((r) => ({ show: r.show, rec: r })) : [];
    const shelf = (id: string) => recs.shelves.find((s) => s.id === id)?.items.map((r) => ({ show: r.show, rec: r })) ?? [];
    // Library first — what you've watched, what you're watching, what's next. Recommendations come after.
    const all: Collection[] = [
      { id: 'watched', label: 'Watched', items: lib((e) => e.status === 'completed') },
      { id: 'continue', label: 'Watching', items: lib((e) => e.status === 'watching') },
      { id: 'watchlist', label: 'Watchlist', items: lib((e) => e.status === 'plan', (a, b) => b.addedAt.localeCompare(a.addedAt)) },
      { id: 'onhold', label: 'On hold', items: lib((e) => e.status === 'on_hold') },
      { id: 'foryou', label: 'For you', items: forYou },
      { id: 'gems', label: 'Hidden gems', items: shelf('gems') },
      { id: 'binge', label: 'Quick binges', items: shelf('binge') },
    ];
    return all.filter((c) => c.items.length > 0 || c.id === 'foryou');
  }, [entries, recs.output, recs.shelves]);
  return { collections, recs };
}

/** Library collections, in the order Home should lead with. */
export const LIBRARY_COLLECTIONS: CollectionId[] = ['watched', 'continue', 'watchlist', 'onhold'];

/** The collection a design should open on: the first library list with shows in it, else recommendations. */
export function defaultCollection(collections: Collection[]): CollectionId {
  return LIBRARY_COLLECTIONS.find((id) => collections.some((c) => c.id === id && c.items.length > 0)) ?? 'foryou';
}
