import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { EpisodeInfo, ShowDetail } from '../types';
import { airedSeasonSizes, getSeasonEpisodes, hasAired } from '../providers';
import { snapshot, useLibrary } from '../store/library';
import { nextUp } from '../lib/progress';
import { daysUntil, fmtDate } from '../lib/labels';

export function EpisodeTracker({ detail }: { detail: ShowDetail }) {
  const entry = useLibrary((s) => s.entries[detail.id]);
  const { add, toggleEpisode, markUpTo, setSeasonWatched, refresh } = useLibrary.getState();
  const sizes = airedSeasonSizes(detail);
  const hasSizes = !!entry?.seasonSizes?.length;

  // A show added after this page loaded (status menu, hero button…) has no
  // episode counts yet — store them so "up to here", completion and progress work.
  useEffect(() => {
    if (entry && !hasSizes && sizes.length) refresh(detail.id, snapshot(detail), sizes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!entry, hasSizes, detail]);
  const next = entry ? nextUp({ ...entry, seasonSizes: entry.seasonSizes ?? sizes }) : { season: 1, episode: 1 };
  const [open, setOpen] = useState<number | null>(next?.season ?? detail.seasons[0]?.number ?? null);

  /** Make sure the show is in the library before ticking anything. */
  const ensure = () => {
    const cur = useLibrary.getState().entries[detail.id];
    if (!cur) add(snapshot(detail), 'watching', { seasonSizes: sizes });
    else if (!cur.seasonSizes?.length) refresh(detail.id, snapshot(detail), sizes);
  };

  if (!detail.seasons.length) return <p className="dim">No episode information available for this show yet.</p>;

  return (
    <div className="seasons">
      {detail.seasons.map((s) => {
        const aired = sizes[s.number - 1] ?? s.episodeCount;
        const watched = entry?.watched[s.number]?.length ?? 0;
        const pct = aired ? Math.round((Math.min(watched, aired) / aired) * 100) : 0;
        const isOpen = open === s.number;
        return (
          <div key={s.number} className="season">
            <button className="season__head" onClick={() => setOpen(isOpen ? null : s.number)} aria-expanded={isOpen}>
              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="season__name">{s.name && !/^season \d+$/i.test(s.name) ? s.name : `Season ${s.number}`}</span>
              <span className="season__bar bar">
                <span className="bar__fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="season__count">
                {watched}/{aired || s.episodeCount}
                {aired < s.episodeCount ? ` (+${s.episodeCount - aired})` : ''}
              </span>
            </button>
            {isOpen && (
              <SeasonBody
                detail={detail}
                season={s.number}
                aired={aired}
                watchedList={entry?.watched[s.number] ?? []}
                next={next}
                onToggle={(ep) => {
                  ensure();
                  toggleEpisode(detail.id, s.number, ep.number, ep.runtime ?? detail.runtime);
                }}
                onUpTo={(ep) => {
                  ensure();
                  markUpTo(detail.id, s.number, ep.number, ep.runtime ?? detail.runtime);
                }}
                onSeason={(value) => {
                  ensure();
                  setSeasonWatched(detail.id, s.number, aired, value, detail.runtime);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SeasonBody(props: {
  detail: ShowDetail;
  season: number;
  aired: number;
  watchedList: number[];
  next?: { season: number; episode: number };
  onToggle: (ep: EpisodeInfo) => void;
  onUpTo: (ep: EpisodeInfo) => void;
  onSeason: (v: boolean) => void;
}) {
  const { detail, season, aired, watchedList, next } = props;
  const [eps, setEps] = useState<EpisodeInfo[] | null>(null);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    let alive = true;
    getSeasonEpisodes(detail, season)
      .then((e) => alive && setEps(e))
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [detail, season]);

  const watched = new Set(watchedList);
  const all = aired > 0 && watchedList.length >= aired;

  return (
    <div className="season__body">
      <div className="season__tools">
        <button className="btn btn--sm" onClick={() => props.onSeason(!all)} disabled={!aired}>
          <Check size={13} /> {all ? 'Unmark season' : 'Mark season watched'}
        </button>
        {detail.synthetic && <span className="hint">Episode titles unavailable offline — numbers only.</span>}
      </div>
      {err && <p className="dim">Couldn't load episodes: {err}</p>}
      {!eps && !err && <div className="spinner" />}
      {eps && (
        <div className="eps">
          {eps.map((ep) => {
            const on = watched.has(ep.number);
            const future = !hasAired(ep, detail);
            const isNext = next?.season === season && next.episode === ep.number;
            const d = future ? daysUntil(ep.airDate) : undefined;
            return (
              <div key={ep.number} className={`ep ${on ? 'ep--on' : ''} ${isNext ? 'ep--next' : ''} ${future ? 'ep--future' : ''}`}>
                <button className="ep__check" onClick={() => props.onToggle(ep)} aria-pressed={on} aria-label={`Episode ${ep.number} watched`} disabled={future}>
                  <Check size={14} />
                </button>
                <span className="ep__num">E{String(ep.number).padStart(2, '0')}</span>
                <span className="ep__main">
                  <span className="ep__name" title={ep.overview}>
                    {ep.name ?? `Episode ${ep.number}`}
                  </span>
                  {ep.airDate && <span className="ep__date">{future ? `airs in ${d} day${d === 1 ? '' : 's'} · ${fmtDate(ep.airDate)}` : fmtDate(ep.airDate)}</span>}
                </span>
                {!future && !on && (
                  <button className="ep__upto" onClick={() => props.onUpTo(ep)} title="Mark everything up to here as watched">
                    up to here
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
