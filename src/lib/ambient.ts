import { useEffect } from 'react';
import { create } from 'zustand';
import type { ShowSummary } from '../types';
import { requestArtwork } from '../providers/artwork';
import { useSettings } from '../store/settings';

/**
 * Show-coloured background: the two dominant vivid colours of the focused
 * show's poster tint the page. Posters that can't be read (no artwork, CORS)
 * fall back to the same hues as the procedural poster art, so the background
 * always matches what's on screen.
 */

export type Palette = [string, string];

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Same hues the procedural <Art> uses for a show without images. */
export function fallbackPalette(show: Pick<ShowSummary, 'id' | 'title'>): Palette {
  const h = hash(show.id + show.title);
  const h1 = h % 360;
  const h2 = (h1 + 30 + ((h >> 8) % 90)) % 360;
  return [`hsl(${h1} 70% 50%)`, `hsl(${h2} 72% 44%)`];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [h, s, l];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const BUCKETS = 18; // 20° hue slices

/**
 * Picks two distinct vivid colours from RGBA pixel data. Pixels are binned by
 * hue and weighted by chroma, so a small splash of saturated colour beats a
 * large dull area. Output is normalised to a lightness range that reads well
 * as a background glow on every skin. Pure, for tests.
 */
export function pickPalette(data: ArrayLike<number>): Palette {
  const weight = new Float64Array(BUCKETS);
  const sums = Array.from({ length: BUCKETS }, () => [0, 0, 0]);
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.07 || l > 0.96) continue;
    const w = s * (1 - Math.abs(2 * l - 1)); // chroma
    if (w < 0.08) continue;
    const b = Math.floor(h / (360 / BUCKETS)) % BUCKETS;
    weight[b] += w;
    sums[b][0] += data[i] * w;
    sums[b][1] += data[i + 1] * w;
    sums[b][2] += data[i + 2] * w;
    total += w;
  }
  const pixels = data.length / 4;
  // Black-and-white or near-grey poster: a cool neutral, not random colour.
  if (total < pixels * 0.02) return ['hsl(220 14% 52%)', 'hsl(220 10% 38%)'];

  const colour = (b: number, dl = 0) => {
    const [r, g, bl] = sums[b].map((v) => v / weight[b]);
    const [h, s, l] = rgbToHsl(r, g, bl);
    return `hsl(${Math.round(h)} ${Math.round(clamp(s, 0.45, 0.85) * 100)}% ${Math.round((clamp(l, 0.42, 0.58) + dl) * 100)}%)`;
  };
  let first = 0;
  for (let b = 1; b < BUCKETS; b++) if (weight[b] > weight[first]) first = b;
  let second = -1;
  for (let b = 0; b < BUCKETS; b++) {
    const dist = Math.min(Math.abs(b - first), BUCKETS - Math.abs(b - first));
    if (dist >= 2 && (second < 0 || weight[b] > weight[second])) second = b;
  }
  if (second < 0 || weight[second] < weight[first] * 0.12) {
    // One-colour poster: a darker, shifted shade of the same colour for depth.
    const [h, s] = rgbToHsl(...(sums[first].map((v) => v / weight[first]) as [number, number, number]));
    return [colour(first), `hsl(${Math.round(h + 28) % 360} ${Math.round(clamp(s, 0.45, 0.85) * 100)}% 40%)`];
  }
  return [colour(first), colour(second, -0.04)];
}

const memo = new Map<string, Palette>();

function smallPoster(url: string): string {
  return url.replace(/\/t\/p\/(w\d+|original)\//, '/t/p/w92/');
}

function readImage(url: string): Promise<Palette | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const done = (p: Palette | null) => {
      img.onload = img.onerror = null;
      resolve(p);
    };
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 24;
        c.height = 36;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        done(pickPalette(ctx.getImageData(0, 0, c.width, c.height).data));
      } catch {
        done(null); // tainted canvas (no CORS headers)
      }
    };
    img.src = smallPoster(url);
    setTimeout(() => done(null), 5000);
  });
}

function posterUrl(show: ShowSummary): Promise<string | undefined> {
  if (show.poster) return Promise.resolve(show.poster);
  if (show.source !== 'catalog' && show.source !== 'custom') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const cancel = requestArtwork(show, (a) => resolve(a?.poster));
    setTimeout(() => {
      cancel();
      resolve(undefined);
    }, 4000);
  });
}

export async function paletteFor(show: ShowSummary): Promise<Palette> {
  const hit = memo.get(show.id);
  if (hit) return hit;
  const url = await posterUrl(show);
  const p = (url && (await readImage(url))) || fallbackPalette(show);
  memo.set(show.id, p);
  return p;
}

interface AmbientState {
  colors: Palette | null;
  active: boolean;
}

export const useAmbient = create<AmbientState>(() => ({ colors: null, active: false }));

let owner: object | null = null;

/** Tints the page with this show's colours while the calling component is mounted. */
export function useAmbientShow(show: ShowSummary | null | undefined) {
  const enabled = useSettings((s) => s.ambientColors);
  useEffect(() => {
    if (!enabled || !show) return;
    const token = {};
    owner = token;
    const cached = memo.get(show.id);
    if (cached) useAmbient.setState({ colors: cached, active: true });
    else
      void paletteFor(show).then((p) => {
        if (owner === token) useAmbient.setState({ colors: p, active: true });
      });
    return () => {
      if (owner !== token) return;
      owner = null;
      // Grace period so moving between shows cross-fades instead of flashing.
      setTimeout(() => {
        if (owner === null) useAmbient.setState({ active: false });
      }, 350);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, show?.id]);
}
