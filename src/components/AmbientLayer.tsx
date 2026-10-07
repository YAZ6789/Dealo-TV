import type { CSSProperties } from 'react';
import { useAmbient } from '../lib/ambient';
import { useSettings } from '../store/settings';

/** Full-page glow in the focused show's colours (see lib/ambient). */
export function AmbientLayer() {
  const { colors, active } = useAmbient();
  const enabled = useSettings((s) => s.ambientColors);
  if (!enabled || !colors) return null;
  return <div className={`ambient ${active ? 'on' : ''}`} style={{ '--amb-a': colors[0], '--amb-b': colors[1] } as CSSProperties} aria-hidden />;
}
