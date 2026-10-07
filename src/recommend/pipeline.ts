import { create } from 'zustand';
import type { LibraryDoc, ShowDetail, ShowSummary } from '../types';
import { catalogPool, getTmdb, providerMode } from '../providers';
import { relatedInCatalog } from '../providers/catalog';
import { mapLimit } from '../providers/http';
import { GENRE_TO_TMDB } from '../lib/genres';
import { snapshot, useLibrary } from '../store/library';
import { recommend, type EngineOutput, type RelatedList } from './engine';
import { collectSignals } from './profile';
import { buildShelves, type Shelf } from './shelves';

/**
 * Orchestrates candidate generation around the pure engine:
 *
 *  open mode  → whole built-in catalog + content-based "related" lists.
 *  tmdb mode  → TMDB recommendations/similar of your top seeds, trending,
 *               top-rated and genre-targeted discover queries; then a second
 *               pass that fetches full metadata (themes, creators, cast) for
 *               the best ~60 candidates and re-ranks with it.
 */

export type RecStage = 'idle' | 'seeds' | 'candidates' | 'enrich' | 'ranking' | 'ready' | 'error';

interface RecsState {
  stage: RecStage;
  output?: EngineOutput;
  shelves: Shelf[];
  signature?: string;
  error?: string;
  computedAt?: number;
}

export const useRecs = create<RecsState>()(() => ({ stage: 'idle', shelves: [] }));

const SEEDS_FOR_RELATED = 14;
const ENRICH_TOP = 60;

function stripDetail(d: ShowDetail): ShowSummary {
  return snapshot(d);
}

export async function computeRecommendations(doc: LibraryDoc, onStage?: (s: RecStage) => void): Promise<EngineOutput> {
  const now = Date.now();
  const base = { entries: doc.entries, blocked: doc.blocked, feedback: doc.feedback, taste: doc.taste, activity: doc.activity, now };
  const tmdb = getTmdb();

  if (!tmdb || providerMode() === 'open') {
    onStage?.('candidates');
    const pool = catalogPool();
    const signals = collectSignals(base);
    const related: RelatedList[] = signals.positive.slice(0, 20).map((s) => ({ seed: s.id, items: relatedInCatalog(s.show, 16), strength: 0.6 }));
    onStage?.('ranking');
    return recommend({ ...base, candidates: pool, related, collabWeight: 0.12, limit: 24 });
  }

  /* ── tmdb mode ── */
  onStage?.('seeds');
  const signals = collectSignals(base);
  const tmdbSeeds = signals.positive.filter((s) => s.id.startsWith('tmdb:')).slice(0, SEEDS_FOR_RELATED);
  const seedDetails = await mapLimit(tmdbSeeds, 6, (s) => tmdb.detail(Number(s.id.slice(5))).catch(() => undefined));

  // Feed richer metadata back into the library (themes, creators… improve the profile).
  const refresh = useLibrary.getState().refresh;
  seedDetails.forEach((d) => d && refresh(d.id, stripDetail(d)));

  const related: RelatedList[] = [];
  seedDetails.forEach((d, i) => {
    if (!d) return;
    if (d.related?.length) related.push({ seed: tmdbSeeds[i].id, items: d.related, strength: 1 });
    if (d.similar?.length) related.push({ seed: tmdbSeeds[i].id, items: d.similar.slice(0, 12), strength: 0.45 });
  });

  onStage?.('candidates');
  const genreScores = new Map<number, number>();
  for (const s of signals.positive.slice(0, 40))
    for (const g of s.show.genres) {
      const id = GENRE_TO_TMDB[g];
      if (id) genreScores.set(id, (genreScores.get(id) ?? 0) + s.weight);
    }
  for (const [g, v] of Object.entries(doc.taste.genres)) {
    const id = GENRE_TO_TMDB[g as keyof typeof GENRE_TO_TMDB];
    if (id && v > 0) genreScores.set(id, (genreScores.get(id) ?? 0) + 2);
  }
  const topGenres = [...genreScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
  const avoid = Object.entries(doc.taste.genres)
    .filter(([, v]) => v < 0)
    .map(([g]) => GENRE_TO_TMDB[g as keyof typeof GENRE_TO_TMDB])
    .filter((x): x is number => !!x);
  const langs = doc.taste.preferences.languages;

  const jobs: (() => Promise<ShowSummary[]>)[] = [
    () => tmdb.trending(1),
    () => tmdb.trending(2),
    () => tmdb.topRated(1),
    () => tmdb.topRated(2),
    () => tmdb.topRated(3),
    () => tmdb.popular(1),
    ...topGenres.map((g) => () => tmdb.discover({ genres: [g], withoutGenres: avoid, sort: 'vote_average.desc', minVotes: 250 })),
    ...topGenres.slice(0, 2).map((g) => () => tmdb.discover({ genres: [g], withoutGenres: avoid, sort: 'popularity.desc', minVotes: 60, fromYear: new Date().getFullYear() - 3 })),
    ...langs.filter((l) => l !== 'en').slice(0, 2).map((l) => () => tmdb.discover({ language: l, withoutGenres: avoid, sort: 'vote_average.desc', minVotes: 100 })),
  ];
  const lists = await mapLimit(jobs, 6, (j) => j().catch(() => [] as ShowSummary[]));
  const candidates = lists.flat();

  onStage?.('enrich');
  const engineIn = { ...base, entries: useLibrary.getState().entries, candidates, related, collabWeight: 0.26, limit: 24 };
  const first = recommend({ ...engineIn, limit: 40 });
  const toEnrich = first.ranked.filter((r) => !r.show.keywords?.length).slice(0, ENRICH_TOP);
  const details = await mapLimit(toEnrich, 6, (r) => tmdb.detail(Number(r.show.id.slice(5))).catch(() => undefined));
  const enriched = new Map<string, ShowSummary>();
  details.forEach((d) => d && enriched.set(d.id, stripDetail(d)));
  const enrichedCandidates = candidates.map((c) => enriched.get(c.id) ?? c);
  const enrichedRelated = related.map((r) => ({ ...r, items: r.items.map((c) => enriched.get(c.id) ?? c) }));

  onStage?.('ranking');
  return recommend({ ...engineIn, candidates: enrichedCandidates, related: enrichedRelated });
}

function signatureOf(doc: LibraryDoc, mode: string): string {
  const e = Object.values(doc.entries)
    .map((x) => `${x.id}:${x.status}:${x.rating ?? ''}:${x.favorite ? 1 : 0}:${Math.floor((Object.values(x.watched).flat().length || 0) / 3)}`)
    .sort()
    .join(',');
  return `${mode}|${e}|${Object.keys(doc.blocked).sort().join(',')}|${JSON.stringify(doc.feedback && Object.keys(doc.feedback).sort())}|${JSON.stringify(doc.taste)}`;
}

let running: Promise<void> | undefined;
let queued = false;

/** Recompute if the library changed in a way that matters. Safe to call often. */
export async function ensureRecommendations(force = false): Promise<void> {
  if (running) {
    queued = true;
    return running;
  }
  const lib = useLibrary.getState();
  if (!lib.hydrated) return;
  const doc = lib.exportDoc();
  const sig = signatureOf(doc, providerMode());
  const st = useRecs.getState();
  if (!force && st.signature === sig && st.output) return;

  running = (async () => {
    try {
      if (!st.output) useRecs.setState({ stage: 'seeds' });
      const output = await computeRecommendations(doc, (stage) => {
        if (!useRecs.getState().output) useRecs.setState({ stage });
      });
      useRecs.setState({ output, shelves: buildShelves(output), signature: sig, stage: 'ready', error: undefined, computedAt: Date.now() });
    } catch (err) {
      console.error('[dealo] recommendations failed', err);
      useRecs.setState({ stage: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = undefined;
      if (queued) {
        queued = false;
        setTimeout(() => void ensureRecommendations(), 50);
      }
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleRecommendations(delay = 900): void {
  clearTimeout(timer);
  timer = setTimeout(() => void ensureRecommendations(), delay);
}
