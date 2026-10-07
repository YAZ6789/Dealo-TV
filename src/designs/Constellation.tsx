import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crosshair, Minus, Plus, X } from 'lucide-react';
import { useLibrary } from '../store/library';
import { useRecommendations } from '../hooks/useRecommendations';
import { GENRE_LABELS } from '../lib/genres';
import { STATUS_LABEL } from '../lib/labels';
import { remember, showPath } from '../lib/showCache';
import { Poster } from '../components/Poster';
import { ShowHud } from './ShowHud';
import { layoutSky, R, type StarNode } from './constellationLayout';

/**
 * CONSTELLATION — your taste as a star map. You're the core; your library
 * orbits close (loved = closer), recommendations drift in the discovery field
 * (better match = closer) with beams back to the show that inspired them.
 */

type View = { x: number; y: number; k: number };
const HOME: View = { x: 0, y: 0, k: 1 };
const PAD = 160;

export default function Constellation() {
  const entries = useLibrary((s) => s.entries);
  const recs = useRecommendations();
  const nav = useNavigate();
  const [show, setShow] = useState({ library: true, recs: true, links: true });
  const [hover, setHover] = useState<StarNode | null>(null);
  const [selected, setSelected] = useState<StarNode | null>(null);
  const [view, setView] = useState<View>(HOME);
  // World units per screen pixel at zoom 1 — lets text stay a constant, readable size at any zoom.
  const [unitsPerPx, setUnitsPerPx] = useState(2);
  const svg = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; dist?: number; x: number; y: number; moved: boolean } | null>(null);

  const sky = useMemo(() => {
    const lib = Object.values(entries);
    const r = recs.output ? recs.output.picks.concat(recs.output.ranked.filter((x) => !recs.output!.picks.some((p) => p.show.id === x.show.id))).slice(0, 60) : [];
    return layoutSky(lib, r);
  }, [entries, recs.output]);

  const visible = sky.nodes.filter((n) => (n.kind === 'library' ? show.library : show.recs));
  const byId = useMemo(() => new Map(sky.nodes.map((n) => [n.id, n])), [sky]);
  const focus = hover ?? selected;

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setUnitsPerPx((R * 2 + PAD * 2) / Math.min(r.width, r.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Always label the stars that matter: best matches, loved shows, what you're watching.
  const important = useMemo(() => {
    const ids = new Set<string>();
    const recsByScore = sky.nodes.filter((n) => n.kind === 'rec').sort((a, b) => (b.rec?.score ?? 0) - (a.rec?.score ?? 0));
    recsByScore.slice(0, 8).forEach((n) => ids.add(n.id));
    for (const n of sky.nodes) {
      const e = n.entry;
      if (e && (e.status === 'watching' || e.favorite || (e.rating ?? 0) >= 9)) ids.add(n.id);
    }
    return ids;
  }, [sky]);
  const u = unitsPerPx / view.k; // world units per screen px at the current zoom

  const related = useMemo(() => {
    if (!focus) return new Set<string>();
    const s = new Set<string>([focus.id]);
    for (const l of sky.links) if (l.from === focus.id || l.to === focus.id) s.add(l.from === focus.id ? l.to : l.from);
    return s;
  }, [focus, sky.links]);

  // Greedy label placement: most important first; try below / above / right / left; skip if all collide.
  const labels = useMemo(() => {
    const fs = 12.5 * u;
    const want = visible.filter((n) => view.k > 1.8 || important.has(n.id) || selected?.id === n.id || (focus && related.has(n.id)));
    const prio = (n: StarNode) =>
      (selected?.id === n.id ? 1000 : 0) + (focus?.id === n.id ? 900 : 0) + (important.has(n.id) ? 100 : 0) + (n.rec?.match ?? (n.entry?.rating ?? 6) * 10);
    want.sort((a, b) => prio(b) - prio(a));
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    // stars themselves are obstacles too
    for (const n of visible) boxes.push({ x0: n.x - n.r, y0: n.y - n.r, x1: n.x + n.r, y1: n.y + n.r });
    const out = new Map<string, { x: number; y: number; anchor: 'middle' | 'start' | 'end'; text: string }>();
    for (const n of want) {
      const text = n.show.title.length > 24 ? `${n.show.title.slice(0, 23)}…` : n.show.title;
      const w = text.length * fs * 0.56;
      const h = fs * 1.15;
      const gap = 5 * u;
      const cands = [
        { x: n.x, y: n.y + n.r + gap + fs, anchor: 'middle' as const, x0: n.x - w / 2, y0: n.y + n.r + gap },
        { x: n.x, y: n.y - n.r - gap, anchor: 'middle' as const, x0: n.x - w / 2, y0: n.y - n.r - gap - h },
        { x: n.x + n.r + gap, y: n.y + fs * 0.35, anchor: 'start' as const, x0: n.x + n.r + gap, y0: n.y - h / 2 },
        { x: n.x - n.r - gap, y: n.y + fs * 0.35, anchor: 'end' as const, x0: n.x - n.r - gap - w, y0: n.y - h / 2 },
      ];
      for (const c of cands) {
        const b = { x0: c.x0, y0: c.y0, x1: c.x0 + w, y1: c.y0 + h };
        const hit = boxes.some((o) => !(b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1) && !(o.x0 === n.x - n.r && o.y0 === n.y - n.r));
        if (!hit) {
          boxes.push(b);
          out.set(n.id, { x: c.x - n.x, y: c.y - n.y, anchor: c.anchor, text });
          break;
        }
      }
    }
    return out;
  }, [visible, view.k, u, important, selected, focus, related]);

  /* ── pan / zoom ── */
  const toWorld = (cx: number, cy: number, v = view) => {
    const rect = svg.current!.getBoundingClientRect();
    const size = R * 2 + PAD * 2;
    const scale = size / Math.min(rect.width, rect.height);
    const sx = (cx - rect.left - rect.width / 2) * scale;
    const sy = (cy - rect.top - rect.height / 2) * scale;
    return { x: sx / v.k - v.x, y: sy / v.k - v.y, scale };
  };
  const zoomAt = (cx: number, cy: number, factor: number) => {
    setView((v) => {
      const k = Math.max(0.6, Math.min(6, v.k * factor));
      const w = toWorld(cx, cy, v);
      const rect = svg.current!.getBoundingClientRect();
      const sx = (cx - rect.left - rect.width / 2) * w.scale;
      const sy = (cy - rect.top - rect.height / 2) * w.scale;
      return { k, x: sx / k - w.x, y: sy / k - w.y };
    });
  };

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = {
      view,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : undefined,
    };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && g.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setView({ ...g.view, k: Math.max(0.6, Math.min(6, g.view.k * (d / g.dist))) });
      g.moved = true;
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
    if (!g.moved) return;
    const { scale } = toWorld(e.clientX, e.clientY);
    setView({ ...g.view, x: g.view.x + (dx * scale) / g.view.k, y: g.view.y + (dy * scale) / g.view.k });
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!pointers.current.size) gesture.current = null;
    else {
      // one finger lifted mid-pinch: continue as a pan from the current view
      const [rest] = [...pointers.current.values()];
      gesture.current = { view: viewRef.current, x: rest.x, y: rest.y, moved: true };
      return;
    }
    if (g && !g.moved) {
      // pointer capture retargets pointerup to the <svg>, so hit-test by position
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-star]');
      if (target) {
        const n = byId.get(target.getAttribute('data-star')!);
        if (n) setSelected(n);
      } else setSelected(null);
    }
  };

  const flyTo = (n: StarNode) => setView({ x: -n.x, y: -n.y, k: 2.6 });

  const traits = recs.output?.traits.filter((t) => t.key.startsWith('k:') || t.key.startsWith('g:')).slice(0, 3) ?? [];
  const size = R * 2 + PAD * 2;

  return (
    <div className="sky-stage">
      <svg
        ref={svg}
        className="sky"
        viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label="Star map of your library and recommendations"
      >
        <defs>
          <radialGradient id="sky-core">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="45%" stopColor="var(--accent-2)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" />
          </radialGradient>
          <filter id="sky-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g transform={`scale(${view.k}) translate(${view.x} ${view.y})`} className="sky-world">
          {/* orbits */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <circle key={f} r={R * f} className={`sky-orbit ${f === sky.split ? 'split' : ''}`} />
          ))}
          <text className="sky-ring-label" y={-R * sky.split - 8 * u} textAnchor="middle" style={{ fontSize: 11 * u }}>
            YOUR LIBRARY ▲ ▼ DISCOVERY FIELD
          </text>
          {/* sectors */}
          {sky.sectors.map((s) => (
            <g key={s.key}>
              <line x1={0} y1={0} x2={Math.cos(s.start) * R * 1.04} y2={Math.sin(s.start) * R * 1.04} className="sky-sector" />
              <text
                x={Math.cos(s.mid) * (R + 40)}
                y={Math.sin(s.mid) * (R + 40)}
                textAnchor="middle"
                dominantBaseline="middle"
                className="sky-sector-label"
                style={{ fontSize: 14 * u, strokeWidth: 4 * u }}
              >
                {s.key === 'other' ? 'OTHER' : GENRE_LABELS[s.key].toUpperCase()}
              </text>
            </g>
          ))}
          {/* links */}
          {show.links &&
            show.recs &&
            show.library &&
            sky.links.map((l) => {
              const a = byId.get(l.from)!;
              const b = byId.get(l.to)!;
              const on = focus && (related.has(l.from) && related.has(l.to));
              return <line key={l.from + l.to} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`sky-link ${on ? 'on' : ''} ${focus && !on ? 'dim' : ''}`} />;
            })}
          {/* core */}
          <circle r={120} fill="url(#sky-core)" className="sky-core-glow" />
          <circle r={38} className="sky-core" />
          <circle r={62} className="sky-core-ring" />
          <text className="sky-core-label" textAnchor="middle" y={5 * u} style={{ fontSize: Math.min(22, 14 * u) }}>
            YOU
          </text>
          {/* stars */}
          {visible.map((n) => {
            const st = n.entry?.status;
            const dim = focus && !related.has(n.id);
            return (
              <g key={n.id} data-star={n.id} transform={`translate(${n.x} ${n.y})`} className={`star star--${n.kind} ${st ? `star--${st}` : ''} ${dim ? 'dim' : ''} ${selected?.id === n.id ? 'sel' : ''}`}
                onPointerEnter={() => setHover(n)}
                onPointerLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
              >
                <circle r={n.r + 14} className="star-hit" />
                {st === 'watching' && <circle r={n.r + 6} className="star-pulse" />}
                <circle r={n.r} className="star-dot" filter={n.kind === 'rec' && n.rec && n.rec.match > 85 ? 'url(#sky-glow)' : undefined} />
                {labels.has(n.id) && (
                  <text
                    x={labels.get(n.id)!.x}
                    y={labels.get(n.id)!.y}
                    textAnchor={labels.get(n.id)!.anchor}
                    className={`star-label ${important.has(n.id) ? 'key' : ''}`}
                    style={{ fontSize: 12.5 * u, strokeWidth: 4 * u }}
                  >
                    {labels.get(n.id)!.text}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* overlay HUD */}
      <div className="sky-top">
        <div>
          <div className="hud-eyebrow">Taste core</div>
          <div className="sky-traits">{traits.length ? traits.map((t) => t.label).join(' · ') : 'Rate shows to shape your core'}</div>
        </div>
        <div className="sky-filters">
          {(['library', 'recs', 'links'] as const).map((k) => (
            <button key={k} className={`chip chip--sm ${show[k] ? 'chip--on' : ''}`} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}>
              {k === 'library' ? '● Library' : k === 'recs' ? '○ Recommended' : '— Influence beams'}
            </button>
          ))}
        </div>
      </div>

      <div className="sky-zoom">
        <button className="btn btn--icon btn--sm" onClick={() => setView((v) => ({ ...v, k: Math.min(6, v.k * 1.4) }))} aria-label="Zoom in">
          <Plus size={15} />
        </button>
        <button className="btn btn--icon btn--sm" onClick={() => setView((v) => ({ ...v, k: Math.max(0.6, v.k / 1.4) }))} aria-label="Zoom out">
          <Minus size={15} />
        </button>
        <button className="btn btn--icon btn--sm" onClick={() => setView(HOME)} aria-label="Recentre">
          <Crosshair size={15} />
        </button>
      </div>

      <div className="sky-legend">
        <span>
          <i className="lg lg--lib" /> In your library — closer = loved more
        </span>
        <span>
          <i className="lg lg--rec" /> Recommended — closer = stronger match
        </span>
        <span>
          <i className="lg lg--watch" /> Watching now
        </span>
        <span>
          <i className="lg lg--plan" /> Watchlist
        </span>
      </div>

      {hover && hover.id !== selected?.id && <HoverCard node={hover} svg={svg.current} view={view} />}

      {selected && (
        <aside className="sky-panel">
          <button className="icon-btn sky-panel__close" onClick={() => setSelected(null)} aria-label="Close">
            <X size={16} />
          </button>
          <div className="sky-panel__poster" onClick={() => {
            remember(selected.show);
            nav(showPath(selected.show.id));
          }}>
            <Poster show={selected.show} />
          </div>
          <ShowHud key={selected.id} item={{ show: selected.show, rec: selected.rec, entry: selected.entry }} />
          <button className="btn btn--sm btn--ghost" onClick={() => flyTo(selected)}>
            <Crosshair size={14} /> Fly to
          </button>
        </aside>
      )}

      {sky.nodes.length === 0 && (
        <div className="sky-empty">
          <div className="spinner" /> Mapping your universe…
        </div>
      )}
    </div>
  );
}

function HoverCard({ node, svg, view }: { node: StarNode; svg: SVGSVGElement | null; view: View }) {
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const size = R * 2 + PAD * 2;
  const scale = Math.min(rect.width, rect.height) / size;
  const sx = rect.left + rect.width / 2 + (node.x + view.x) * view.k * scale;
  const sy = rect.top + rect.height / 2 + (node.y + view.y) * view.k * scale;
  const left = Math.min(innerWidth - 300, sx + 18);
  const top = Math.max(70, Math.min(innerHeight - 140, sy - 50));
  const because = node.rec?.reasons.find((r) => r.kind === 'because');
  return (
    <div className="sky-hover" style={{ left, top }}>
      <div className="sky-hover__poster">
        <Poster show={node.show} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="sky-hover__title">{node.show.title}</div>
        <div className="hint">
          {node.show.year ?? ''} {node.entry ? `· ${STATUS_LABEL[node.entry.status]}` : ''} {node.entry?.rating ? `· ${node.entry.rating}/10` : ''}
        </div>
        {node.rec && <div className="match">{node.rec.match}% match</div>}
        {because && <div className="hint">{because.label}</div>}
      </div>
    </div>
  );
}
