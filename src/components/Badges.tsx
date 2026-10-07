import { Ban, Clock, Compass, Flame, Globe, History, Moon, Repeat, Star, Sunrise, Trophy, Zap } from 'lucide-react';
import { TIER_NAME, type Badge, type BadgeIcon } from '../stats/badges';

const ICONS: Record<BadgeIcon, typeof Flame> = { flame: Flame, zap: Zap, trophy: Trophy, clock: Clock, star: Star, globe: Globe, history: History, compass: Compass, moon: Moon, ban: Ban, repeat: Repeat, sunrise: Sunrise };

/** Achievement grid: earned tiers glow bronze/silver/gold, locked ones show progress to the next tier. */
export function Badges({ badges }: { badges: Badge[] }) {
  return (
    <ul className="badges">
      {badges.map((b) => {
        const Icon = ICONS[b.icon];
        return (
          <li key={b.id} className={`badge badge--t${b.tier}`} title={b.hint}>
            <span className="badge__medal" aria-hidden>
              <Icon size={22} />
            </span>
            <span className="badge__main">
              <span className="badge__name">
                {b.name} <span className="badge__tier">{TIER_NAME[b.tier]}</span>
              </span>
              <span className="badge__sub">
                {b.value.toLocaleString()} {b.unit}
                {b.next != null && <> · next at {b.next.toLocaleString()}</>}
              </span>
              <span className="badge__bar" role="progressbar" aria-valuenow={Math.round(b.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.name} progress`}>
                <i style={{ width: `${b.progress * 100}%` }} />
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
