import { useEffect, useRef, useState } from 'react';

interface Point {
  day: string; // yyyy-mm-dd
  count: number;
}

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * Single-series activity sparkline (episodes per day). One hue (--accent):
 * 2px line, ~10% area wash, ≥8px end dot with a surface ring, hairline
 * baseline, crosshair + tooltip on hover/focus, arrow keys to scrub, and a
 * screen-reader table.
 */
export function Sparkline({ data, minHeight = 96 }: { data: Point[]; minHeight?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [height, setH] = useState(minHeight);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setW(Math.max(120, Math.round(e.contentRect.width)));
      setH(Math.max(minHeight, Math.min(240, Math.round(e.contentRect.height))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [minHeight]);

  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.count));
  const padX = 6;
  const padTop = 8;
  const padBot = 6;
  const x = (i: number) => padX + (n > 1 ? (i / (n - 1)) * (w - padX * 2) : 0);
  const y = (v: number) => padTop + (1 - v / max) * (height - padTop - padBot);
  const base = height - padBot;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.count).toFixed(1)}`).join('');
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z` : '';
  const last = n - 1;
  const total = data.reduce((a, d) => a + d.count, 0);

  const pick = (clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || !n) return;
    const i = Math.round(((clientX - r.left - padX) / Math.max(1, r.width - padX * 2)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const h = hover != null ? data[hover] : undefined;
  // Tooltip sits beside the crosshair (flips to the left near the right edge).
  const flip = hover != null && x(hover) > w - 150;
  const tipStyle = hover != null ? (flip ? { right: w - x(hover) + 10 } : { left: x(hover) + 10 }) : {};

  return (
    <div className="mc-spark">
      <div className="mc-spark__head">
        <span className="mc-spark__title">Episodes per day, last 30 days</span>
        <span className="mc-spark__peak">peak {max}/day</span>
      </div>
      <div
        ref={wrap}
        className="mc-spark__plot"
        style={{ minHeight }}
        tabIndex={0}
        role="img"
        aria-label={`Episodes per day over the last 30 days: ${total} in total, peak ${max} a day. Use arrow keys to inspect days.`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((v) => v ?? last)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? last) - 1));
          else if (e.key === 'ArrowRight') setHover((v) => Math.min(last, (v ?? last) + 1));
          else if (e.key === 'Home') setHover(0);
          else if (e.key === 'End') setHover(last);
          else return;
          e.preventDefault();
        }}
      >
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden focusable="false">
          <line className="mc-spark__grid" x1={0} x2={w} y1={y(max)} y2={y(max)} />
          <line className="mc-spark__axis" x1={0} x2={w} y1={base + 0.5} y2={base + 0.5} />
          {n > 0 && <path className="mc-spark__area" d={area} />}
          {n > 0 && <path className="mc-spark__line" d={line} />}
          {hover != null && <line className="mc-spark__cross" x1={x(hover)} x2={x(hover)} y1={padTop - 4} y2={base} />}
          {n > 0 && <circle className="mc-spark__dot" cx={x(hover ?? last)} cy={y(data[hover ?? last].count)} r={4} />}
        </svg>
        {h && (
          <div className="mc-spark__tip" style={tipStyle} aria-live="polite">
            <strong>
              {h.count} episode{h.count === 1 ? '' : 's'}
            </strong>
            <span>{fmtDay(h.day)}</span>
          </div>
        )}
      </div>
      <div className="mc-spark__axislabels" aria-hidden>
        <span>30 days ago</span>
        <span>{total} episodes</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>Episodes watched per day, last 30 days</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
