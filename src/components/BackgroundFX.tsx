import { useEffect, useRef } from 'react';
import { useSettings } from '../store/settings';

/** Per-theme ambient background. Pure CSS layers, plus a tiny canvas glyph-rain for Terminal. High Contrast renders nothing. */
export function BackgroundFX() {
  const theme = useSettings((s) => s.theme);
  const reduceFx = useSettings((s) => s.reduceFx);
  if (reduceFx) return <div className="fx-layer" aria-hidden />;
  return (
    <div className={`fx-layer fx-${theme}`} aria-hidden>
      {theme === 'hud' && (
        <>
          <div className="fx-glow" />
          <div className="fx-dots" />
          <div className="fx-grid" />
          <div className="fx-scan" />
        </>
      )}
      {theme === 'neon' && (
        <>
          <div className="fx-sky" />
          <div className="fx-horizon" />
          <div className="fx-rain" />
          <div className="fx-noise" />
        </>
      )}
      {theme === 'aurora' && (
        <>
          <div className="fx-blob b1" />
          <div className="fx-blob b2" />
          <div className="fx-blob b3" />
          <div className="fx-grain" />
        </>
      )}
      {theme === 'surveillance' && (
        <>
          <div className="fx-feeds">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <div className="fx-sweep" />
          <div className="fx-grain" />
          <div className="fx-vignette" />
        </>
      )}
      {theme === 'daylight' && (
        <>
          <div className="fx-sky" />
          <div className="fx-sun" />
          <div className="fx-haze" />
        </>
      )}
      {/* contrast: deliberately nothing — a flat black background, no motion */}
      {theme === 'terminal' && (
        <>
          <GlyphRain />
          <div className="fx-roll" />
          <div className="fx-scanlines" />
          <div className="fx-flicker" />
          <div className="fx-vignette" />
        </>
      )}
    </div>
  );
}

function GlyphRain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ01234567890<>/{}[]=+*#$%';
    const size = 16;
    let cols = 0;
    let drops: number[] = [];
    const resize = () => {
      canvas.width = innerWidth;
      canvas.height = innerHeight;
      cols = Math.ceil(innerWidth / size);
      drops = Array.from({ length: cols }, () => Math.random() * -60);
    };
    resize();
    addEventListener('resize', resize);
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 70 || document.hidden) return;
      last = t;
      ctx.fillStyle = 'rgba(1, 4, 1, 0.16)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${size - 2}px monospace`;
      for (let i = 0; i < cols; i++) {
        if (i % 3) continue; // sparse columns keep it subtle
        const y = drops[i] * size;
        ctx.fillStyle = Math.random() > 0.96 ? '#c8ffe6' : '#00ff9c';
        ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * size, y);
        if (y > canvas.height && Math.random() > 0.97) drops[i] = 0;
        drops[i] += 1;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={ref} className="fx-matrix" />;
}
