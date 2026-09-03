/**
 * Isometric projection shared by the level data, physics and renderer.
 *
 * World space: (u, v) in tile units on the floor plane, z in pixels of height.
 * Map space:   pixel coordinates on the stage PNG.
 *
 *   sx = (u - v) * 8
 *   sy = (u + v) * 4 - z
 *
 * One tile is a 16x8 px diamond on the map. Moving +1 in u goes screen right/down,
 * +1 in v goes screen left/down. The course descends toward +u+v (screen down).
 */
export const HALF_W = 8;
export const HALF_H = 4;

export interface Vec2 { x: number; y: number }

export function toMap(u: number, v: number, z: number): Vec2 {
  return { x: (u - v) * HALF_W, y: (u + v) * HALF_H - z };
}

/** Inverse projection for a known height. */
export function toWorld(sx: number, sy: number, z: number): { u: number; v: number } {
  const S = (sy + z) / HALF_H;
  const D = sx / HALF_W;
  return { u: (S + D) / 2, v: (S - D) / 2 };
}

/** Convert a screen-space direction (right = +x, down = +y) into a world direction of equal magnitude. */
export function screenDirToWorld(ax: number, ay: number): { du: number; dv: number } {
  // du - dv = ax/8 ; du + dv = ay/4   (scaled so that magnitude is preserved)
  let du = (ax / HALF_W + ay / HALF_H) / 2;
  let dv = (ay / HALF_H - ax / HALF_W) / 2;
  const mIn = Math.hypot(ax, ay);
  const mOut = Math.hypot(du, dv);
  if (mOut > 1e-6) {
    du *= mIn / mOut;
    dv *= mIn / mOut;
  }
  return { du, dv };
}

/** Depth key for painter's algorithm: larger = drawn later (closer to viewer). */
export function depthKey(u: number, v: number, z: number): number {
  return (u + v) * HALF_H + z * 0.001;
}
