import { memo } from 'react';
import type { Item } from '../useCollections';
import { Poster } from '../../components/Poster';
import { prefetchArtwork } from '../../providers/artwork';
import { fmtEp, progressOf } from '../../lib/progress';
import { yearRange } from '../../lib/labels';
import { KIND, camFor, kindOf, timecodeFor, type FeedKind } from './logic';

/** Short tag printed on the tracking box. */
export function boxTag(item: Item, kind: FeedKind): string {
  const e = item.entry;
  if (kind === 'active' && e) {
    const p = progressOf(e);
    return p.next ? `ACTIVE · ${fmtEp(p.next)}` : 'ACTIVE';
  }
  if (kind === 'closed') return e?.rating != null ? `CLOSED · ★${e.rating}` : 'CLOSED';
  if (kind === 'incoming') return 'INCOMING';
  if (kind === 'dormant') return 'DORMANT';
  if (kind === 'threat') return 'THREAT';
  if (item.rec) return item.rec.exploratory ? 'WILDCARD' : `${item.rec.match}% MATCH`;
  return 'UNKNOWN';
}

/** One line of plain facts under the feed. */
function metaLine(item: Item, kind: FeedKind): string {
  const e = item.entry;
  if (e && (kind === 'active' || kind === 'dormant')) {
    const p = progressOf(e);
    if (p.total) return `${p.watched}/${p.total} episodes`;
  }
  if (kind === 'closed' && e) return [e.rating != null ? `Rated ${e.rating}/10` : 'Unrated', yearRange(item.show)].filter(Boolean).join(' · ');
  if (item.rec) return [`${item.rec.match}% match`, yearRange(item.show)].filter(Boolean).join(' · ');
  return [yearRange(item.show), item.show.networks?.[0]].filter(Boolean).join(' · ');
}

/**
 * A show as a CCTV feed: monochrome footage, camera id + timecode, and the
 * Machine's tracking box coloured by what the show is to you.
 */
export const Feed = memo(function Feed({ item, eager, onOpen, small }: { item: Item; eager?: boolean; small?: boolean; onOpen: (item: Item, el: HTMLElement) => void }) {
  const kind = kindOf(item);
  const meta = KIND[kind];
  const e = item.entry;
  const p = e && (kind === 'active' || kind === 'dormant') ? progressOf(e) : undefined;
  const tag = boxTag(item, kind);
  const line = metaLine(item, kind);
  return (
    <button
      type="button"
      className={`poi-feed poi-feed--${kind} poi-tone--${meta.tone} ${meta.dashed ? 'poi-feed--dashed' : ''} ${small ? 'poi-feed--small' : ''}`}
      data-poi-feed=""
      data-poi-id={item.show.id}
      aria-label={`${item.show.title}. ${meta.plain}. ${line}. Open file.`}
      onClick={(ev) => onOpen(item, ev.currentTarget)}
      onPointerEnter={() => prefetchArtwork([item.show], 'backdrop')}
      onFocus={() => prefetchArtwork([item.show], 'backdrop')}
    >
      <span className="poi-feed__screen">
        <span className="poi-feed__img">
          <Poster show={item.show} variant="wide" eager={eager} />
        </span>
        <span className="poi-feed__fx" aria-hidden />
        <span className="poi-feed__osd" aria-hidden>
          <span>
            <i className="poi-rec" /> {camFor(item.show.id)}
          </span>
          {!small && <span>{timecodeFor(item.show.id)}</span>}
        </span>
        <span className="poi-box" aria-hidden>
          <span className="poi-box__tag">{tag}</span>
        </span>
        {p && p.total > 0 && (
          <span className="poi-feed__bar" aria-hidden>
            <i style={{ width: `${p.pct}%` }} />
          </span>
        )}
      </span>
      <span className="poi-feed__cap">
        <span className="poi-feed__title">{item.show.title}</span>
        <span className="poi-feed__meta">{line}</span>
      </span>
    </button>
  );
});
