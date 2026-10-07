import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Bot, CalendarClock, Compass, Cpu, Gift, Home, LayoutGrid, Library, Palette, Plus, Search, Settings, Sparkles, Upload } from 'lucide-react';
import type { ShowSummary } from '../types';
import { searchLocal, searchShows } from '../providers';
import { useLibrary } from '../store/library';
import { DESIGN_IDS, THEME_IDS } from '../store/settings';
import { DESIGNS, THEMES } from '../theme/themes';
import { switchDesign, switchTheme } from '../theme/switch';
import { remember, showPath } from '../lib/showCache';
import { STATUS_LABEL } from '../lib/labels';
import { usePalette } from './palette';
import { Poster } from './Poster';
import { toast } from './toast';

interface Item {
  key: string;
  group: string;
  title: string;
  sub?: string;
  icon?: React.ReactNode;
  show?: ShowSummary;
  run: () => void;
}

export function CommandPalette() {
  const { open, query: initial, setOpen } = usePalette();
  if (!open) return null;
  return <PaletteInner initial={initial} close={() => setOpen(false)} />;
}

function PaletteInner({ initial, close }: { initial: string; close: () => void }) {
  const nav = useNavigate();
  const entries = useLibrary((s) => s.entries);
  const add = useLibrary((s) => s.add);
  const [q, setQ] = useState(initial);
  const [remote, setRemote] = useState<ShowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRemote([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await searchShows(term);
        if (alive) setRemote(r.slice(0, 14));
      } catch {
        if (alive) setRemote([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 260);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const go = (path: string) => () => {
      nav(path);
      close();
    };
    const openShow = (s: ShowSummary) => () => {
      remember(s);
      nav(showPath(s.id));
      close();
    };
    const out: Item[] = [];

    const lib = Object.values(entries);
    const libHits = term
      ? lib.filter((e) => e.show.title.toLowerCase().includes(term)).slice(0, 6)
      : lib.filter((e) => e.status === 'watching').sort((a, b) => (b.lastWatchedAt ?? b.updatedAt).localeCompare(a.lastWatchedAt ?? a.updatedAt)).slice(0, 5);
    for (const e of libHits)
      out.push({ key: `lib:${e.id}`, group: term ? 'In your library' : 'Continue watching', title: e.show.title, sub: `${STATUS_LABEL[e.status]}${e.show.year ? ` · ${e.show.year}` : ''}`, show: e.show, run: openShow(e.show) });

    if (term.length >= 2) {
      const seen = new Set(out.map((i) => i.show?.id));
      const results = remote.length ? remote : searchLocal(term);
      for (const s of results) {
        if (seen.has(s.id) || entries[s.id]) continue;
        seen.add(s.id);
        out.push({
          key: `s:${s.id}`,
          group: 'Shows',
          title: s.title,
          sub: [s.year, s.networks?.[0], s.rating ? `★ ${s.rating.toFixed(1)}` : undefined].filter(Boolean).join(' · '),
          show: s,
          run: openShow(s),
        });
      }
    }

    const commands: Item[] = [
      { key: 'go:home', group: 'Navigate', title: 'Home', icon: <Home size={16} />, run: go('/') },
      { key: 'go:discover', group: 'Navigate', title: 'Discover — recommendations', icon: <Compass size={16} />, run: go('/discover') },
      { key: 'go:library', group: 'Navigate', title: 'Library', icon: <Library size={16} />, run: go('/library') },
      { key: 'go:upcoming', group: 'Navigate', title: 'Airing — new episodes & calendar', icon: <CalendarClock size={16} />, run: go('/upcoming') },
      { key: 'go:stats', group: 'Navigate', title: 'Stats', icon: <BarChart3 size={16} />, run: go('/stats') },
      { key: 'go:wrapped', group: 'Navigate', title: 'Wrapped — your year in TV', icon: <Gift size={16} />, run: go('/wrapped') },
      { key: 'go:assistant', group: 'Navigate', title: 'Ask Dealo — AI assistant', icon: <Bot size={16} />, run: go('/assistant') },
      { key: 'go:taste', group: 'Navigate', title: 'Taste profile', icon: <Sparkles size={16} />, run: go('/taste') },
      { key: 'go:import', group: 'Navigate', title: 'Import from Google Sheets / Excel', icon: <Upload size={16} />, run: go('/settings/import') },
      { key: 'go:settings', group: 'Navigate', title: 'Settings', icon: <Settings size={16} />, run: go('/settings') },
      ...THEME_IDS.map((id) => ({
        key: `theme:${id}`,
        group: 'Theme',
        title: `Theme: ${THEMES[id].name}`,
        sub: THEMES[id].transition,
        icon: id === 'terminal' ? <Cpu size={16} /> : <Palette size={16} />,
        run: () => {
          close();
          setTimeout(() => switchTheme(id), 30);
        },
      })),
      ...DESIGN_IDS.map((id) => ({
        key: `design:${id}`,
        group: 'Design',
        title: `Design: ${DESIGNS[id].name}`,
        sub: DESIGNS[id].tagline,
        icon: <LayoutGrid size={16} />,
        run: () => {
          close();
          nav('/');
          setTimeout(() => switchDesign(id), 30);
        },
      })),
    ];
    const cmdHits = term ? commands.filter((c) => c.title.toLowerCase().includes(term) || c.group.toLowerCase().includes(term)) : commands;
    out.push(...cmdHits);
    // Free text that isn't a show title: offer it to the assistant ("like Dark but funnier").
    if (term.length >= 3 && term.includes(' '))
      out.push({ key: 'ask', group: 'Ask Dealo', title: `Ask Dealo: “${q.trim()}”`, sub: 'AI picks based on your taste', icon: <Bot size={16} />, run: go(`/assistant?q=${encodeURIComponent(q.trim())}`) });
    return out;
  }, [q, remote, entries, nav, close]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active];
      if (!it) return;
      if (e.shiftKey && it.show && !entries[it.show.id]) {
        add(it.show, 'plan');
        toast(`Added “${it.show.title}” to your watchlist`);
        return;
      }
      it.run();
    } else if (e.key === 'Escape') close();
  };

  let lastGroup = '';
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette__input">
          <Search size={20} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search any show, or type a command…" aria-label="Search" />
          {loading && <div className="spinner" />}
          <kbd>esc</kbd>
        </div>
        <div className="palette__list" ref={listRef}>
          {items.length === 0 && <div className="palette__group">No matches</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.key}>
                {header && <div className="palette__group">{header}</div>}
                <button data-i={i} className={`palette__item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onClick={it.run}>
                  {it.show ? (
                    <div className="palette__thumb">
                      <Poster show={it.show} />
                    </div>
                  ) : (
                    <span className="accent">{it.icon}</span>
                  )}
                  <span className="palette__main">
                    <span className="palette__title">{it.title}</span>
                    {it.sub && <span className="palette__sub">{it.sub}</span>}
                  </span>
                  {it.show && !entries[it.show.id] && (
                    <span
                      role="button"
                      tabIndex={-1}
                      className="btn btn--sm btn--icon"
                      title="Add to watchlist"
                      onClick={(e) => {
                        e.stopPropagation();
                        add(it.show!, 'plan');
                        toast(`Added “${it.show!.title}” to your watchlist`);
                      }}
                    >
                      <Plus size={14} />
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette__foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>⇧</kbd>+<kbd>↵</kbd> add to watchlist
          </span>
        </div>
      </div>
    </div>
  );
}
