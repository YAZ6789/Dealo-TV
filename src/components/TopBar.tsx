import { NavLink, Link } from 'react-router-dom';
import { BarChart3, CalendarClock, Compass, Home, Library, Search, Settings, Sparkles } from 'lucide-react';
import { Logo } from './Logo';
import { ThemeSwitcher } from './ThemeSwitcher';
import { VoiceButton } from '../voice/VoiceButton';
import { usePalette } from './palette';

const LINKS = [
  // Your shows first; recommendations (Discover) are the extra.
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/upcoming', label: 'Airing', icon: CalendarClock },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/taste', label: 'Taste', icon: Sparkles, desktopOnly: true },
];

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);

export function TopBar() {
  const openPalette = usePalette((s) => s.setOpen);
  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" aria-label="Dealo TV home">
            <Logo />
          </Link>
          <nav className="nav" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar__actions">
            <button className="search-trigger" onClick={() => openPalette(true)} aria-label="Search">
              <Search size={16} />
              <span className="label">Search shows…</span>
              <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            <VoiceButton />
            <ThemeSwitcher />
            <NavLink to="/settings" className={({ isActive }) => `icon-btn ${isActive ? 'on' : ''}`} aria-label="Settings">
              <Settings size={19} />
            </NavLink>
          </div>
        </div>
      </header>
      <nav className="tabbar" aria-label="Main">
        {LINKS.filter((l) => !l.desktopOnly).map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            <l.icon size={20} />
            {l.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
