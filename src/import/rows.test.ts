import { describe, expect, it } from 'vitest';
import { detectColumns } from './mapping';
import { cleanTitle, comparePosition, dedupeRows, tableToRows, type ImportRow } from './rows';
import { parseCsv, type Table } from './table';

const pipeline = (csv: string, opts?: Parameters<typeof tableToRows>[2]) => {
  const table = parseCsv(csv);
  const { mapping } = detectColumns(table);
  return { table, mapping, ...tableToRows(table, mapping, opts) };
};

const strip = (r: ImportRow) => {
  const { raw: _raw, ...rest } = r;
  return rest;
};

describe('cleanTitle', () => {
  it.each([
    ['Breaking Bad', { title: 'Breaking Bad' }],
    ['  Dark (2017) ', { title: 'Dark', year: 2017 }],
    ['Doctor Who [2005]', { title: 'Doctor Who', year: 2005 }],
    ['Stranger Things S3', { title: 'Stranger Things', position: { season: 3, episode: 0 } }],
    ['Stranger Things - Season 3', { title: 'Stranger Things', position: { season: 3, episode: 0 } }],
    ['Stranger Things (Season 3)', { title: 'Stranger Things', position: { season: 3, episode: 0 } }],
    ['Stranger Things season 4', { title: 'Stranger Things', position: { season: 4, episode: 0 } }],
    ['Lost S2E5', { title: 'Lost', position: { season: 2, episode: 5 } }],
    ['Fargo (2014) - Season 5', { title: 'Fargo', year: 2014, position: { season: 5, episode: 0 } }],
    ['Severance ✓', { title: 'Severance' }],
    ['The Bear ⭐⭐⭐', { title: 'The Bear' }],
    ['Andor **', { title: 'Andor' }],
    ['Shōgun 🔥🔥', { title: 'Shōgun' }],
    ['✅ Succession', { title: 'Succession' }],
    ['1. Breaking Bad', { title: 'Breaking Bad' }],
    ['24', { title: '24' }],
    ['1923', { title: '1923' }],
    ['9-1-1', { title: '9-1-1' }],
    ['The Office (US)', { title: 'The Office (US)' }],
    ['Seasons', { title: 'Seasons' }],
    ['S', { title: 'S' }],
  ])('%j', (input, out) => {
    const r = cleanTitle(input);
    expect(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))).toEqual(out);
  });
});

describe('tableToRows — realistic layouts', () => {
  it('(a) Show | Status | Season | Episode | Rating | Notes', () => {
    const { rows, skipped } = pipeline(
      [
        'Show,Status,Season,Episode,Rating,Notes',
        'Breaking Bad,Watched,5,16,10,Masterpiece',
        'Severance,Watching,2,3,9,',
        'The Bear,Plan to watch,,,,Everyone says it is great',
        'Lost,Dropped,3,,6,lost me',
        'Emily in Paris,Not interested,,,,',
        ',,,,,orphan note',
        'Show,Status,Season,Episode,Rating,Notes',
      ].join('\n'),
    );
    expect(rows.map(strip)).toEqual([
      { rowIndex: 0, title: 'Breaking Bad', status: 'completed', position: { season: 5, episode: 16 }, rating: 10, notes: 'Masterpiece' },
      { rowIndex: 1, title: 'Severance', status: 'watching', position: { season: 2, episode: 3 }, rating: 9 },
      { rowIndex: 2, title: 'The Bear', status: 'plan', notes: 'Everyone says it is great' },
      { rowIndex: 3, title: 'Lost', status: 'dropped', position: { season: 3, episode: 0 }, rating: 6, notes: 'lost me' },
      { rowIndex: 4, title: 'Emily in Paris', blocked: true },
    ]);
    expect(skipped).toEqual([
      { rowIndex: 5, reason: 'missing title' },
      { rowIndex: 6, reason: 'repeated header' },
    ]);
    expect(rows[0].raw).toEqual({
      Show: 'Breaking Bad',
      Status: 'Watched',
      Season: '5',
      Episode: '16',
      Rating: '10',
      Notes: 'Masterpiece',
    });
  });

  it('(b) Title | Watched? (TRUE/FALSE) | My Score (out of 5) | Date finished', () => {
    const { rows } = pipeline(
      [
        'Title,Watched? (TRUE/FALSE),My Score (out of 5),Date finished',
        'Fleabag,TRUE,5,3/2/2020',
        'Succession,TRUE,4.5,5/30/2023',
        'Andor,FALSE,,',
        'Dark,,3,',
      ].join('\n'),
    );
    expect(rows.map(strip)).toEqual([
      { rowIndex: 0, title: 'Fleabag', status: 'completed', rating: 10, finishedAt: '2020-03-02' },
      { rowIndex: 1, title: 'Succession', status: 'completed', rating: 9, finishedAt: '2023-05-30' },
      { rowIndex: 2, title: 'Andor', status: 'plan', statusInferred: true },
      { rowIndex: 3, title: 'Dark', status: 'completed', statusInferred: true, rating: 6 },
    ]);
  });

  it('(c) headerless titles with emoji statuses in column B', () => {
    const { rows, table } = pipeline(['Breaking Bad,✅', 'Severance,🔴', 'The Bear,⏳', 'Emily in Paris,❌', 'Dark,'].join('\n'));
    expect(table.headers).toEqual(['Column A', 'Column B']);
    expect(rows.map((r) => [r.title, r.status ?? (r.blocked ? 'blocked' : '?')])).toEqual([
      ['Breaking Bad', 'completed'],
      ['Severance', 'watching'],
      ['The Bear', 'plan'],
      ['Emily in Paris', 'blocked'],
      ['Dark', 'plan'],
    ]);
    expect(rows[4].statusInferred).toBe(true);
  });

  it('(d) Name | Progress | Platform', () => {
    const { rows } = pipeline(['Name,Progress,Platform', 'Shogun,S1E5,Hulu', 'The Boys,s04e02,Prime Video', 'Slow Horses,Season 3,Apple TV+'].join('\n'));
    expect(rows.map(strip)).toEqual([
      { rowIndex: 0, title: 'Shogun', status: 'watching', statusInferred: true, position: { season: 1, episode: 5 }, platform: 'Hulu' },
      { rowIndex: 1, title: 'The Boys', status: 'watching', statusInferred: true, position: { season: 4, episode: 2 }, platform: 'Prime Video' },
      { rowIndex: 2, title: 'Slow Horses', status: 'watching', statusInferred: true, position: { season: 3, episode: 0 }, platform: 'Apple TV+' },
    ]);
  });

  it('defaultStatus applies only when nothing else says otherwise', () => {
    const { rows } = pipeline(['Show,Finished', 'Dark,', 'Lost,2010-05-23', 'Fargo S2,'].join('\n'), { defaultStatus: 'completed' });
    expect(rows.map((r) => [r.title, r.status])).toEqual([
      ['Dark', 'completed'],
      ['Lost', 'completed'],
      ['Fargo', 'watching'],
    ]);
    const plain = pipeline('Show\nDark\nLost\n', { defaultStatus: 'on_hold' });
    expect(plain.rows.map((r) => r.status)).toEqual(['on_hold', 'on_hold']);
  });

  it('progress column wins over season/episode columns', () => {
    const table: Table = {
      headers: ['Show', 'Progress', 'Season', 'Episode'],
      rows: [
        ['Dark', 'S3E2', '1', '1'],
        ['Lost', '', '2', '4'],
        ['Fargo', '', '', 'Ep 3'],
      ],
    };
    const { rows } = tableToRows(table, { title: 0, progress: 1, season: 2, episode: 3 });
    expect(rows.map((r) => r.position)).toEqual([
      { season: 3, episode: 2 },
      { season: 2, episode: 4 },
      { season: 1, episode: 3 },
    ]);
  });

  it('parses year, genres, favorite, dates and ids', () => {
    const table: Table = {
      headers: ['Title', 'Year', 'Genre', 'Fav', 'Started', 'TMDB', 'IMDb'],
      rows: [['Dark', '2017–2020', 'Sci-fi / Mystery', '❤', 'Jan 5, 2020', 'https://www.themoviedb.org/tv/70523-dark', 'https://www.imdb.com/title/tt5753856/']],
    };
    const { rows } = tableToRows(table, { title: 0, year: 1, genre: 2, favorite: 3, startedAt: 4, tmdbId: 5, imdbId: 6 });
    expect(strip(rows[0])).toEqual({
      rowIndex: 0,
      title: 'Dark',
      year: 2017,
      genres: ['scifi', 'mystery'],
      favorite: true,
      startedAt: '2020-01-05',
      status: 'watching',
      statusInferred: true,
      tmdbId: 70523,
      imdbId: 'tt5753856',
    });
  });

  it('respects an explicit rating scale', () => {
    const table: Table = { headers: ['Show', 'Rating'], rows: [['Dark', '4'], ['Lost', '3']] };
    expect(tableToRows(table, { title: 0, rating: 1 }).rows.map((r) => r.rating)).toEqual([8, 6]);
    expect(tableToRows(table, { title: 0, rating: 1 }, { ratingScale: 10 }).rows.map((r) => r.rating)).toEqual([4, 3]);
  });

  it('without a title mapping every row is skipped', () => {
    const table: Table = { headers: ['A'], rows: [['x']] };
    expect(tableToRows(table, {})).toEqual({ rows: [], skipped: [{ rowIndex: 0, reason: 'no title column' }] });
  });

  it('can disable dedupe', () => {
    const table: Table = { headers: ['Show'], rows: [['Dark'], ['dark']] };
    expect(tableToRows(table, { title: 0 }, { dedupe: false }).rows).toHaveLength(2);
    expect(tableToRows(table, { title: 0 }).rows).toHaveLength(1);
  });
});

describe('dedupeRows', () => {
  const row = (r: Partial<ImportRow> & { rowIndex: number; title: string }): ImportRow => ({ raw: {}, ...r });

  it('merges same-title rows keeping the most advanced status, max position, latest rating, all notes', () => {
    const out = dedupeRows([
      row({ rowIndex: 0, title: 'Stranger Things', status: 'watching', position: { season: 3, episode: 0 }, rating: 7, notes: 'S3 was fun' }),
      row({ rowIndex: 1, title: 'stranger things', status: 'completed', position: { season: 2, episode: 9 }, rating: 8, notes: 'finale!' }),
      row({ rowIndex: 2, title: 'Stranger Things', status: 'plan', statusInferred: true, notes: 'finale!' }),
    ]);
    expect(out).toHaveLength(1);
    expect(strip(out[0])).toEqual({
      rowIndex: 0,
      title: 'Stranger Things',
      status: 'completed',
      position: { season: 3, episode: 0 },
      rating: 8,
      notes: 'S3 was fun\nfinale!',
      mergedRowIndexes: [0, 1, 2],
    });
  });

  it('keeps rows with different years apart but merges a missing year', () => {
    const out = dedupeRows([
      row({ rowIndex: 0, title: 'Doctor Who', year: 1963 }),
      row({ rowIndex: 1, title: 'Doctor Who', year: 2005 }),
      row({ rowIndex: 2, title: 'Doctor Who', status: 'watching' }),
    ]);
    expect(out.map((r) => [r.year, r.mergedRowIndexes])).toEqual([
      [1963, [0, 2]],
      [2005, undefined],
    ]);
  });

  it('explicit statuses beat inferred ones, and blocked yields to explicit statuses', () => {
    const a = dedupeRows([
      row({ rowIndex: 0, title: 'Dark', status: 'completed', statusInferred: true }),
      row({ rowIndex: 1, title: 'Dark', status: 'dropped' }),
    ]);
    expect(a[0].status).toBe('dropped');
    expect(a[0].statusInferred).toBeUndefined();

    const b = dedupeRows([row({ rowIndex: 0, title: 'Dark', blocked: true }), row({ rowIndex: 1, title: 'Dark', status: 'watching' })]);
    expect(b[0].blocked).toBeUndefined();
    expect(b[0].status).toBe('watching');

    const c = dedupeRows([row({ rowIndex: 0, title: 'Dark', status: 'plan', statusInferred: true }), row({ rowIndex: 1, title: 'Dark', blocked: true })]);
    expect(c[0].blocked).toBe(true);
    expect(c[0].status).toBeUndefined();
  });

  it('unions genres and keeps earliest start / latest finish', () => {
    const out = dedupeRows([
      row({ rowIndex: 0, title: 'Dark', genres: ['scifi'], startedAt: '2020-02-01', finishedAt: '2020-03-01', favorite: false }),
      row({ rowIndex: 1, title: 'Dark', genres: ['mystery', 'scifi'], startedAt: '2020-01-01', finishedAt: '2021-01-01', favorite: true }),
    ]);
    expect(out[0].genres).toEqual(['scifi', 'mystery']);
    expect(out[0].startedAt).toBe('2020-01-01');
    expect(out[0].finishedAt).toBe('2021-01-01');
    expect(out[0].favorite).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = [row({ rowIndex: 0, title: 'Dark', notes: 'a' }), row({ rowIndex: 1, title: 'Dark', notes: 'b' })];
    dedupeRows(input);
    expect(input[0].notes).toBe('a');
  });
});

describe('comparePosition', () => {
  it('orders by season then episode', () => {
    expect(comparePosition({ season: 2, episode: 1 }, { season: 1, episode: 9 })).toBeGreaterThan(0);
    expect(comparePosition({ season: 1, episode: 2 }, { season: 1, episode: 9 })).toBeLessThan(0);
    expect(comparePosition({ season: 1, episode: 2 }, { season: 1, episode: 2 })).toBe(0);
  });
});
