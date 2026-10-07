import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useSettings, type DesignId } from '../store/settings';
import { Home } from '../pages/Home';

const DESIGNS: Record<Exclude<DesignId, 'stream'>, LazyExoticComponent<ComponentType>> = {
  ring: lazy(() => import('./HoloRing')),
  constellation: lazy(() => import('./Constellation')),
  tunnel: lazy(() => import('./WarpTunnel')),
  swipe: lazy(() => import('./SwipeDeck')),
  channel: lazy(() => import('./ChannelSurfer')),
  timeline: lazy(() => import('./LifeTimeline')),
  mission: lazy(() => import('./MissionControl')),
};

export function HomeRouter() {
  const design = useSettings((s) => s.design);
  const Design = design === 'stream' ? undefined : DESIGNS[design];
  return (
    <Suspense fallback={<div className="page"><div className="spinner" /></div>}>
      {Design ? <Design /> : <Home />}
    </Suspense>
  );
}
