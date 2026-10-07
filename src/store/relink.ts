import type { ShowSummary } from '../types';
import { getTmdb } from '../providers';
import { mapLimit } from '../providers/http';
import { titleSimilarity } from '../lib/text';
import { useLibrary } from './library';

/**
 * After a TMDB key is added, move catalog/TVmaze/custom entries onto TMDB ids
 * so they get TMDB posters, episode data and "people also liked" lists.
 * Matches by IMDb/TVDB id first, then by title + year.
 */
export async function relinkToTmdb(onProgress?: (done: number, total: number) => void): Promise<{ moved: number; total: number }> {
  const tmdb = getTmdb();
  if (!tmdb) return { moved: 0, total: 0 };
  const todo = Object.values(useLibrary.getState().entries).filter((e) => !e.id.startsWith('tmdb:'));
  let done = 0;
  let moved = 0;
  await mapLimit(todo, 4, async (e) => {
    try {
      let hit: ShowSummary | undefined;
      const ext = e.show.externalIds;
      if (ext?.imdb) hit = await tmdb.findByExternal('imdb_id', ext.imdb);
      if (!hit && ext?.tvdb) hit = await tmdb.findByExternal('tvdb_id', ext.tvdb);
      if (!hit) {
        const res = await tmdb.search(e.show.title, e.show.year);
        hit = res.find((r) => titleSimilarity(r.title, e.show.title) >= 0.92 && (!r.year || !e.show.year || Math.abs(r.year - e.show.year) <= 1));
      }
      if (hit && !useLibrary.getState().entries[hit.id]) {
        useLibrary.getState().rekey(e.id, { ...hit, keywords: e.show.keywords });
        moved++;
      }
    } catch {
      /* leave entry as is */
    } finally {
      onProgress?.(++done, todo.length);
    }
  });
  return { moved, total: todo.length };
}
