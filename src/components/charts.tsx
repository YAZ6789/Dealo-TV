import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small, dependency-free SVG charts that inherit the active theme's tokens.
 * Single-series charts use one hue (the accent); magnitude in the heatmap is a
 * single-hue light→dark ramp. Every mark has a hover tooltip and every chart
 * ships a screen-reader table.
 */

interface Tip {
  x: number;
  y: number;
  text: ReactNode;
}

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const node = tip
    ? createPortal(
        <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y - 34 }}>
          {tip.text}
        </div>,
        document.body,
      )
    : null;
  const bind = (text: ReactNode) => ({
    onPointerMove: (e: React.PointerEvent) => setTip({ x: e.clientX, y: e.clientY, text }),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const r = (e.target as Element).getBoundingClientRect();
      setTip({ x: r.right, y: r.top, text });
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
  });
  return { node, bind };
}

function SrTable({ caption, rows }: { caption: string; rows: [string, string | number][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Horizontal bars with value at the tip — for ranked categories. */
export function BarList({ items, caption, format = (v) => String(v), tip }: { items: { label: string; value: number; key?: string }[]; caption: string; format?: (v: number) => string; tip?: (i: { label: string; value: number }) => string }) {
  const { node, bind } = useTip();
  const max = Math.max(1e-9, ...items.map((i) => i.value));
  return (
    <div className="barlist" role="img" aria-label={caption}>
      {items.map((i) => (
        <div key={i.key ?? i.label} className="barlist__row" {...bind(tip ? tip(i) : `${i.label}: ${format(i.value)}`)}>
          <span className="barlist__label">{i.label}</span>
          <span className="barlist__track">
            <span className="barlist__fill" style={{ width: `${(i.value / max) * 100}%` }} />
            <span className="barlist__value">{format(i.value)}</span>
          </span>
        </div>
      ))}
      <SrTable caption={caption} rows={items.map((i) => [i.label, format(i.value)])} />
      {node}
    </div>
  );
}

/** Vertical columns from a shared baseline — for ordered bins (months, ratings). */
export function Columns({ items, caption, height = 170, tip }: { items: { label: string; value: number }[]; caption: string; height?: number; tip?: (i: { label: string; value: number }) => string }) {
  const { node, bind } = useTip();
  const W = 600;
  const H = height;
  const padL = 30;
  const padB = 22;
  const max = Math.max(1, ...items.map((i) => i.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const band = (W - padL) / items.length;
  const bw = Math.min(24, band * 0.62);
  const y = (v: number) => (H - padB) * (1 - v / top);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  return (
    <>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--panel-border)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end">
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {items.map((it, i) => {
          const x = padL + band * i + (band - bw) / 2;
          const h = (H - padB) - y(it.value);
          return (
            <g key={it.label + i} {...bind(tip ? tip(it) : `${it.label}: ${it.value}`)} style={{ outline: 'none' }}>
              <rect x={padL + band * i} y={0} width={band} height={H - padB} fill="transparent" />
              {it.value > 0 && <path d={roundTopBar(x, y(it.value), bw, h, Math.min(4, h))} fill="var(--accent)" opacity={0.92} />}
              <text x={x + bw / 2} y={H - 6} textAnchor="middle">
                {it.label}
              </text>
            </g>
          );
        })}
      </svg>
      <SrTable caption={caption} rows={items.map((i) => [i.label, i.value])} />
      {node}
    </>
  );
}

function roundTopBar(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** GitHub-style calendar of episodes per day (single-hue ramp). */
export function Heatmap({ days, caption }: { days: { day: string; count: number }[]; caption: string }) {
  const { node, bind } = useTip();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const max = Math.max(1, ...days.map((d) => d.count));
  const level = (c: number) => (c === 0 ? 0 : Math.min(4, 1 + Math.floor(((c - 1) / Math.max(1, max - 1)) * 3.999)));
  const cell = 11;
  // (axis text is sized in CSS: .heatmap text)
  const gap = 3;
  const firstDow = new Date(`${days[0]?.day}T12:00:00`).getDay();
  const weeks = Math.ceil((days.length + firstDow) / 7);
  const W = weeks * (cell + gap) + 28;
  const H = 7 * (cell + gap) + 18;
  const months: { x: number; label: string }[] = [];
  let lastMonth = '';
  days.forEach((d, i) => {
    const m = d.day.slice(5, 7);
    const col = Math.floor((i + firstDow) / 7);
    if (m !== lastMonth && new Date(`${d.day}T12:00:00`).getDate() <= 7) {
      months.push({ x: 28 + col * (cell + gap), label: new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }) });
      lastMonth = m;
    }
  });
  return (
    // On narrow screens the year scrolls sideways — start at the most recent weeks.
    <div className="heatmap-scroll" ref={scroller}>
      <svg className="chart-svg heatmap" viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 640 }} role="img" aria-label={caption}>
        {months.map((m) => (
          <text key={m.x} x={m.x} y={9}>
            {m.label}
          </text>
        ))}
        {['Mon', 'Wed', 'Fri'].map((d, i) => (
          <text key={d} x={0} y={18 + (i * 2 + 1) * (cell + gap) + cell - 2}>
            {d}
          </text>
        ))}
        {days.map((d, i) => {
          const idx = i + firstDow;
          const col = Math.floor(idx / 7);
          const row = idx % 7;
          const l = level(d.count);
          return (
            <rect
              key={d.day}
              x={28 + col * (cell + gap)}
              y={14 + row * (cell + gap)}
              width={cell}
              height={cell}
              rx={2}
              className={`hm hm-${l}`}
              {...bind(`${new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.count} episode${d.count === 1 ? '' : 's'}`)}
            />
          );
        })}
      </svg>
      <div className="heatmap-legend">
        Less {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`hm-sw hm-${l}`} />)} More
      </div>
      {node}
    </div>
  );
}

/** Ring meter for a single percentage. */
export function Ring({ value, label, size = 120 }: { value: number; label: string; size?: number }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${value}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in srgb, var(--accent) 18%, transparent)" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ filter: 'drop-shadow(0 0 6px var(--accent))', transition: 'stroke-dasharray 1s var(--ease)' }}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="var(--text)" style={{ fontFamily: 'var(--font-display)', fontSize: size / 4.4, fontWeight: 700 }}>
        {value}%
      </text>
    </svg>
  );
}
