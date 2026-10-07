/**
 * Keeping a Google Sheet and the library in step.
 *
 * At import time we remember every row's importable fields (`rowState`) and
 * which show it was matched to (`links`). On each sync we re-read the sheet
 * and only act on what CHANGED in the sheet since then:
 *   • new rows        → matched and added (same "smart" rules as an import)
 *   • edited rows     → only the edited fields are applied ("the sheet wins
 *                       for what you just changed"); progress never moves
 *                       backwards
 *   • unchanged rows  → ignored, so edits you made in the app are kept
 *   • deleted rows    → forgotten, but the show stays in your library
 * Rows that can't be matched confidently are returned as `pending` for review.
 */
import type { BlockedEntry, ImportSource, LibraryEntry, ShowId, ShowSummary, SheetRowState } from '../types';
import { normalizeTitle, slugify } from '../lib/text';
import type { Table } from './table';
import { mappingFromHeaders, detectColumns } from './mapping';
import { comparePosition, tableToRows, type ImportRow } from './rows';
import { matchRow, type SearchFn } from './match';
import { entryPosition, planImport, type ImportAction } from './plan';

export const rowKey = (r: Pick<ImportRow, 'title' | 'year'>) => `${normalizeTitle(r.title)}|${r.year ?? ''}`;

export function rowStateOf(r: ImportRow): SheetRowState {
  const st: SheetRowState = {};
  if (r.status) st.status = r.status;
  if (r.blocked) st.blocked = true;
  if (r.rating !== undefined) st.rating = r.rating;
  if (r.position) st.pos = `S${r.position.season}E${r.position.episode}`;
  if (r.notes) st.notes = r.notes;
  if (r.favorite) st.fav = true;
  if (r.startedAt) st.started = r.startedAt;
  if (r.finishedAt) st.finished = r.finishedAt;
  return st;
}

const same = (a: SheetRowState, b: SheetRowState) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());

/**
 * The row reduced to the fields that changed since `prev` (identity fields
 * are always kept). `null` when nothing changed. A row never seen before is
 * returned whole.
 */
export function diffRow(prev: SheetRowState | undefined, row: ImportRow): ImportRow | null {
  const now = rowStateOf(row);
  if (!prev) return row;
  if (same(prev, now)) return null;
  const out: ImportRow = { rowIndex: row.rowIndex, title: row.title, year: row.year, raw: row.raw, tmdbId: row.tmdbId, imdbId: row.imdbId };
  if (now.status !== prev.status) {
    out.status = row.status;
    out.statusInferred = row.statusInferred;
  }
  if (now.blocked !== prev.blocked) out.blocked = row.blocked;
  if (now.rating !== prev.rating) out.rating = row.rating;
  if (now.pos !== prev.pos) out.position = row.position;
  if (now.notes !== prev.notes) out.notes = row.notes;
  if (now.fav !== prev.fav) out.favorite = row.favorite;
  if (now.started !== prev.started) out.startedAt = row.startedAt;
  if (now.finished !== prev.finished) out.finishedAt = row.finishedAt;
  return out;
}

export function customShowFor(row: Pick<ImportRow, 'title' | 'year' | 'genres' | 'platform'>): ShowSummary {
  return {
    id: `custom:${slugify(row.title)}${row.year ? `-${row.year}` : ''}`,
    source: 'custom',
    title: row.title,
    year: row.year,
    genres: row.genres ?? [],
    networks: row.platform ? [row.platform] : undefined,
  };
}

export interface SyncPlan {
  actions: ImportAction[];
  /** Rows that need a human to pick the show. */
  pending: ImportRow[];
  rowState: Record<string, SheetRowState>;
  links: Record<string, ShowId>;
  changedRows: number;
}

export interface SyncContext {
  entries: Record<ShowId, LibraryEntry>;
  blocked: Record<ShowId, BlockedEntry>;
  search: SearchFn;
  signal?: AbortSignal;
}

export async function planSync(table: Table, src: ImportSource, ctx: SyncContext): Promise<SyncPlan> {
  const mapping = src.mapping ? mappingFromHeaders(table, src.mapping) : detectColumns(table).mapping;
  if (mapping.title === undefined) Object.assign(mapping, detectColumns(table).mapping);
  const { rows } = tableToRows(table, mapping, { defaultStatus: src.defaultStatus });

  const prevState = src.rowState ?? {};
  const links: Record<string, ShowId> = { ...(src.links ?? {}) };
  const rowState: Record<string, SheetRowState> = {};
  const fresh: { row: ImportRow; show: ShowSummary }[] = [];
  const edited: { row: ImportRow; show: ShowSummary }[] = [];
  const pending: ImportRow[] = [];
  let changedRows = 0;

  const known = (id: ShowId): ShowSummary | undefined => ctx.entries[id]?.show ?? ctx.blocked[id]?.show;

  for (const row of rows) {
    const key = rowKey(row);
    const prev = prevState[key];
    const diff = diffRow(prev, row);
    if (!diff) {
      rowState[key] = prev!;
      continue;
    }
    changedRows++;

    let show: ShowSummary | undefined;
    const linked = links[key];
    if (linked) show = known(linked) ?? (linked.startsWith('custom:') ? customShowFor(row) : undefined);
    if (!show) {
      const m = await matchRow(row, ctx.search, { signal: ctx.signal });
      if (m.state === 'auto' && m.best) show = m.best;
      else if (row.blocked && !m.best) show = customShowFor(row); // "not interested" in something we can't find: block by title
    }
    if (!show) {
      pending.push(row);
      if (prev) rowState[key] = prev; // keep the old snapshot so the edit is retried
      continue;
    }
    links[key] = show.id;
    rowState[key] = rowStateOf(row);

    if (!prev || !ctx.entries[show.id]) fresh.push({ row, show });
    else {
      // Progress edited in the sheet never moves you backwards.
      const entry = ctx.entries[show.id];
      const furthest = entryPosition(entry);
      if (diff.position && furthest && comparePosition(diff.position, furthest) <= 0) delete diff.position;
      edited.push({ row: diff, show });
    }
  }

  const actions = [...planImport(fresh, ctx.entries, ctx.blocked, 'smart'), ...planImport(edited, ctx.entries, ctx.blocked, 'sheet-wins')];
  // Forget links for rows deleted from the sheet (the shows stay in the library).
  for (const key of Object.keys(links)) if (!(key in rowState) && !pending.some((r) => rowKey(r) === key)) delete links[key];
  return { actions, pending, rowState, links, changedRows };
}
