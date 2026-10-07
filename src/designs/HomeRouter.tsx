import { lazy, Suspense } from 'react';
import { useSettings } from '../store/settings';
import { Home } from '../pages/Home';

const HoloRing = lazy(() => import('./HoloRing'));
const Constellation = lazy(() => import('./Constellation'));
const WarpTunnel = lazy(() => import('./WarpTunnel'));

export function HomeRouter() {
  const design = useSettings((s) => s.design);
  return (
    <Suspense fallback={<div className="page"><div className="spinner" /></div>}>
      {design === 'ring' ? <HoloRing /> : design === 'constellation' ? <Constellation /> : design === 'tunnel' ? <WarpTunnel /> : <Home />}
    </Suspense>
  );
}
