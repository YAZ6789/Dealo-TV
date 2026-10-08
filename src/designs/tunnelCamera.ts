/**
 * Warp Tunnel camera maths, kept pure so it can be tested. The camera travels
 * along z from 0 (first card) to (count - 1) * SPACING (last card).
 */

export const SPACING = 440;

/** Furthest the camera may travel for `count` cards (0 for an empty or 1-card track). */
export const maxCamFor = (count: number) => Math.max(0, (count - 1) * SPACING);

/** Keep a camera position inside the track; NaN/∞ collapse to the start. */
export function clampCam(z: number, count: number) {
  if (!Number.isFinite(z)) return 0;
  return Math.max(0, Math.min(maxCamFor(count), z));
}

/** Index of the card the camera is nearest to, always a valid index (0 for an empty track). */
export function focusIndex(cam: number, count: number) {
  if (count <= 0 || !Number.isFinite(cam)) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(cam / SPACING)));
}

/** Target after stepping `d` whole cards from `target`, snapped to a card and clamped. */
export function stepTarget(target: number, d: number, count: number) {
  return clampCam(Math.round(clampCam(target, count) / SPACING + d) * SPACING, count);
}

/**
 * Snap after a wheel or a slow drag: settle on the next card in the direction
 * of travel, so one wheel notch (less than half a card) still moves you on
 * instead of springing back.
 */
export function snapToward(target: number, dir: number, count: number) {
  const t = clampCam(target, count) / SPACING;
  const card = dir > 0 ? Math.ceil(t - 0.12) : dir < 0 ? Math.floor(t + 0.12) : Math.round(t);
  return clampCam(card * SPACING, count);
}

/**
 * Where a released drag comes to rest: a flick (velocity in camera px per ms)
 * carries on for up to `maxCards`, then snaps to the nearest card.
 */
export function flingTarget(target: number, velocity: number, count: number, maxCards = 4) {
  const cards = Number.isFinite(velocity) ? Math.max(-maxCards, Math.min(maxCards, velocity * 1.6)) : 0;
  return stepTarget(target + cards * SPACING, 0, count);
}

/** One frame of easing towards the target. Returns the new position and whether it has arrived. */
export function easeCam(cam: number, target: number, k: number) {
  const next = cam + (target - cam) * k;
  if (Math.abs(target - next) < 0.5) return { cam: target, settled: true };
  return { cam: next, settled: false };
}

/** Opacity of card `i` with the camera at `cam`: gone once passed, fading out with distance ahead. */
export function cardOpacity(i: number, cam: number) {
  const z = -i * SPACING - 260 + cam;
  if (z > 160) return 0;
  if (z > 0) return 1 - z / 160; // just passed: fade out before it fills the screen
  if (z > -200) return 1;
  return Math.max(0, 1 + (z + 200) / 3600);
}

/** Cards that get real pictures right now: a few behind the focus and the stretch ahead that is visible. */
export function nearWindow(focus: number, count: number, behind = 3, ahead = 9) {
  return { from: Math.max(0, focus - behind), to: Math.min(count - 1, focus + ahead) };
}

/**
 * Indexes to pre-load, most urgent first: interleaves the next cards in the
 * direction of travel (`dir` = +1 forwards / -1 back) with a few the other way.
 */
export function prefetchOrder(focus: number, dir: 1 | -1, count: number, ahead = 8, behind = 3) {
  const out: number[] = [];
  const push = (i: number) => i >= 0 && i < count && !out.includes(i) && out.push(i);
  for (let k = 1; k <= Math.max(ahead, behind); k++) {
    if (k <= ahead) push(focus + dir * k);
    if (k <= behind) push(focus - dir * k);
  }
  return out;
}
