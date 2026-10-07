import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Check, Maximize2, Minus, Pause, Play, Plus, Sparkles, X, type LucideIcon } from 'lucide-react';
import type { WatchStatus } from '../types';
import { STATUS_ORDER } from '../types';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { STATUS_LABEL } from '../lib/labels';
import { remember, showPath } from '../lib/showCache';
import { Poster } from '../components/Poster';
import { ShowHud } from './ShowHud';
import { useCollections, type Item } from './useCollections';
import {
  airSpan,
  approxTextWidth,
  axisRange,
  ERAS,
  layoutGroups,
  spanLabel,
  summarize,
  tickStep,
  yearFrac,
  type AirSpan,
  type LayoutOptions,
} from './timelineLayout';

/**
 * LIFE TIMELINE — TV history as a timeline. Every show is a bar spanning the
 * years it was on air; your library is styled by status, recommendations are
 * hollow bars. Pan, zoom, jump through the decades.
 */

type SourceMode = 'library' | 'recs' | 'both';
type GroupKey = WatchStatus | 'rec';
type TItem = Item & { id: string; span: AirSpan; group: GroupKey };

const GROUP_LABEL: Record<GroupKey, string> = { ...STATUS_LABEL, rec: 'Recommended for you' };
const ICON: Record<GroupKey, LucideIcon> = { watching: Play, completed: Check, plan: Bookmark, on_hold: Pause, dropped: X, rec: Sparkles };
const GROUP_ORDER: GroupKey[] = [...STATUS_ORDER, 'rec'];
const ALL_STATUSES = new Set<WatchStatus>(STATUS_ORDER);

/* Geometry — keep in sync with timeline.css. */
const PAD_L = 28;
const PAD_R = 40;
const AXIS_H = 62;
const GROUP_H = 30;
const LABEL_FONT_SCALE = 0.9; // --fs-sm
const ICON_W = 14;
const LABEL_PAD = 8; // label plate padding (4 + 4)
const LABEL_GAP = 10;
const MAX_TITLE_W = 300;

function useCompact() {
  const q = '(max-width: 860px)';
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Measures label text with the active skin's body font (re-measures on skin change / font load). */
function useMeasure(theme: string) {
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontsReady((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    const root = getComputedStyle(document.documentElement);
    const rem = parseFloat(root.fontSize) || 16;
    const px = rem * LABEL_FONT_SCALE;
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    const mono = root.getPropertyValue('--font-mono').trim() || 'monospace';
    const ctx = document.createElement('canvas').getContext('2d');
    const cache = new Map<string, number>();
    const measure = (text: string, kind: 'title' | 'mono' = 'title') => {
      const k = kind + text;
      const hit = cache.get(k);
      if (hit != null) return hit;
      let w: number;
      if (ctx) {
        ctx.font = kind === 'title' ? `600 ${px}px ${family}` : `700 ${rem * 0.8}px ${mono}`;
        w = Math.ceil(ctx.measureText(text).width * 1.06) + 2;
      } else w = approxTextWidth(text, kind === 'title' ? px : rem * 0.8);
      cache.set(k, w);
      return w;
    };
    return measure;
    // theme/fontsReady are cache-busters: fonts differ per skin
  }, [theme, fontsReady]);
}

export default function LifeTimeline() {
  const entries = useLibrary((s) => s.entries);
  const theme = useSettings((s) => s.theme);
  const { collections, recs } = useCollections();
  const nav = useNavigate();
  const compact = useCompact();
  const measure = useMeasure(theme);

  const [source, setSource] = useState<SourceMode>('library');
  const [statuses, setStatuses] = useState<Set<WatchStatus>>(ALL_STATUSES);
  const [grouped, setGrouped] = useState(true);
  const [ppy, setPpy] = useState(0); // px per year; 0 until the viewport is measured
  const [viewW, setViewW] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const ppyRef = useRef(ppy);
  ppyRef.current = ppy;
  const pendingScroll = useRef<{ year: number; ax: number; smooth?: boolean; end?: boolean } | null>(null);
  const dragged = useRef(false);

  const now = useMemo(() => yearFrac(new Date()), []);
  const barH = compact ? 44 : 34;
  const laneH = compact ? 54 : 42;
  const thumbW = Math.round(((barH - 8) * 2) / 3);

  /* ── data ── */
  const libItems = useMemo<TItem[]>(() => {
    const out: TItem[] = [];
    for (const e of Object.values(entries)) {
      const span = airSpan(e.show, now);
      if (span) out.push({ id: e.id, show: e.show, entry: e, span, group: e.status });
    }
    return out;
  }, [entries, now]);
  const libUndated = useMemo(() => Object.values(entries).filter((e) => !e.show.year).length, [entries]);

  const recItems = useMemo<TItem[]>(() => {
    const foryou = collections.find((c) => c.id === 'foryou')?.items ?? [];
    const out: TItem[] = [];
    for (const it of foryou) {
      if (entries[it.show.id]) continue;
      const span = airSpan(it.show, now);
      if (span) out.push({ ...it, id: it.show.id, span, group: 'rec' });
      if (out.length >= 30) break;
    }
    return out;
  }, [collections, entries, now]);

  const statusCounts = useMemo(() => {
    const c: Record<WatchStatus, number> = { watching: 0, plan: 0, completed: 0, on_hold: 0, dropped: 0 };
    for (const it of libItems) c[it.group as WatchStatus]++;
    return c;
  }, [libItems]);

  const items = useMemo(() => {
    const lib = source === 'recs' ? [] : libItems.filter((i) => statuses.has(i.group as WatchStatus));
    const rec = source === 'library' ? [] : recItems;
    return [...lib, ...rec];
  }, [source, libItems, recItems, statuses]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // The axis covers library + recs regardless of the filter, so toggling filters never jolts the scale.
  const axis = useMemo(() => axisRange([...libItems, ...recItems].map((i) => i.span), now), [libItems, recItems, now]);
  const spanYears = axis.to - axis.from;

  /* ── zoom limits ── */
  const fitPpy = viewW ? Math.max(4, (viewW - PAD_L - PAD_R) / spanYears) : 30;
  const maxPpy = Math.max(fitPpy, viewW / 3);
  const clampPpy = useCallback((p: number) => Math.min(maxPpy, Math.max(fitPpy, p)), [fitPpy, maxPpy]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Initial view: everything if it's readable, otherwise ~13 years ending today.
  useLayoutEffect(() => {
    if (!viewW || ppy) return;
    if (fitPpy >= 26) setPpy(fitPpy);
    else {
      setPpy(30);
      pendingScroll.current = { year: now, ax: viewW, end: true };
    }
  }, [viewW, ppy, fitPpy, now]);

  // Keep the zoom inside its limits when the viewport changes.
  useEffect(() => {
    if (ppy && (ppy < fitPpy - 0.01 || ppy > maxPpy + 0.01)) setPpy(clampPpy(ppy));
  }, [ppy, fitPpy, maxPpy, clampPpy]);

  const effPpy = ppy || fitPpy;

  /* ── layout ── */
  const layout = useMemo(() => {
    const opts: LayoutOptions = {
      pxPerYear: effPpy,
      origin: axis.from,
      padLeft: PAD_L,
      minBarW: thumbW + 10,
      leadW: thumbW + 8,
      innerPad: 6,
      labelGap: LABEL_GAP,
      gap: 10,
    };
    const labelW = new Map<string, number>();
    for (const it of items) {
      let w = LABEL_PAD + ICON_W + 5 + Math.min(MAX_TITLE_W, measure(it.show.title));
      if (it.rec) w += 6 + measure(`${it.rec.match}%`, 'mono');
      labelW.set(it.id, w);
    }
    const toItem = (it: TItem) => ({ id: it.id, start: it.span.start, end: it.span.end, labelW: labelW.get(it.id)! });
    const groups = grouped
      ? GROUP_ORDER.map((g) => ({ key: g as string, items: items.filter((i) => i.group === g).map(toItem) }))
      : [{ key: 'all', items: items.map(toItem) }];
    const r = layoutGroups(groups, opts);
    const headH = grouped ? GROUP_H : 8;
    const groupTop = new Map<string, number>();
    let y = AXIS_H + 6;
    for (const g of r.groups) {
      groupTop.set(g.key, y);
      y += headH + g.lanes * laneH + 6;
    }
    const bars = r.bars.map((b) => {
      const g = r.groups.find((x) => x.key === b.group)!;
      return { ...b, y: groupTop.get(b.group)! + headH + (b.row - g.row) * laneH + (laneH - barH) / 2, labelW: labelW.get(b.id)! };
    });
    // DOM / tab order: by group then chronologically
    const order = new Map(r.groups.map((g, i) => [g.key, i]));
    bars.sort((a, b) => order.get(a.group)! - order.get(b.group)! || a.x - b.x || a.row - b.row);
    const width = Math.max(r.right + PAD_R, PAD_L + spanYears * effPpy + PAD_R);
    return { bars, groups: r.groups.map((g) => ({ ...g, y: groupTop.get(g.key)! })), width, height: y + 24, headH };
  }, [items, effPpy, axis.from, spanYears, thumbW, measure, grouped, laneH, barH]);

  const xOf = useCallback((year: number) => PAD_L + (year - axis.from) * effPpy, [axis.from, effPpy]);

  /* ── zooming (anchored) ── */
  useLayoutEffect(() => {
    const el = scroller.current;
    const p = pendingScroll.current;
    if (!el || !p || !ppy) return;
    pendingScroll.current = null;
    const left = p.end ? el.scrollWidth : PAD_L + (p.year - axis.from) * ppy - p.ax;
    if (p.smooth && !reducedMotion()) el.scrollTo({ left, behavior: 'smooth' });
    else el.scrollLeft = left;
  }, [ppy, axis.from, layout]);

  const zoomTo = useCallback(
    (next: number, clientX?: number) => {
      const el = scroller.current;
      if (!el) return;
      const cur = ppyRef.current || fitPpy;
      const target = clampPpy(next);
      if (Math.abs(target - cur) < 0.01) return;
      const rect = el.getBoundingClientRect();
      const ax = clientX == null ? el.clientWidth / 2 : clientX - rect.left;
      const year = axis.from + (el.scrollLeft + ax - PAD_L) / cur;
      pendingScroll.current = { year, ax };
      setPpy(target);
    },
    [axis.from, clampPpy, fitPpy],
  );
  const fitAll = useCallback(() => {
    pendingScroll.current = { year: axis.from, ax: PAD_L };
    setPpy(fitPpy);
  }, [axis.from, fitPpy]);
  const jumpTo = (decade: number) => {
    const el = scroller.current;
    if (!el) return;
    const cur = ppyRef.current || fitPpy;
    const wantYears = compact ? 9 : 14;
    const target = el.clientWidth / cur > wantYears + 2 ? clampPpy(el.clientWidth / wantYears) : cur;
    pendingScroll.current = { year: decade - 0.4, ax: 0, smooth: target === cur };
    if (target === cur) {
      // same zoom: run the scroll now
      const left = PAD_L + (decade - 0.4 - axis.from) * cur;
      if (reducedMotion()) el.scrollLeft = left;
      else el.scrollTo({ left, behavior: 'smooth' });
      pendingScroll.current = null;
    } else setPpy(target);
  };

  // wheel → zoom at the cursor (trackpad pinch arrives as ctrl+wheel); horizontal wheel pans natively
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Ctrl/⌘+wheel (and trackpad pinch) zoom anywhere; a plain wheel zooms over the year ruler,
    // or anywhere when there is nothing to scroll vertically — otherwise it scrolls the lanes.
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) return;
      const overAxis = (e.target as Element).closest?.('.tl-axis');
      const canScrollY = el.scrollHeight > el.clientHeight + 2;
      if (!e.ctrlKey && !e.metaKey && !overAxis && canScrollY) return;
      e.preventDefault();
      const k = Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 40 ? 0.01 : 0.0018));
      zoomTo((ppyRef.current || fitPpy) * k, e.clientX);
    };
    // two-finger pinch on touch screens; one finger scrolls natively
    let pinch: { d: number; p: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const tStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { d: dist(e.touches), p: ppyRef.current || fitPpy };
    };
    const tMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      zoomTo(pinch.p * (dist(e.touches) / pinch.d), (e.touches[0].clientX + e.touches[1].clientX) / 2);
    };
    const tEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('touchstart', tStart, { passive: true });
    el.addEventListener('touchmove', tMove, { passive: false });
    el.addEventListener('touchend', tEnd);
    el.addEventListener('touchcancel', tEnd);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('touchstart', tStart);
      el.removeEventListener('touchmove', tMove);
      el.removeEventListener('touchend', tEnd);
      el.removeEventListener('touchcancel', tEnd);
    };
  }, [zoomTo, fitPpy]);

  // mouse drag → pan (both axes); touch uses native scrolling
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, []);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = scroller.current!;
    const start = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    dragged.current = false;
    setHint(false);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!dragged.current && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!dragged.current) {
        dragged.current = true;
        setDragging(true);
        setHover(null);
      }
      el.scrollLeft = start.l - dx;
      el.scrollTop = start.t - dy;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      // let the click that follows a drag see `dragged`, then reset
      setTimeout(() => (dragged.current = false), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ── selection & keyboard ── */
  const selected = selectedId ? byId.get(selectedId) : undefined;
  useEffect(() => {
    if (selectedId && !byId.has(selectedId)) setSelectedId(null);
  }, [byId, selectedId]);

  const barEl = (id: string) => scroller.current?.querySelector<HTMLButtonElement>(`[data-bar="${CSS.escape(id)}"]`);
  useEffect(() => {
    if (!selectedId) return;
    // after the panel opens (scroller narrows), keep the bar in view
    const t = setTimeout(() => barEl(selectedId)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }), 60);
    return () => clearTimeout(t);
  }, [selectedId]);

  const close = () => {
    const id = selectedId;
    setSelectedId(null);
    if (id) requestAnimationFrame(() => barEl(id)?.focus({ preventScroll: true }));
  };

  const onBarKey = (e: React.KeyboardEvent, idx: number) => {
    const bars = layout.bars;
    const b = bars[idx];
    let next: (typeof bars)[number] | undefined;
    if (e.key === 'ArrowRight') next = bars[idx + 1];
    else if (e.key === 'ArrowLeft') next = bars[idx - 1];
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const cands = bars.filter((o) => (dir > 0 ? o.y > b.y : o.y < b.y));
      const rowY = cands.length ? (dir > 0 ? Math.min(...cands.map((o) => o.y)) : Math.max(...cands.map((o) => o.y))) : undefined;
      if (rowY != null) next = cands.filter((o) => o.y === rowY).sort((p, q) => Math.abs(p.x - b.x) - Math.abs(q.x - b.x))[0];
    } else return;
    e.preventDefault();
    if (next) barEl(next.id)?.focus();
  };

  const onRootKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, [role="menu"]')) return;
    if (e.key === 'Escape' && selectedId) close();
    else if (e.key === '+' || e.key === '=') zoomTo(effPpy * 1.4);
    else if (e.key === '-' || e.key === '_') zoomTo(effPpy / 1.4);
    else if (e.key === '0') fitAll();
    else return;
    e.preventDefault();
  };

  const showHover = (id: string, el: HTMLElement) => {
    if (dragged.current) return;
    setHover({ id, rect: el.getBoundingClientRect() });
  };

  /* ── narrative ── */
  const summary = useMemo(() => summarize(items.map((i) => ({ id: i.id, span: i.span }))), [items]);
  const longestTitle = summary.longest ? byId.get(summary.longest.id)?.show.title : undefined;
  const who = source === 'library' ? 'Your TV' : source === 'recs' ? 'Your picks' : 'Your TV & picks';

  /* ── axis ── */
  const step = tickStep(effPpy, compact ? 40 : 46);
  const years: number[] = [];
  for (let y = Math.ceil(axis.from); y <= axis.to; y++) years.push(y);
  const decades = years.filter((y) => y % 10 === 0);
  const dataDecades = useMemo(() => {
    const s = new Set<number>();
    for (const i of [...libItems, ...recItems]) for (let d = Math.floor(i.span.from / 10) * 10; d <= i.span.to; d += 10) s.add(d);
    return [...s].sort((a, b) => a - b);
  }, [libItems, recItems]);
  const eras = ERAS.filter((e) => (e.to ?? axis.to) >= axis.from && e.from <= axis.to);
  const yearsPerScreen = viewW ? Math.round(viewW / effPpy) : 0;

  const empty = items.length === 0;
  const loadingRecs = source !== 'library' && !recs.output;

  return (
    <div className={`tl ${selected ? 'tl--open' : ''}`} onKeyDown={onRootKey}>
      <header className="tl-head">
        <div className="tl-story">
          <div className="hud-eyebrow">Life timeline<span className="tl-eyebrow-more"> · the years your shows aired</span></div>
          <h2 className="tl-title">
            {summary.count ? (
              <>
                {who} {source === 'library' ? 'spans' : 'span'} <b>{summary.from}–{summary.to}</b>
                <span className="tl-dot">·</span>
                {summary.count} show{summary.count === 1 ? '' : 's'}
                {summary.busiestDecade != null && (
                  <>
                    <span className="tl-dot">·</span>busiest era: <b>{summary.busiestDecade}s</b>
                  </>
                )}
              </>
            ) : (
              `${who}: nothing to plot yet`
            )}
          </h2>
          {summary.count > 0 && (
            <p className="tl-sub">
              {longestTitle && summary.longest && summary.longest.years > 1 && (
                <>
                  Longest-running: <b>{longestTitle}</b> ({summary.longest.years} years)
                </>
              )}
              {summary.ongoing > 0 && <> · {summary.ongoing} still on air</>}
              {summary.busiestDecade != null && <> · {summary.busiestCount} on air in the {summary.busiestDecade}s</>}
              {source !== 'recs' && libUndated > 0 && <> · {libUndated} without air dates not shown</>}
            </p>
          )}
        </div>

        <div className="tl-controls">
          <div className="seg tl-source" role="group" aria-label="Which shows">
            {(
              [
                ['library', compact ? 'Library' : 'My library'],
                ['recs', 'Recommended'],
                ['both', 'Both'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={source === k ? 'on' : ''} aria-pressed={source === k} onClick={() => setSource(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tl-zoom" role="group" aria-label="Zoom">
            <button className="btn btn--icon btn--sm" onClick={() => zoomTo(effPpy / 1.4)} disabled={effPpy <= fitPpy + 0.01} aria-label="Zoom out" title="Zoom out (−)">
              <Minus size={15} />
            </button>
            <span className="tl-zoom__v" aria-live="polite">
              {yearsPerScreen ? `${yearsPerScreen} yrs` : ''}
            </span>
            <button className="btn btn--icon btn--sm" onClick={() => zoomTo(effPpy * 1.4)} disabled={effPpy >= maxPpy - 0.01} aria-label="Zoom in" title="Zoom in (+)">
              <Plus size={15} />
            </button>
            <button className="btn btn--sm tl-fit" onClick={fitAll} title="Fit all (0)" aria-label="Fit all">
              <Maximize2 size={14} aria-hidden /> <span className="tl-fit-text">Fit all</span>
            </button>
          </div>
        </div>

        <div className="tl-filters">
          {source !== 'recs' && (
            <div className="tl-chips" role="group" aria-label="Filter by status">
              {STATUS_ORDER.map((s) => {
                const Icon = ICON[s];
                const on = statuses.has(s);
                return (
                  <button
                    key={s}
                    className={`chip chip--sm tl-chip ${on ? 'tl-chip--on' : ''}`}
                    aria-pressed={on}
                    disabled={!statusCounts[s]}
                    onClick={() =>
                      setStatuses((prev) => {
                        const n = new Set(prev);
                        if (n.has(s)) n.delete(s);
                        else n.add(s);
                        return n.size ? n : new Set(ALL_STATUSES);
                      })
                    }
                  >
                    <i className={`tl-swatch tl-swatch--${s}`} aria-hidden />
                    <Icon size={13} aria-hidden />
                    {STATUS_LABEL[s]}
                    <span className="tl-chip__n">{statusCounts[s]}</span>
                  </button>
                );
              })}
            </div>
          )}
          {source !== 'library' && (
            <span className="tl-legend-rec">
              <i className="tl-swatch tl-swatch--rec" aria-hidden />
              <Sparkles size={13} aria-hidden /> Recommended · match %
            </span>
          )}
          <div className="tl-right">
            <div className="tl-decades" role="group" aria-label="Jump to decade">
              {dataDecades.map((d) => (
                <button key={d} className="btn btn--sm btn--ghost" onClick={() => jumpTo(d)}>
                  {d}s
                </button>
              ))}
            </div>
            <button className={`chip chip--sm ${grouped ? 'chip--on' : ''}`} aria-pressed={grouped} onClick={() => setGrouped((g) => !g)} title="Group lanes by status">
              Group by status
            </button>
          </div>
        </div>
      </header>

      <div className="tl-body">
        <div
          ref={scroller}
          className={`tl-scroll ${dragging ? 'is-dragging' : ''}`}
          onPointerDown={onPointerDown}
          onScroll={() => hover && setHover(null)}
          tabIndex={-1}
        >
          <div className="tl-canvas" style={{ width: layout.width, height: layout.height, '--bar-h': `${barH}px`, '--thumb-w': `${thumbW}px` } as CSSProperties}>
            {/* era bands */}
            {eras.map((e, i) => {
              const x0 = xOf(Math.max(e.from, axis.from));
              const x1 = e.to == null ? layout.width : xOf(Math.min(e.to + 1, axis.to));
              return <div key={e.label} className={`tl-era ${i % 2 ? 'tl-era--alt' : ''}`} style={{ left: x0, width: Math.max(0, x1 - x0) }} />;
            })}
            {/* year grid */}
            {years.map((y) => (
              <div key={y} className={`tl-gridline ${y % 10 === 0 ? 'tl-gridline--decade' : y % step === 0 ? '' : 'tl-gridline--minor'}`} style={{ left: xOf(y) }} />
            ))}
            <div className="tl-today" style={{ left: xOf(now) }} aria-hidden />

            {/* sticky axis */}
            <div className="tl-axis" aria-hidden>
              {eras.map((e) => {
                const x0 = xOf(Math.max(e.from, axis.from));
                const x1 = xOf(Math.min((e.to ?? axis.to) + 1, axis.to));
                return (
                  <div key={e.label} className="tl-era-label" style={{ left: x0, width: Math.max(0, x1 - x0) }}>
                    <span>
                      {e.label} · {e.from}–{e.to ?? ''}
                    </span>
                  </div>
                );
              })}
              {years
                .filter((y) => y % step === 0 && y % 10 !== 0 && Math.abs(y - now) * effPpy > 16)
                .map((y) => (
                  <span key={y} className="tl-tick" style={{ left: xOf(y) }}>
                    {step === 1 || step === 2 ? `’${String(y).slice(2)}` : y}
                  </span>
                ))}
              {decades.map((d) => (
                <span key={d} className="tl-tick tl-tick--decade" style={{ left: xOf(d) }}>
                  {d}
                </span>
              ))}
              <span className="tl-today__label" style={{ left: xOf(now) }}>
                Today
              </span>
            </div>

            {/* group headers */}
            {grouped &&
              layout.groups.map((g) => {
                const Icon = ICON[g.key as GroupKey];
                const n = layout.bars.filter((b) => b.group === g.key).length;
                return (
                  <div key={g.key} className="tl-group" style={{ top: g.y, height: GROUP_H }}>
                    <span className={`tl-group__label tl-group__label--${g.key}`}>
                      <Icon size={14} aria-hidden /> {GROUP_LABEL[g.key as GroupKey]} <span className="tl-chip__n">{n}</span>
                    </span>
                  </div>
                );
              })}

            {/* bars */}
            {layout.bars.map((b, idx) => {
              const it = byId.get(b.id)!;
              const Icon = ICON[it.group];
              const label = (
                <>
                  <Icon size={ICON_W} className="tl-label__icon" aria-hidden />
                  <span className="tl-label__title" style={{ maxWidth: MAX_TITLE_W }}>
                    {it.show.title}
                  </span>
                  {it.rec && <span className="tl-label__match">{it.rec.match}%</span>}
                </>
              );
              const status = it.entry ? STATUS_LABEL[it.entry.status] : `Recommended, ${it.rec?.match ?? 0}% match`;
              return (
                <Fragment key={b.id}>
                  <button
                    data-bar={b.id}
                    className={`tl-bar tl-bar--${it.group} ${it.span.ongoing ? 'tl-bar--ongoing' : ''} ${it.span.single ? 'tl-bar--single' : ''} ${selectedId === b.id ? 'is-sel' : ''}`}
                    style={{ left: b.x, top: b.y, width: b.w }}
                    aria-label={`${it.show.title}, aired ${spanLabel(it.span)}, ${status}`}
                    aria-pressed={selectedId === b.id}
                    onClick={() => {
                      if (dragged.current) return;
                      setSelectedId(b.id);
                      setHover(null);
                    }}
                    onKeyDown={(e) => onBarKey(e, idx)}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && showHover(b.id, e.currentTarget)}
                    onPointerLeave={() => setHover((h) => (h?.id === b.id ? null : h))}
                    onFocus={(e) => e.currentTarget.matches(':focus-visible') && showHover(b.id, e.currentTarget)}
                    onBlur={() => setHover((h) => (h?.id === b.id ? null : h))}
                  >
                    <span className="tl-lead">
                      <span className="tl-thumb">
                        <Poster show={it.show} />
                      </span>
                      {b.labelInside && <span className="tl-label">{label}</span>}
                    </span>
                    {it.span.ongoing && <span className="tl-open" aria-hidden />}
                  </button>
                  {!b.labelInside && (
                    <span className={`tl-label tl-label--out tl-label--${it.group}`} style={{ left: b.x + b.w + LABEL_GAP, top: b.y, width: b.labelW }} aria-hidden>
                      {label}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </div>

          {empty && (
            <div className="tl-empty">
              {loadingRecs ? (
                <>
                  <div className="spinner" /> Finding recommendations…
                </>
              ) : source === 'recs' ? (
                'No recommendations with air dates yet — rate a few shows.'
              ) : libItems.length ? (
                'No shows match these filters.'
              ) : (
                'Add shows to your library to see them on the timeline.'
              )}
            </div>
          )}
        </div>

        {!empty && hint && (
          <div className="tl-hint" aria-hidden>
            Drag to pan · Ctrl + wheel (or wheel over the years) to zoom · Tab / arrows between shows
          </div>
        )}

        {selected && (
          <aside className="tl-panel" aria-label={`${selected.show.title} details`}>
            <div className="tl-panel__grip" aria-hidden />
            <button className="icon-btn tl-panel__close" onClick={close} aria-label="Close details">
              <X size={16} />
            </button>
            <div className="tl-panel__top">
              <button
                className="tl-panel__poster"
                onClick={() => {
                  remember(selected.show);
                  nav(showPath(selected.show.id));
                }}
                aria-label={`Open ${selected.show.title}`}
              >
                <Poster show={selected.show} />
              </button>
              <div className="tl-panel__air">
                <div className="label">On air</div>
                <div className="tl-panel__years">{spanLabel(selected.span)}</div>
                <div className="hint">
                  {selected.span.ongoing ? 'Still airing' : selected.span.single ? 'One year' : `${selected.span.to - selected.span.from + 1} years`}
                  {selected.show.seasonCount ? ` · ${selected.show.seasonCount} season${selected.show.seasonCount > 1 ? 's' : ''}` : ''}
                </div>
                <span className={`tl-status tl-status--${selected.group}`}>
                  <StatusGlyph g={selected.group} /> {selected.entry ? STATUS_LABEL[selected.entry.status] : `${selected.rec?.match}% match`}
                </span>
              </div>
            </div>
            <ShowHud key={selected.id} item={{ show: selected.show, rec: selected.rec, entry: selected.entry }} />
          </aside>
        )}
      </div>

      {hover && byId.get(hover.id) && <HoverCard item={byId.get(hover.id)!} rect={hover.rect} />}
    </div>
  );
}

function StatusGlyph({ g }: { g: GroupKey }) {
  const Icon = ICON[g];
  return <Icon size={13} aria-hidden />;
}

function HoverCard({ item, rect }: { item: TItem; rect: DOMRect }) {
  const W = 300;
  const H = 150;
  const left = Math.max(8, Math.min(innerWidth - W - 8, rect.left + Math.min(rect.width, 160) - 20));
  const below = rect.bottom + 10 + H < innerHeight;
  const top = below ? rect.bottom + 8 : Math.max(8, rect.top - H - 8);
  const { show, entry, rec, span } = item;
  const because = rec?.reasons.find((r) => r.kind === 'because');
  return (
    <div className="tl-hover" style={{ left, top, width: W }} role="tooltip">
      <div className="tl-hover__poster">
        <Poster show={show} />
      </div>
      <div className="tl-hover__body">
        <div className="tl-hover__title">{show.title}</div>
        <div className="tl-hover__meta">
          <b>{spanLabel(span)}</b>
          {span.ongoing && ' · still airing'}
          {show.seasonCount ? ` · ${show.seasonCount} season${show.seasonCount > 1 ? 's' : ''}` : ''}
        </div>
        {show.networks?.[0] && <div className="tl-hover__meta">{show.networks[0]}</div>}
        <div className={`tl-status tl-status--${item.group}`}>
          <StatusGlyph g={item.group} />
          {entry ? (
            <>
              {STATUS_LABEL[entry.status]}
              {entry.rating != null && ` · ★ ${entry.rating}/10`}
            </>
          ) : (
            <>{rec?.match}% match</>
          )}
        </div>
        {because && <div className="tl-hover__meta">{because.label}</div>}
      </div>
    </div>
  );
}
