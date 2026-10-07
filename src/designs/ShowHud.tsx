import { Link } from 'react-router-dom';
import { Ban, CheckCheck, Info, ThumbsUp } from 'lucide-react';
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

/** Holographic data readout for the focused show (used by the immersive designs). */
export function ShowHud({ item, side = 'full' }: { item: Item; side?: 'full' | 'info' | 'actions' }) {
  const entry = useLibrary((s) => s.entries[item.show.id]) ?? item.entry;
  const toggleEpisode = useLibrary((s) => s.toggleEpisode);
  const actions = useShowActions();
  const { show, rec } = item;
  useAmbientShow(show);
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

  if (side === 'info') return info;
  if (side === 'actions') return act;
  return (
    <>
      {info}
      {act}
    </>
  );
}
