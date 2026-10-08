import { useRef, useState } from 'react';
import { MonitorSmartphone, Moon, Palette, Sun } from 'lucide-react';
import { DESIGN_IDS, THEME_IDS, useSettings, type ColorMode, type DesignId, type ThemeId } from '../store/settings';
import { DESIGNS, THEMES } from '../theme/themes';
import { switchDesign, switchMode, switchTheme } from '../theme/switch';
import { useClickOutside } from '../hooks/useClickOutside';

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
      {id === 'poi' && (
        <>
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((c) => <rect key={`${r}${c}`} x={8 + c * 37} y={6 + r * 24} width="33" height="20" fill="none" stroke={dim} />),
          )}
          <path d="M52 34h-6v-6M72 28h6v6M78 46v6h-6M46 52v-6h6" fill="none" stroke="#f2d600" strokeWidth="2" />
          <path d="M89 10h-4v-4M106 6h4v4M110 22v4h-4M85 26v-4h4" fill="none" stroke="#ec3a3f" strokeWidth="1.6" />
          <circle cx="16" cy="12" r="2" fill="#ec3a3f" />
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

/** Skin = colours & type. A plain dropdown (native on phones), with the current skin's colours beside it. */
export function SkinPicker() {
  const theme = useSettings((s) => s.theme);
  const t = THEMES[theme];
  return (
    <div className="skin-pick">
      <span className="skin-pick__swatch" aria-hidden>
        {t.swatch.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
      </span>
      <select className="select" value={theme} onChange={(e) => switchTheme(e.target.value as ThemeId)} aria-label="Skin">
        {THEME_IDS.map((id) => (
          <option key={id} value={id}>
            {THEMES[id].name} — {THEMES[id].tagline}
          </option>
        ))}
      </select>
    </div>
  );
}

const MODES: { id: ColorMode; label: string; icon: typeof Sun }[] = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'auto', label: 'Auto', icon: MonitorSmartphone },
];

/** Light / dark / follow the device — works with every skin. */
export function ModePicker() {
  const mode = useSettings((s) => s.mode);
  const theme = useSettings((s) => s.theme);
  if (theme === 'contrast') return <span className="hint">High Contrast is always dark</span>;
  return (
    <div className="seg" role="radiogroup" aria-label="Light or dark">
      {MODES.map(({ id, label, icon: Icon }) => (
        <button key={id} role="radio" aria-checked={mode === id} className={mode === id ? 'on' : ''} onClick={() => switchMode(id)} title={id === 'auto' ? 'Follow your device' : undefined}>
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}

/** "Reality shift" — choose a Design (how you browse) and a Skin (colours & type). */
export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useClickOutside([btn, panel], () => setOpen(false), open);


  return (
    <div style={{ position: 'relative' }}>
      <button ref={btn} className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Design and skin" title="Design & skin (Alt+D / Alt+T)">
        <Palette size={19} />
      </button>
      {open && (
        <div ref={panel} className="reality" role="dialog" aria-label="Design and skin">
          <div className="reality__head">
            <div>
              <div className="label">Design</div>
              <div className="reality__title">How you browse</div>
            </div>
          </div>
          <DesignPicker />
          <div className="reality__row">
            <div className="label">Skin</div>
            <SkinPicker />
          </div>
          <div className="reality__row">
            <div className="label">Mode</div>
            <ModePicker />
          </div>
          <div className="reality__row">
            <div className="label">Text size</div>
            <TextSizePicker />
          </div>
          <div className="reality__foot">
            <kbd>Alt</kbd>+<kbd>D</kbd> next design · <kbd>Alt</kbd>+<kbd>T</kbd> next skin
          </div>
        </div>
      )}
    </div>
  );
}
