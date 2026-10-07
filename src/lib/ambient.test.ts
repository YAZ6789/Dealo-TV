import { describe, expect, it } from 'vitest';
import { fallbackPalette, pickPalette } from './ambient';

/** Builds RGBA pixel data from [r,g,b,count] runs. */
function pixels(...runs: [number, number, number, number][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [r, g, b, n] of runs) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return new Uint8ClampedArray(out);
}
const hue = (c: string) => Number(/hsl\((\d+)/.exec(c)![1]);

describe('pickPalette', () => {
  it('finds the two dominant vivid colours', () => {
    const [a, b] = pickPalette(pixels([220, 30, 30, 300], [30, 60, 220, 150], [20, 20, 20, 400]));
    expect(hue(a)).toBeLessThan(15); // red
    expect(hue(b)).toBeGreaterThan(215); // blue
    expect(hue(b)).toBeLessThan(240);
  });

  it('lets a vivid accent beat a large dull area', () => {
    const [a] = pickPalette(pixels([120, 110, 100, 700], [255, 200, 0, 120]));
    expect(hue(a)).toBeGreaterThan(40);
    expect(hue(a)).toBeLessThan(55);
  });

  it('returns a neutral palette for black-and-white posters', () => {
    const [a] = pickPalette(pixels([10, 10, 10, 300], [240, 240, 240, 300], [128, 128, 128, 300]));
    expect(a).toContain('14%');
  });

  it('derives a second shade for single-colour posters', () => {
    const [a, b] = pickPalette(pixels([20, 160, 60, 400]));
    expect(a).not.toEqual(b);
    expect(Math.abs(hue(b) - hue(a))).toBeGreaterThan(20);
  });

  it('keeps output lightness in a readable band', () => {
    for (const c of pickPalette(pixels([255, 240, 250, 200], [60, 0, 90, 200]))) {
      const l = Number(/(\d+)%\)$/.exec(c)![1]);
      expect(l).toBeGreaterThanOrEqual(38);
      expect(l).toBeLessThanOrEqual(58);
    }
  });
});

describe('fallbackPalette', () => {
  it('is deterministic per show', () => {
    const s = { id: 'catalog:dark', title: 'Dark' };
    expect(fallbackPalette(s)).toEqual(fallbackPalette({ ...s }));
    expect(fallbackPalette(s)).not.toEqual(fallbackPalette({ id: 'catalog:lost', title: 'Lost' }));
  });
});
