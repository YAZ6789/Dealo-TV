/**
 * Google Sheets fetching from the browser with no API key.
 *
 * Works for sheets shared as "Anyone with the link → Viewer" (or "Published
 * to the web"). Strategy chain:
 *   1. gviz CSV endpoint (CORS-enabled for public sheets);
 *   2. published CSV (`/pub?output=csv`) for "Publish to web" links;
 *   3. JSONP through a <script> tag (`tqx=responseHandler:…`) — survives
 *      CORS/proxy quirks; browser only (needs `document`).
 * A private sheet surfaces as {@link SheetAccessError}.
 */
import { cellToString, detectHeaderRow, parseCsv, type Table } from './table';

export type SheetRef =
  | { kind: 'doc'; id: string; gid?: string }
  | { kind: 'published'; pubId: string; gid?: string };

export const SHEET_ACCESS_MESSAGE =
  "This Google Sheet isn't shared publicly. In Google Sheets click Share → General access → " +
  '"Anyone with the link" → Viewer, then try again.';

/** The sheet exists but can't be read anonymously (private / sign-in required). */
export class SheetAccessError extends Error {
  constructor(message: string = SHEET_ACCESS_MESSAGE) {
    super(message);
    this.name = 'SheetAccessError';
  }
}

const ID_RE = /^[A-Za-z0-9_-]{25,}$/;

function extractGid(url: string): string | undefined {
  const m = url.match(/[?&#]gid=(\d+)/);
  return m ? m[1] : undefined;
}

/**
 * Recognise every common way of pasting a Google Sheet:
 * `/d/<id>/edit?usp=sharing`, `/edit#gid=123`, `/edit?gid=1#gid=1`, `/view`,
 * `/htmlview`, a bare id, `/d/e/2PACX-…/pubhtml`, `/pub?output=csv&gid=…`,
 * `drive.google.com/open?id=<id>`. Returns null when it isn't one.
 */
export function parseSheetUrl(url: string): SheetRef | null {
  const s = String(url ?? '').trim();
  if (!s) return null;
  const gid = extractGid(s);

  let m = s.match(/\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/);
  if (m) return withGid({ kind: 'published', pubId: m[1] }, gid);

  m = s.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/);
  if (m) return withGid({ kind: 'doc', id: m[1] }, gid);

  m = s.match(/(?:drive|docs)\.google\.com\/(?:open|uc)\?(?:.*&)?id=([A-Za-z0-9_-]+)/);
  if (m) return withGid({ kind: 'doc', id: m[1] }, gid);

  if (/^2PACX-[A-Za-z0-9_-]+$/.test(s)) return { kind: 'published', pubId: s };
  if (ID_RE.test(s)) return { kind: 'doc', id: s };
  return null;
}

function withGid<T extends SheetRef>(ref: T, gid: string | undefined): T {
  return gid !== undefined ? { ...ref, gid } : ref;
}

/**
 * gviz query endpoint for a sheet id. `tab` that is all digits is a gid,
 * anything else is a tab name.
 */
export function gvizUrl(id: string, opts: { tab?: string; out: 'csv' | 'json' }): string {
  let u = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:${opts.out}&headers=1`;
  const tab = opts.tab?.trim();
  if (tab) u += /^\d+$/.test(tab) ? `&gid=${tab}` : `&sheet=${encodeURIComponent(tab)}`;
  return u;
}

/** Published-to-web CSV URL. Published sheets only address tabs by gid. */
export function publishedCsvUrl(pubId: string, gid?: string): string {
  let u = `https://docs.google.com/spreadsheets/d/e/${encodeURIComponent(pubId)}/pub?output=csv`;
  if (gid && /^\d+$/.test(gid)) u += `&gid=${gid}`;
  return u;
}

/* ───────────────────────── gviz response parsing ───────────────────────── */

interface GvizCell {
  v?: unknown;
  f?: string | null;
}
interface GvizResponse {
  status?: string;
  errors?: { reason?: string; message?: string; detailed_message?: string }[];
  table?: {
    cols?: { id?: string; label?: string; type?: string }[];
    rows?: { c?: (GvizCell | null)[] }[];
  };
}

const GVIZ_DATE = /^Date\((\d+),(\d+),(\d+)(?:,\d+){0,4}\)$/;

function gvizCell(cell: GvizCell | null | undefined, type: string | undefined): string {
  if (!cell) return '';
  const { v, f } = cell;
  if (v === null || v === undefined) return typeof f === 'string' ? f.trim() : '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') {
    const m = v.match(GVIZ_DATE);
    if (m) {
      // gviz months are 0-based. Dates are returned as ISO (unambiguous)
      // rather than the locale-formatted `f`.
      const d = new Date(Date.UTC(+m[1], +m[2], +m[3]));
      return d.toISOString().slice(0, 10);
    }
    return v.trim();
  }
  if (typeof v === 'number') {
    // Formatted numbers keep the user's intent ("85%", "8.5", "1,234").
    if (typeof f === 'string' && f.trim() && type !== 'date' && type !== 'datetime') return f.trim();
    return cellToString(v);
  }
  return typeof f === 'string' ? f.trim() : cellToString(v);
}

const looksLikeHtml = (t: string) => /^\s*<(?:!doctype|html|head|body)/i.test(t) || /<html[\s>]/i.test(t.slice(0, 2000));

/**
 * Parse a Google Visualization response — either the raw
 * `/*O_o*\/ google.visualization.Query.setResponse({...});` text, a JSONP
 * payload, or an already-parsed object — into a {@link Table}.
 * Column labels become headers (header detection still runs, so banner rows
 * or unlabeled sheets are handled). Throws on `status: 'error'`.
 */
export function parseGvizResponse(input: string | object): Table {
  let obj: GvizResponse;
  if (typeof input === 'string') {
    if (looksLikeHtml(input)) throw new SheetAccessError();
    const start = input.indexOf('{');
    const end = input.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Unexpected response from Google Sheets.');
    try {
      obj = JSON.parse(input.slice(start, end + 1)) as GvizResponse;
    } catch {
      throw new Error('Could not read the Google Sheets response.');
    }
  } else {
    obj = input as GvizResponse;
  }

  if (obj.status === 'error') {
    const errs = obj.errors ?? [];
    if (errs.some((e) => /access_denied|user_not_authenticated|permission/i.test(`${e.reason} ${e.message}`))) {
      throw new SheetAccessError();
    }
    const msg = errs.map((e) => e.detailed_message || e.message || e.reason).filter(Boolean).join('; ');
    throw new Error(msg || 'Google Sheets returned an error.');
  }

  const cols = obj.table?.cols ?? [];
  const rows = (obj.table?.rows ?? []).map((r) => cols.map((col, j) => gvizCell(r?.c?.[j], col.type)));
  const labels = cols.map((c) => (c.label ?? '').trim());
  const matrix = labels.some(Boolean) ? [labels, ...rows] : rows;
  return detectHeaderRow(matrix);
}

/* ───────────────────────── Fetching ───────────────────────── */

export type JsonpFn = (src: string, callbackName: string) => Promise<unknown>;

export interface FetchSheetOptions {
  fetchImpl?: typeof fetch;
  /** JSONP loader; defaults to a <script>-tag loader when `document` exists. `false` disables it. */
  jsonp?: JsonpFn | false;
  /** Timeout for the JSONP strategy (ms). */
  timeoutMs?: number;
}

let jsonpCounter = 0;

/** Default JSONP loader: inject a script tag and wait for the callback. */
export function scriptJsonp(timeoutMs = 15000): JsonpFn {
  return (src, cbName) =>
    new Promise((resolve, reject) => {
      const w = window as unknown as Record<string, unknown>;
      const script = document.createElement('script');
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        delete w[cbName];
        script.remove();
      };
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error('Google Sheets took too long to respond.'))), timeoutMs);
      w[cbName] = (data: unknown) => finish(() => resolve(data));
      // A script that loads without calling back is a sign-in page or similar.
      script.onload = () => setTimeout(() => finish(() => reject(new SheetAccessError())), 0);
      script.onerror = () => finish(() => reject(new SheetAccessError()));
      script.async = true;
      script.src = src;
      document.head.appendChild(script);
    });
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, { credentials: 'omit', redirect: 'follow' });
  if (res.status === 401 || res.status === 403) throw new SheetAccessError();
  if (/accounts\.google\.com|ServiceLogin/i.test(res.url ?? '')) throw new SheetAccessError();
  if (res.status === 404) throw new Error("Google Sheets couldn't find that sheet — double-check the link.");
  if (!res.ok) throw new Error(`Google Sheets responded with HTTP ${res.status}.`);
  const text = await res.text();
  if (looksLikeHtml(text)) throw new SheetAccessError();
  return text;
}

/** CSV or a gviz-wrapped response (gviz returns errors in its own envelope even for out:csv). */
function parseCsvOrGviz(text: string): Table {
  if (/google\.visualization\.Query\.setResponse|^\s*\/\*O_o\*\//.test(text)) return parseGvizResponse(text);
  return parseCsv(text);
}

const isNetworkError = (e: unknown) => e instanceof TypeError;

/**
 * Download a sheet as a {@link Table}.
 * @param url  any form accepted by {@link parseSheetUrl}
 * @param tab  tab name or gid; defaults to the gid in the URL, else the first tab
 * @throws SheetAccessError when the sheet is private
 */
export async function fetchSheet(url: string, tab?: string, opts: FetchSheetOptions = {}): Promise<Table> {
  const ref = parseSheetUrl(url);
  if (!ref) throw new Error("That doesn't look like a Google Sheets link.");
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const tabOrGid = tab?.trim() || ref.gid;
  const errors: unknown[] = [];

  const attempt = async (fn: () => Promise<Table>): Promise<Table | undefined> => {
    try {
      return await fn();
    } catch (e) {
      errors.push(e);
      return undefined;
    }
  };

  if (fetchImpl) {
    const table =
      ref.kind === 'doc'
        ? await attempt(async () => parseCsvOrGviz(await fetchText(gvizUrl(ref.id, { tab: tabOrGid, out: 'csv' }), fetchImpl)))
        : await attempt(async () => parseCsv(await fetchText(publishedCsvUrl(ref.pubId, tabOrGid), fetchImpl)));
    if (table) return table;
  }

  // A gviz error envelope (e.g. bad tab name) is definitive — no point retrying.
  const definitive = errors.find(
    (e): e is Error =>
      e instanceof Error && !(e instanceof SheetAccessError) && !(e instanceof TypeError) && !/HTTP|took too long/.test(e.message),
  );

  const jsonp =
    opts.jsonp === false
      ? undefined
      : (opts.jsonp ?? (typeof document !== 'undefined' && typeof window !== 'undefined' ? scriptJsonp(opts.timeoutMs) : undefined));
  if (ref.kind === 'doc' && jsonp && !definitive) {
    const cbName = `__dealoGviz${Date.now().toString(36)}${jsonpCounter++}`;
    const src = gvizUrl(ref.id, { tab: tabOrGid, out: 'json' }).replace('tqx=out:json', `tqx=out:json;responseHandler:${cbName}`);
    const table = await attempt(async () => {
      const data = await jsonp(src, cbName);
      if (data == null) throw new SheetAccessError();
      return parseGvizResponse(data as object);
    });
    if (table) return table;
  }

  if (definitive) throw definitive;
  if (errors.some((e) => e instanceof SheetAccessError)) throw new SheetAccessError();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error("You're offline — connect to the internet and try again.");
  }
  // Every strategy failed at the network level: for Google Sheets that is almost
  // always a private sheet (the sign-in redirect has no CORS headers).
  if (errors.length && errors.every(isNetworkError)) throw new SheetAccessError();
  const last = errors[errors.length - 1];
  throw last instanceof Error ? last : new Error('Could not load the Google Sheet.');
}
