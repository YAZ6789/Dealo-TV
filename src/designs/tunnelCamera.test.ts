import { describe, expect, it } from 'vitest';
import { cardOpacity, clampCam, snapToward, easeCam, flingTarget, focusIndex, maxCamFor, nearWindow, prefetchOrder, SPACING, stepTarget } from './tunnelCamera';

describe('tunnel camera', () => {
  it('never leaves the track, even for empty or 1-card tracks', () => {
    expect(maxCamFor(0)).toBe(0);
    expect(maxCamFor(1)).toBe(0);
    expect(clampCam(5000, 3)).toBe(2 * SPACING);
    expect(clampCam(-10, 3)).toBe(0);
    expect(clampCam(NaN, 3)).toBe(0);
    expect(clampCam(Infinity, 3)).toBe(0);
  });

  it('always reports a valid focus index', () => {
    expect(focusIndex(0, 0)).toBe(0);
    expect(focusIndex(99999, 4)).toBe(3);
    expect(focusIndex(-500, 4)).toBe(0);
    expect(focusIndex(SPACING * 1.4, 4)).toBe(1);
    expect(focusIndex(SPACING * 1.6, 4)).toBe(2);
  });

  it('steps whole cards and pulls a stale target back when the track shrinks', () => {
    expect(stepTarget(0, 1, 5)).toBe(SPACING);
    expect(stepTarget(SPACING * 1.3, 0, 5)).toBe(SPACING);
    expect(stepTarget(SPACING * 4, 1, 5)).toBe(SPACING * 4);
    // was on card 30 of a long track, the track now has 3 cards
    expect(stepTarget(SPACING * 30, 0, 3)).toBe(SPACING * 2);
    expect(stepTarget(SPACING * 30, -1, 3)).toBe(SPACING * 1);
  });

  it('moves on one card for a single wheel notch, either way', () => {
    expect(snapToward(168, 1, 10)).toBe(SPACING);
    expect(snapToward(SPACING - 168, -1, 10)).toBe(0);
    expect(snapToward(SPACING * 2 + 20, 1, 10)).toBe(SPACING * 2); // overshoot of a few px is not another card
    expect(snapToward(SPACING * 2 - 20, -1, 10)).toBe(SPACING * 2);
    expect(snapToward(SPACING * 9 + 100, 1, 10)).toBe(SPACING * 9);
    expect(snapToward(-50, -1, 10)).toBe(0);
    expect(snapToward(300, 0, 10)).toBe(SPACING);
  });

  it('flings a few cards and snaps', () => {
    expect(flingTarget(0, 0, 10)).toBe(0);
    expect(flingTarget(0, 1.3, 10)).toBe(2 * SPACING);
    expect(flingTarget(0, 50, 10)).toBe(4 * SPACING);
    expect(flingTarget(SPACING * 2, -50, 10)).toBe(0);
    expect(flingTarget(0, NaN, 10)).toBe(0);
  });

  it('eases to rest exactly on the target', () => {
    let s = { cam: 0, settled: false };
    let frames = 0;
    while (!s.settled && frames < 500) {
      s = easeCam(s.cam, 880, 0.12);
      frames++;
    }
    expect(s.cam).toBe(880);
    expect(frames).toBeLessThan(120);
  });

  it('fades cards that are behind or far ahead', () => {
    expect(cardOpacity(0, 0)).toBeCloseTo(1, 1);
    expect(cardOpacity(0, SPACING * 2)).toBe(0); // passed
    expect(cardOpacity(20, 0)).toBe(0); // too far ahead
    expect(cardOpacity(3, 0)).toBeGreaterThan(0.3);
  });

  it('loads pictures around the focus, the way you are flying first', () => {
    expect(nearWindow(0, 50)).toEqual({ from: 0, to: 9 });
    expect(nearWindow(48, 50)).toEqual({ from: 45, to: 49 });
    expect(prefetchOrder(5, 1, 50).slice(0, 4)).toEqual([6, 4, 7, 3]);
    expect(prefetchOrder(5, -1, 50).slice(0, 2)).toEqual([4, 6]);
    expect(prefetchOrder(0, 1, 3)).toEqual([1, 2]);
    expect(prefetchOrder(0, 1, 0)).toEqual([]);
  });
});
