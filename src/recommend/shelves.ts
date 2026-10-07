import type { Recommendation, ShowId } from '../types';
import { GENRE_LABELS } from '../lib/genres';
import type { GenreKey } from '../types';
import type { EngineOutput } from './engine';

export interface Shelf {
  id: string;
  title: string;
  subtitle?: string;
  items: Recommendation[];
  seedId?: ShowId;
}

/** Netflix-style rows derived from one engine run. */
export function buildShelves(out: EngineOutput, opts: { perShelf?: number } = {}): Shelf[] {
  const n = opts.perShelf ?? 18;
  const shelves: Shelf[] = [];

  shelves.push({
    id: 'picks',
    title: out.coldStart ? 'Essential viewing' : 'Top picks for you',
    subtitle: out.coldStart ? 'Rate a few shows and this row becomes personal' : 'Ranked by your taste, diversified',
    items: out.picks,
  });

  if (!out.coldStart) {
    // "Because you watched X" — for the strongest, distinct seeds.
    const usedSeeds = new Set<string>();
    for (const seed of out.seeds) {
      if (shelves.filter((s) => s.seedId).length >= 3) break;
      if (usedSeeds.has(seed.show.title) || seed.weight < 0.45) continue;
      usedSeeds.add(seed.show.title);
      const items = out.ranked
        .map((r) => ({ r, v: out.similarity(seed.show, r.show) * 0.65 + (r.seeds.includes(seed.id) ? 0.35 : 0) + r.score * 0.25 }))
        .filter((x) => x.v > 0.25)
        .sort((a, b) => b.v - a.v)
        .slice(0, n)
        .map((x) => x.r);
      if (items.length >= 5) {
        const verb = seed.verb === 'asked for more like' ? 'asked for more like' : seed.verb;
        shelves.push({ id: `because-${seed.id}`, title: `Because you ${verb} ${seed.show.title}`, items, seedId: seed.id });
      }
    }
  }

  const gems = out.ranked.filter((r) => r.reasons.some((x) => x.kind === 'gem') && r.match >= 55).slice(0, n);
  if (gems.length >= 5) shelves.push({ id: 'gems', title: 'Hidden gems', subtitle: 'Brilliant, criminally under-watched', items: gems });

  const binge = out.ranked.filter((r) => (r.show.seasonCount ?? 9) <= 2 || r.show.keywords?.includes('limited series')).slice(0, n);
  if (binge.length >= 5) shelves.push({ id: 'binge', title: 'Finish in a weekend', subtitle: 'One or two seasons, no commitment', items: binge });

  const genreTraits = out.traits.filter((t) => t.key.startsWith('g:')).slice(0, 2);
  for (const t of genreTraits) {
    const g = t.key.slice(2) as GenreKey;
    const items = out.ranked.filter((r) => r.show.genres[0] === g || r.show.genres.slice(0, 2).includes(g)).slice(0, n);
    if (items.length >= 6) shelves.push({ id: `genre-${g}`, title: `${GENRE_LABELS[g]} tuned to you`, items });
  }

  const acclaimed = out.ranked.filter((r) => (r.show.rating ?? 0) >= 8.2 && r.match >= 50).slice(0, n);
  if (acclaimed.length >= 5) shelves.push({ id: 'acclaimed', title: 'Critically acclaimed matches', items: acclaimed });

  const explore = out.ranked
    .filter((r) => r.exploratory || (r.match < 70 && (r.show.rating ?? 0) >= 8))
    .slice(0, n)
    .map((r) => ({ ...r, exploratory: true }));
  if (!out.coldStart && explore.length >= 5) shelves.push({ id: 'explore', title: 'Something different', subtitle: 'Outside your comfort zone — but loved', items: explore });

  return shelves;
}
