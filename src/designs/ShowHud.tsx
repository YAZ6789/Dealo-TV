import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Ban, CheckCheck, ChevronUp, Clock, Info, ThumbsUp, X } from 'lucide-react';
import type { Item } from './useCollections';
import { useLibrary } from '../store/library';
import { useShowActions } from '../hooks/useShowActions';
import { GENRE_LABELS } from '../lib/genres';
import { fmtEp, progressOf } from '../lib/progress';
import { STATUS_LABEL, yearRange } from '../lib/labels';
import { remember, showPath } from '../lib/showCache';
import { StatusMenu } from '../components/StatusMenu';
import { Ring } from '../components/charts';
import { toast } from '../components/toast';
import { useAmbientShow } from '../lib/ambient';
import { useSettings } from '../store/settings';

/** Live `matchMedia` flag. */
export function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const h = () => setOn(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return on;
}

/**
 * Procedural poster art prints the title big; on small cards a long word
 * ("SEVERANCE", "YELLOWJACKETS") would be clipped mid-word. Shrink each
 * title under `root` until its longest word fits the card.
 */
export function useFitArtTitles(root: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => {
      for (const t of el.querySelectorAll<HTMLElement>('.art__title')) {
        t.style.fontSize = '';
        let size = parseFloat(getComputedStyle(t).fontSize);
        for (let i = 0; i < 12 && t.scrollWidth > t.clientWidth + 1 && size > 7; i++) {
          size *= 0.9;
          t.style.fontSize = `${size.toFixed(1)}px`;
        }
      }
    };
    fit();
    // fonts and lazily swapped artwork can land after the first pass
    const id = setTimeout(fit, 600);
    void document.fonts?.ready.then(fit);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Phone layout for the immersive designs (same breakpoint as the bottom tab bar). */
export const useCompact = () => useMedia('(max-width: 860px)');

/**
 * True when continuous decoration should stop: the "Reduce background effects"
 * setting, the OS reduced-motion preference, or a touch-first device (battery).
 */
export function useCalmFx() {
  const reduceFx = useSettings((s) => s.reduceFx);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const touch = useMedia('(hover: none) and (pointer: coarse)');
  return reduceFx || reduced || touch;
}

/**
 * Holographic data readout for the focused show (used by the immersive designs).
 * `compact` is the one-glance phone strip (status, title, progress, primary
 * action); `onMore` adds a button that opens the full readout (see HudSheet).
 */
export function ShowHud({
  item,
  side = 'full',
  onMore,
  ambient = true,
}: {
  item: Item;
  side?: 'full' | 'info' | 'actions' | 'compact';
  onMore?: () => void;
  /** Tint the app background with this show's colours (off for a second, stacked readout). */
  ambient?: boolean;
}) {
  const entry = useLibrary((s) => s.entries[item.show.id]) ?? item.entry;
  const toggleEpisode = useLibrary((s) => s.toggleEpisode);
  const actions = useShowActions();
  const { show, rec } = item;
  useAmbientShow(ambient ? show : null);
  const p = entry ? progressOf(entry) : undefined;
  const because = rec?.reasons.find((r) => r.kind === 'because');
  const traits = rec?.reasons.filter((r) => r.kind !== 'because').slice(0, 4) ?? [];

  const info = (
    <div className="hud-info">
      <div className="hud-eyebrow">{entry ? STATUS_LABEL[entry.status] : because ? because.label : rec?.exploratory ? 'Outside your usual' : 'Recommended'}</div>
      <h2 className="hud-title">{show.title}</h2>
      <div className="hud-meta">
        {yearRange(show) && <span>{yearRange(show)}</span>}
        {show.seasonCount ? <span>{show.seasonCount} season{show.seasonCount > 1 ? 's' : ''}</span> : null}
        {show.networks?.[0] && <span>{show.networks[0]}</span>}
        {show.rating ? <span>★ {show.rating.toFixed(1)}</span> : null}
      </div>
      <div className="chips">
        {show.genres.slice(0, 3).map((g) => (
          <span key={g} className="chip chip--sm">
            {GENRE_LABELS[g]}
          </span>
        ))}
      </div>
      {show.overview && <p className="hud-overview">{show.overview}</p>}
    </div>
  );

  const act = (
    <div className="hud-actions">
      {rec && (
        <div className="hud-match">
          <Ring value={rec.match} label="Match" size={86} />
          <div>
            <div className="label">Match</div>
            {traits.length > 0 && (
              <ul className="hud-reasons">
                {traits.map((r) => (
                  <li key={r.label}>{r.label}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {entry?.rating != null && (
        <div className="hud-stat">
          <span className="label">Your rating</span>
          <span className="hud-stat__v">{entry.rating}/10</span>
        </div>
      )}
      {p && p.total > 0 && entry?.status !== 'plan' && (
        <div className="hud-stat">
          <span className="label">
            Progress · {p.watched}/{p.total}
          </span>
          <span className="bar">
            <span className="bar__fill" style={{ width: `${p.pct}%` }} />
          </span>
          {p.next && <span className="hint">Next {fmtEp(p.next)}</span>}
        </div>
      )}
      <div className="cluster">
        {entry && p?.next && entry.seasonSizes?.length && entry.status === 'watching' ? (
          <button
            className="btn btn--primary btn--sm"
            onClick={() => {
              toggleEpisode(entry.id, p.next!.season, p.next!.episode);
              toast(`✓ ${show.title} ${fmtEp(p.next)}`, { label: 'Undo', run: () => toggleEpisode(entry.id, p.next!.season, p.next!.episode) });
            }}
          >
            <CheckCheck size={14} /> {fmtEp(p.next)}
          </button>
        ) : null}
        <StatusMenu show={show} primary={!entry} />
        <Link to={showPath(show.id)} onClick={() => remember(show)} className="btn btn--sm">
          <Info size={14} /> Details
        </Link>
        {rec && !entry && (
          <>
            <button className="btn btn--sm btn--icon" title="More like this" onClick={() => actions.moreLikeThis(show)}>
              <ThumbsUp size={14} />
            </button>
            <button className="btn btn--sm btn--icon" title="Not interested" onClick={() => actions.notInterested(show)}>
              <Ban size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );

  if (side === 'compact') {
    const canTick = !!(entry && p?.next && entry.seasonSizes?.length && entry.status === 'watching');
    const eyebrow = [
      entry ? STATUS_LABEL[entry.status] : because ? because.label : rec?.exploratory ? 'Outside your usual' : 'Recommended',
      entry?.rating != null ? `★ ${entry.rating}/10` : rec ? `${rec.match}% match` : null,
    ].filter(Boolean);
    const text = (
      <>
        <span className="hud-eyebrow hud-compact__eyebrow">{eyebrow.join(' · ')}</span>
        <span className="hud-title hud-compact__title">{show.title}</span>
        {p && p.total > 0 && entry?.status !== 'plan' ? (
          <span className="hud-compact__progress">
            <span className="bar">
              <span className="bar__fill" style={{ width: `${p.pct}%` }} />
            </span>
            <span className="mono">
              {p.watched}/{p.total}
              {p.next && entry?.status === 'watching' ? ` · next ${fmtEp(p.next)}` : ''}
            </span>
          </span>
        ) : (
          <span className="hud-meta">
            {yearRange(show) && <span>{yearRange(show)}</span>}
            {show.seasonCount ? <span>{show.seasonCount} season{show.seasonCount > 1 ? 's' : ''}</span> : null}
            {show.networks?.[0] && <span>{show.networks[0]}</span>}
          </span>
        )}
      </>
    );
    return (
      <div className="hud-compact">
        {onMore ? (
          <button type="button" className="hud-compact__text" onClick={onMore} aria-label={`${show.title}: more info`}>
            {text}
          </button>
        ) : (
          <div className="hud-compact__text">{text}</div>
        )}
        <div className="hud-compact__actions">
          {canTick ? (
            <button
              className="btn btn--primary btn--sm"
              onClick={() => {
                toggleEpisode(entry!.id, p!.next!.season, p!.next!.episode);
                toast(`✓ ${show.title} ${fmtEp(p!.next)}`, { label: 'Undo', run: () => toggleEpisode(entry!.id, p!.next!.season, p!.next!.episode) });
              }}
            >
              <CheckCheck size={15} /> {fmtEp(p!.next)}
            </button>
          ) : !entry ? (
            <button className="btn btn--primary btn--sm" onClick={() => actions.watchlist(show)}>
              <Clock size={15} /> Watchlist
            </button>
          ) : null}
          <Link to={showPath(show.id)} onClick={() => remember(show)} className="btn btn--sm hud-compact__details" aria-label="Details">
            <Info size={15} /> <span className="hud-compact__label">Details</span>
          </Link>
          {onMore && (
            <button type="button" className="btn btn--sm btn--icon" onClick={onMore} aria-label="More about this show" title="More">
              <ChevronUp size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }
  if (side === 'info') return info;
  if (side === 'actions') return act;
  return (
    <>
      {info}
      {act}
    </>
  );
}

/**
 * Full readout as a sheet between the top bar and the bottom tab bar (phones).
 * Closes on the X, a tap outside, or Escape; focus moves in and back out.
 */
export function HudSheet({ item, onClose, children }: { item: Item; onClose: () => void; children?: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.menu')) {
        e.stopPropagation();
        onClose();
      }
    };
    addEventListener('keydown', k);
    return () => {
      removeEventListener('keydown', k);
      before?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return createPortal(
    <div className="hud-sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="hud-sheet" role="dialog" aria-modal="true" aria-label={item.show.title}>
        <button ref={close} className="btn btn--icon hud-sheet__close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        {children}
        <ShowHud key={item.show.id} item={item} ambient={false} />
      </section>
    </div>,
    document.body,
  );
}
