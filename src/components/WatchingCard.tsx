import { Link } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import type { LibraryEntry } from '../types';
import { useLibrary } from '../store/library';
import { fmtEp, progressOf } from '../lib/progress';
import { remember, showPath } from '../lib/showCache';
import { relTime } from '../lib/labels';
import { toast } from './toast';
import { Poster } from './Poster';

/** Landscape "continue watching" card with a one-tap "watched next episode". */
export function WatchingCard({ entry }: { entry: LibraryEntry }) {
  const toggleEpisode = useLibrary((s) => s.toggleEpisode);
  const p = progressOf(entry);
  return (
    <div className="wcard">
      <Link to={showPath(entry.id)} onClick={() => remember(entry.show)} className="wcard__media" aria-label={entry.show.title}>
        <Poster show={entry.show} variant="wide" />
        <span className="wcard__shade" />
        <span className="wcard__info">
          <span className="wcard__title">{entry.show.title}</span>
          <span className="wcard__next">
            <span>{p.next ? `Next ${fmtEp(p.next)}` : p.caughtUp ? 'Caught up' : 'In progress'}</span>
            <span>{p.total ? `${p.watched}/${p.total}` : relTime(entry.lastWatchedAt)}</span>
          </span>
          {p.total > 0 && (
            <span className="bar">
              <span className="bar__fill" style={{ width: `${p.pct}%` }} />
            </span>
          )}
        </span>
      </Link>
      {p.next && entry.seasonSizes?.length ? (
        <button
          className="btn btn--sm wcard__play"
          onClick={() => {
            toggleEpisode(entry.id, p.next!.season, p.next!.episode);
            toast(`✓ ${entry.show.title} ${fmtEp(p.next)}`, { label: 'Undo', run: () => toggleEpisode(entry.id, p.next!.season, p.next!.episode) });
          }}
          title={`Mark ${fmtEp(p.next)} watched`}
        >
          <CheckCheck size={14} /> {fmtEp(p.next)}
        </button>
      ) : null}
    </div>
  );
}
