import { describe, expect, it } from 'vitest';
import type { BlockedEntry, LibraryEntry, ShowSummary } from '../types';
import { allWatched, entryPosition, planImport, positionToWatched } from './plan';
import type { ImportRow } from './rows';

const show = (id: string, title = id): ShowSummary => ({ id, source: 'tmdb', title, genres: [] });
const row = (extra: Partial<ImportRow> = {}): ImportRow => ({ rowIndex: 0, title: 'X', raw: {}, ...extra });
const entry = (s: ShowSummary, extra: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: s.id,
  show: s,
  status: 'plan',
  watched: {},
  addedAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...extra,
});
const blockedEntry = (s: ShowSummary): BlockedEntry => ({ id: s.id, show: s, at: '2024-01-01', reason: 'not_interested' });

const A = show('tmdb:1', 'Dark');
const B = show('tmdb:2', 'Lost');

describe('planImport — new shows', () => {
  it('adds new shows with every known field', () => {
    const r = row({
      status: 'completed',
      rating: 9,
      notes: 'great',
      favorite: true,
      position: { season: 3, episode: 8 },
      startedAt: '2020-01-01',
      finishedAt: '2020-02-01',
    });
    const [a] = planImport([{ row: r, show: A }], {}, {});
    expect(a).toMatchObject({
      kind: 'add',
      show: A,
      patch: {
        status: 'completed',
        rating: 9,
        notes: 'great',
        favorite: true,
        position: { season: 3, episode: 8 },
        startedAt: '2020-01-01',
        completedAt: '2020-02-01',
      },
    });
  });

  it("defaults the status of an add to 'plan'", () => {
    expect(planImport([{ row: row(), show: A }], {}, {})[0].patch.status).toBe('plan');
  });

  it('adding a currently-blocked show notes the unblock, except with keep-mine', () => {
    const blocked = { [A.id]: blockedEntry(A) };
    const [a] = planImport([{ row: row({ status: 'completed' }), show: A }], {}, blocked);
    expect(a.kind).toBe('add');
    expect(a.reason).toMatch(/unblock/);
    expect(planImport([{ row: row({ status: 'completed' }), show: A }], {}, blocked, 'keep-mine')[0].kind).toBe('skip');
  });

  it('skips a second row resolving to the same show', () => {
    const acts = planImport(
      [
        { row: row({ rowIndex: 0 }), show: A },
        { row: row({ rowIndex: 4 }), show: A },
      ],
      {},
      {},
    );
    expect(acts.map((a) => a.kind)).toEqual(['add', 'skip']);
    expect(acts[1].reason).toBe('duplicate of row 1');
  });
});

describe('planImport — blocked rows', () => {
  it('blocks new shows', () => {
    expect(planImport([{ row: row({ blocked: true }), show: A }], {}, {})[0].kind).toBe('block');
  });
  it('does not block shows I am watching or completed', () => {
    for (const status of ['watching', 'completed'] as const) {
      const [a] = planImport([{ row: row({ blocked: true }), show: A }], { [A.id]: entry(A, { status }) }, {});
      expect(a.kind).toBe('skip');
      expect(a.reason).toContain(status);
    }
  });
  it('blocks plan/dropped library entries (removal noted) and skips already blocked', () => {
    const [a] = planImport([{ row: row({ blocked: true }), show: A }], { [A.id]: entry(A, { status: 'dropped' }) }, {});
    expect(a.kind).toBe('block');
    expect(a.reason).toMatch(/removes/);
    const [b] = planImport([{ row: row({ blocked: true }), show: B }], {}, { [B.id]: blockedEntry(B) });
    expect(b).toMatchObject({ kind: 'skip', reason: 'already blocked' });
  });
});

describe('planImport — existing shows', () => {
  const lib = (extra: Partial<LibraryEntry>) => ({ [A.id]: entry(A, extra) });
  const plan1 = (r: Partial<ImportRow>, e: Partial<LibraryEntry>, policy?: Parameters<typeof planImport>[3]) =>
    planImport([{ row: row(r), show: A }], lib(e), {}, policy)[0];

  it("identical data → skip 'unchanged'", () => {
    const a = plan1({ status: 'completed', rating: 8, notes: 'n' }, { status: 'completed', rating: 8, notes: 'n' });
    expect(a).toMatchObject({ kind: 'skip', reason: 'unchanged', patch: {} });
  });

  describe('smart', () => {
    it('never regresses a completed show', () => {
      expect(plan1({ status: 'watching' }, { status: 'completed' }).kind).toBe('skip');
      expect(plan1({ status: 'plan' }, { status: 'completed' }).kind).toBe('skip');
      expect(plan1({ status: 'dropped' }, { status: 'completed' }).kind).toBe('skip');
    });
    it('moves forward and laterally', () => {
      expect(plan1({ status: 'completed' }, { status: 'watching' }).patch.status).toBe('completed');
      expect(plan1({ status: 'watching' }, { status: 'plan' }).patch.status).toBe('watching');
      expect(plan1({ status: 'on_hold' }, { status: 'watching' }).patch.status).toBe('on_hold');
      expect(plan1({ status: 'plan' }, { status: 'watching' }).kind).toBe('skip');
    });
    it('inferred statuses only move strictly forward', () => {
      expect(plan1({ status: 'on_hold', statusInferred: true }, { status: 'watching' }).kind).toBe('skip');
      expect(plan1({ status: 'completed', statusInferred: true }, { status: 'watching' }).patch.status).toBe('completed');
    });
    it('takes the sheet rating only when mine is unset', () => {
      expect(plan1({ rating: 7 }, { status: 'plan' }).patch.rating).toBe(7);
      expect(plan1({ rating: 7 }, { status: 'plan', rating: 9 }).kind).toBe('skip');
    });
    it('never moves position backwards (also considering watched episodes)', () => {
      expect(plan1({ position: { season: 2, episode: 5 } }, { position: { season: 2, episode: 3 } }).patch.position).toEqual({ season: 2, episode: 5 });
      expect(plan1({ position: { season: 2, episode: 1 } }, { position: { season: 2, episode: 3 } }).kind).toBe('skip');
      expect(plan1({ position: { season: 1, episode: 5 } }, { watched: { '1': [1, 2, 3, 4, 5, 6] } }).kind).toBe('skip');
      expect(plan1({ position: { season: 1, episode: 5 } }, {}).patch.position).toEqual({ season: 1, episode: 5 });
    });
    it('merges differing notes', () => {
      expect(plan1({ notes: 'from sheet' }, { notes: 'mine' }).patch.notes).toBe('mine\n\nfrom sheet');
      expect(plan1({ notes: 'from sheet' }, { notes: 'mine\n\nfrom sheet' }).kind).toBe('skip');
      expect(plan1({ notes: 'from sheet' }, {}).patch.notes).toBe('from sheet');
    });
    it('only adds favorite and fills empty dates', () => {
      expect(plan1({ favorite: true }, {}).patch.favorite).toBe(true);
      expect(plan1({ favorite: undefined }, { favorite: true }).kind).toBe('skip');
      expect(plan1({ startedAt: '2020-01-01', finishedAt: '2020-02-02' }, {}).patch).toEqual({
        startedAt: '2020-01-01',
        completedAt: '2020-02-02',
      });
      expect(plan1({ startedAt: '2020-01-01' }, { startedAt: '2019-01-01' }).kind).toBe('skip');
    });
  });

  describe('sheet-wins', () => {
    it('overrides everything the sheet has', () => {
      const a = plan1(
        { status: 'watching', rating: 6, notes: 'sheet', position: { season: 1, episode: 2 }, startedAt: '2021-01-01' },
        { status: 'completed', rating: 9, notes: 'mine', position: { season: 3, episode: 1 }, startedAt: '2020-01-01' },
        'sheet-wins',
      );
      expect(a).toMatchObject({
        kind: 'update',
        patch: { status: 'watching', rating: 6, notes: 'sheet', position: { season: 1, episode: 2 }, startedAt: '2021-01-01' },
      });
    });
  });

  describe('keep-mine', () => {
    it('only fills gaps and never changes status', () => {
      const a = plan1(
        { status: 'completed', rating: 6, notes: 'sheet', position: { season: 1, episode: 2 } },
        { status: 'watching', notes: 'mine' },
        'keep-mine',
      );
      expect(a).toMatchObject({ kind: 'update', patch: { rating: 6, position: { season: 1, episode: 2 } } });
      expect(a.patch.status).toBeUndefined();
      expect(a.patch.notes).toBeUndefined();
    });
  });
});

describe('entryPosition', () => {
  it('uses the furthest of position and watched', () => {
    expect(entryPosition({ watched: { '1': [1, 2], '2': [1, 4, 3] } })).toEqual({ season: 2, episode: 4 });
    expect(entryPosition({ watched: { '0': [1], '1': [] } })).toBeUndefined();
    expect(entryPosition({ position: { season: 3, episode: 1 }, watched: { '2': [9] } })).toEqual({ season: 3, episode: 1 });
  });
});

describe('positionToWatched / allWatched', () => {
  it('fills earlier seasons and the current one up to the episode', () => {
    expect(positionToWatched({ season: 3, episode: 2 }, [3, 2, 10])).toEqual({ '1': [1, 2, 3], '2': [1, 2], '3': [1, 2] });
  });
  it('omits the current season at episode 0 and clamps to the season size', () => {
    expect(positionToWatched({ season: 2, episode: 0 }, [2, 5])).toEqual({ '1': [1, 2] });
    expect(positionToWatched({ season: 1, episode: 9 }, [4])).toEqual({ '1': [1, 2, 3, 4] });
  });
  it('handles unknown season sizes', () => {
    expect(positionToWatched({ season: 2, episode: 3 }, [])).toEqual({ '2': [1, 2, 3] });
  });
  it('allWatched marks everything', () => {
    expect(allWatched([2, 0, 1])).toEqual({ '1': [1, 2], '3': [1] });
    expect(allWatched([])).toEqual({});
  });
});
