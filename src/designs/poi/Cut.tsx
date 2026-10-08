import { useEffect, useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Item } from '../useCollections';
import { Poster } from '../../components/Poster';
import { KIND, camFor, kindOf, timecodeFor } from './logic';

export interface CutSpec {
  /** Changes on every cut so a new sequence restarts its animations. */
  id: number;
  mode: 'in' | 'out';
  subject?: Item;
  /** Where the subject's feed sits on the wall (the zoom starts there). */
  from?: { left: number; top: number; width: number; height: number };
  frames: Item[];
}

/** Total length of each sequence (ms) — keep in sync with poi.css. */
export const CUT_MS = { in: 560, out: 190 } as const;

/**
 * The show's signature editorial cut, played over everything:
 *   in  — hard cuts through two other feeds (with tearing), a frame of white
 *         static, then a stepped zoom into the subject while the tracking box
 *         snaps down and locks. ≈560 ms.
 *   out — static, one other feed, back to the wall. ≈190 ms.
 * Any tap or key skips straight to the end (the parent handles keys).
 */
export function Cut({ spec, onDone }: { spec: CutSpec; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, CUT_MS[spec.mode]);
    return () => clearTimeout(t);
  }, [spec.id, spec.mode, onDone]);

  const zoom = useMemo(() => {
    if (spec.mode !== 'in') return undefined;
    const vw = innerWidth;
    const vh = innerHeight;
    const h = Math.min(vh * 0.8, vw * 0.92 * 1.5);
    const w = h / 1.5;
    const left = (vw - w) / 2;
    const top = (vh - h) / 2;
    const f = spec.from;
    const style = {
      left,
      top,
      width: w,
      height: h,
      '--from': f ? `translate(${f.left - left}px, ${f.top - top}px) scale(${f.width / w}, ${f.height / h})` : 'scale(0.55)',
    } as CSSProperties;
    return style;
  }, [spec]);

  const subject = spec.subject;
  const kind = subject ? kindOf(subject) : 'suggest';

  return createPortal(
    <div className={`poi-theme poi-cut poi-cut--${spec.mode} ${spec.frames.length < 2 ? 'poi-cut--few' : ''}`} aria-hidden onPointerDown={onDone}>
      {spec.frames.map((f, i) => (
        <div key={f.show.id + i} className={`poi-cut__frame poi-cut__frame--${i ? 'b' : 'a'}`}>
          <div className="poi-cut__img">
            <Poster show={f.show} variant="wide" eager />
          </div>
          <div className="poi-cut__osd">
            <span>
              <i className="poi-rec" /> {camFor(f.show.id)}
            </span>
            <span>{timecodeFor(f.show.id, i * 7)}</span>
          </div>
        </div>
      ))}
      <div className="poi-cut__static" />
      {subject && zoom && (
        <div className={`poi-cut__subject poi-tone--${KIND[kind].tone}`}>
          <div className="poi-cut__zoom" style={zoom}>
            <div className="poi-cut__img">
              <Poster show={subject.show} eager />
            </div>
            <div className="poi-cut__osd">
              <span>
                <i className="poi-rec" /> {camFor(subject.show.id)}
              </span>
              <span>{timecodeFor(subject.show.id)}</span>
            </div>
            <div className="poi-cut__box">
              <span className="poi-box__tag">{KIND[kind].code}</span>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
