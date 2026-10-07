import { useSettings } from '../store/settings';
import { THEMES } from '../theme/themes';

export function LogoMark() {
  return (
    <svg className="logo__mark" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="3" y="6" width="26" height="18" rx="2" stroke="var(--accent)" strokeWidth="1.6" />
      <path d="M13 11.5v7l6-3.5-6-3.5Z" fill="var(--accent)" />
      <path d="M11 28h10M16 24v4" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6 9h4" stroke="var(--accent-2)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  const theme = useSettings((s) => s.theme);
  const l = THEMES[theme].logo;
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo__text">
        {l.pre}
        <b>{l.accent}</b>
        {l.post}
      </span>
    </span>
  );
}
