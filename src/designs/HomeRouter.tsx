import { Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useSettings, type DesignId } from '../store/settings';
import { Home } from '../pages/Home';
import { lazyRoute } from '../lib/lazyRoute';

const DESIGNS: Record<Exclude<DesignId, 'stream'>, LazyExoticComponent<ComponentType>> = {
  ring: lazyRoute(() => import('./HoloRing')),
  constellation: lazyRoute(() => import('./Constellation')),
  tunnel: lazyRoute(() => import('./WarpTunnel')),
  swipe: lazyRoute(() => import('./SwipeDeck')),
  channel: lazyRoute(() => import('./ChannelSurfer')),
  timeline: lazyRoute(() => import('./LifeTimeline')),
  mission: lazyRoute(() => import('./MissionControl')),
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
