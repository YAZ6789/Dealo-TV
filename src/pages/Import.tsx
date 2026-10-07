import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileSpreadsheet, Link2, Plus, RefreshCw, Search, Sheet, Trash2, Upload, X } from 'lucide-react';
import type { ColumnRole, ImportSource, ShowSummary, WatchStatus } from '../types';
import { STATUS_ORDER } from '../types';
import { useLibrary, migrateDoc } from '../store/library';
import { enrichLibrary } from '../store/enrich';
import { searchShows } from '../providers';
import { fetchSheet, parseSheetUrl, SheetAccessError } from '../import/sheets';
import { readSpreadsheetFile } from '../import/excel';
import type { Table } from '../import/table';
import { COLUMN_ROLES, ROLE_LABELS, detectColumns, mappingFromHeaders, mappingToHeaders, normalizeStatus, type ColumnMapping } from '../import/mapping';
import { tableToRows, dedupeRows, type ImportRow } from '../import/rows';
import { matchRows, type MatchResult } from '../import/match';
import { planImport, type ConflictPolicy } from '../import/plan';
import { slugify } from '../lib/text';
import { STATUS_LABEL, relTime } from '../lib/labels';
import { fmtEp } from '../lib/progress';
import { Poster } from '../components/Poster';
import { toast } from '../components/toast';

/* ───────────────────────── types ───────────────────────── */

interface SheetData {
  key: string;
  name: string;
  table: Table;
  mapping: ColumnMapping;
  confidence: Partial<Record<ColumnRole, number>>;
  defaultStatus?: WatchStatus;
  include: boolean;
  gsheet?: { url: string; tab?: string; sourceId?: string };
}

type Choice = { kind: 'show'; show: ShowSummary } | { kind: 'custom' } | { kind: 'skip' };
interface Reviewed extends MatchResult {
  choice: Choice;
}

type Step = 'source' | 'map' | 'match' | 'review' | 'done';

const guessStatus = (name: string): WatchStatus | undefined => {
  const s = normalizeStatus(name);
  return s && s !== 'blocked' ? s : undefined;
};

function customShow(row: ImportRow): ShowSummary {
  return {
    id: `custom:${slugify(row.title)}${row.year ? `-${row.year}` : ''}`,
    source: 'custom',
    title: row.title,
    year: row.year,
    genres: row.genres ?? [],
    networks: row.platform ? [row.platform] : undefined,
  };
}

function prepare(name: string, table: Table, extra: Partial<SheetData> = {}): SheetData {
  const { mapping, confidence } = detectColumns(table);
  return { key: `${name}-${Math.random().toString(36).slice(2, 7)}`, name, table, mapping, confidence, include: true, defaultStatus: guessStatus(name), ...extra };
}

/* ───────────────────────── page ───────────────────────── */

export default function Import() {
  const [step, setStep] = useState<Step>('source');
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [results, setResults] = useState<Reviewed[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{ added: number; updated: number; blocked: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const runMatch = async (list: SheetData[]) => {
    const rows = dedupeRows(
      list
        .filter((s) => s.include)
        .flatMap((s) => tableToRows(s.table, s.mapping, { defaultStatus: s.defaultStatus, dedupe: false }).rows),
    );
    setStep('match');
    setProgress({ done: 0, total: rows.length });
    abort.current = new AbortController();
    try {
      const res = await matchRows(rows, searchShows, {
        concurrency: 3,
        signal: abort.current.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResults(
        res.map((r) => ({
          ...r,
          choice: r.best ? { kind: 'show', show: r.best } : { kind: 'custom' },
        })),
      );
      setStep('review');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast(`Matching failed: ${(err as Error).message}`);
      setStep('map');
    }
  };

  return (
    <div className="page import">
      <div className="page-head">
        <div>
          <Link to="/settings" className="btn btn--ghost btn--sm" style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} /> Settings
          </Link>
          <h1 className="page-title">Import</h1>
          <p className="page-sub">Pull your history from Google Sheets, Excel or CSV — columns are detected automatically and every match can be reviewed.</p>
        </div>
      </div>

      <Stepper step={step} />

      {step === 'source' && (
        <SourceStep
          onLoaded={(list, skipToMatch) => {
            setSheets(list);
            if (skipToMatch) void runMatch(list);
            else setStep('map');
          }}
        />
      )}
      {step === 'map' && <MapStep sheets={sheets} setSheets={setSheets} onBack={() => setStep('source')} onNext={() => void runMatch(sheets)} />}
      {step === 'match' && (
        <div className="panel panel--pad match-progress">
          <div className="label">Matching shows</div>
          <div className="kpi__value">
            {progress.done}
            <small>/ {progress.total}</small>
          </div>
          <span className="bar" style={{ height: 6 }}>
            <span className="bar__fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </span>
          <p className="hint">Searching each title and scoring candidates by title, year and country…</p>
          <button className="btn btn--sm" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
      {step === 'review' && (
        <ReviewStep
          results={results}
          setResults={setResults}
          onBack={() => setStep('map')}
          onApply={(applied) => {
            setSummary(applied);
            // Remember Google Sheet sources for one-click re-sync.
            const lib = useLibrary.getState();
            for (const s of sheets.filter((x) => x.include && x.gsheet)) {
              const same = lib.importSources.find((x) => x.url === s.gsheet!.url && (x.tab ?? '') === (s.gsheet!.tab ?? ''));
              const src: ImportSource = {
                id: s.gsheet!.sourceId ?? same?.id ?? `gs-${Date.now()}-${s.name}`,
                kind: 'gsheet',
                label: s.name,
                url: s.gsheet!.url,
                tab: s.gsheet!.tab,
                defaultStatus: s.defaultStatus,
                mapping: mappingToHeaders(s.table, s.mapping),
                lastSyncAt: new Date().toISOString(),
              };
              lib.upsertImportSource(src);
            }
            void enrichLibrary(150);
            setStep('done');
          }}
        />
      )}
      {step === 'done' && summary && (
        <div className="panel panel--pad done">
          <Check size={40} className="accent" />
          <h2 className="section-title" style={{ margin: 0 }}>
            Import complete
          </h2>
          <p className="dim">
            {summary.added} added · {summary.updated} updated · {summary.blocked} marked “not interested”. Episode data and artwork are filling in in the background.
          </p>
          <div className="cluster" style={{ justifyContent: 'center' }}>
            <Link to="/library/all" className="btn btn--primary">
              Open library
            </Link>
            <Link to="/discover" className="btn">
              See recommendations
            </Link>
            <button
              className="btn btn--ghost"
              onClick={() => {
                setSheets([]);
                setResults([]);
                setStep('source');
              }}
            >
              Import more
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: [Step, string][] = [
    ['source', 'Source'],
    ['map', 'Columns'],
    ['match', 'Match'],
    ['review', 'Review'],
    ['done', 'Done'],
  ];
  const idx = steps.findIndex(([s]) => s === step);
  return (
    <ol className="stepper">
      {steps.map(([s, label], i) => (
        <li key={s} className={i < idx ? 'done' : i === idx ? 'on' : ''}>
          <span className="stepper__n">{i < idx ? <Check size={12} /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/* ───────────────────────── step 1: source ───────────────────────── */

interface TabSpec {
  tab: string;
  status?: WatchStatus;
}

function SourceStep({ onLoaded }: { onLoaded: (s: SheetData[], skipToMatch?: boolean) => void }) {
  const [mode, setMode] = useState<'gsheet' | 'file' | 'backup'>('gsheet');
  const sources = useLibrary((s) => s.importSources);
  const removeSource = useLibrary((s) => s.removeImportSource);
  const [url, setUrl] = useState('');
  const [tabs, setTabs] = useState<TabSpec[]>([{ tab: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; access?: boolean } | null>(null);
  const nav = useNavigate();

  const ref = parseSheetUrl(url.trim());

  const loadSheets = async (u: string, specs: TabSpec[], saved?: ImportSource) => {
    setBusy(true);
    setError(null);
    try {
      const out: SheetData[] = [];
      for (const spec of specs) {
        const table = await fetchSheet(u, spec.tab || undefined);
        if (!table.rows.length) continue;
        const name = spec.tab || saved?.label || 'Google Sheet';
        const base = prepare(name, table, { gsheet: { url: u, tab: spec.tab || undefined, sourceId: saved?.id } });
        if (spec.status) base.defaultStatus = spec.status;
        if (saved?.mapping) {
          const m = mappingFromHeaders(table, saved.mapping);
          if (m.title != null) base.mapping = m;
        }
        out.push(base);
      }
      if (!out.length) throw new Error('The sheet came back empty. Check the tab name, or that the first tab has data.');
      onLoaded(out, !!saved);
    } catch (err) {
      setError({ message: (err as Error).message, access: err instanceof SheetAccessError });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (/\.json$/i.test(file.name)) {
        const doc = migrateDoc(JSON.parse(await file.text()));
        useLibrary.getState().mergeDoc(doc);
        toast(`Restored backup — ${Object.keys(doc.entries).length} shows merged`);
        nav('/library/all');
        return;
      }
      const list = await readSpreadsheetFile(file);
      if (!list.length) throw new Error('That file has no data.');
      onLoaded(list.map((s) => prepare(s.name, s.table)));
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="seg">
        <button className={mode === 'gsheet' ? 'on' : ''} onClick={() => setMode('gsheet')}>
          <Sheet size={14} /> Google Sheets
        </button>
        <button className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}>
          <FileSpreadsheet size={14} /> Excel / CSV
        </button>
        <button className={mode === 'backup' ? 'on' : ''} onClick={() => setMode('backup')}>
          <Upload size={14} /> Dealo backup
        </button>
      </div>

      {sources.length > 0 && mode === 'gsheet' && (
        <div className="panel panel--pad">
          <div className="label" style={{ marginBottom: 10 }}>
            Connected sheets
          </div>
          <div className="list">
            {sources.map((s) => (
              <div key={s.id} className="source-row">
                <Link2 size={16} className="accent" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="list-row__title">{s.label}</div>
                  <div className="hint">
                    {s.tab ? `tab “${s.tab}” · ` : ''}
                    {s.defaultStatus ? `default ${STATUS_LABEL[s.defaultStatus]} · ` : ''}last synced {relTime(s.lastSyncAt)}
                  </div>
                </div>
                <button className="btn btn--sm" disabled={busy} onClick={() => void loadSheets(s.url, [{ tab: s.tab ?? '', status: s.defaultStatus }], s)}>
                  <RefreshCw size={13} /> Re-sync
                </button>
                <button className="btn btn--sm btn--icon btn--ghost" onClick={() => removeSource(s.id)} aria-label="Forget this sheet">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'gsheet' && (
        <div className="panel panel--pad stack">
          <div className="field">
            <label className="label" htmlFor="sheet-url">
              Google Sheet link
            </label>
            <input id="sheet-url" className="input" placeholder="https://docs.google.com/spreadsheets/d/…/edit" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            {url && !ref && <span className="hint" style={{ color: 'var(--danger)' }}>That doesn't look like a Google Sheets link.</span>}
            {ref && (
              <span className="hint accent">
                ✓ Sheet detected{ref.gid ? ` · tab gid ${ref.gid}` : ''}
              </span>
            )}
          </div>

          <div className="field">
            <span className="label">Tabs to import · leave blank for the first tab</span>
            {tabs.map((t, i) => (
              <div key={i} className="tab-row">
                <input
                  className="input"
                  placeholder={i === 0 ? 'Tab name (optional), e.g. Watched' : 'Tab name, e.g. Want to watch'}
                  value={t.tab}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTabs((list) => list.map((x, j) => (j === i ? { tab: v, status: x.status ?? guessStatus(v) } : x)));
                  }}
                />
                <select
                  className="select"
                  value={t.status ?? ''}
                  onChange={(e) => setTabs((list) => list.map((x, j) => (j === i ? { ...x, status: (e.target.value || undefined) as WatchStatus | undefined } : x)))}
                  aria-label="Status for rows without one"
                >
                  <option value="">Status from sheet</option>
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      Default: {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                {tabs.length > 1 && (
                  <button className="btn btn--icon btn--ghost" onClick={() => setTabs((l) => l.filter((_, j) => j !== i))} aria-label="Remove tab">
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
            <button className="btn btn--sm btn--ghost" style={{ justifySelf: 'start' }} onClick={() => setTabs((l) => [...l, { tab: '' }])}>
              <Plus size={13} /> Add another tab
            </button>
          </div>

          <div className="note">
            <AlertTriangle size={18} style={{ flex: 'none' }} />
            <span>
              The sheet must be readable by link: in Google Sheets click <b>Share</b> → <b>General access</b> → <b>Anyone with the link</b> → <b>Viewer</b>. Nothing is uploaded anywhere — your
              browser reads the sheet directly.
            </span>
          </div>

          {error && (
            <div className={`note ${error.access ? 'note--warn' : 'note--danger'}`}>
              <AlertTriangle size={18} style={{ flex: 'none' }} />
              <span>{error.message}</span>
            </div>
          )}

          <div className="cluster">
            <button className="btn btn--primary" disabled={!ref || busy} onClick={() => void loadSheets(url.trim(), tabs)}>
              {busy ? <div className="spinner" /> : <ArrowRight size={16} />} Read sheet
            </button>
          </div>
        </div>
      )}

      {(mode === 'file' || mode === 'backup') && (
        <label className="dropzone panel">
          <input
            type="file"
            accept={mode === 'file' ? '.xlsx,.csv,.tsv,.txt' : '.json'}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          {busy ? <div className="spinner" /> : <Upload size={32} className="accent" />}
          <strong>{mode === 'file' ? 'Drop an .xlsx or .csv file, or click to choose' : 'Choose a Dealo TV backup (.json)'}</strong>
          <span className="hint">
            {mode === 'file' ? 'Every sheet in the workbook is read; you choose which to import. From Google Sheets: File → Download → .xlsx also works.' : 'Backups merge into your current library (newest edit wins).'}
          </span>
          {error && <span style={{ color: 'var(--danger)' }}>{error.message}</span>}
        </label>
      )}
    </div>
  );
}

/* ───────────────────────── step 2: columns ───────────────────────── */

function MapStep({ sheets, setSheets, onBack, onNext }: { sheets: SheetData[]; setSheets: (s: SheetData[]) => void; onBack: () => void; onNext: () => void }) {
  const update = (key: string, patch: Partial<SheetData>) => setSheets(sheets.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const total = sheets.filter((s) => s.include).reduce((a, s) => a + tableToRows(s.table, s.mapping, { defaultStatus: s.defaultStatus }).rows.length, 0);
  const ok = sheets.some((s) => s.include && s.mapping.title != null);

  return (
    <div className="stack" style={{ gap: 20 }}>
      {sheets.map((s) => (
        <SheetMapper key={s.key} sheet={s} onChange={(p) => update(s.key, p)} multi={sheets.length > 1} />
      ))}
      <div className="import-foot">
        <button className="btn btn--ghost" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <div className="spacer" />
        <span className="dim">{total} shows found</span>
        <button className="btn btn--primary" disabled={!ok || !total} onClick={onNext}>
          Match {total} shows <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function SheetMapper({ sheet, onChange, multi }: { sheet: SheetData; onChange: (p: Partial<SheetData>) => void; multi: boolean }) {
  const { table, mapping } = sheet;
  const roleOf = (col: number) => (Object.entries(mapping).find(([, c]) => c === col)?.[0] as ColumnRole | undefined) ?? '';
  const setRole = (col: number, role: ColumnRole | '') => {
    const next: ColumnMapping = {};
    for (const [r, c] of Object.entries(mapping) as [ColumnRole, number][]) if (c !== col && r !== role) next[r] = c;
    if (role) next[role] = col;
    onChange({ mapping: next });
  };
  const preview = useMemo(() => tableToRows(table, mapping, { defaultStatus: sheet.defaultStatus }), [table, mapping, sheet.defaultStatus]);
  const lowTitle = (sheet.confidence.title ?? 1) < 0.8;

  return (
    <section className={`panel panel--pad stack ${sheet.include ? '' : 'muted'}`}>
      <div className="cluster">
        {multi && (
          <button className={`toggle ${sheet.include ? 'on' : ''}`} onClick={() => onChange({ include: !sheet.include })} aria-label={`Include ${sheet.name}`} aria-pressed={sheet.include} />
        )}
        <h2 className="section-title" style={{ margin: 0 }}>
          {sheet.name}
          <span className="count">
            {table.rows.length} rows · {table.headers.length} columns
          </span>
        </h2>
        <div className="spacer" />
        <select className="select" style={{ width: 'auto' }} value={sheet.defaultStatus ?? ''} onChange={(e) => onChange({ defaultStatus: (e.target.value || undefined) as WatchStatus | undefined })}>
          <option value="">Rows without a status: infer</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              Rows without a status: {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {sheet.include && (
        <>
          {lowTitle && (
            <div className="note note--warn">
              <AlertTriangle size={16} /> I couldn't find a column clearly named “Title” — please confirm which column holds the show names.
            </div>
          )}
          <div className="table-wrap">
            <table className="table map-table">
              <thead>
                <tr>
                  {table.headers.map((h, i) => (
                    <th key={i}>
                      <div className="map-head">
                        <span>{h || `Column ${i + 1}`}</span>
                        <select className={`select ${roleOf(i) ? 'mapped' : ''}`} value={roleOf(i)} onChange={(e) => setRole(i, e.target.value as ColumnRole | '')}>
                          <option value="">— ignore —</option>
                          {COLUMN_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 6).map((r, i) => (
                  <tr key={i}>
                    {table.headers.map((_, j) => (
                      <td key={j} className={roleOf(j) ? '' : 'faint'}>
                        {r[j]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              How Dealo reads it · first rows
            </div>
            <div className="chips">
              {preview.rows.slice(0, 8).map((r) => (
                <span key={r.rowIndex} className="chip chip--sm">
                  <b>{r.title}</b>
                  {r.year ? ` (${r.year})` : ''} · {r.blocked ? 'not interested' : r.status ? STATUS_LABEL[r.status] : '?'}
                  {r.position ? ` · ${fmtEp({ season: r.position.season, episode: Math.max(1, r.position.episode) })}` : ''}
                  {r.rating ? ` · ${r.rating}/10` : ''}
                </span>
              ))}
            </div>
            {preview.skipped.length > 0 && <p className="hint">{preview.skipped.length} rows skipped (blank or repeated headers).</p>}
          </div>
        </>
      )}
    </section>
  );
}

/* ───────────────────────── step 4: review ───────────────────────── */

function ReviewStep({
  results,
  setResults,
  onBack,
  onApply,
}: {
  results: Reviewed[];
  setResults: React.Dispatch<React.SetStateAction<Reviewed[]>>;
  onBack: () => void;
  onApply: (r: { added: number; updated: number; blocked: number }) => void;
}) {
  const [filter, setFilter] = useState<'attention' | 'all' | 'auto'>(() => (results.some((r) => r.state !== 'auto') ? 'attention' : 'all'));
  const [policy, setPolicy] = useState<ConflictPolicy>('smart');
  const entries = useLibrary((s) => s.entries);
  const blocked = useLibrary((s) => s.blocked);

  const counts = {
    auto: results.filter((r) => r.state === 'auto').length,
    attention: results.filter((r) => r.state !== 'auto').length,
    all: results.length,
  };
  const visible = results.map((r, i) => ({ r, i })).filter(({ r }) => filter === 'all' || (filter === 'auto' ? r.state === 'auto' : r.state !== 'auto'));

  const actions = useMemo(() => {
    const pairs = results.filter((r) => r.choice.kind !== 'skip').map((r) => ({ row: r.row, show: r.choice.kind === 'show' ? r.choice.show : customShow(r.row) }));
    return planImport(pairs, entries, blocked, policy);
  }, [results, entries, blocked, policy]);
  const tally = { add: 0, update: 0, block: 0, skip: 0 };
  for (const a of actions) tally[a.kind]++;

  const set = (i: number, choice: Choice) => setResults((prev) => prev.map((r, j) => (j === i ? { ...r, choice } : r)));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="cluster">
        <div className="seg">
          <button className={filter === 'attention' ? 'on' : ''} onClick={() => setFilter('attention')}>
            Needs a look <span className="n">{counts.attention}</span>
          </button>
          <button className={filter === 'auto' ? 'on' : ''} onClick={() => setFilter('auto')}>
            Confident <span className="n">{counts.auto}</span>
          </button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            All <span className="n">{counts.all}</span>
          </button>
        </div>
        <div className="spacer" />
        <button
          className="btn btn--sm"
          onClick={() => setResults(results.map((r) => (r.state !== 'auto' && r.candidates[0] ? { ...r, choice: { kind: 'show', show: r.candidates[0] } } : r)))}
        >
          Accept all top suggestions
        </button>
      </div>

      {visible.length === 0 && <p className="dim">Nothing to review here — everything matched confidently.</p>}

      <div className="list">
        {visible.map(({ r, i }) => (
          <ReviewRow key={i} r={r} onChoose={(c) => set(i, c)} />
        ))}
      </div>

      <div className="import-foot panel panel--pad">
        <button className="btn btn--ghost" onClick={onBack}>
          <ArrowLeft size={15} /> Columns
        </button>
        <div className="field" style={{ minWidth: 220 }}>
          <span className="label">If a show is already in your library</span>
          <select className="select" value={policy} onChange={(e) => setPolicy(e.target.value as ConflictPolicy)}>
            <option value="smart">Smart merge — never lose progress</option>
            <option value="sheet-wins">Sheet wins — overwrite with sheet</option>
            <option value="keep-mine">Keep mine — only add new shows</option>
          </select>
        </div>
        <div className="spacer" />
        <span className="dim">
          {tally.add} new · {tally.update} updates · {tally.block} not interested · {tally.skip} unchanged
        </span>
        <button
          className="btn btn--primary"
          disabled={!tally.add && !tally.update && !tally.block}
          onClick={() => {
            const res = useLibrary.getState().applyImport(actions);
            toast(`Imported ${res.added + res.updated} shows`);
            onApply(res);
          }}
        >
          <Check size={16} /> Import
        </button>
      </div>
    </div>
  );
}

function ReviewRow({ r, onChoose }: { r: Reviewed; onChoose: (c: Choice) => void }) {
  const [q, setQ] = useState('');
  const [extra, setExtra] = useState<ShowSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return [...extra, ...r.candidates].filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).slice(0, 12);
  }, [extra, r.candidates]);
  const chosen = r.choice.kind === 'show' ? r.choice.show : undefined;
  const value = r.choice.kind === 'show' ? r.choice.show.id : r.choice.kind;
  const row = r.row;
  const badge = r.state === 'auto' ? 'tag--accent' : '';

  return (
    <div className={`panel review-row review-row--${r.state}`}>
      <div className="review-row__sheet">
        <div className="list-row__title">{row.title}</div>
        <div className="list-row__meta">
          {row.year && <span>{row.year}</span>}
          <span>{row.blocked ? 'Not interested' : row.status ? STATUS_LABEL[row.status] : ''}</span>
          {row.position && <span className="mono">{fmtEp({ season: row.position.season, episode: Math.max(1, row.position.episode) })}</span>}
          {row.rating && <span>{row.rating}/10</span>}
          {row.mergedRowIndexes && <span>{row.mergedRowIndexes.length} rows merged</span>}
        </div>
      </div>
      <ArrowRight size={16} className="faint review-row__arrow" />
      <div className="review-row__match">
        <div className="review-row__thumb">{chosen ? <Poster show={chosen} /> : <span className="faint">{r.choice.kind === 'custom' ? '✎' : '—'}</span>}</div>
        <div style={{ minWidth: 0, flex: 1, display: 'grid', gap: 6 }}>
          <select className="select" value={value} onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom' || v === 'skip') onChoose({ kind: v });
            else {
              const s = candidates.find((c) => c.id === v);
              if (s) onChoose({ kind: 'show', show: s });
            }
          }}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.year ? ` (${c.year})` : ''}
                {c.networks?.[0] ? ` · ${c.networks[0]}` : ''}
              </option>
            ))}
            <option value="custom">Keep as “{row.title}” without metadata</option>
            <option value="skip">Skip this row</option>
          </select>
          <form
            className="review-row__search"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!q.trim()) return;
              setSearching(true);
              try {
                const res = await searchShows(q.trim());
                setExtra(res);
                if (res[0]) onChoose({ kind: 'show', show: res[0] });
                else toast(`No results for “${q.trim()}”`);
              } catch (err) {
                toast(`Search failed: ${(err as Error).message}`);
              } finally {
                setSearching(false);
              }
            }}
          >
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a different title…" />
            <button className="btn btn--sm btn--icon" aria-label="Search">
              {searching ? <div className="spinner" /> : <Search size={14} />}
            </button>
          </form>
        </div>
        <span className={`tag ${badge}`} title="Match confidence">
          {r.state === 'auto' ? '✓' : r.state === 'review' ? '?' : '✕'} {Math.round(r.confidence * 100)}%
        </span>
      </div>
    </div>
  );
}
