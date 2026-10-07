import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, CheckCheck, ExternalLink, Heart, PlayCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ShowDetail, ShowSummary } from '../types';
import { useLibrary } from '../store/library';
import { useShowDetail } from '../hooks/useShowDetail';
import { useAmbientShow } from '../lib/ambient';
import { useSettings } from '../store/settings';
import { useRecommendations } from '../hooks/useRecommendations';
import { useShowActions } from '../hooks/useShowActions';
import { GENRE_LABELS } from '../lib/genres';
import { fmtEp, progressOf } from '../lib/progress';
import { daysUntil, fmtDate, yearRange } from '../lib/labels';
import { Poster } from '../components/Poster';
import { StatusMenu } from '../components/StatusMenu';
import { RatingInput } from '../components/RatingInput';
import { EpisodeTracker } from '../components/EpisodeTracker';
import { Row } from '../components/Row';
import { ShowCard, matchClass } from '../components/ShowCard';
import { TrailerModal } from '../components/Modal';
import { toast } from '../components/toast';
import { Attribution } from './Home';

const langName = (code?: string) => {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
  } catch {
    return code;
  }
};

export default function Show() {
  const { id = '' } = useParams();
  const showId = decodeURIComponent(id);
  const { detail, error, loading, hint } = useShowDetail(showId);
  const show: ShowSummary | undefined = detail ?? hint;

  if (!show) {
    return (
      <div className="page">
        {loading ? (
          <div className="spinner" />
        ) : (
          <div className="empty">
            <h3>Signal lost</h3>
            <p>{error ?? 'Show not found.'}</p>
            <button className="btn" onClick={() => history.back()}>
              <ArrowLeft size={15} /> Go back
            </button>
          </div>
        )}
      </div>
    );
  }
  return <ShowView key={show.id} show={show} detail={detail} loading={loading} error={error} />;
}

function ShowView({ show, detail, loading, error }: { show: ShowSummary; detail?: ShowDetail; loading: boolean; error?: string }) {
  const entry = useLibrary((s) => s.entries[show.id]);
  const feedback = useLibrary((s) => s.feedback[show.id]?.value);
  const keywordsTaste = useLibrary((s) => s.taste.keywords);
  const { rate, toggleFavorite, setNotes, setKeyword, toggleEpisode } = useLibrary.getState();
  const actions = useShowActions();
  const recs = useRecommendations();
  const [trailer, setTrailer] = useState(false);
  const p = entry ? progressOf(entry) : undefined;
  useAmbientShow(show);
  const spoilerFree = useSettings((s) => s.spoilerFree);

  const scored = useMemo(() => (recs.output && !entry ? recs.output.score(show) : undefined), [recs.output, show, entry]);
  const related = useMemo(() => {
    const list = [...(detail?.related ?? []), ...(detail?.similar ?? [])];
    const seen = new Set<string>();
    const uniq = list.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    if (!recs.output) return uniq.map((s) => ({ show: s, rec: undefined }));
    return uniq
      .map((s) => ({ show: s, rec: recs.output!.score(s) }))
      .sort((a, b) => b.rec.score - a.rec.score);
  }, [detail, recs.output]);

  const next = detail?.nextEpisode;
  const nextIn = next ? daysUntil(next.airDate) : undefined;

  return (
    <div className="show">
      <section className="detail-hero">
        <div className="detail-hero__bg">
          <Poster show={show} variant="hero" eager />
        </div>
        <div className="hero__shade" />
        <div className="detail-hero__grid">
          <div className="detail-hero__poster">
            <Poster show={show} eager />
          </div>
          <div className="detail-hero__info hero-anim">
            <button className="btn btn--ghost btn--sm back-btn" onClick={() => history.back()}>
              <ArrowLeft size={14} /> Back
            </button>
            <h1 className="hero__title">{show.title}</h1>
            {detail?.tagline && <p className="tagline">“{detail.tagline}”</p>}
            <div className="hero__meta">
              {scored && <span className={matchClass(scored.match)}>{scored.match}% match</span>}
              {yearRange(show) && <span>{yearRange(show)}</span>}
              {show.seasonCount ? <span>{show.seasonCount} season{show.seasonCount > 1 ? 's' : ''}</span> : null}
              {show.episodeCount ? <span>{show.episodeCount} episodes</span> : null}
              {show.runtime ? <span>{show.runtime} min</span> : null}
              {detail?.contentRating && <span className="tag">{detail.contentRating}</span>}
              {show.rating ? <span>★ {show.rating.toFixed(1)}</span> : null}
              {show.airStatus && show.airStatus !== 'unknown' && <span className="tag tag--accent">{show.airStatus === 'ongoing' ? 'Returning' : show.airStatus === 'ended' ? 'Ended' : 'Upcoming'}</span>}
            </div>
            <div className="chips">
              {show.genres.map((g) => (
                <span key={g} className="chip chip--sm">
                  {GENRE_LABELS[g]}
                </span>
              ))}
            </div>
            <div className="hero__actions">
              <StatusMenu show={detail ?? show} primary />
              {entry && p?.next && entry.seasonSizes?.length ? (
                <button
                  className="btn"
                  onClick={() => {
                    toggleEpisode(entry.id, p.next!.season, p.next!.episode, show.runtime);
                    toast(`✓ ${show.title} ${fmtEp(p.next)}`, { label: 'Undo', run: () => toggleEpisode(entry.id, p.next!.season, p.next!.episode) });
                  }}
                >
                  <CheckCheck size={16} /> Watched {fmtEp(p.next)}
                </button>
              ) : null}
              {detail?.trailerKey && (
                <button className="btn" onClick={() => setTrailer(true)}>
                  <PlayCircle size={16} /> Trailer
                </button>
              )}
              {entry ? (
                <button className={`btn btn--icon ${entry.favorite ? 'btn--on' : ''}`} onClick={() => toggleFavorite(show.id)} title="Favourite" aria-pressed={!!entry.favorite}>
                  <Heart size={16} fill={entry.favorite ? 'currentColor' : 'none'} />
                </button>
              ) : (
                <>
                  <button className={`btn btn--icon ${feedback === 1 ? 'btn--on' : ''}`} onClick={() => actions.moreLikeThis(show)} title="More like this">
                    <ThumbsUp size={16} />
                  </button>
                  <button className={`btn btn--icon ${feedback === -1 ? 'btn--on' : ''}`} onClick={() => actions.lessLikeThis(show)} title="Less like this">
                    <ThumbsDown size={16} />
                  </button>
                </>
              )}
            </div>
            {scored && scored.reasons.length > 0 && (
              <div className="why">
                <span className="label">Why it's recommended</span>
                <div className="chips">
                  {scored.reasons.slice(0, 5).map((r) => (
                    <span key={r.label} className={`chip chip--sm ${r.kind === 'because' ? 'chip--on' : ''}`}>
                      {r.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="page">
        <div className="detail-body">
          <div className="stack" style={{ gap: 34, minWidth: 0 }}>
            {show.overview && (
              <section>
                <h2 className="section-title">Synopsis</h2>
                <p className="overview">{show.overview}</p>
              </section>
            )}

            {entry && (
              <section className="panel panel--pad your-panel">
                <div className="your-panel__grid">
                  <div className="field">
                    <span className="label">Your rating</span>
                    <RatingInput value={entry.rating} onChange={(v) => rate(show.id, v)} />
                  </div>
                  {p && p.total > 0 && (
                    <div className="field" style={{ minWidth: 220, flex: 1 }}>
                      <span className="label">
                        Progress · {p.watched}/{p.total} · {p.pct}%
                      </span>
                      <span className="bar" style={{ height: 6 }}>
                        <span className="bar__fill" style={{ width: `${p.pct}%` }} />
                      </span>
                      <span className="hint">{p.next ? `Up next: ${fmtEp(p.next)}` : p.caughtUp ? 'All caught up ✓' : ''}</span>
                    </div>
                  )}
                </div>
                <div className="field" style={{ marginTop: 18 }}>
                  <span className="label">Notes</span>
                  <textarea className="textarea" defaultValue={entry.notes} placeholder="Thoughts, where you left off, who recommended it…" onBlur={(e) => setNotes(show.id, e.target.value)} />
                </div>
              </section>
            )}

            {next && (
              <div className="note">
                <CalendarClock size={18} />
                <span>
                  Next episode <b>{fmtEp({ season: next.season, episode: next.number })}</b>
                  {next.name && !spoilerFree ? ` “${next.name}”` : ''} airs {nextIn != null && nextIn >= 0 ? (nextIn === 0 ? 'today' : `in ${nextIn} day${nextIn === 1 ? '' : 's'}`) : ''} · {fmtDate(next.airDate)}
                </span>
              </div>
            )}

            <section>
              <h2 className="section-title">Episodes</h2>
              {detail ? <EpisodeTracker detail={detail} /> : loading ? <div className="spinner" /> : <p className="dim">{error}</p>}
            </section>

            {detail?.castFull && detail.castFull.length > 0 && (
              <section>
                <h2 className="section-title">Cast</h2>
                <div className="cast">
                  {detail.castFull.map((c) => (
                    <div key={c.name + c.character} className="cast__item">
                      <div className="cast__photo">{c.photo ? <img src={c.photo} alt="" loading="lazy" /> : c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
                      <span className="cast__name">{c.name}</span>
                      {c.character && <span className="cast__role">{c.character}</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="stack">
            <div className="panel panel--pad">
              <dl className="kv">
                {show.creators?.length ? (
                  <>
                    <dt>Created by</dt>
                    <dd>{show.creators.join(', ')}</dd>
                  </>
                ) : null}
                {show.networks?.length ? (
                  <>
                    <dt>Network</dt>
                    <dd>{show.networks.join(', ')}</dd>
                  </>
                ) : null}
                {show.language && (
                  <>
                    <dt>Language</dt>
                    <dd>{langName(show.language)}</dd>
                  </>
                )}
                {show.country && (
                  <>
                    <dt>Country</dt>
                    <dd>{show.country}</dd>
                  </>
                )}
                {detail?.lastEpisode && (
                  <>
                    <dt>Last aired</dt>
                    <dd>
                      {fmtEp({ season: detail.lastEpisode.season, episode: detail.lastEpisode.number })} · {fmtDate(detail.lastEpisode.airDate)}
                    </dd>
                  </>
                )}
                {detail?.watchProviders?.stream.length ? (
                  <>
                    <dt>Watch on</dt>
                    <dd className="providers">
                      {detail.watchProviders.stream.map((w) =>
                        w.logo ? <img key={w.name} src={w.logo} alt={w.name} title={w.name} /> : <span key={w.name} className="tag">{w.name}</span>,
                      )}
                      {detail.watchProviders.link && (
                        <a href={detail.watchProviders.link} target="_blank" rel="noreferrer" className="tag">
                          more <ExternalLink size={10} />
                        </a>
                      )}
                    </dd>
                  </>
                ) : null}
                {detail?.homepage && (
                  <>
                    <dt>Website</dt>
                    <dd>
                      <a href={detail.homepage} target="_blank" rel="noreferrer" className="accent">
                        Official site <ExternalLink size={11} />
                      </a>
                    </dd>
                  </>
                )}
              </dl>
            </div>

            {show.keywords && show.keywords.length > 0 && (
              <div className="panel panel--pad">
                <div className="label" style={{ marginBottom: 10 }}>
                  Themes · tap to tune your taste
                </div>
                <div className="chips">
                  {show.keywords.slice(0, 18).map((k) => {
                    const v = keywordsTaste[k];
                    return (
                      <button
                        key={k}
                        className={`chip chip--sm ${v === 1 ? 'chip--on' : v === -1 ? 'chip--off' : ''}`}
                        onClick={() => setKeyword(k, v === 1 ? -1 : v === -1 ? 0 : 1)}
                        title={v === 1 ? 'You like this — tap to avoid' : v === -1 ? 'Avoiding — tap to clear' : 'Tap if you like this theme'}
                      >
                        {k}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {related.length > 0 && (
        <Row title="More like this" sub={recs.output ? 'Re-ranked for your taste' : undefined}>
          {related.slice(0, 20).map(({ show: s, rec }) => (
            <ShowCard key={s.id} show={s} rec={rec} />
          ))}
        </Row>
      )}
      {trailer && detail?.trailerKey && <TrailerModal videoKey={detail.trailerKey} title={show.title} onClose={() => setTrailer(false)} />}
      <Attribution />
    </div>
  );
}
