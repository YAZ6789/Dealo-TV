/**
 * Pure merge planner: decides what an import does to the library.
 */
import type { BlockedEntry, LibraryEntry, Position, ShowId, ShowSummary, WatchStatus } from '../types';
import { comparePosition, type ImportRow } from './rows';

export type ConflictPolicy = 'sheet-wins' | 'keep-mine' | 'smart';

export interface ImportPatch {
  status?: WatchStatus;
  rating?: number;
  notes?: string;
  favorite?: boolean;
  position?: Position;
  startedAt?: string;
  completedAt?: string;
}

export interface ImportAction {
  /**
   * add    – not in the library yet: create an entry from `patch` (status always set).
   *          If the show is currently blocked, `reason` says so and the store should unblock it.
   * update – apply `patch` (only the changed fields) to the existing entry.
   * block  – add to the blocked list (and remove from the library if present).
   * skip   – nothing to do; `reason` explains why.
   */
  kind: 'add' | 'update' | 'block' | 'skip';
  show: ShowSummary;
  row: ImportRow;
  patch: ImportPatch;
  reason?: string;
}

/**
 * How far along each status is for the "never regress" rule in 'smart' mode:
 * plan → (watching | on_hold | dropped) → completed. Moving between the
 * middle states is allowed (they're lateral), moving down is not.
 */
const PROGRESS_RANK: Record<WatchStatus, number> = { plan: 0, watching: 1, on_hold: 1, dropped: 1, completed: 2 };

/** The furthest point known for an entry (explicit position or the watched map). */
export function entryPosition(entry: Pick<LibraryEntry, 'position' | 'watched'>): Position | undefined {
  let best: Position | undefined = entry.position;
  for (const [season, eps] of Object.entries(entry.watched ?? {})) {
    const s = Number(season);
    if (!eps?.length || !(s > 0)) continue;
    const p = { season: s, episode: Math.max(...eps) };
    if (!best || comparePosition(p, best) > 0) best = p;
  }
  return best;
}

const samePos = (a?: Position, b?: Position) => (!a && !b) || (!!a && !!b && comparePosition(a, b) === 0);

function rowPatch(row: ImportRow): ImportPatch {
  const p: ImportPatch = {};
  if (row.status) p.status = row.status;
  if (row.rating !== undefined) p.rating = row.rating;
  if (row.notes) p.notes = row.notes;
  if (row.favorite) p.favorite = true;
  if (row.position) p.position = row.position;
  if (row.startedAt) p.startedAt = row.startedAt;
  if (row.finishedAt) p.completedAt = row.finishedAt;
  return p;
}

function updatePatch(entry: LibraryEntry, row: ImportRow, policy: ConflictPolicy): ImportPatch {
  const sheet = rowPatch(row);
  const patch: ImportPatch = {};
  const sheetWins = policy === 'sheet-wins';
  const smart = policy === 'smart';

  // Status
  if (sheet.status && sheet.status !== entry.status) {
    if (sheetWins) patch.status = sheet.status;
    else if (smart && !row.statusInferred && PROGRESS_RANK[sheet.status] >= PROGRESS_RANK[entry.status]) patch.status = sheet.status;
    else if (smart && row.statusInferred && PROGRESS_RANK[sheet.status] > PROGRESS_RANK[entry.status]) patch.status = sheet.status;
  }

  // Rating: only fills a gap unless the sheet wins.
  if (sheet.rating !== undefined && sheet.rating !== entry.rating) {
    if (entry.rating === undefined || sheetWins) patch.rating = sheet.rating;
  }

  // Notes
  if (sheet.notes && sheet.notes !== entry.notes) {
    const mine = entry.notes?.trim();
    if (!mine) patch.notes = sheet.notes;
    else if (sheetWins) patch.notes = sheet.notes;
    else if (smart && !mine.includes(sheet.notes.trim())) patch.notes = `${mine}\n\n${sheet.notes}`;
  }

  // Favorite: smart/keep-mine only ever add the flag.
  if (sheet.favorite && !entry.favorite) patch.favorite = true;

  // Position: never backwards unless the sheet wins.
  if (sheet.position) {
    const mine = entryPosition(entry);
    if (!mine) patch.position = sheet.position;
    else if (sheetWins ? !samePos(mine, sheet.position) : smart && comparePosition(sheet.position, mine) > 0) {
      patch.position = sheet.position;
    }
  }

  // Dates: fill gaps; the sheet overrides only when it wins.
  if (sheet.startedAt && sheet.startedAt !== entry.startedAt && (!entry.startedAt || sheetWins)) patch.startedAt = sheet.startedAt;
  if (sheet.completedAt && sheet.completedAt !== entry.completedAt && (!entry.completedAt || sheetWins)) {
    patch.completedAt = sheet.completedAt;
  }
  return patch;
}

/**
 * Plan an import. `matches` are rows already resolved to shows.
 *
 * Policies for shows already in the library:
 *  - 'smart' (default): never regress status (plan → watching/on_hold/dropped → completed;
 *    completed stays completed), rating only fills a gap, position only moves forward,
 *    differing notes are appended, favorite/dates only fill gaps.
 *  - 'sheet-wins': every value present in the sheet overrides the library.
 *  - 'keep-mine': only fills fields that are empty in the library (status never changes).
 * Blocked rows → 'block', unless the show is in the library as watching/completed
 * (→ 'skip'). Rows that change nothing → 'skip' with reason 'unchanged'.
 * A second row resolving to the same show → 'skip' ('duplicate').
 */
export function planImport(
  matches: { row: ImportRow; show: ShowSummary }[],
  existing: Record<ShowId, LibraryEntry>,
  blocked: Record<ShowId, BlockedEntry>,
  policy: ConflictPolicy = 'smart',
): ImportAction[] {
  const actions: ImportAction[] = [];
  const seen = new Map<ShowId, number>();

  for (const { row, show } of matches) {
    const firstRow = seen.get(show.id);
    if (firstRow !== undefined) {
      actions.push({ kind: 'skip', show, row, patch: {}, reason: `duplicate of row ${firstRow + 1}` });
      continue;
    }
    seen.set(show.id, row.rowIndex);
    const entry = existing[show.id];
    const isBlocked = !!blocked[show.id];

    if (row.blocked) {
      if (entry && (entry.status === 'completed' || entry.status === 'watching')) {
        actions.push({ kind: 'skip', show, row, patch: {}, reason: `in your library as ${entry.status}; not blocking` });
      } else if (isBlocked) {
        actions.push({ kind: 'skip', show, row, patch: {}, reason: 'already blocked' });
      } else {
        actions.push({ kind: 'block', show, row, patch: {}, reason: entry ? 'removes it from your library' : undefined });
      }
      continue;
    }

    if (!entry) {
      if (isBlocked && policy === 'keep-mine') {
        actions.push({ kind: 'skip', show, row, patch: {}, reason: 'blocked in the app' });
        continue;
      }
      const patch = rowPatch(row);
      patch.status ??= 'plan';
      actions.push({ kind: 'add', show, row, patch, reason: isBlocked ? 'currently blocked; adding unblocks it' : undefined });
      continue;
    }

    const patch = updatePatch(entry, row, policy);
    if (Object.keys(patch).length === 0) actions.push({ kind: 'skip', show, row, patch, reason: 'unchanged' });
    else actions.push({ kind: 'update', show, row, patch });
  }
  return actions;
}

/**
 * Episodes watched up to `position`: every earlier season in full plus
 * episodes 1..position.episode of the current season.
 * `seasonSizes[i]` is the episode count of season i+1. Seasons with an unknown
 * size are skipped (earlier) or filled up to the position (current).
 */
export function positionToWatched(position: Position, seasonSizes: number[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const range = (n: number) => Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => i + 1);
  for (let s = 1; s < position.season; s++) {
    const size = seasonSizes[s - 1];
    if (size > 0) out[String(s)] = range(size);
  }
  const size = seasonSizes[position.season - 1];
  const count = size > 0 ? Math.min(position.episode, size) : position.episode;
  if (position.season > 0 && count > 0) out[String(position.season)] = range(count);
  return out;
}

/** Every episode of every season watched. */
export function allWatched(seasonSizes: number[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  seasonSizes.forEach((size, i) => {
    if (size > 0) out[String(i + 1)] = Array.from({ length: size }, (_, k) => k + 1);
  });
  return out;
}
