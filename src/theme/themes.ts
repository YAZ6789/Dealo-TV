import type { DesignId, ThemeId } from '../store/settings';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  transition: string;
  /** For the switcher preview swatches. */
  swatch: [string, string, string];
  logo: { pre: string; accent: string; post?: string };
}

export const THEMES: Record<ThemeId, ThemeMeta> = {
  hud: {
    id: 'hud',
    name: 'Cyan HUD',
    tagline: 'Ship-console glass, cyan light, scan-lines',
    transition: 'Scan sweep',
    swatch: ['#03060d', '#00e5ff', '#8b5cf6'],
    logo: { pre: 'DEALO', accent: '//', post: 'TV' },
  },
  neon: {
    id: 'neon',
    name: 'Neon',
    tagline: 'Hot pink, acid yellow, glitch & rain',
    transition: 'Glitch cut',
    swatch: ['#07060b', '#ff2a6d', '#f9f002'],
    logo: { pre: 'DEALO', accent: '.', post: 'TV' },
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora',
    tagline: 'Calm, premium, spatial-computing light',
    transition: 'Light bloom',
    swatch: ['#090a10', '#8fd8ff', '#b69cff'],
    logo: { pre: 'Dealo ', accent: 'TV' },
  },
  terminal: {
    id: 'terminal',
    name: 'Phosphor',
    tagline: 'Phosphor-green CRT, monospace, ASCII',
    transition: 'CRT power cycle',
    swatch: ['#010401', '#00ff9c', '#ffb000'],
    logo: { pre: 'dealo@tv', accent: ':~$' },
  },
};

export interface DesignMeta {
  id: DesignId;
  name: string;
  tagline: string;
}

export const DESIGNS: Record<DesignId, DesignMeta> = {
  ring: { id: 'ring', name: 'Holo Ring', tagline: 'A rotating 3D carousel on a holographic base — sci-fi console' },
  constellation: { id: 'constellation', name: 'Constellation', tagline: 'Your taste as a star map — matches orbit closer to you' },
  tunnel: { id: 'tunnel', name: 'Warp Tunnel', tagline: 'Fly through your history and into what’s next' },
  stream: { id: 'stream', name: 'Stream', tagline: 'Classic streaming rows, hero billboard, shelves' },
};
