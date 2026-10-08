import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCheck, Info, Play, Sparkles, Upload } from 'lucide-react';
import type { LibraryEntry, Recommendation, ShowSummary } from '../types';
import { useLibrary } from '../store/library';
import { useRecommendations } from '../hooks/useRecommendations';
import { fmtEp, progressOf } from '../lib/progress';
import { remember, showPath } from '../lib/showCache';
import { GENRE_LABELS } from '../lib/genres';
import { yearRange } from '../lib/labels';
import { Row } from '../components/Row';
import { ShowCard, matchClass } from '../components/ShowCard';
import { WatchingCard } from '../components/WatchingCard';
import { Poster } from '../components/Poster';
import { useAmbientShow } from '../lib/ambient';
import { prefetchArtwork } from '../providers/artwork';
import { NewEpisodesBanner } from '../components/NewEpisodesBanner';
import { StatusMenu } from '../components/StatusMenu';
import { toast } from '../components/toast';

interface Slide {
  show: ShowSummary;
  kind: 'continue' | 'watched' | 'rec';
  entry?: LibraryEntry;
  rec?: Recommendation;
}

function Hero({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const toggleEpisode = useLibrary((s) => s.toggleEpisode);
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), 9000);
    return () => clearInterval(t);
  }, [slides.length]);
  const slide = slides[Math.min(i, slides.length - 1)];
  useAmbientShow(slide?.show);
  // the billboard rotates: have the next backdrops ready before they slide in
  useEffect(() => prefetchArtwork(slides.map((x) => x.show), 'backdrop'), [slides]);
  if (!slide) return null;
  const { show, entry, rec } = slide;
  const p = entry ? progressOf(entry) : undefined;
  const why = rec?.reasons.find((r) => r.kind === 'because')?.label ?? rec?.reasons[0]?.label;

  return (
    <section className="hero" key={show.id}>
      <div className="hero__bg">
        <Poster show={show} variant="hero" eager />
      </div>
      <div className="hero__shade" />
      <div className="hero__content hero-anim">
        <div className="hero__eyebrow">
          {slide.kind === 'continue' ? 'Continue watching' : slide.kind === 'watched' ? `Watched${entry?.rating != null ? ` · you rated it ${entry.rating}/10` : ''}` : why ?? 'Recommended for you'}
        </div>
        <h1 className="hero__title">{show.title}</h1>
        <div className="hero__meta">
          {rec && <span className={matchClass(rec.match)}>{rec.match}% match</span>}
          {yearRange(show) && <span>{yearRange(show)}</span>}
          {show.seasonCount ? <span>{show.seasonCount} season{show.seasonCount > 1 ? 's' : ''}</span> : null}
          {show.genres.slice(0, 3).map((g) => (
            <span key={g} className="tag">
              {GENRE_LABELS[g]}
            </span>
          ))}
          {show.rating ? <span>★ {show.rating.toFixed(1)}</span> : null}
        </div>
        {show.overview && <p className="hero__overview">{show.overview}</p>}
        {p && p.total > 0 && (
          <div className="hero__progress">
            <span>
              {p.next ? `Up next · ${fmtEp(p.next)}` : 'All caught up'} — {p.watched}/{p.total} episodes
            </span>
            <span className="bar">
              <span className="bar__fill" style={{ width: `${p.pct}%` }} />
            </span>
          </div>
        )}
        <div className="hero__actions">
          {entry && p?.next && entry.seasonSizes?.length ? (
            <button
              className="btn btn--primary"
              onClick={() => {
                toggleEpisode(entry.id, p.next!.season, p.next!.episode);
                toast(`✓ ${show.title} ${fmtEp(p.next)}`, { label: 'Undo', run: () => toggleEpisode(entry.id, p.next!.season, p.next!.episode) });
              }}
            >
              <CheckCheck size={17} /> Watched {fmtEp(p.next)}
            </button>
          ) : (
            <StatusMenu show={show} primary />
          )}
          <button
            className="btn"
            onClick={() => {
              remember(show);
              nav(showPath(show.id));
            }}
          >
            <Info size={17} /> Details
          </button>
        </div>
        {slides.length > 1 && (
          <div className="hero__dots" role="tablist" aria-label="Featured">
            {slides.map((s, n) => (
              <button key={s.show.id} role="tab" aria-selected={n === i} aria-label={s.show.title} className={n === i ? 'on' : ''} onClick={() => setI(n)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function Home() {
  const entries = useLibrary((s) => s.entries);
  const recs = useRecommendations();
  const list = useMemo(() => Object.values(entries), [entries]);

  const watching = useMemo(
    () => list.filter((e) => e.status === 'watching').sort((a, b) => (b.lastWatchedAt ?? b.updatedAt).localeCompare(a.lastWatchedAt ?? a.updatedAt)),
    [list],
  );
  const watchlist = useMemo(() => list.filter((e) => e.status === 'plan').sort((a, b) => b.addedAt.localeCompare(a.addedAt)), [list]);
  const onHold = useMemo(() => list.filter((e) => e.status === 'on_hold'), [list]);
  const finished = useMemo(
    () => list.filter((e) => e.status === 'completed').sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)),
    [list],
  );

  // The billboard is about *your* shows: what you're in the middle of, then what you finished last.
  // Recommendations only fill it while the library is empty.
  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = watching.slice(0, 3).map((e) => ({ show: e.show, kind: 'continue' as const, entry: e }));
    for (const e of finished.slice(0, 5 - out.length)) out.push({ show: e.show, kind: 'watched', entry: e });
    if (!out.length) for (const r of recs.output?.picks.slice(0, 5) ?? []) out.push({ show: r.show, kind: 'rec', rec: r });
    return out;
  }, [watching, finished, recs.output]);

  const shelves = recs.shelves;
  const empty = list.length === 0;

  return (
    <div className="home">
      {slides.length ? <Hero slides={slides} /> : <div style={{ height: 40 }} />}
      <div className="home-banner">
        <NewEpisodesBanner />
      </div>

      {empty && (
        <div className="page" style={{ paddingTop: 0 }}>
          <div className="panel panel--pad onboard-cta">
            <div>
              <div className="label">Your library is empty</div>
              <h2 className="section-title" style={{ margin: '6px 0' }}>
                Bring your history in
              </h2>
              <p className="dim" style={{ margin: 0 }}>
                Pull everything from your Google Sheet, or tell Dealo what you love and it will start recommending immediately.
              </p>
            </div>
            <div className="cluster">
              <Link to="/settings/import" className="btn btn--primary">
                <Upload size={16} /> Import from Google Sheets
              </Link>
              <Link to="/welcome" className="btn">
                <Sparkles size={16} /> Calibrate my taste
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Your shows first — Watched, Currently watching, Watchlist. Recommendations are the extra below. */}
      {finished.length > 0 && (
        <Row title="Watched" count={finished.length} more="/library/completed">
          {finished.slice(0, 30).map((e) => (
            <ShowCard key={e.id} show={e.show} showStatus={false} />
          ))}
        </Row>
      )}

      {watching.length > 0 && (
        <Row title="Currently watching" count={watching.length} more="/library/watching">
          {watching.map((e) => (
            <WatchingCard key={e.id} entry={e} />
          ))}
        </Row>
      )}

      {watchlist.length > 0 && (
        <Row title="Your watchlist" count={watchlist.length} more="/library/plan">
          {watchlist.slice(0, 30).map((e) => (
            <ShowCard key={e.id} show={e.show} showStatus={false} />
          ))}
        </Row>
      )}

      {onHold.length > 0 && (
        <Row title="On hold" count={onHold.length} more="/library/on_hold">
          {onHold.map((e) => (
            <ShowCard key={e.id} show={e.show} showStatus={false} />
          ))}
        </Row>
      )}

      {(shelves.length > 0 || recs.stage !== 'ready') && (
        <div className="home-divider">
          <div>
            <h2 className="home-divider__title">
              <Sparkles size={16} /> Discover more
            </h2>
            <p className="home-divider__sub">Recommendations based on what you've watched and rated.</p>
          </div>
          <Link className="btn btn--sm" to="/discover">
            All picks
          </Link>
        </div>
      )}

      {recs.stage !== 'ready' && !recs.output && (
        <div className="loading-line">
          <div className="spinner" /> {recs.stage === 'error' ? `Recommendations unavailable: ${recs.error}` : `Computing recommendations · ${recs.stage}…`}
        </div>
      )}

      {shelves.slice(0, 4).map((s) => (
        <Row key={s.id} title={s.title} sub={s.subtitle} more={s.id === 'picks' ? '/discover' : undefined}>
          {s.items.map((r) => (
            <ShowCard key={r.show.id} show={r.show} rec={r} />
          ))}
        </Row>
      ))}

      {!empty && watching.length === 0 && (
        <div className="page">
          <div className="note">
            <Play size={16} /> Mark a show as <b>Watching</b> and tick episodes off — it'll appear in “Continue watching” with a one-tap “watched next episode”.
          </div>
        </div>
      )}
      <Attribution />
    </div>
  );
}

export function Attribution() {
  return (
    <footer className="attribution">
      <span>Dealo TV · your data stays in this browser</span>
      <span>
        Metadata: <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">TMDB</a> (this product uses the TMDB API but is not endorsed or certified by TMDB) ·{' '}
        <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer">TVmaze</a> (CC BY-SA) · Streaming data by JustWatch
      </span>
    </footer>
  );
}
