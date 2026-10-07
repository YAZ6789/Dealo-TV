import { Link } from 'react-router-dom';
import { Ban, Check, Plus, ThumbsUp } from 'lucide-react';
import type { LibraryEntry, Recommendation, ShowSummary } from '../types';
import { useLibrary } from '../store/library';
import { progressOf } from '../lib/progress';
import { remember, showPath } from '../lib/showCache';
import { STATUS_LABEL } from '../lib/labels';
import { useShowActions } from '../hooks/useShowActions';
import { Poster } from './Poster';
import { STATUS_ICON } from './StatusMenu';

export function matchClass(m: number) {
  return m >= 75 ? 'match' : m >= 55 ? 'match match--mid' : 'match match--low';
}

export function ShowCard({ show, rec, showStatus = true }: { show: ShowSummary; rec?: Recommendation; showStatus?: boolean }) {
  const entry = useLibrary((s) => s.entries[show.id]) as LibraryEntry | undefined;
  const liked = useLibrary((s) => s.feedback[show.id]?.value === 1);
  const actions = useShowActions();
  const p = entry && entry.status === 'watching' ? progressOf(entry) : undefined;
  const StatusIcon = entry ? STATUS_ICON[entry.status] : undefined;
  const reason = rec?.reasons.find((r) => r.kind === 'because') ?? rec?.reasons[0];

  return (
    <div className="card">
      <div className="card__poster">
        <Poster show={show} />
        <Link to={showPath(show.id)} onClick={() => remember(show)} className="card__link" aria-label={show.title} />
        {rec && <span className="card__corner">{rec.match}%</span>}
        {!rec && entry?.rating != null && <span className="card__corner">{entry.rating}</span>}
        {showStatus && StatusIcon && (
          <span className="card__badge tag tag--accent" title={STATUS_LABEL[entry!.status]}>
            <StatusIcon size={11} /> {STATUS_LABEL[entry!.status]}
          </span>
        )}
        {p && p.total > 0 && (
          <span className="card__progress">
            <span className="bar">
              <span className="bar__fill" style={{ width: `${p.pct}%` }} />
            </span>
          </span>
        )}
        <span className="card__overlay">
          {reason && <span className="card__reason">{reason.label}</span>}
          {!entry && (
            <span className="card__actions">
              <button className="btn" title="Add to watchlist" aria-label="Add to watchlist" onClick={() => actions.watchlist(show)}>
                <Plus size={15} />
              </button>
              <button className="btn" title="Already watched" aria-label="Already watched" onClick={() => actions.seen(show)}>
                <Check size={15} />
              </button>
              {rec && (
                <button className={`btn ${liked ? 'btn--on' : ''}`} title="More like this" aria-label="More like this" onClick={() => actions.moreLikeThis(show)}>
                  <ThumbsUp size={14} />
                </button>
              )}
              <button className="btn" title="Not interested — don't recommend" aria-label="Not interested" onClick={() => actions.notInterested(show)}>
                <Ban size={14} />
              </button>
            </span>
          )}
        </span>
      </div>
      <div className="card__body">
        <div className="card__title" title={show.title}>
          {show.title}
        </div>
        <div className="card__meta">
          {rec ? <span className={matchClass(rec.match)}>{rec.match}% match</span> : show.year ? <span>{show.year}</span> : null}
          {p?.next ? <span>next S{p.next.season}E{p.next.episode}</span> : show.rating ? <span>★ {show.rating.toFixed(1)}</span> : null}
        </div>
      </div>
    </div>
  );
}
