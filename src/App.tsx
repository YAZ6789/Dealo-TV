import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { BackgroundFX } from './components/BackgroundFX';
import { CommandPalette } from './components/CommandPalette';
import { Toasts } from './components/Toasts';
import { usePalette } from './components/palette';
import { useHotkeys } from './hooks/useHotkeys';
import { cycleTheme, switchDesign } from './theme/switch';
import { DESIGN_IDS } from './store/settings';
import { initLibrary, useLibrary } from './store/library';
import { useSettings } from './store/settings';
import { scheduleRecommendations } from './recommend/pipeline';
import { enrichLibrary } from './store/enrich';
import { HomeRouter } from './designs/HomeRouter';

const Discover = lazy(() => import('./pages/Discover'));
const Library = lazy(() => import('./pages/Library'));
const Show = lazy(() => import('./pages/Show'));
const Stats = lazy(() => import('./pages/Stats'));
const Taste = lazy(() => import('./pages/Taste'));
const Settings = lazy(() => import('./pages/Settings'));
const Import = lazy(() => import('./pages/Import'));
const Welcome = lazy(() => import('./pages/Welcome'));

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }), [pathname]);
  return null;
}

function Shell() {
  const setPalette = usePalette((s) => s.setOpen);
  const onboarded = useSettings((s) => s.onboarded);
  const hydrated = useLibrary((s) => s.hydrated);
  const hasLibrary = useLibrary((s) => Object.keys(s.entries).length > 0);
  const { pathname } = useLocation();

  useHotkeys({
    'mod+k': () => setPalette(!usePalette.getState().open),
    '/': () => setPalette(true),
    'alt+t': () => cycleTheme(1),
    'alt+d': () => {
      const cur = useSettings.getState().design;
      switchDesign(DESIGN_IDS[(DESIGN_IDS.indexOf(cur) + 1) % DESIGN_IDS.length]);
    },
  });

  if (hydrated && !onboarded && !hasLibrary && pathname === '/') return <Navigate to="/welcome" replace />;

  return (
    <div className="app">
      <BackgroundFX />
      <div className="vt-scanbar" aria-hidden />
      {pathname !== '/welcome' && <TopBar />}
      <main className="main">
        <Suspense fallback={<div className="page"><div className="spinner" /></div>}>
          <Routes>
            <Route path="/" element={<HomeRouter />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/library" element={<Library />} />
            <Route path="/library/:tab" element={<Library />} />
            <Route path="/show/:id" element={<Show />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/taste" element={<Taste />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/import" element={<Import />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <CommandPalette />
      <Toasts />
    </div>
  );
}

export default function App() {
  useEffect(() => {
    void initLibrary().then(() => setTimeout(() => void enrichLibrary(), 4000));
    // Re-rank whenever the library changes (debounced; network parts are cached).
    return useLibrary.subscribe((s, prev) => {
      if (s.hydrated && (s.entries !== prev.entries || s.blocked !== prev.blocked || s.feedback !== prev.feedback || s.taste !== prev.taste)) scheduleRecommendations();
    });
  }, []);
  useEffect(
    () =>
      useSettings.subscribe((s, prev) => {
        if (s.tmdbKey !== prev.tmdbKey || s.tmdbValid !== prev.tmdbValid) scheduleRecommendations(100);
      }),
    [],
  );
  return (
    <HashRouter>
      <ScrollReset />
      <Shell />
    </HashRouter>
  );
}
