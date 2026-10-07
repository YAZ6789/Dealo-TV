import { describe, expect, it, vi } from 'vitest';
import type { ImportSource, LibraryEntry, ShowSummary } from '../types';
import type { Table } from './table';
import { diffRow, planSync, rowKey, rowStateOf } from './sync';
import type { ImportRow } from './rows';

const show = (id: string, title: string, year?: number): ShowSummary => ({ id, source: 'catalog', title, year, genres: ['drama'] });
const BB = show('cat:bb', 'Breaking Bad', 2008);
const SEV = show('cat:sev', 'Severance', 2022);
const DARK = show('cat:dark', 'Dark', 2017);

const table = (rows: string[][]): Table => ({ headers: ['Show', 'Status', 'Progress', 'Rating', 'Notes'], rows });
const MAPPING = { title: 'Show', status: 'Status', progress: 'Progress', rating: 'Rating', notes: 'Notes' } as const;

const entry = (s: ShowSummary, o: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: s.id,
  show: s,
  status: 'watching',
  watched: {},
  addedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...o,
});

const search = vi.fn(async (q: string) => [BB, SEV, DARK].filter((s) => s.title.toLowerCase() === q.toLowerCase()));

/** A source that only knows which show each title is linked to. */
function linkedSource(links: Record<string, string>): ImportSource {
  const src: ImportSource = { id: 's1', kind: 'gsheet', label: 'Sheet', url: 'x', mapping: { ...MAPPING }, rowState: {}, links: {} };
  for (const [title, id] of Object.entries(links)) src.links![rowKey({ title })] = id;
  return src;
}

describe('diffRow', () => {
  const base: ImportRow = { rowIndex: 0, title: 'Dark', status: 'watching', rating: 8, position: { season: 1, episode: 4 }, raw: {} };
  it('returns null for unchanged rows and only changed fields otherwise', () => {
    expect(diffRow(rowStateOf(base), base)).toBeNull();
    const edited = { ...base, rating: 9 };
    const d = diffRow(rowStateOf(base), edited)!;
    expect(d.rating).toBe(9);
    expect(d.status).toBeUndefined();
    expect(d.position).toBeUndefined();
  });
  it('returns new rows whole', () => {
    expect(diffRow(undefined, base)).toBe(base);
  });
});

describe('planSync', () => {
  const sheet1 = [
    ['Breaking Bad', 'watching', 'S2E3', '8', ''],
    ['Severance', 'want to watch', '', '', ''],
  ];

  async function firstSync() {
    // A first sync over an empty snapshot behaves like an import.
    const src: ImportSource = { id: 's1', kind: 'gsheet', label: 'Sheet', url: 'x', mapping: { ...MAPPING } };
    return planSync(table(sheet1), src, { entries: {}, blocked: {}, search });
  }

  it('adds everything on the first sync and records state + links', async () => {
    const plan = await firstSync();
    expect(plan.actions.map((a) => [a.kind, a.show.id, a.patch.status])).toEqual([
      ['add', 'cat:bb', 'watching'],
      ['add', 'cat:sev', 'plan'],
    ]);
    expect(Object.values(plan.links).sort()).toEqual(['cat:bb', 'cat:sev']);
    expect(Object.keys(plan.rowState)).toHaveLength(2);
  });

  it('ignores unchanged rows, so edits made in the app survive', async () => {
    const first = await firstSync();
    const src: ImportSource = { id: 's1', kind: 'gsheet', label: 'Sheet', url: 'x', mapping: { ...MAPPING }, rowState: first.rowState, links: first.links };
    // In the app the user rated Breaking Bad 10 — the sheet still says 8.
    const entries = { 'cat:bb': entry(BB, { rating: 10, position: { season: 2, episode: 3 } }), 'cat:sev': entry(SEV, { status: 'plan' }) };
    search.mockClear();
    const plan = await planSync(table(sheet1), src, { entries, blocked: {}, search });
    expect(plan.changedRows).toBe(0);
    expect(plan.actions).toHaveLength(0);
    expect(search).not.toHaveBeenCalled();
  });

  it('applies only fields edited in the sheet, and adds new rows', async () => {
    const first = await firstSync();
    const src: ImportSource = { id: 's1', kind: 'gsheet', label: 'Sheet', url: 'x', mapping: { ...MAPPING }, rowState: first.rowState, links: first.links };
    const entries = { 'cat:bb': entry(BB, { rating: 10, position: { season: 2, episode: 3 } }), 'cat:sev': entry(SEV, { status: 'plan' }) };
    const sheet2 = [
      ['Breaking Bad', 'watching', 'S2E7', '8', 'so good'], // progress + notes edited, rating untouched
      ['Severance', 'watching', 'S1E2', '', ''], // started watching
      ['Dark', 'finished', '', '9', ''], // new row
    ];
    const plan = await planSync(table(sheet2), src, { entries, blocked: {}, search });
    const byId = Object.fromEntries(plan.actions.map((a) => [a.show.id, a]));
    expect(byId['cat:bb'].kind).toBe('update');
    expect(byId['cat:bb'].patch.position).toEqual({ season: 2, episode: 7 });
    expect(byId['cat:bb'].patch.notes).toContain('so good');
    expect(byId['cat:bb'].patch.rating).toBeUndefined(); // app rating 10 kept
    expect(byId['cat:sev'].patch.status).toBe('watching');
    expect(byId['cat:dark']).toMatchObject({ kind: 'add', patch: { status: 'completed', rating: 9 } });
  });

  it('never moves progress backwards from a sheet edit', async () => {
    const first = await firstSync();
    const src: ImportSource = { id: 's1', kind: 'gsheet', label: 'Sheet', url: 'x', mapping: { ...MAPPING }, rowState: first.rowState, links: first.links };
    const entries = { 'cat:bb': entry(BB, { watched: { 1: [1, 2, 3, 4, 5, 6, 7], 2: [1, 2, 3, 4, 5, 6, 7, 8, 9] } }), 'cat:sev': entry(SEV) };
    const sheet2 = [['Breaking Bad', 'watching', 'S2E5', '8', ''], sheet1[1]];
    const plan = await planSync(table(sheet2), src, { entries, blocked: {}, search });
    const bb = plan.actions.find((a) => a.show.id === 'cat:bb');
    expect(bb?.patch.position).toBeUndefined();
  });

  it('holds back rows it cannot match confidently', async () => {
    const first = await firstSync();
    const src: ImportSource = { id: 's1', kind: 'gsheet', label: 'Sheet', url: 'x', mapping: { ...MAPPING }, rowState: first.rowState, links: first.links };
    const plan = await planSync(table([...sheet1, ['Some Unknown Show', 'watching', '', '', '']]), src, { entries: {}, blocked: {}, search });
    expect(plan.pending.map((r) => r.title)).toEqual(['Some Unknown Show']);
    expect(Object.keys(plan.rowState)).toHaveLength(2); // retried next time
  });

  it('uses saved links instead of searching again', async () => {
    const src = linkedSource({ 'Breaking Bad': 'cat:bb' });
    search.mockClear();
    const plan = await planSync(table([['Breaking Bad', 'finished', '', '10', '']]), src, { entries: { 'cat:bb': entry(BB) }, blocked: {}, search });
    expect(search).not.toHaveBeenCalled();
    // no prior snapshot → merged with the same "smart" rules as an import
    expect(plan.actions[0]).toMatchObject({ kind: 'update', show: { id: 'cat:bb' }, patch: { status: 'completed', rating: 10 } });
  });
});
