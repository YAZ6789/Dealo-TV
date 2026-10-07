import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCheck, Info, Play, Plus, Shuffle } from 'lucide-react';
import type { ActivityEvent, LibraryEntry, Recommendation, ShowSummary } from '../../types';
import type { Item } from '../useCollections';
import type { Stats } from '../../stats/compute';
import type { AiringItem } from '../../hooks/useUpcoming';
import type { TasteTrait } from '../../recommend/engine';
import type { RecStage } from '../../recommend/pipeline';
import { useLibrary } from '../../store/library';
import { useSettings } from '../../store/settings';
import { useAmbientShow } from '../../lib/ambient';
import { useShowActions } from '../../hooks/useShowActions';
import { fmtEp, progressOf } from '../../lib/progress';
import { STATUS_LABEL, relTime, yearRange } from '../../lib/labels';
import { GENRE_LABELS } from '../../lib/genres';
import { toast } from '../../components/toast';
import { Poster } from '../../components/Poster';
import { Empty, Loading, Panel, ShowLink, Thumb, countdown, useCountUp, useNow } from './parts';
import { Sparkline } from './Sparkline';

/* ───────────── shared bits ───────────── */

function tickNext(entry: LibraryEntry) {
  const p = progressOf(entry);
  if (!p.next) return;
  const { season, episode } = p.next;
  const { toggleEpisode } = useLibrary.getState();
  toggleEpisode(entry.id, season, episode);
  toast(`✓ ${entry.show.title} ${fmtEp(p.next)}`, { label: 'Undo', run: () => useLibrary.getState().toggleEpisode(entry.id, season, episode) });
}

const canTick = (entry: LibraryEntry) => !!progressOf(entry).next && !!entry.seasonSizes?.length;

function MoreLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="mc-more">
      {children} <ArrowRight size={15} aria-hidden />
    </Link>
  );
}

const showMeta = (s: ShowSummary) =>
  [yearRange(s), s.seasonCount ? `${s.seasonCount} season${s.seasonCount > 1 ? 's' : ''}` : '', s.genres[0] ? GENRE_LABELS[s.genres[0]] : ''].filter(Boolean).join(' · ');

const reasonOf = (rec: Recommendation) => rec.reasons.find((r) => r.kind === 'because')?.label ?? rec.reasons[0]?.label ?? (rec.exploratory ? 'Outside your usual' : 'Fits your taste');

/* ───────────── 1 · NOW WATCHING ───────────── */

export function NowWatching({ items }: { items: Item[] }) {
  const entries = useLibrary((s) => s.entries);
  const list = items.map((i) => entries[i.show.id]).filter((e): e is LibraryEntry => !!e);
  const [first, ...rest] = list;
  return (
    <Panel id="now" label="Now watching" className="mc-now" meta={list.length ? `${list.length} in progress` : undefined} action={<MoreLink to="/library/watching">See all</MoreLink>}>
      {!first ? (
        <Empty title="Nothing in progress" hint="Start a show and it will be tracked here, with one-tap episode ticks.">
          <Link to="/discover" className="btn btn--sm mc-btn">
            Find something to watch
          </Link>
        </Empty>
      ) : (
        <>
          <NowHero entry={first} />
          {rest.length > 0 && (
            <div className="mc-also">
              <div className="mc-sub">Also watching</div>
              <ul className="mc-list">
                {rest.slice(0, 4).map((e) => {
                  const p = progressOf(e);
                  return (
                    <li key={e.id} className="mc-row">
                      <ShowLink show={e.show} className="mc-row__link">
                        <Thumb show={e.show} />
                        <span className="mc-row__text">
                          <span className="mc-row__title">{e.show.title}</span>
                          <span className="mc-row__sub">
                            {p.next ? `Next ${fmtEp(p.next)}` : p.caughtUp ? 'Caught up' : 'In progress'}
                            {p.total ? ` · ${p.watched}/${p.total}` : ''}
                          </span>
                          {p.total > 0 && (
                            <span className="mc-meter mc-meter--thin" aria-hidden>
                              <span style={{ width: `${p.pct}%` }} />
                            </span>
                          )}
                        </span>
                      </ShowLink>
                      {canTick(e) && (
                        <button className="btn btn--sm btn--icon mc-row__tick" onClick={() => tickNext(e)} title={`Mark ${fmtEp(p.next)} watched`} aria-label={`Mark ${e.show.title} ${fmtEp(p.next)} watched`}>
                          <Check size={16} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function NowHero({ entry }: { entry: LibraryEntry }) {
  useAmbientShow(entry.show);
  const p = progressOf(entry);
  const s = entry.show;
  return (
    <div className="mc-hero">
      <ShowLink show={s} className="mc-hero__media" label={`Open ${s.title}`}>
        <Poster show={s} variant="hero" eager />
        <span className="mc-hero__pct" aria-hidden>
          {p.total ? `${p.pct}%` : STATUS_LABEL[entry.status]}
        </span>
      </ShowLink>
      <div className="mc-hero__info">
        <div className="mc-eyebrow">{entry.lastWatchedAt ? `Last watched ${relTime(entry.lastWatchedAt)}` : 'In progress'}</div>
        <h3 className="mc-hero__title">
          <ShowLink show={s}>{s.title}</ShowLink>
        </h3>
        <div className="mc-hero__meta">
          {[yearRange(s), s.networks?.[0], s.rating ? `★ ${s.rating.toFixed(1)}` : ''].filter(Boolean).join(' · ')}
        </div>
        <div className="mc-hero__next">
          <span className="mc-hero__nextlabel">{p.next ? 'Up next' : 'Status'}</span>
          <span className="mc-hero__ep">{p.next ? fmtEp(p.next) : p.caughtUp ? 'Caught up' : '—'}</span>
        </div>
        {p.total > 0 && (
          <div className="mc-hero__progress">
            <span className="mc-meter" aria-hidden>
              <span style={{ width: `${p.pct}%` }} />
            </span>
            <span className="mc-hero__count">
              {p.watched} / {p.total} episodes · {p.pct}%
            </span>
          </div>
        )}
        <div className="mc-hero__actions">
          {canTick(entry) && (
            <button className="btn btn--primary" onClick={() => tickNext(entry)}>
              <CheckCheck size={17} aria-hidden /> Watched {fmtEp(p.next)}
            </button>
          )}
          <ShowLink show={s} className="btn btn--ghost">
            <Info size={16} aria-hidden /> Details
          </ShowLink>
        </div>
      </div>
    </div>
  );
}

/* ───────────── WATCHED (library) ───────────── */

export function Watched({ items }: { items: Item[] }) {
  const entries = useLibrary((s) => s.entries);
  const rows = items.slice(0, 6);
  const rated = items.filter((i) => (entries[i.show.id] ?? i.entry)?.rating != null).length;
  return (
    <Panel
      id="watched"
      label="Watched"
      className="mc-watched"
      meta={items.length ? `${items.length} show${items.length === 1 ? '' : 's'}` : undefined}
      action={<MoreLink to="/library/completed">See all</MoreLink>}
    >
      {!rows.length ? (
        <Empty title="Nothing finished yet" hint="Shows you finish land here, with your rating.">
          <Link to="/library" className="btn btn--sm mc-btn">
            Open library
          </Link>
        </Empty>
      ) : (
        <>
          <div className="mc-total">
            <span className="mc-total__num">{items.length}</span>
            <span className="mc-total__text">
              shows finished
              <span>{rated ? `${rated} rated by you` : 'none rated yet'}</span>
            </span>
          </div>
          <ul className="mc-list">
            {rows.map((it) => {
              const e = entries[it.show.id] ?? it.entry;
              const when = e?.completedAt ?? e?.lastWatchedAt;
              return (
                <li key={it.show.id} className="mc-row">
                  <ShowLink show={it.show} className="mc-row__link">
                    <Thumb show={it.show} />
                    <span className="mc-row__text">
                      <span className="mc-row__title">{it.show.title}</span>
                      <span className="mc-row__sub">{[when ? `Finished ${relTime(when)}` : '', yearRange(it.show)].filter(Boolean).join(' · ')}</span>
                    </span>
                    {e?.rating != null ? (
                      <span className="mc-rating" aria-label={`Your rating ${e.rating} out of 10`}>
                        <span aria-hidden>★</span> {e.rating}
                        <span className="mc-rating__of">/10</span>
                      </span>
                    ) : (
                      <span className="mc-rating mc-rating--none">Not rated</span>
                    )}
                  </ShowLink>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}

/* ───────────── WATCHLIST (library) ───────────── */

export function Watchlist({ items }: { items: Item[] }) {
  const actions = useShowActions();
  const rows = items.slice(0, 6);
  return (
    <Panel
      id="watchlist"
      label="Watchlist"
      className="mc-watchlist"
      meta={items.length ? `${items.length} to watch` : undefined}
      action={<MoreLink to="/library/plan">See all</MoreLink>}
    >
      {!rows.length ? (
        <Empty title="Watchlist is empty" hint="Save shows you want to watch and they line up here.">
          <Link to="/discover" className="btn btn--sm mc-btn">
            Find shows
          </Link>
        </Empty>
      ) : (
        <ol className="mc-list">
          {rows.map((it, i) => (
            <li key={it.show.id} className="mc-row">
              <span className="mc-row__num" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <ShowLink show={it.show} className="mc-row__link">
                <Thumb show={it.show} />
                <span className="mc-row__text">
                  <span className="mc-row__title">{it.show.title}</span>
                  <span className="mc-row__sub">{showMeta(it.show)}</span>
                </span>
              </ShowLink>
              <button className="btn btn--sm btn--icon mc-row__tick" onClick={() => actions.setStatus(it.show, 'watching')} title="Start watching" aria-label={`Start watching ${it.show.title}`}>
                <Play size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/* ───────────── 3 · AIRING ───────────── */

export function Airing({ status, upcoming, recent, progress }: { status: string; upcoming: AiringItem[]; recent: AiringItem[]; progress: { done: number; total: number } }) {
  const spoilerFree = useSettings((x) => x.spoilerFree);
  const rows = [...recent.filter((r) => r.isNew), ...upcoming].slice(0, 6);
  const loading = status !== 'ready' && !rows.length;
  const week = upcoming.filter((u) => u.days >= 0 && u.days <= 7).length;
  return (
    <Panel id="air" label="Airing" className="mc-air" meta={status === 'ready' ? `${week} this week` : undefined} action={<MoreLink to="/upcoming">Schedule</MoreLink>}>
      {loading ? (
        <Loading text={progress.total ? `Scanning schedules · ${progress.done}/${progress.total} shows` : 'Scanning schedules…'} />
      ) : !rows.length ? (
        <Empty title="No episodes on the radar" hint="New episodes of shows you follow that are still airing show up here." />
      ) : (
        <ul className="mc-list">
          {rows.map((r) => (
            <li key={`${r.show.id}-${r.episode.season}-${r.episode.number}`} className="mc-row">
              <ShowLink show={r.show} className="mc-row__link">
                <Thumb show={r.show} />
                <span className="mc-row__text">
                  <span className="mc-row__title">
                    {r.show.title} <span className="mc-row__ep">{fmtEp({ season: r.episode.season, episode: r.episode.number })}</span>
                  </span>
                  <span className="mc-row__sub">{(!spoilerFree && r.episode.name) || new Date(`${r.airDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                </span>
                <span className={`mc-when${r.days <= 1 ? ' mc-when--soon' : ''}`}>
                  {r.isNew && <span className="mc-new">New</span>}
                  {countdown(r.days)}
                </span>
              </ShowLink>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────── 4 · RECOMMENDATION RADAR ───────────── */

const STAGE_TEXT: Partial<Record<RecStage, string>> = {
  idle: 'Warming up the recommender…',
  seeds: 'Reading your library…',
  candidates: 'Gathering candidates…',
  enrich: 'Enriching metadata…',
  ranking: 'Ranking picks…',
  error: 'Recommendations unavailable right now',
};

export function Radar({ picks, stage }: { picks?: Recommendation[]; stage: RecStage }) {
  const top = picks?.slice(0, 5) ?? [];
  return (
    <Panel id="radar" label="Recommendation radar" className="mc-radar" action={<MoreLink to="/discover">Discover</MoreLink>}>
      {!picks ? (
        <Loading text={STAGE_TEXT[stage] ?? 'Ranking picks…'} />
      ) : !top.length ? (
        <Empty title="No picks yet" hint="Rate or finish a few shows to train the recommender." />
      ) : (
        <ul className="mc-list">
          {top.map((r) => (
            <li key={r.show.id} className="mc-row">
              <ShowLink show={r.show} className="mc-row__link">
                <Thumb show={r.show} />
                <span className="mc-row__text">
                  <span className="mc-row__title">{r.show.title}</span>
                  <span className="mc-row__sub">{reasonOf(r)}</span>
                  <span className="mc-match">
                    <span className="mc-meter" aria-hidden>
                      <span style={{ width: `${r.match}%` }} />
                    </span>
                    <span className="mc-match__val">{r.match}% match</span>
                  </span>
                </span>
              </ShowLink>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────── 5 · TELEMETRY ───────────── */

function Kpi({ label, value, decimals = 0, unit, sub, empty }: { label: string; value: number; decimals?: number; unit?: string; sub: string; empty?: boolean }) {
  const v = useCountUp(value);
  const final = empty ? '—' : value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const shown = empty ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <div className="mc-kpi">
      <div className="mc-kpi__label">{label}</div>
      <div className="mc-kpi__value">
        <span aria-hidden>{shown}</span>
        <span className="sr-only">{final}</span>
        {unit && !empty && <span className="mc-kpi__unit">{unit}</span>}
      </div>
      <div className="mc-kpi__sub">{sub}</div>
    </div>
  );
}

export function Telemetry({ stats }: { stats: Stats }) {
  const spark = stats.heatmap.slice(-30);
  return (
    <Panel id="tele" label="Telemetry" className="mc-tele" action={<MoreLink to="/stats">Stats</MoreLink>}>
      <div className="mc-kpis">
        <Kpi label="Hours watched" value={stats.lifetimeHours} sub={`${stats.lifetimeEpisodes.toLocaleString()} episodes`} />
        <Kpi label="Shows finished" value={stats.byStatus.completed} sub={stats.completionRate != null ? `${stats.completionRate}% completion` : 'none yet'} />
        <Kpi label="Current streak" value={stats.streak.current} unit={stats.streak.current === 1 ? 'day' : 'days'} sub={`Best ${stats.streak.longest} days`} />
        <Kpi label="Average rating" value={stats.avgRating ?? 0} decimals={1} unit="/10" empty={stats.avgRating == null} sub={`${stats.ratedCount} rated`} />
      </div>
      <Sparkline data={spark} />
    </Panel>
  );
}

/* ───────────── 6 · TASTE DNA ───────────── */

export function TasteDna({ traits }: { traits?: TasteTrait[] }) {
  const top = traits?.slice(0, 9) ?? [];
  const max = Math.max(1e-9, ...top.map((t) => t.weight));
  return (
    <Panel id="dna" label="Taste DNA" className="mc-dna" action={<MoreLink to="/taste">Tune</MoreLink>}>
      {!traits ? (
        <Loading text="Sequencing your taste…" />
      ) : !top.length ? (
        <Empty title="Not enough signal yet" hint="Rate a few shows to map your taste." />
      ) : (
        <>
          <ul className="mc-dna">
            {top.map((t) => {
              const pct = Math.round((t.weight / max) * 100);
              return (
                <li key={t.key} className="mc-dna__row" title={`${t.label}: strength ${pct}`}>
                  <span className="mc-dna__label">{t.label}</span>
                  <span className="mc-dna__track" aria-hidden>
                    <span className="mc-dna__bar" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="mc-dna__val">{pct}</span>
                </li>
              );
            })}
          </ul>
          <p className="mc-foot">Relative strength · strongest trait = 100</p>
        </>
      )}
    </Panel>
  );
}

/* ───────────── 7 · WILDCARD ───────────── */

export function Wildcard({ ranked, picks }: { ranked?: Recommendation[]; picks?: Recommendation[] }) {
  const actions = useShowActions();
  const inLib = useLibrary((s) => s.entries);
  const pool = useMemo(() => {
    if (!ranked) return [];
    const top = new Set((picks ?? []).slice(0, 5).map((p) => p.show.id));
    const fresh = (r: Recommendation) => !top.has(r.show.id) && !inLib[r.show.id];
    const explore = ranked.filter((r) => r.exploratory && fresh(r));
    return explore.length >= 4 ? explore : [...explore, ...ranked.slice(6, 60).filter((r) => fresh(r) && !r.exploratory)];
  }, [ranked, picks, inLib]);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1000));
  const rec = pool.length ? pool[seed % pool.length] : undefined;
  const shuffle = () => {
    if (pool.length < 2) return;
    let next = seed;
    while (next % pool.length === seed % pool.length) next = Math.floor(Math.random() * 100_000);
    setSeed(next);
  };
  return (
    <Panel
      id="wild"
      label="Wildcard"
      className="mc-wild"
      action={
        <button className="btn btn--sm mc-btn" onClick={shuffle} disabled={pool.length < 2}>
          <Shuffle size={15} aria-hidden /> Shuffle
        </button>
      }
    >
      {!ranked ? (
        <Loading text="Spinning up the wildcard…" />
      ) : !rec ? (
        <Empty title="No wildcard available" hint="Come back once the recommender has more to work with." />
      ) : (
        <div className="mc-wildcard" key={rec.show.id}>
          <ShowLink show={rec.show} className="mc-wildcard__media" label={`Open ${rec.show.title}`}>
            <Poster show={rec.show} variant="poster" />
          </ShowLink>
          <div className="mc-wildcard__info">
            <div className="mc-eyebrow">{rec.exploratory ? 'Outside your usual' : 'Off the beaten path'}</div>
            <h3 className="mc-wildcard__title">
              <ShowLink show={rec.show}>{rec.show.title}</ShowLink>
            </h3>
            <div className="mc-row__sub">{showMeta(rec.show)}</div>
            <div className="mc-match">
              <span className="mc-meter" aria-hidden>
                <span style={{ width: `${rec.match}%` }} />
              </span>
              <span className="mc-match__val">{rec.match}% match</span>
            </div>
            <p className="mc-wildcard__why">{reasonOf(rec)}</p>
            {rec.show.overview && <p className="mc-wildcard__overview">{rec.show.overview}</p>}
            <div className="mc-wildcard__actions">
              <button className="btn btn--sm mc-btn" onClick={() => actions.watchlist(rec.show)}>
                <Plus size={15} aria-hidden /> Watchlist
              </button>
              <ShowLink show={rec.show} className="btn btn--sm btn--ghost mc-btn">
                Details
              </ShowLink>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ───────────── 8 · SYSTEM LOG ───────────── */

interface LogLine {
  key: string;
  at: string;
  kind: ActivityEvent['kind'];
  id: string;
  count: number;
  from?: string;
  to?: string;
  status?: ActivityEvent['status'];
  rating?: number;
}

const TAG: Record<ActivityEvent['kind'], string> = { episode: 'EP', unepisode: 'UNDO', status: 'STATUS', rating: 'RATE', add: 'ADD' };

function buildLog(activity: ActivityEvent[], limit = 10): LogLine[] {
  const out: LogLine[] = [];
  for (let i = activity.length - 1; i >= 0 && out.length <= limit; i--) {
    const a = activity[i];
    const ep = a.season != null && a.episode != null ? fmtEp({ season: a.season, episode: a.episode }) : undefined;
    const prev = out[out.length - 1];
    // Collapse a binge (same show, same kind, within 12h) into one line.
    if (prev && (a.kind === 'episode' || a.kind === 'unepisode') && prev.kind === a.kind && prev.id === a.id && Date.parse(prev.at) - Date.parse(a.at) < 12 * 3600_000) {
      prev.count++;
      prev.from = ep ?? prev.from;
      continue;
    }
    out.push({ key: `${a.at}|${a.id}|${a.kind}|${i}`, at: a.at, kind: a.kind, id: a.id, count: 1, from: ep, to: ep, status: a.status, rating: a.rating });
  }
  return out.slice(0, limit);
}

export function SystemLog({ mountedAt }: { mountedAt: string }) {
  useNow(30_000); // re-render so relative times stay fresh
  const activity = useLibrary((s) => s.activity);
  const entries = useLibrary((s) => s.entries);
  const lines = useMemo(() => buildLog(activity), [activity]);
  const titleOf = (id: string) => entries[id]?.show;
  const msg = (l: LogLine) => {
    switch (l.kind) {
      case 'episode':
        return l.count > 1 ? `watched ${l.count} episodes · ${l.from} → ${l.to}` : `watched ${l.to ?? 'an episode'}`;
      case 'unepisode':
        return l.count > 1 ? `unmarked ${l.count} episodes` : `unmarked ${l.to ?? 'an episode'}`;
      case 'status':
        return `moved to ${l.status ? STATUS_LABEL[l.status] : 'a new list'}`;
      case 'rating':
        return l.rating != null ? `rated ${l.rating}/10` : 'rating cleared';
      case 'add':
        return `added${l.status ? ` to ${STATUS_LABEL[l.status]}` : ''}`;
    }
  };
  const inner = (l: LogLine, title: string) => (
    <>
      <time className="mc-logl__time" dateTime={l.at} title={new Date(l.at).toLocaleString()}>
        {relTime(l.at)}
      </time>
      <span className={`mc-logl__tag mc-logl__tag--${l.kind}`}>{TAG[l.kind]}</span>
      <span className="mc-logl__msg">
        <span className="mc-logl__show">{title}</span> {msg(l)}
      </span>
    </>
  );
  return (
    <Panel id="log" label="System log" className="mc-log" meta={activity.length ? `${activity.length.toLocaleString()} events` : undefined}>
      {!lines.length ? (
        <Empty title="Log is quiet" hint="Tick episodes, rate shows or move them between lists — every action is logged here." />
      ) : (
        <ol className="mc-logl" aria-live="polite" aria-relevant="additions">
          {lines.map((l) => {
            const show = titleOf(l.id);
            return (
              <li key={l.key} className={l.at > mountedAt ? 'is-new' : undefined}>
                {show ? (
                  <ShowLink show={show} className="mc-logl__row">
                    {inner(l, show.title)}
                  </ShowLink>
                ) : (
                  <div className="mc-logl__row">{inner(l, 'Removed show')}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
