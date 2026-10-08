import { useEffect, useMemo, useRef, useState } from 'react';
import { ListVideo, X } from 'lucide-react';
import type { Collection } from '../useCollections';
import { keyOf, type Channel } from './model';
import { schedule, slotMinutes, type Slot } from './schedule';
import { Poster } from '../../components/Poster';
import { useLibrary } from '../../store/library';
import { yearRange } from '../../lib/labels';
import { hash } from '../../lib/ambient';

const SPAN = 150; // minutes shown on the timeline
const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

interface Props {
  channels: Channel[];
  collections: Collection[];
  currentKey?: string;
  fmtCh: (n: number) => string;
  onTune: (ch: Channel) => void;
  onClose: () => void;
}

/**
 * Programme guide. Desktop: an EPG grid — channels down the side, a 2½-hour
 * timeline across with "now" and what follows, built from where you are in each
 * show. Phones: a clean list with NOW / NEXT. ↑↓ select, ←→ jump network,
 * Enter tunes, Esc / G closes.
 */
export function Guide({ channels, collections, currentKey, fmtCh, onTune, onClose }: Props) {
  const entries = useLibrary((s) => s.entries);
  const [sel, setSel] = useState(() => Math.max(0, channels.findIndex((c) => keyOf(c) === currentKey)));
  const list = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // the timeline is fixed for as long as the guide is open
  const time = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
    const nowMin = (now.getTime() - start.getTime()) / 60000;
    const marks = [0, 30, 60, 90, 120].map((m) => ({ m, label: fmtTime(new Date(start.getTime() + m * 60000)) }));
    return { now, nowMin, marks };
  }, []);

  const safeSel = Math.min(sel, Math.max(0, channels.length - 1));
  const firstOf = (netIdx: number) => channels.findIndex((c) => c.netIdx === netIdx);

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-gi="${safeSel}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  }, [safeSel]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = channels.length;
      const cur = channels[safeSel];
      const key = e.key;
      if (key === 'Tab') {
        const f = panel.current ? [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled])')].filter((b) => b.tabIndex >= 0) : [];
        if (!f.length) return;
        const inside = panel.current?.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === f[0] || !inside)) f[f.length - 1].focus();
        else if (!e.shiftKey && (document.activeElement === f[f.length - 1] || !inside)) f[0].focus();
        else return;
      } else if (key === 'Escape' || key === 'g' || key === 'G') onClose();
      else if (!n) return;
      else if (key === 'ArrowDown') setSel(Math.min(n - 1, safeSel + 1));
      else if (key === 'ArrowUp') setSel(Math.max(0, safeSel - 1));
      else if (key === 'PageDown') setSel(Math.min(n - 1, safeSel + 8));
      else if (key === 'PageUp') setSel(Math.max(0, safeSel - 8));
      else if (key === 'Home') setSel(0);
      else if (key === 'End') setSel(n - 1);
      else if (key === 'ArrowRight' || key === 'ArrowLeft') {
        const nets = collections.length;
        for (let d = 1; d <= nets; d++) {
          const ni = ((((cur?.netIdx ?? 0) + (key === 'ArrowRight' ? d : -d)) % nets) + nets) % nets;
          const i = firstOf(ni);
          if (i >= 0) {
            setSel(i);
            break;
          }
        }
      } else if (key === 'Enter' && cur) {
        // handled here (not by the focused row's click) so it fires exactly once
        if ((e.target as Element | null)?.closest?.('.ch-guide__head')) return;
        onTune(cur);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  });

  const rows: React.ReactNode[] = [];
  let lastNet = -1;
  channels.forEach((ch, i) => {
    if (ch.netIdx !== lastNet) {
      lastNet = ch.netIdx;
      rows.push(
        <div key={`net-${ch.cid}`} className="ch-g-net" role="presentation">
          {ch.net}
          <span>{collections[ch.netIdx]?.items.length ?? 0}</span>
        </div>,
      );
    }
    const entry = entries[ch.item.show.id] ?? ch.item.entry;
    const { show, rec } = ch.item;
    const len = slotMinutes(show.runtime);
    // each channel's programmes start at a slightly different time, like a real schedule
    // the programme on now started at or before the left edge and is still running
    const lo = Math.min(time.nowMin, len - 1);
    const first = time.nowMin - (lo + (hash(show.id) % Math.max(1, Math.floor(len - lo))));
    const count = Math.min(6, Math.ceil((SPAN - first) / len) + 1);
    const slots = schedule(ch.item, entry, count);
    const on = keyOf(ch) === currentKey;
    rows.push(
      <button
        key={keyOf(ch)}
        data-gi={i}
        role="option"
        aria-selected={i === safeSel}
        tabIndex={i === safeSel ? 0 : -1}
        className={`ch-g-row ${i === safeSel ? 'sel' : ''} ${on ? 'on' : ''}`}
        onClick={() => onTune(ch)}
        onMouseMove={() => i !== safeSel && setSel(i)}
      >
        <span className="ch-g-no">{fmtCh(ch.no)}</span>
        <span className="ch-g-thumb">
          <Poster show={show} />
        </span>
        <span className="ch-g-info">
          <span className="ch-g-title">{show.title}</span>
          <span className="ch-g-meta">
            {on ? <b>On now · </b> : null}
            {rec ? `${rec.match}% match` : [yearRange(show), show.networks?.[0]].filter(Boolean).join(' · ')}
          </span>
          <span className="ch-g-sched">
            {slots
              .slice(0, slots[0]?.kind === 'rerun' ? 1 : 2)
              .map((s) => slotText(s))
              .join(' · ')}
          </span>
        </span>
        <span className="ch-g-line" aria-hidden>
          {slots.map((s, si) => {
            const from = first + si * len;
            const to = s.kind === 'offair' ? SPAN : from + len;
            const l = Math.max(0, from);
            const r = Math.min(SPAN, to);
            if (r <= l) return null;
            return (
              <span
                key={si}
                className={`ch-g-slot ch-g-slot--${s.kind} ${from < 0 ? 'cut' : ''} ${from <= time.nowMin && time.nowMin < to ? 'live' : ''}`}
                style={{ left: `${(l / SPAN) * 100}%`, width: `${((r - l) / SPAN) * 100}%` }}
              >
                {(si === 0 || s.kind === 'offair') && <b>{s.tag}</b>} {s.label}
              </span>
            );
          })}
        </span>
      </button>,
    );
  });

  return (
    <div className="ch-guide" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ch-guide__panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="ch-guide-title">
        <header className="ch-guide__head">
          <h2 id="ch-guide-title" className="ch-guide__title">
            <ListVideo size={18} /> Guide
          </h2>
          <nav className="ch-guide__nets" aria-label="Jump to network">
            {collections.map((c, ni) => {
              const i = firstOf(ni);
              const here = channels[safeSel]?.netIdx === ni;
              return (
                <button key={c.id} className={`ch-guide__net ${here ? 'on' : ''}`} disabled={i < 0} onClick={() => setSel(i)}>
                  {c.label}
                </button>
              );
            })}
          </nav>
          <button className="btn btn--sm btn--icon ch-guide__close" onClick={onClose} aria-label="Close guide">
            <X size={16} />
          </button>
        </header>
        <div className="ch-guide__body" ref={list} role="listbox" aria-label="Channels" style={{ '--now': `${(time.nowMin / SPAN) * 100}%` } as React.CSSProperties}>
          <div className="ch-g-times" aria-hidden>
            <span className="ch-g-times__lbl">{fmtTime(time.now)}</span>
            <span className="ch-g-times__line">
              {time.marks.map((m) => (
                <span key={m.m} style={{ left: `${(m.m / SPAN) * 100}%` }}>
                  {m.label}
                </span>
              ))}
              <i className="ch-g-nowmark" style={{ left: `${(time.nowMin / SPAN) * 100}%` }} />
            </span>
          </div>
          {channels.length ? rows : <p className="hint ch-guide__empty">No channels yet — add shows to your library.</p>}
        </div>
        <footer className="ch-guide__foot">
          <kbd>↑</kbd>
          <kbd>↓</kbd> select · <kbd>←</kbd>
          <kbd>→</kbd> network · <kbd>Enter</kbd> tune · <kbd>Esc</kbd> close
        </footer>
      </div>
    </div>
  );
}

export const slotText = (s: Slot) => (s.label ? `${s.tag} ${s.label}` : s.tag);
