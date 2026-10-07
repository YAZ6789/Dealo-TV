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
  surveillance: {
    id: 'surveillance',
    name: 'Surveillance',
    tagline: 'CCTV feeds, tracking brackets, hard camera cuts',
    transition: 'Camera cut',
    swatch: ['#050505', '#f2d600', '#e2262b'],
    logo: { pre: 'DEALO', accent: ' ▮ ', post: 'FEED' },
  },
  daylight: {
    id: 'daylight',
    name: 'Daylight',
    tagline: 'A light, airy skin for bright rooms',
    transition: 'Sunrise wipe',
    swatch: ['#f6f7fb', '#3651e8', '#e0457b'],
    logo: { pre: 'Dealo ', accent: 'TV' },
  },
  contrast: {
    id: 'contrast',
    name: 'High Contrast',
    tagline: 'Maximum legibility — pure black, white and yellow',
    transition: 'Hard cut',
    swatch: ['#000000', '#ffe600', '#ffffff'],
    logo: { pre: 'DEALO', accent: ' TV' },
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
  swipe: { id: 'swipe', name: 'Swipe Deck', tagline: 'Swipe right to save, left to skip — rate fast' },
  channel: { id: 'channel', name: 'Channel Surfer', tagline: 'Flip through your shows on a retro TV' },
  timeline: { id: 'timeline', name: 'Life Timeline', tagline: 'Every show on the years it aired' },
  mission: { id: 'mission', name: 'Mission Control', tagline: 'A live dashboard of everything at once' },
  stream: { id: 'stream', name: 'Stream', tagline: 'Classic streaming rows, hero billboard, shelves' },
};
