import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Ban, LayoutGrid, List, Search, Upload } from 'lucide-react';
import type { GenreKey, LibraryEntry, WatchStatus } from '../types';
import { STATUS_ORDER } from '../types';
import { useLibrary } from '../store/library';
import { GENRE_LABELS } from '../lib/genres';
import { fmtEp, progressOf } from '../lib/progress';
import { STATUS_LABEL, relTime } from '../lib/labels';
import { remember, showPath } from '../lib/showCache';
import { ShowCard } from '../components/ShowCard';
import { Poster } from '../components/Poster';
import { RatingInput } from '../components/RatingInput';
import { Empty } from '../components/Empty';
import { usePalette } from '../components/palette';

type Tab = WatchStatus | 'all' | 'blocked';
type Sort = 'recent' | 'title' | 'rating' | 'progress' | 'year' | 'added';

const TABS: Tab[] = ['watching', 'plan', 'completed', 'on_hold', 'dropped', 'all', 'blocked'];
const TAB_LABEL: Record<Tab, string> = { ...STATUS_LABEL, all: 'All', blocked: 'Not interested' };

const recentKey = (e: LibraryEntry) => e.lastWatchedAt ?? e.completedAt ?? e.updatedAt;

export default function Library() {
  const { tab: tabParam } = useParams();
  const nav = useNavigate();
  const tab = (TABS.includes(tabParam as Tab) ? tabParam : 'watching') as Tab;
  const entries = useLibrary((s) => s.entries);
  const blocked = useLibrary((s) => s.blocked);
  const { rate, unblock } = useLibrary.getState();
  const openPalette = usePalette((s) => s.setOpen);
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('dealo:libview') as 'grid' | 'list') ?? 'grid');
  const [sort, setSort] = useState<Sort>('recent');
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState<GenreKey | ''>('');

  const all = useMemo(() => Object.values(entries), [entries]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length, blocked: Object.keys(blocked).length };
    for (const s of STATUS_ORDER) c[s] = 0;
    for (const e of all) c[e.status]++;
    return c;
  }, [all, blocked]);

  const genres = useMemo(() => {
    const m = new Map<GenreKey, number>();
    for (const e of all) for (const g of e.show.genres) m.set(g, (m.get(g) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [all]);

  const items = useMemo(() => {
    let list = tab === 'all' ? all : all.filter((e) => e.status === tab);
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((e) => e.show.title.toLowerCase().includes(term) || e.notes?.toLowerCase().includes(term));
    if (genre) list = list.filter((e) => e.show.genres.includes(genre));
    const by: Record<Sort, (a: LibraryEntry, b: LibraryEntry) => number> = {
      recent: (a, b) => recentKey(b).localeCompare(recentKey(a)),
      added: (a, b) => b.addedAt.localeCompare(a.addedAt),
      title: (a, b) => a.show.title.localeCompare(b.show.title),
      rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.show.rating ?? 0) - (a.show.rating ?? 0),
      progress: (a, b) => progressOf(b).pct - progressOf(a).pct,
      year: (a, b) => (b.show.year ?? 0) - (a.show.year ?? 0),
    };
    return [...list].sort(by[sort]);
  }, [all, tab, q, genre, sort]);

  const setViewPersist = (v: 'grid' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('dealo:libview', v);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-sub">
            {counts.all} shows · {counts.completed} watched · {counts.watching} in progress · {counts.plan} on your watchlist
          </p>
        </div>
        <div className="spacer" />
        <Link to="/settings/import" className="btn btn--sm">
          <Upload size={14} /> Import
        </Link>
      </div>

      <div className="seg lib-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'on' : ''} onClick={() => nav(`/library/${t}`)}>
            {TAB_LABEL[t]}
            <span className="n">{counts[t] ?? 0}</span>
          </button>
        ))}
      </div>

      {tab === 'blocked' ? (
        <BlockedList blocked={Object.values(blocked)} onUnblock={unblock} />
      ) : (
        <>
          <div className="toolbar" style={{ marginTop: 18 }}>
            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-faint)' }} />
              <input className="input" style={{ paddingLeft: 36 }} placeholder="Filter your library…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select" value={genre} onChange={(e) => setGenre(e.target.value as GenreKey | '')} aria-label="Genre">
              <option value="">All genres</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {GENRE_LABELS[g]}
                </option>
              ))}
            </select>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="recent">Recently active</option>
              <option value="added">Recently added</option>
              <option value="title">Title A–Z</option>
              <option value="rating">Your rating</option>
              <option value="progress">Progress</option>
              <option value="year">Release year</option>
            </select>
            <div className="spacer" />
            <div className="seg">
              <button className={view === 'grid' ? 'on' : ''} onClick={() => setViewPersist('grid')} aria-label="Grid view">
                <LayoutGrid size={15} />
              </button>
              <button className={view === 'list' ? 'on' : ''} onClick={() => setViewPersist('list')} aria-label="List view">
                <List size={15} />
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <Empty
              title={all.length ? 'Nothing here' : 'Your library is empty'}
              actions={
                <>
                  <button className="btn btn--primary" onClick={() => openPalette(true)}>
                    <Search size={15} /> Find a show
                  </button>
                  <Link className="btn" to="/settings/import">
                    <Upload size={15} /> Import from Google Sheets
                  </Link>
                </>
              }
            >
              {all.length ? 'No shows match this list and filter.' : 'Search for shows you have watched, are watching, or want to watch — or import your spreadsheet.'}
            </Empty>
          ) : view === 'grid' ? (
            <div className="grid">
              {items.map((e) => (
                <ShowCard key={e.id} show={e.show} showStatus={tab === 'all'} />
              ))}
            </div>
          ) : (
            <div className="list">
              {items.map((e) => {
                const p = progressOf(e);
                return (
                  <div key={e.id} className="panel list-row">
                    <Link to={showPath(e.id)} onClick={() => remember(e.show)} className="list-row__poster">
                      <Poster show={e.show} />
                    </Link>
                    <div className="list-row__main">
                      <Link to={showPath(e.id)} onClick={() => remember(e.show)} className="list-row__title">
                        {e.show.title}
                      </Link>
                      <div className="list-row__meta">
                        <span className="tag tag--accent">{STATUS_LABEL[e.status]}</span>
                        {e.show.year && <span>{e.show.year}</span>}
                        {p.total > 0 && (
                          <span className="mono">
                            {p.watched}/{p.total} eps{p.next && e.status === 'watching' ? ` · next ${fmtEp(p.next)}` : ''}
                          </span>
                        )}
                        <span>{relTime(recentKey(e))}</span>
                      </div>
                      {p.total > 0 && e.status !== 'completed' && (
                        <span className="bar" style={{ maxWidth: 320 }}>
                          <span className="bar__fill" style={{ width: `${p.pct}%` }} />
                        </span>
                      )}
                    </div>
                    <RatingInput size="sm" value={e.rating} onChange={(v) => rate(e.id, v)} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BlockedList({ blocked, onUnblock }: { blocked: { id: string; show: import('../types').ShowSummary; at: string }[]; onUnblock: (id: string) => void }) {
  if (!blocked.length)
    return (
      <Empty icon={<Ban size={36} />} title="No blocked shows">
        Hover any recommendation and hit ⊘ — Dealo will never suggest it again, and will steer away from similar shows.
      </Empty>
    );
  return (
    <div className="list" style={{ marginTop: 18 }}>
      {blocked
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((b) => (
          <div key={b.id} className="panel list-row">
            <div className="list-row__poster">
              <Poster show={b.show} />
            </div>
            <div className="list-row__main">
              <Link to={showPath(b.id)} onClick={() => remember(b.show)} className="list-row__title">
                {b.show.title}
              </Link>
              <div className="list-row__meta">
                {b.show.year && <span>{b.show.year}</span>}
                <span>hidden {relTime(b.at)}</span>
              </div>
            </div>
            <button className="btn btn--sm" onClick={() => onUnblock(b.id)}>
              Allow again
            </button>
          </div>
        ))}
    </div>
  );
}
