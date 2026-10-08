import { useEffect, useState } from 'react';

const p2 = (n: number) => String(n).padStart(2, '0');

/** Live clock. Ticks every second on desktop; on calm devices (phones, reduced motion) only once a minute. */
export function Clock({ calm }: { calm: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    // align to the next whole second / minute so the display never lags
    const period = calm ? 60_000 : 1000;
    let id: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => {
      tick();
      id = setInterval(tick, period);
    }, period - (Date.now() % period));
    return () => {
      clearTimeout(t);
      if (id) clearInterval(id);
    };
  }, [calm]);
  const d = now;
  return (
    <span className="poi-clock">
      <span className="poi-clock__d">
        {d.getFullYear()}.{p2(d.getMonth() + 1)}.{p2(d.getDate())}{' '}
      </span>
      {p2(d.getHours())}:{p2(d.getMinutes())}
      {!calm && <span className="poi-clock__s">:{p2(d.getSeconds())}</span>}
    </span>
  );
}

/** A one-line "the Machine is thinking" ticker. Static on calm devices. */
export function Ticker({ lines, calm }: { lines: string[]; calm: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (calm || lines.length < 2) return;
    const id = setInterval(() => setI((n) => n + 1), 4200);
    return () => clearInterval(id);
  }, [calm, lines.length]);
  const line = lines.length ? lines[i % lines.length] : '';
  return (
    <span className="poi-ticker" key={calm ? 'static' : i}>
      {line}
    </span>
  );
}

const BOOT_KEY = 'dealo:poi-booted';

function bootedThisSession(): boolean {
  try {
    return sessionStorage.getItem(BOOT_KEY) === '1';
  } catch {
    return true;
  }
}

/**
 * A short boot line on the first visit of the session ("You are being
 * watched."). ~1.2 s, skipped by any tap or key, never shown with reduced motion.
 */
export function Boot({ feeds, skip }: { feeds: number; skip: boolean }) {
  const [on, setOn] = useState(() => !skip && !bootedThisSession());
  useEffect(() => {
    if (!on) return;
    try {
      sessionStorage.setItem(BOOT_KEY, '1');
    } catch {
      /* private mode */
    }
    const done = () => setOn(false);
    const t = setTimeout(done, 1250);
    addEventListener('pointerdown', done, true);
    addEventListener('keydown', done, true);
    addEventListener('wheel', done, { capture: true, passive: true });
    return () => {
      clearTimeout(t);
      removeEventListener('pointerdown', done, true);
      removeEventListener('keydown', done, true);
      removeEventListener('wheel', done, true);
    };
  }, [on]);
  if (!on) return null;
  return (
    <div className="poi-boot" aria-hidden>
      <div className="poi-boot__lines">
        <p className="poi-boot__l1">&gt; ESTABLISHING {feeds} FEED{feeds === 1 ? '' : 'S'}…</p>
        <p className="poi-boot__l2">&gt; YOU ARE BEING WATCHED.</p>
      </div>
      <span className="poi-boot__skip">TAP TO SKIP</span>
    </div>
  );
}
