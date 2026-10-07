import { useEffect, useRef, useState } from 'react';
import { Palette, Play, Square } from 'lucide-react';
import { DESIGN_IDS, THEME_IDS, useSettings, type DesignId, type ThemeId } from '../store/settings';
import { DESIGNS, THEMES } from '../theme/themes';
import { switchDesign, switchTheme } from '../theme/switch';
import { useClickOutside } from '../hooks/useClickOutside';
import { Art } from './Poster';

const SAMPLE = { id: 'preview', title: 'Severance', year: 2022, genres: ['scifi' as const] };

export function TextSizePicker() {
  const scale = useSettings((s) => s.textScale);
  const set = useSettings((s) => s.setTextScale);
  const opts: [number, string][] = [
    [1, 'Normal'],
    [1.12, 'Large'],
    [1.25, 'Extra large'],
  ];
  return (
    <div className="seg" role="radiogroup" aria-label="Text size">
      {opts.map(([v, label], i) => (
        <button key={v} role="radio" aria-checked={scale === v} className={scale === v ? 'on' : ''} onClick={() => set(v)} style={{ fontSize: `${0.82 + i * 0.1}rem` }}>
          A<span className="sr-only"> {label}</span>
          <span aria-hidden className="seg-label">
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Tiny schematic drawing of each design, rendered in the current skin. */
function DesignGlyph({ id }: { id: DesignId }) {
  const a = 'var(--accent)';
  const b = 'var(--accent-2)';
  const dim = 'color-mix(in srgb, var(--text) 25%, transparent)';
  return (
    <svg viewBox="0 0 160 80" className="design-glyph" aria-hidden>
      {id === 'stream' && (
        <>
          <rect x="8" y="8" width="144" height="26" rx="3" fill="none" stroke={a} />
          <rect x="14" y="20" width="40" height="4" fill={a} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={8 + i * 25} y="42" width="20" height="30" rx="2" fill="none" stroke={i === 0 ? a : dim} />
          ))}
        </>
      )}
      {id === 'ring' && (
        <>
          <ellipse cx="80" cy="66" rx="62" ry="9" fill="none" stroke={a} />
          <ellipse cx="80" cy="66" rx="44" ry="6" fill="none" stroke={b} strokeDasharray="3 4" />
          {[-3, -2, -1, 1, 2, 3].map((i) => {
            const s = 1 - Math.abs(i) * 0.18;
            return <rect key={i} x={80 + i * 21 - 7 * s} y={36 - 13 * s} width={14 * s} height={22 * s} rx="1.5" fill="none" stroke={dim} />;
          })}
          <rect x="68" y="14" width="24" height="38" rx="2" fill="none" stroke={a} strokeWidth="1.6" />
        </>
      )}
      {id === 'constellation' && (
        <>
          {[
            [30, 20],
            [52, 58],
            [120, 18],
            [134, 54],
            [100, 66],
            [22, 50],
            [64, 14],
          ].map(([x, y], i) => (
            <g key={i}>
              <line x1="80" y1="40" x2={x} y2={y} stroke={dim} />
              <circle cx={x} cy={y} r={i % 3 === 0 ? 4 : 2.6} fill={i % 2 ? 'none' : a} stroke={a} />
            </g>
          ))}
          <circle cx="80" cy="40" r="7" fill={b} />
          <circle cx="80" cy="40" r="13" fill="none" stroke={b} strokeDasharray="2 3" />
        </>
      )}
      {id === 'swipe' && (
        <>
          <rect x="58" y="12" width="40" height="58" rx="4" fill="none" stroke={dim} transform="rotate(-8 78 41)" />
          <rect x="62" y="10" width="40" height="58" rx="4" fill="none" stroke={b} transform="rotate(6 82 39)" />
          <rect x="60" y="10" width="40" height="58" rx="4" fill="none" stroke={a} strokeWidth="1.6" />
          <path d="M28 40h16M36 34l-8 6 8 6" stroke={dim} fill="none" />
          <path d="M116 40h16M124 34l8 6-8 6" stroke={a} fill="none" />
        </>
      )}
      {id === 'channel' && (
        <>
          <rect x="34" y="8" width="92" height="62" rx="10" fill="none" stroke={a} strokeWidth="1.6" />
          <rect x="44" y="16" width="62" height="46" rx="6" fill="none" stroke={dim} />
          <circle cx="116" cy="28" r="4" fill="none" stroke={b} />
          <circle cx="116" cy="44" r="4" fill="none" stroke={b} />
          <text x="50" y="30" fontSize="9" fill={a} fontFamily="monospace">CH 07</text>
          <path d="M60 70l-8 8M100 70l8 8" stroke={dim} />
        </>
      )}
      {id === 'timeline' && (
        <>
          <line x1="8" y1="70" x2="152" y2="70" stroke={dim} />
          {[20, 50, 80, 110, 140].map((x) => (
            <line key={x} x1={x} y1="66" x2={x} y2="74" stroke={dim} />
          ))}
          <rect x="14" y="14" width="58" height="8" rx="4" fill={a} />
          <rect x="44" y="28" width="84" height="8" rx="4" fill="none" stroke={b} />
          <rect x="90" y="42" width="56" height="8" rx="4" fill={a} opacity="0.6" />
          <rect x="24" y="54" width="40" height="8" rx="4" fill="none" stroke={a} />
        </>
      )}
      {id === 'mission' && (
        <>
          <rect x="8" y="8" width="68" height="36" rx="2" fill="none" stroke={a} />
          <rect x="82" y="8" width="70" height="20" rx="2" fill="none" stroke={dim} />
          <rect x="82" y="32" width="70" height="40" rx="2" fill="none" stroke={b} />
          <rect x="8" y="50" width="32" height="22" rx="2" fill="none" stroke={dim} />
          <rect x="44" y="50" width="32" height="22" rx="2" fill="none" stroke={dim} />
          <polyline points="14,36 26,24 38,30 50,16 62,22 70,14" fill="none" stroke={a} />
          <circle cx="117" cy="52" r="12" fill="none" stroke={a} strokeDasharray="40 80" />
        </>
      )}
      {id === 'tunnel' && (
        <>
          {[0, 1, 2, 3].map((i) => {
            const k = 1 - i * 0.22;
            return <rect key={i} x={80 - 70 * k} y={40 - 34 * k} width={140 * k} height={68 * k} fill="none" stroke={i === 0 ? a : dim} />;
          })}
          {[
            [10, 6],
            [150, 6],
            [10, 74],
            [150, 74],
          ].map(([x, y], i) => (
            <line key={i} x1={x} y1={y} x2="80" y2="40" stroke={dim} />
          ))}
          <rect x="22" y="22" width="14" height="22" fill="none" stroke={a} />
          <rect x="120" y="26" width="12" height="18" fill="none" stroke={b} />
        </>
      )}
    </svg>
  );
}

export function DesignPicker({ onPick }: { onPick?: () => void }) {
  const design = useSettings((s) => s.design);
  return (
    <div className="design-grid">
      {DESIGN_IDS.map((id) => (
        <button
          key={id}
          className={`design-card ${design === id ? 'on' : ''}`}
          onClick={() => {
            switchDesign(id);
            onPick?.();
          }}
        >
          <DesignGlyph id={id} />
          <strong>{DESIGNS[id].name}</strong>
          <span>{DESIGNS[id].tagline}</span>
        </button>
      ))}
    </div>
  );
}

export function SkinPicker() {
  const theme = useSettings((s) => s.theme);
  const pick = (id: ThemeId, e: React.MouseEvent) => switchTheme(id, { x: e.clientX, y: e.clientY });
  return (
    <div className="reality__grid">
      {THEME_IDS.map((id) => {
        const t = THEMES[id];
        return (
          <button key={id} data-theme={id} className={`reality__card ${theme === id ? 'on' : ''}`} onClick={(e) => pick(id, e)}>
            <div className="reality__preview">
              <div className="reality__poster">
                <Art show={SAMPLE} />
              </div>
              <div className="reality__lines">
                <span className="reality__h">
                  {t.logo.pre}
                  <b>{t.logo.accent}</b>
                  {t.logo.post}
                </span>
                <span className="reality__bar">
                  <i />
                </span>
                <span className="reality__btn">Watch</span>
              </div>
            </div>
            <div className="reality__meta">
              <strong>{t.name}</strong>
              <span>{t.tagline}</span>
              <em>↳ {t.transition}</em>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** "Reality shift" — choose a Design (how you browse) and a Skin (colours & type). */
export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [touring, setTouring] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useClickOutside([btn, panel], () => setOpen(false), open);

  useEffect(() => {
    if (!touring) return;
    const stop = () => setTouring(false);
    const id = setInterval(() => {
      const cur = useSettings.getState().theme;
      const next = THEME_IDS[(THEME_IDS.indexOf(cur) + 1) % THEME_IDS.length];
      switchTheme(next, { x: innerWidth * (0.2 + Math.random() * 0.6), y: innerHeight * (0.2 + Math.random() * 0.6) });
    }, 4200);
    const t = setTimeout(() => window.addEventListener('pointerdown', stop, { once: true }), 50);
    return () => {
      clearInterval(id);
      clearTimeout(t);
      window.removeEventListener('pointerdown', stop);
    };
  }, [touring]);

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btn} className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Design and skin" title="Design & skin (Alt+D / Alt+T)">
        <Palette size={19} />
      </button>
      {touring && (
        <button className="tour-pill" onClick={() => setTouring(false)}>
          <Square size={12} /> Stop skin tour
        </button>
      )}
      {open && (
        <div ref={panel} className="reality" role="dialog" aria-label="Design and skin">
          <div className="reality__head">
            <div>
              <div className="label">Design</div>
              <div className="reality__title">How you browse</div>
            </div>
          </div>
          <DesignPicker />
          <div className="reality__head" style={{ marginTop: 18 }}>
            <div>
              <div className="label">Skin</div>
              <div className="reality__title">Colours & type — works with every design</div>
            </div>
            <button
              className="btn btn--sm"
              onClick={() => {
                setOpen(false);
                setTouring(true);
              }}
            >
              <Play size={13} /> Tour skins
            </button>
          </div>
          <SkinPicker />
          <div className="reality__head" style={{ marginTop: 18 }}>
            <div>
              <div className="label">Text size</div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <TextSizePicker />
            </div>
          </div>
          <div className="reality__foot">
            <kbd>Alt</kbd>+<kbd>D</kbd> next design · <kbd>Alt</kbd>+<kbd>T</kbd> next skin
          </div>
        </div>
      )}
    </div>
  );
}
