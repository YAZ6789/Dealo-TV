import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Check, ChevronDown, Clock, Eye, Pause, Plus, Trash2, X } from 'lucide-react';
import type { ShowSummary, WatchStatus } from '../types';
import { STATUS_ORDER } from '../types';
import { useLibrary } from '../store/library';
import { STATUS_LABEL } from '../lib/labels';
import { useClickOutside } from '../hooks/useClickOutside';
import { useShowActions } from '../hooks/useShowActions';

export const STATUS_ICON: Record<WatchStatus, typeof Eye> = {
  watching: Eye,
  plan: Clock,
  completed: Check,
  on_hold: Pause,
  dropped: X,
};

/** Primary "where does this show live" control: add / move between lists / remove / block. */
export function StatusMenu({ show, primary }: { show: ShowSummary; primary?: boolean }) {
  const entry = useLibrary((s) => s.entries[show.id]);
  const blocked = useLibrary((s) => !!s.blocked[show.id]);
  const unblock = useLibrary((s) => s.unblock);
  const actions = useShowActions();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useClickOutside([btn, menu], () => setOpen(false), open);

  const toggle = () => {
    const r = btn.current!.getBoundingClientRect();
    setPos({ x: Math.min(r.left, innerWidth - 240), y: r.bottom + 6 + scrollY });
    setOpen((o) => !o);
  };

  const Icon = entry ? STATUS_ICON[entry.status] : Plus;
  const label = entry ? STATUS_LABEL[entry.status] : blocked ? 'Not interested' : 'Add to list';

  return (
    <>
      <button ref={btn} className={`btn ${primary && !entry ? 'btn--primary' : ''} ${entry ? 'btn--on' : ''}`} onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
        {blocked && !entry ? <Ban size={16} /> : <Icon size={16} />}
        {label}
        <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div ref={menu} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
            {STATUS_ORDER.map((st) => {
              const I = STATUS_ICON[st];
              return (
                <button
                  key={st}
                  role="menuitem"
                  className={`menu__item ${entry?.status === st ? 'on' : ''}`}
                  onClick={() => {
                    actions.setStatus(show, st);
                    setOpen(false);
                  }}
                >
                  <I size={16} /> {STATUS_LABEL[st]}
                </button>
              );
            })}
            <div className="menu__sep" />
            {entry && (
              <button
                role="menuitem"
                className="menu__item"
                onClick={() => {
                  actions.remove(show);
                  setOpen(false);
                }}
              >
                <Trash2 size={16} /> Remove from library
              </button>
            )}
            {blocked ? (
              <button
                role="menuitem"
                className="menu__item"
                onClick={() => {
                  unblock(show.id);
                  setOpen(false);
                }}
              >
                <Ban size={16} /> Allow in recommendations again
              </button>
            ) : (
              <button
                role="menuitem"
                className="menu__item"
                onClick={() => {
                  actions.notInterested(show);
                  setOpen(false);
                }}
              >
                <Ban size={16} /> Don't recommend this
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
