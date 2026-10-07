import { describe, expect, it, vi } from 'vitest';
import { fetchSheet, gvizUrl, parseGvizResponse, parseSheetUrl, publishedCsvUrl, SheetAccessError } from './sheets';

const USER_URL = 'https://docs.google.com/spreadsheets/d/1F41YLH-q4C2H9jKQAA1bbA103rHXpXKfapawllKjBL0/edit?usp=sharing';
const USER_ID = '1F41YLH-q4C2H9jKQAA1bbA103rHXpXKfapawllKjBL0';
const PUB_ID = '2PACX-1vQx4k3J5sZ_abcDEF-ghiJKLmnoPQRstuVWxyz0123456789abcdefGHIJKLmnopQRSTuvwxYZ';

describe('parseSheetUrl', () => {
  it("parses the user's real sharing URL", () => {
    expect(parseSheetUrl(USER_URL)).toEqual({ kind: 'doc', id: USER_ID });
  });
  it.each([
    [`https://docs.google.com/spreadsheets/d/${USER_ID}/edit#gid=123`, { kind: 'doc', id: USER_ID, gid: '123' }],
    [`https://docs.google.com/spreadsheets/d/${USER_ID}/edit?gid=456#gid=456`, { kind: 'doc', id: USER_ID, gid: '456' }],
    [`https://docs.google.com/spreadsheets/d/${USER_ID}/view`, { kind: 'doc', id: USER_ID }],
    [`https://docs.google.com/spreadsheets/d/${USER_ID}/htmlview`, { kind: 'doc', id: USER_ID }],
    [`https://docs.google.com/spreadsheets/d/${USER_ID}`, { kind: 'doc', id: USER_ID }],
    [`docs.google.com/spreadsheets/d/${USER_ID}/edit`, { kind: 'doc', id: USER_ID }],
    [`https://docs.google.com/spreadsheets/u/1/d/${USER_ID}/edit#gid=0`, { kind: 'doc', id: USER_ID, gid: '0' }],
    [`https://drive.google.com/open?id=${USER_ID}`, { kind: 'doc', id: USER_ID }],
    [`  ${USER_ID}  `, { kind: 'doc', id: USER_ID }],
    [`https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pubhtml`, { kind: 'published', pubId: PUB_ID }],
    [`https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?output=csv&gid=789`, { kind: 'published', pubId: PUB_ID, gid: '789' }],
    [`https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pubhtml?gid=0&single=true`, { kind: 'published', pubId: PUB_ID, gid: '0' }],
    [PUB_ID, { kind: 'published', pubId: PUB_ID }],
  ])('%s', (url, out) => {
    expect(parseSheetUrl(url)).toEqual(out);
  });
  it.each(['', 'hello', 'https://example.com/sheet', 'short_id_123', 'https://docs.google.com/document/d/abc/edit'])(
    'rejects %j',
    (url) => expect(parseSheetUrl(url)).toBeNull(),
  );
});

describe('gvizUrl / publishedCsvUrl', () => {
  it('builds CSV and JSON urls', () => {
    expect(gvizUrl(USER_ID, { out: 'csv' })).toBe(
      `https://docs.google.com/spreadsheets/d/${USER_ID}/gviz/tq?tqx=out:csv&headers=1`,
    );
    expect(gvizUrl(USER_ID, { out: 'json', tab: '123' })).toBe(
      `https://docs.google.com/spreadsheets/d/${USER_ID}/gviz/tq?tqx=out:json&headers=1&gid=123`,
    );
    expect(gvizUrl(USER_ID, { out: 'csv', tab: 'Watched Shows & more' })).toBe(
      `https://docs.google.com/spreadsheets/d/${USER_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=Watched%20Shows%20%26%20more`,
    );
    expect(gvizUrl(USER_ID, { out: 'csv', tab: '  ' })).not.toContain('sheet=');
  });
  it('builds published urls', () => {
    expect(publishedCsvUrl(PUB_ID)).toBe(`https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?output=csv`);
    expect(publishedCsvUrl(PUB_ID, '5')).toBe(`https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?output=csv&gid=5`);
  });
});

const GVIZ_FIXTURE = `/*O_o*/
google.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","sig":"123","table":{"cols":[{"id":"A","label":"Show","type":"string"},{"id":"B","label":"Rating","type":"number","pattern":"General"},{"id":"C","label":"Finished","type":"date","pattern":"M/d/yyyy"},{"id":"D","label":"Seen","type":"boolean"},{"id":"E","label":"Score %","type":"number","pattern":"0%"}],"rows":[{"c":[{"v":"Breaking Bad"},{"v":9.5,"f":"9.5"},{"v":"Date(2024,0,15)","f":"1/15/2024"},{"v":true},{"v":0.85,"f":"85%"}]},{"c":[{"v":"Lost"},{"v":6.0,"f":"6"},null,{"v":false},null]},{"c":[{"v":"Dark"},{"v":null},{"v":"Date(2023,11,31)","f":"12/31/2023"},{"v":null},{"v":1,"f":"100%"}]}],"parsedNumHeaders":1}});`;

describe('parseGvizResponse', () => {
  it('parses the wrapped response with Date(), formatted numbers, booleans and nulls', () => {
    const t = parseGvizResponse(GVIZ_FIXTURE);
    expect(t.headers).toEqual(['Show', 'Rating', 'Finished', 'Seen', 'Score %']);
    expect(t.rows).toEqual([
      ['Breaking Bad', '9.5', '2024-01-15', 'TRUE', '85%'],
      ['Lost', '6', '', 'FALSE', ''],
      ['Dark', '', '2023-12-31', '', '100%'],
    ]);
  });

  it('accepts a raw object (JSONP payload)', () => {
    const t = parseGvizResponse({
      status: 'ok',
      table: { cols: [{ label: 'Title' }, { label: 'Status' }], rows: [{ c: [{ v: 'Dark' }, { v: 'Watched' }] }] },
    });
    expect(t).toEqual({ headers: ['Title', 'Status'], rows: [['Dark', 'Watched']] });
  });

  it('falls back to the first row when all labels are empty', () => {
    const t = parseGvizResponse({
      status: 'ok',
      table: {
        cols: [{ label: '' }, { label: '' }],
        rows: [{ c: [{ v: 'Show' }, { v: 'Status' }] }, { c: [{ v: 'Dark' }, { v: 'Watched' }] }],
      },
    });
    expect(t).toEqual({ headers: ['Show', 'Status'], rows: [['Dark', 'Watched']] });
  });

  it('synthesizes headers when the sheet has none', () => {
    const t = parseGvizResponse({
      status: 'ok',
      table: {
        cols: [{ label: '' }, { label: '' }],
        rows: [{ c: [{ v: 'Breaking Bad' }, { v: 10 }] }, { c: [{ v: 'Dark' }, { v: 9 }] }],
      },
    });
    expect(t.headers).toEqual(['Column A', 'Column B']);
    expect(t.rows).toEqual([
      ['Breaking Bad', '10'],
      ['Dark', '9'],
    ]);
  });

  it('months in Date() are 0-based and datetimes keep only the date', () => {
    const t = parseGvizResponse({
      status: 'ok',
      table: {
        cols: [{ label: 'Show' }, { label: 'Started', type: 'datetime' }],
        rows: [{ c: [{ v: 'Dark' }, { v: 'Date(2020,11,1,20,15,0)', f: '12/1/2020 20:15:00' }] }],
      },
    });
    expect(t.rows[0][1]).toBe('2020-12-01');
  });

  it('throws on status error with the detailed message', () => {
    const text = `/*O_o*/\ngoogle.visualization.Query.setResponse({"version":"0.6","status":"error","errors":[{"reason":"invalid_query","message":"INVALID_QUERY","detailed_message":"Invalid sheet name: Nope"}]});`;
    expect(() => parseGvizResponse(text)).toThrow('Invalid sheet name: Nope');
  });

  it('maps access_denied errors and HTML to SheetAccessError', () => {
    expect(() =>
      parseGvizResponse({ status: 'error', errors: [{ reason: 'access_denied', message: 'Access denied' }] }),
    ).toThrow(SheetAccessError);
    expect(() => parseGvizResponse('<!DOCTYPE html><html><body>Sign in</body></html>')).toThrow(SheetAccessError);
  });

  it('throws on garbage', () => {
    expect(() => parseGvizResponse('nonsense')).toThrow();
  });
});

type FakeRes = { status: number; body: string; url?: string };
function fakeFetch(handler: (url: string) => FakeRes | Error) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const r = handler(url);
    if (r instanceof Error) throw r;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      url: r.url ?? url,
      text: async () => r.body,
    } as unknown as Response;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('fetchSheet', () => {
  it('fetches gviz CSV for a doc URL', async () => {
    const f = fakeFetch(() => ({ status: 200, body: '"Show","Status"\n"Dark","Watched"\n' }));
    const t = await fetchSheet(USER_URL, undefined, { fetchImpl: f, jsonp: false });
    expect(t).toEqual({ headers: ['Show', 'Status'], rows: [['Dark', 'Watched']] });
    expect(String(f.mock.calls[0][0])).toBe(gvizUrl(USER_ID, { out: 'csv' }));
  });

  it('uses the tab argument, then the gid from the URL', async () => {
    const f = fakeFetch(() => ({ status: 200, body: 'Show\nDark\n' }));
    await fetchSheet(`${USER_URL}#gid=42`, undefined, { fetchImpl: f, jsonp: false });
    expect(String(f.mock.calls[0][0])).toContain('&gid=42');
    await fetchSheet(`${USER_URL}#gid=42`, 'Watched', { fetchImpl: f, jsonp: false });
    expect(String(f.mock.calls[1][0])).toContain('&sheet=Watched');
  });

  it('fetches the published CSV for published links', async () => {
    const f = fakeFetch(() => ({ status: 200, body: 'Title\nLost\n' }));
    const t = await fetchSheet(`https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pubhtml?gid=7`, undefined, {
      fetchImpl: f,
      jsonp: false,
    });
    expect(t.rows).toEqual([['Lost']]);
    expect(String(f.mock.calls[0][0])).toBe(publishedCsvUrl(PUB_ID, '7'));
  });

  it('detects a private sheet served as an HTML sign-in page', async () => {
    const f = fakeFetch(() => ({ status: 200, body: '<!doctype html><html><head><title>Sign in</title></head></html>' }));
    await expect(fetchSheet(USER_URL, undefined, { fetchImpl: f, jsonp: false })).rejects.toBeInstanceOf(SheetAccessError);
  });

  it('detects a redirect to accounts.google.com', async () => {
    const f = fakeFetch(() => ({ status: 200, body: 'whatever', url: 'https://accounts.google.com/ServiceLogin?continue=…' }));
    await expect(fetchSheet(USER_URL, undefined, { fetchImpl: f, jsonp: false })).rejects.toBeInstanceOf(SheetAccessError);
  });

  it.each([401, 403])('detects HTTP %i as private', async (status) => {
    const f = fakeFetch(() => ({ status, body: '' }));
    const err = await fetchSheet(USER_URL, undefined, { fetchImpl: f, jsonp: false }).catch((e) => e);
    expect(err).toBeInstanceOf(SheetAccessError);
    expect(err.message).toMatch(/Anyone with the link/);
  });

  it('falls back to JSONP when fetch fails at the network level', async () => {
    const f = fakeFetch(() => new TypeError('Failed to fetch'));
    const jsonp = vi.fn(async (src: string, cb: string) => {
      expect(src).toContain(`responseHandler:${cb}`);
      expect(src).toContain('tqx=out:json;responseHandler:');
      return { status: 'ok', table: { cols: [{ label: 'Show' }], rows: [{ c: [{ v: 'Dark' }] }] } };
    });
    const t = await fetchSheet(USER_URL, '3', { fetchImpl: f, jsonp });
    expect(t).toEqual({ headers: ['Show'], rows: [['Dark']] });
    expect(jsonp.mock.calls[0][0]).toContain('&gid=3');
  });

  it('reports a private sheet when every strategy fails at the network level', async () => {
    const f = fakeFetch(() => new TypeError('Failed to fetch'));
    const jsonp = vi.fn(async () => {
      throw new SheetAccessError();
    });
    await expect(fetchSheet(USER_URL, undefined, { fetchImpl: f, jsonp })).rejects.toBeInstanceOf(SheetAccessError);
    const f2 = fakeFetch(() => new TypeError('Failed to fetch'));
    await expect(fetchSheet(USER_URL, undefined, { fetchImpl: f2, jsonp: false })).rejects.toBeInstanceOf(SheetAccessError);
  });

  it('surfaces gviz error envelopes (e.g. a bad tab name) without retrying', async () => {
    const f = fakeFetch(() => ({
      status: 200,
      body: `/*O_o*/\ngoogle.visualization.Query.setResponse({"status":"error","errors":[{"reason":"invalid_query","detailed_message":"Invalid sheet name: Nope"}]});`,
    }));
    const jsonp = vi.fn();
    await expect(fetchSheet(USER_URL, 'Nope', { fetchImpl: f, jsonp })).rejects.toThrow('Invalid sheet name: Nope');
    expect(jsonp).not.toHaveBeenCalled();
  });

  it('reports 404 as not found', async () => {
    const f = fakeFetch(() => ({ status: 404, body: '' }));
    await expect(fetchSheet(USER_URL, undefined, { fetchImpl: f, jsonp: false })).rejects.toThrow(/couldn't find/);
  });

  it('rejects non-sheet URLs', async () => {
    await expect(fetchSheet('https://example.com', undefined, { jsonp: false })).rejects.toThrow(/Google Sheets link/);
  });
});
