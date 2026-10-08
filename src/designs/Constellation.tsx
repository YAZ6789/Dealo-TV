import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Crosshair, HelpCircle, Minus, Plus, X } from 'lucide-react';
import { useLibrary } from '../store/library';
import { useRecommendations } from '../hooks/useRecommendations';
import { GENRE_LABELS } from '../lib/genres';
import { STATUS_LABEL } from '../lib/labels';
import { remember, showPath } from '../lib/showCache';
import { Poster } from '../components/Poster';
import { prefetchArtwork } from '../providers/artwork';
import { HudSheet, ShowHud, useCalmFx, useCompact } from './ShowHud';
import { layoutSky, R, type StarNode } from './constellationLayout';

/**
 * CONSTELLATION — your taste as a star map. You're the core; your library
 * orbits close (loved = closer), recommendations drift in the discovery field
 * (better match = closer) with beams back to the show that inspired them.
 * Touch: drag to pan, pinch or double-tap to zoom, tap a star for its card.
 */

type View = { x: number; y: number; k: number };
const HOME: View = { x: 0, y: 0, k: 1 };
const PAD = 160;
const K_MIN = 0.6;
const K_MAX = 6;
const clampK = (k: number) => Math.max(K_MIN, Math.min(K_MAX, k));
type Gesture = { view: View; x: number; y: number; moved: boolean; dist?: number; mid?: { x: number; y: number } };

export default function Constellation() {
  const entries = useLibrary((s) => s.entries);
  const recs = useRecommendations();
  const nav = useNavigate();
  const [show, setShow] = useState({ library: true, recs: true, links: true });
  const [hover, setHover] = useState<StarNode | null>(null);
  const [selected, setSelected] = useState<StarNode | null>(null);
  const [view, setView] = useState<View>(HOME);
  /** Programmatic moves (buttons, fly-to, keeping the picked star in sight) glide; gestures track the finger. */
  const [glide, setGlide] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [legend, setLegend] = useState(false);
  const compact = useCompact();
  const calm = useCalmFx();
  // SVG box in screen px; world units per screen px at zoom 1 — lets text stay a constant, readable size at any zoom.
  const [box, setBox] = useState({ w: 800, h: 800 });
  const unitsPerPx = (R * 2 + PAD * 2) / Math.min(box.w, box.h);
  const svg = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const moveView = useCallback((v: View | ((v: View) => View), smooth = true) => {
    setGlide(smooth);
    setView(v);
  }, []);

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
      if (r.width && r.height) setBox({ w: r.width, h: r.height });
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
  // Text sizes in screen px (a touch larger on phones).
  const LABEL_PX = compact ? 14 : 12.5;
  // Small maps (landscape phones) get smaller sector names so neighbours don't pile up.
  const mapPx = Math.min(box.w, box.h);
  const SECTOR_PX = compact ? Math.max(11, Math.min(15, mapPx / 26)) : 14;

  const related = useMemo(() => {
    if (!focus) return new Set<string>();
    const s = new Set<string>([focus.id]);
    for (const l of sky.links) if (l.from === focus.id || l.to === focus.id) s.add(l.from === focus.id ? l.to : l.from);
    return s;
  }, [focus, sky.links]);

  // Greedy label placement: most important first; try below / above / right / left; skip if all collide.
  const labels = useMemo(() => {
    const fs = LABEL_PX * u;
    const want = visible.filter((n) => view.k > 1.8 || important.has(n.id) || selected?.id === n.id || (focus && related.has(n.id)));
    const prio = (n: StarNode) =>
      (selected?.id === n.id ? 1000 : 0) + (focus?.id === n.id ? 900 : 0) + (important.has(n.id) ? 100 : 0) + (n.rec?.match ?? (n.entry?.rating ?? 6) * 10);
    want.sort((a, b) => prio(b) - prio(a));
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    // keep labels on screen: the visible world rect at the current view
    const vis = { x0: (-box.w / 2 + 6) * u - view.x, x1: (box.w / 2 - 6) * u - view.x, y0: (-box.h / 2 + 4) * u - view.y, y1: (box.h / 2 - 4) * u - view.y };
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
        const off = b.x0 < vis.x0 || b.x1 > vis.x1 || b.y0 < vis.y0 || b.y1 > vis.y1;
        const hit = off || boxes.some((o) => !(b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1) && !(o.x0 === n.x - n.r && o.y0 === n.y - n.r));
        if (!hit) {
          boxes.push(b);
          out.set(n.id, { x: c.x - n.x, y: c.y - n.y, anchor: c.anchor, text });
          break;
        }
      }
    }
    return out;
  }, [visible, view.k, view.x, view.y, box, u, important, selected, focus, related, LABEL_PX]);

  // Sector names sit just outside the disc; on a narrow screen pull them in so
  // "ANIMATION" or "THRILLER" never run off the edge (at the home zoom).
  const sectorLabels = useMemo(() => {
    const size = R * 2 + PAD * 2;
    const halfW = (box.w * unitsPerPx) / 2; // visible half-width in world units at zoom 1
    const halfH = (box.h * unitsPerPx) / 2;
    const fs = SECTOR_PX * u;
    const margin = 10 * unitsPerPx;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    return sky.sectors.map((s) => {
      const text = s.key === 'other' ? 'OTHER' : GENRE_LABELS[s.key].toUpperCase();
      const hw = (text.length * fs * 0.84) / 2;
      const maxX = Math.max(hw, Math.min(size / 2, halfW) - margin - hw);
      const maxY = Math.max(fs, Math.min(size / 2, halfH) - margin - fs / 2);
      // Narrow neighbouring sectors can put two names on top of each other: step outwards/inwards until clear.
      let best = { x: 0, y: 0 };
      for (const dr of [0, 1.4, -1.4, 2.8, -2.8]) {
        const r = R + 40 + dr * fs;
        const x = Math.max(-maxX, Math.min(maxX, Math.cos(s.mid) * r));
        const y = Math.max(-maxY, Math.min(maxY, Math.sin(s.mid) * r));
        const b = { x0: x - hw, x1: x + hw, y0: y - fs * 0.6, y1: y + fs * 0.6 };
        best = { x, y };
        if (!placed.some((o) => !(b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1))) {
          placed.push(b);
          break;
        }
      }
      return { key: s.key, start: s.start, text, ...best };
    });
  }, [sky.sectors, box, unitsPerPx, u, SECTOR_PX]);

  /* ── pan / zoom ── */
  /** Screen point (relative to the SVG centre, px) → world point, for a given view. */
  const rel = (cx: number, cy: number) => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: cx - rect.left - rect.width / 2, y: cy - rect.top - rect.height / 2 };
  };
  /** The view that keeps world point `w` under the screen point `s` (centre-relative px) at zoom k. */
  const anchored = (w: { x: number; y: number }, s: { x: number; y: number }, k: number): View => ({ k, x: (s.x * unitsPerPx) / k - w.x, y: (s.y * unitsPerPx) / k - w.y });
  const worldAt = (s: { x: number; y: number }, v: View) => ({ x: (s.x * unitsPerPx) / v.k - v.x, y: (s.y * unitsPerPx) / v.k - v.y });
  const zoomAt = (cx: number, cy: number, factor: number, smooth = false) => {
    const s = rel(cx, cy);
    moveView((v) => anchored(worldAt(s, v), s, clampK(v.k * factor)), smooth);
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

  /** (Re)start the gesture from the fingers currently down. */
  const beginGesture = (moved: boolean) => {
    const pts = [...pointers.current.values()];
    if (!pts.length) {
      gesture.current = null;
      return;
    }
    const v = viewRef.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = { view: v, x: a.x, y: a.y, moved, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    } else gesture.current = { view: v, x: pts[0].x, y: pts[0].y, moved };
  };
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType !== 'mouse') setHover(null);
    beginGesture(pointers.current.size > 1);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist && g.mid) {
      // pinch: zoom about the fingers' midpoint, and pan with it
      const [a, b] = pts;
      const k = clampK(g.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist));
      const m0 = rel(g.mid.x, g.mid.y);
      const m1 = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
      moveView(anchored(worldAt(m0, g.view), m1, k), false);
      g.moved = true;
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > (e.pointerType === 'mouse' ? 4 : 10)) g.moved = true;
    if (!g.moved) return;
    moveView({ ...g.view, x: g.view.x + (dx * unitsPerPx) / g.view.k, y: g.view.y + (dy * unitsPerPx) / g.view.k }, false);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size) {
      // one finger lifted mid-pinch: carry on as a pan from the current view
      beginGesture(true);
      return;
    }
    gesture.current = null;
    if (!g || g.moved || e.type === 'pointercancel') return;
    // A tap. Pointer capture retargets pointerup to the <svg>, so hit-test by position.
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-star]');
    const now = performance.now();
    const prev = lastTap.current;
    const double = !!prev && now - prev.t < 320 && Math.hypot(prev.x - e.clientX, prev.y - e.clientY) < 30;
    lastTap.current = double ? null : { t: now, x: e.clientX, y: e.clientY };
    if (target) {
      const n = byId.get(target.getAttribute('data-star')!);
      if (n) select(n);
    } else if (double && e.pointerType !== 'mouse') zoomAt(e.clientX, e.clientY, 2, true);
    else select(null);
  };

  /** Pick a star. On phones the card covers the bottom of the map, so keep the star in sight above it. */
  const select = (n: StarNode | null) => {
    // poster for the card now, backdrop for the show page if they open it
    if (n) {
      prefetchArtwork([n.show]);
      prefetchArtwork([n.show], 'backdrop');
    }
    setSelected(n);
    setSheet(false);
    if (!n || !compact || !svg.current) return;
    const v = viewRef.current;
    const rect = svg.current.getBoundingClientRect();
    const sy = ((n.y + v.y) * v.k) / unitsPerPx; // centre-relative screen y
    const sx = ((n.x + v.x) * v.k) / unitsPerPx;
    const landscape = rect.width > rect.height * 1.3;
    const safeBottom = landscape ? rect.height / 2 - 40 : rect.height / 2 - 230; // card height + margin
    const safeRight = landscape ? -40 : rect.width / 2 - 30;
    if (sy > safeBottom || sx > safeRight || sy < -rect.height / 2 + 120) {
      const to = { x: landscape ? -rect.width * 0.22 : 0, y: landscape ? 0 : -rect.height * 0.12 };
      moveView(anchored({ x: n.x, y: n.y }, to, v.k), true);
    }
  };

  const flyTo = (n: StarNode) => {
    setSheet(false);
    moveView({ x: -n.x, y: -n.y, k: 2.6 }, true);
  };

  useEffect(() => {
    if (!selected) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.hud-sheet-wrap, .menu, .overlay')) setSelected(null);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [selected]);
  const closeSheet = useCallback(() => setSheet(false), []);

  const traits = recs.output?.traits.filter((t) => t.key.startsWith('k:') || t.key.startsWith('g:')).slice(0, 3) ?? [];
  const size = R * 2 + PAD * 2;

  return (
    <div className={`sky-stage ${compact ? 'sky-stage--compact' : ''} ${calm ? 'fx-calm' : ''} ${selected ? 'has-sel' : ''}`}>
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
        <g style={{ transform: `scale(${view.k}) translate(${view.x}px, ${view.y}px)` }} className={`sky-world ${glide ? 'glide' : ''}`}>
          {/* orbits */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <circle key={f} r={R * f} className={`sky-orbit ${f === sky.split ? 'split' : ''}`} />
          ))}
          {mapPx >= 330 && (<text className="sky-ring-label" y={-R * sky.split - 8 * u} textAnchor="middle" style={{ fontSize: 11 * u }}>
            YOUR LIBRARY ▲ ▼ DISCOVERY FIELD
          </text>)}
          {/* sectors */}
          {sectorLabels.map((s) => (
            <g key={s.key}>
              <line x1={0} y1={0} x2={Math.cos(s.start) * R * 1.04} y2={Math.sin(s.start) * R * 1.04} className="sky-sector" />
              <text x={s.x} y={s.y} textAnchor="middle" dominantBaseline="middle" className="sky-sector-label" style={{ fontSize: SECTOR_PX * u, strokeWidth: 4 * u }}>
                {s.text}
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
                onPointerEnter={(e) => {
                  if (e.pointerType !== 'mouse' || gesture.current) return;
                  prefetchArtwork([n.show]);
                  setHover(n);
                }}
                onPointerLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
              >
                <circle r={n.r + 14} className="star-hit" />
                {st === 'watching' && <circle r={n.r + 6} className="star-pulse" />}
                <circle r={n.r} className="star-dot" filter={!calm && n.kind === 'rec' && n.rec && n.rec.match > 85 ? 'url(#sky-glow)' : undefined} />
                {labels.has(n.id) && (
                  <text
                    x={labels.get(n.id)!.x}
                    y={labels.get(n.id)!.y}
                    textAnchor={labels.get(n.id)!.anchor}
                    className={`star-label ${important.has(n.id) ? 'key' : ''}`}
                    style={{ fontSize: LABEL_PX * u, strokeWidth: 4 * u }}
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
            <button key={k} className={`chip chip--sm ${show[k] ? 'chip--on' : ''}`} aria-pressed={show[k]} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}>
              {k === 'library' ? '● Library' : k === 'recs' ? (compact ? '○ Recs' : '○ Recommended') : compact ? '— Beams' : '— Influence beams'}
            </button>
          ))}
        </div>
      </div>

      <div className="sky-zoom">
        <button className="btn btn--icon btn--sm" onClick={() => moveView((v) => ({ ...v, k: clampK(v.k * 1.4) }))} aria-label="Zoom in">
          <Plus size={15} />
        </button>
        <button className="btn btn--icon btn--sm" onClick={() => moveView((v) => ({ ...v, k: clampK(v.k / 1.4) }))} aria-label="Zoom out">
          <Minus size={15} />
        </button>
        <button className="btn btn--icon btn--sm" onClick={() => moveView(HOME)} aria-label="Recentre">
          <Crosshair size={15} />
        </button>
        {compact && (
          <button className={`btn btn--icon btn--sm ${legend ? 'btn--on' : ''}`} onClick={() => setLegend((l) => !l)} aria-label="What the stars mean" aria-expanded={legend}>
            <HelpCircle size={15} />
          </button>
        )}
      </div>

      <div className={`sky-legend ${legend ? 'open' : ''}`} onClick={() => compact && setLegend(false)}>
        {compact && <span className="hint">Drag to pan · pinch or double-tap to zoom · tap a star</span>}
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

      {selected && compact && (
        <aside className="sky-peek" aria-label="Selected show" key={selected.id}>
          <button
            type="button"
            className="sky-peek__poster"
            onClick={() => {
              remember(selected.show);
              nav(showPath(selected.show.id));
            }}
            aria-label={`Open ${selected.show.title}`}
          >
            <Poster show={selected.show} eager />
          </button>
          <ShowHud item={{ show: selected.show, rec: selected.rec, entry: selected.entry }} side="compact" onMore={() => setSheet(true)} />
          <button className="btn btn--icon btn--sm sky-peek__close" onClick={() => setSelected(null)} aria-label="Close">
            <X size={16} />
          </button>
        </aside>
      )}
      {selected && compact && sheet && (
        <HudSheet item={{ show: selected.show, rec: selected.rec, entry: selected.entry }} onClose={closeSheet}>
          <button className="btn btn--sm hud-sheet__fly" onClick={() => flyTo(selected)}>
            <Crosshair size={14} /> Fly to on the map
          </button>
        </HudSheet>
      )}

      {selected && !compact && (
        <aside className="sky-panel">
          <button className="btn btn--icon btn--sm sky-panel__close" onClick={() => setSelected(null)} aria-label="Close">
            <X size={16} />
          </button>
          <button
            type="button"
            className="sky-panel__poster"
            aria-label={`Open ${selected.show.title}`}
            onClick={() => {
              remember(selected.show);
              nav(showPath(selected.show.id));
            }}
          >
            <Poster show={selected.show} eager />
          </button>
          <ShowHud key={selected.id} item={{ show: selected.show, rec: selected.rec, entry: selected.entry }} />
          <button className="btn btn--sm btn--ghost" onClick={() => flyTo(selected)}>
            <Crosshair size={14} /> Fly to
          </button>
        </aside>
      )}

      {sky.nodes.length === 0 &&
        (recs.stage === 'ready' || Object.keys(entries).length === 0 ? (
          <div className="sky-empty">
            <p>Your map starts with the shows you've watched. Add a few and they'll light up here.</p>
            <Link to="/discover" className="btn btn--primary">
              Find shows
            </Link>
          </div>
        ) : (
          <div className="sky-empty">
            <div className="spinner" /> Mapping your universe…
          </div>
        ))}
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
        <Poster show={node.show} eager />
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
