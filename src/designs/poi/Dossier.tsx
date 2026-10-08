import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCheck, ChevronLeft, ChevronRight, Info, Play, Plus } from 'lucide-react';
import type { Item } from '../useCollections';
import { useLibrary } from '../../store/library';
import { useShowActions } from '../../hooks/useShowActions';
import { Poster } from '../../components/Poster';
import { StatusMenu } from '../../components/StatusMenu';
import { RatingInput } from '../../components/RatingInput';
import { toast } from '../../components/toast';
import { prefetchArtwork } from '../../providers/artwork';
import { fmtEp, progressOf } from '../../lib/progress';
import { relTime, yearRange } from '../../lib/labels';
import { remember, showPath } from '../../lib/showCache';
import { GENRE_LABELS } from '../../lib/genres';
import { KIND, camFor, coordsFor, kindOf, lastSeen, seasonLog, ssnFor, timecodeFor } from './logic';

/**
 * The subject's file: a big surveillance still with the locked tracking box,
 * the Machine's facts, a per-episode surveillance log and one obvious next
 * action. Full-screen sheet on phones; swipe (or ← →) between subjects.
 */
export function Dossier({
  list,
  index,
  sectionLabel,
  onIndex,
  onClose,
  fade,
}: {
  list: Item[];
  index: number;
  sectionLabel: string;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Reduced motion: cross-fade instead of cutting. */
  fade: boolean;
}) {
  const item = list[Math.min(index, list.length - 1)];
  const show = item.show;
  const entry = useLibrary((s) => s.entries[show.id]);
  const rate = useLibrary((s) => s.rate);
  const toggleEpisode = useLibrary((s) => s.toggleEpisode);
  const actions = useShowActions();
  const back = useRef<HTMLButtonElement>(null);
  const kind = kindOf({ rec: item.rec, entry });
  const meta = KIND[kind];
  const p = entry ? progressOf(entry) : undefined;
  const seen = entry ? lastSeen(entry) : undefined;
  const log = entry ? seasonLog(entry) : [];
  const n = list.length;
  const go = (d: number) => {
    const i = index + d;
    if (i >= 0 && i < n) onIndex(i);
  };

  // focus in on open, back out (to the wall) on close
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    back.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // pictures for the neighbours are ready before you swipe to them
  useEffect(() => {
    prefetchArtwork([list[index + 1], list[index - 1], list[index + 2]].filter(Boolean).map((x) => x!.show), 'backdrop');
  }, [list, index]);

  // keys: Esc back to the wall, ← → between subjects (not while a menu is open or typing)
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (document.querySelector('.menu')) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (t?.closest('[role="radiogroup"]')) return;
        e.preventDefault();
        goRef.current(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    // capture: runs before the status menu's own Esc handler closes it, so Esc closes only the menu
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [onClose]);

  // horizontal swipe between subjects; vertical stays a scroll
  const swipe = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    swipe.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4 && performance.now() - s.t < 700) go(dx < 0 ? 1 : -1);
  };

  const canTick = !!(entry && entry.status === 'watching' && p?.next && entry.seasonSizes?.length);
  const tick = () => {
    if (!entry || !p?.next) return;
    const { season, episode } = p.next;
    toggleEpisode(entry.id, season, episode);
    toast(`✓ ${show.title} ${fmtEp(p.next)}`, { label: 'Undo', run: () => toggleEpisode(entry.id, season, episode) });
  };

  const seenWhen = entry?.lastWatchedAt ?? entry?.completedAt;
  const facts: [string, React.ReactNode][] = [
    ['SSN', <span className="mono">{ssnFor(show.id)}</span>],
    [
      'Status',
      <>
        <span className={`poi-chip poi-tone--${meta.tone}`}>{meta.code}</span> {meta.plain}
      </>,
    ],
  ];
  if (entry) facts.push(['Last seen', seen ? `${fmtEp(seen)}${seenWhen ? ` · ${relTime(seenWhen)}` : ''}` : 'Not yet sighted']);
  if (p?.next && entry?.status !== 'completed') facts.push(['Next', fmtEp(p.next)]);
  if (item.rec && !entry) facts.push(['Match', `${item.rec.match}%${item.rec.exploratory ? ' · wildcard' : ''}`]);
  if (show.networks?.[0]) facts.push(['Network', show.networks[0]]);
  if (yearRange(show)) facts.push(['Active', yearRange(show)]);
  if (show.seasonCount) facts.push(['Record', `${show.seasonCount} season${show.seasonCount > 1 ? 's' : ''}${show.episodeCount ? ` · ${show.episodeCount} episodes` : ''}`]);
  if (show.genres.length) facts.push(['Profile', show.genres.slice(0, 3).map((g) => GENRE_LABELS[g]).join(' · ')]);

  const reasons = item.rec && !entry ? item.rec.reasons.slice(0, 4) : [];

  return createPortal(
    <div className={`poi-theme poi-dossier ${fade ? 'poi-dossier--fade' : ''}`} role="dialog" aria-modal="true" aria-label={`File: ${show.title}`}>
      <div className="poi-dossier__scrim" onClick={onClose} />
      <article className="poi-dossier__sheet" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipe.current = null)}>
        <header className="poi-dossier__bar">
          <button ref={back} type="button" className="poi-btn poi-btn--ghost" onClick={onClose} aria-label="Back to the wall">
            <ArrowLeft size={16} /> <span>Wall</span>
          </button>
          <span className="poi-dossier__count" aria-live="polite">
            {sectionLabel} · {String(index + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
          </span>
          <span className="poi-dossier__nav">
            <button type="button" className="poi-btn poi-btn--icon" onClick={() => go(-1)} disabled={index <= 0} aria-label="Previous subject">
              <ChevronLeft size={18} />
            </button>
            <button type="button" className="poi-btn poi-btn--icon" onClick={() => go(1)} disabled={index >= n - 1} aria-label="Next subject">
              <ChevronRight size={18} />
            </button>
          </span>
        </header>

        <div className={`poi-dossier__still poi-tone--${meta.tone} ${meta.dashed ? 'poi-feed--dashed' : ''}`} key={`still-${show.id}`} aria-hidden>
          <div className="poi-dossier__img">
            <Poster show={show} variant="wide" eager />
          </div>
          <span className="poi-feed__fx" />
          <span className="poi-dossier__osd poi-dossier__osd--tl">
            <i className="poi-rec" /> REC · {camFor(show.id)}
          </span>
          <span className="poi-dossier__osd poi-dossier__osd--tr">{timecodeFor(show.id)}</span>
          <span className="poi-dossier__osd poi-dossier__osd--bl">{coordsFor(show.id)}</span>
          <span className="poi-dossier__osd poi-dossier__osd--br">ZOOM 2.4×</span>
          <span className="poi-box poi-box--locked">
            <span className="poi-box__tag">{meta.code}</span>
          </span>
        </div>

        <div className="poi-dossier__file" key={`file-${show.id}`}>
          <p className="poi-file__kicker" aria-hidden>
            SUBJECT FILE · {camFor(show.id)}
          </p>
          <h2 className="poi-file__name">{show.title}</h2>

          <dl className="poi-file__facts">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          {entry && (
            <section className="poi-file__block" aria-label="Your rating">
              <h3 className="poi-file__h">Your rating</h3>
              <RatingInput value={entry.rating} onChange={(v) => rate(entry.id, v)} />
            </section>
          )}

          {entry && (p?.total || log.length) ? (
            <section className="poi-file__block" aria-label="Surveillance log">
              <h3 className="poi-file__h">
                Surveillance log{' '}
                <span>
                  {p!.watched}/{p!.total} · {p!.pct}%
                </span>
              </h3>
              {log.length && log.reduce((a, r) => a + r.eps.length, 0) <= 160 ? (
                <div className="poi-log" aria-hidden>
                  {log.map((r) => (
                    <div key={r.season} className="poi-log__row">
                      <span className="poi-log__s">S{r.season}</span>
                      <span className="poi-log__eps">
                        {r.eps.map((on, e) => (
                          <i key={e} className={`${on ? 'on' : ''} ${p?.next && p.next.season === r.season && p.next.episode === e + 1 && entry.status !== 'completed' ? 'next' : ''}`} />
                        ))}
                      </span>
                      <span className="poi-log__n">
                        {r.watched}/{r.eps.length}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="poi-meter" aria-hidden>
                  <i style={{ width: `${p?.pct ?? 0}%` }} />
                </span>
              )}
            </section>
          ) : null}

          {(show.overview || reasons.length > 0) && (
            <section className="poi-file__block" aria-label="Intel">
              <h3 className="poi-file__h">Intel</h3>
              {reasons.length > 0 && (
                <ul className="poi-file__reasons">
                  {reasons.map((r) => (
                    <li key={r.label}>{r.label}</li>
                  ))}
                </ul>
              )}
              {show.overview && <p className="poi-file__overview">{show.overview}</p>}
            </section>
          )}
        </div>

        <footer className="poi-dossier__actions">
          {canTick ? (
            <button type="button" className="poi-btn poi-btn--primary" onClick={tick}>
              <CheckCheck size={16} /> Watched {fmtEp(p!.next)}
            </button>
          ) : entry?.status === 'plan' ? (
            <button type="button" className="poi-btn poi-btn--primary" onClick={() => actions.setStatus(show, 'watching')}>
              <Play size={15} /> Start watching
            </button>
          ) : !entry ? (
            <button type="button" className="poi-btn poi-btn--primary" onClick={() => actions.watchlist(show)}>
              <Plus size={16} /> Watchlist
            </button>
          ) : null}
          <StatusMenu show={show} />
          <Link to={showPath(show.id)} onClick={() => remember(show)} className="poi-btn">
            <Info size={15} /> Details
          </Link>
          {!entry && item.rec && (
            <button
              type="button"
              className="poi-btn poi-btn--icon poi-btn--threat"
              title="Not interested"
              aria-label="Not interested"
              onClick={() => {
                actions.notInterested(show);
                onClose();
              }}
            >
              <Ban size={16} />
            </button>
          )}
        </footer>
      </article>
    </div>,
    document.body,
  );
}
