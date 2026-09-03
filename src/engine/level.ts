import { toWorld, HALF_H, HALF_W } from './iso';
import { STEP_UP, WALL_MAX } from './constants';

export type SurfaceKind = 'floor' | 'ice' | 'wall';

export interface HmPiece { yMax: number; a: number; b: number; c: number }
export interface HmComponent { id: number; kind: 'flat' | 'slope'; a: number; b: number; c: number; area: number; bbox: number[]; pieces?: HmPiece[] }

/**
 * Pixel-accurate collision derived from the stage art (tools/heightmap.py):
 * a label image (component id per map pixel) and an affine height per component,
 * z = a + b*x + c*y in map pixels.
 */
export class HeightMap {
  constructor(readonly width: number, readonly height: number, readonly labels: Uint8Array, readonly comps: HmComponent[]) {}

  /** height of component at world (u,v) */
  zOf(c: HmComponent, u: number, v: number): number {
    if (c.pieces) {
      const S4 = HALF_H * (u + v), D8 = HALF_W * (u - v);
      for (const p of c.pieces) {
        const z = (p.a + p.b * D8 + p.c * S4) / (1 + p.c);
        if (S4 - z <= p.yMax) return z;
      }
      const p = c.pieces[c.pieces.length - 1];
      return (p.a + p.b * D8 + p.c * S4) / (1 + p.c);
    }
    return (c.a + c.b * HALF_W * (u - v) + c.c * HALF_H * (u + v)) / (1 + c.c);
  }

  private pieceAt(c: HmComponent, u: number, v: number): { b: number; c: number } {
    if (!c.pieces) return c;
    const S4 = HALF_H * (u + v), D8 = HALF_W * (u - v);
    for (const p of c.pieces) {
      const z = (p.a + p.b * D8 + p.c * S4) / (1 + p.c);
      if (S4 - z <= p.yMax) return p;
    }
    return c.pieces[c.pieces.length - 1];
  }

  /**
   * Is world point (u,v) on component c (at c's own height there)? A few rows below the
   * exact pixel are accepted too, so a floor whose modelled height is slightly too high
   * still catches the marble instead of letting it fall through.
   */
  hit(c: HmComponent, u: number, v: number, z: number): boolean {
    const x = Math.round(HALF_W * (u - v));
    const y = Math.round(HALF_H * (u + v) - z);
    if (x < 0 || x >= this.width) return false;
    const yEnd = Math.min(this.height - 1, y + 4);
    for (let yy = Math.max(0, y); yy <= yEnd; yy++) {
      if (this.labels[yy * this.width + x] === c.id) return true;
    }
    return false;
  }

  gradient(c: HmComponent, u = 0, v = 0): { gu: number; gv: number } {
    const p = this.pieceAt(c, u, v);
    const k = 1 / (1 + p.c);
    return { gu: (HALF_W * p.b + HALF_H * p.c) * k, gv: (-HALF_W * p.b + HALF_H * p.c) * k };
  }
}

export interface Surface {
  id: number;
  /**
   * Footprint. For `sd` surfaces the bounds are in screen-aligned coordinates
   * S = u + v (screen down) and D = u - v (screen right): u0/u1 hold S, v0/v1 hold D.
   */
  u0: number; v0: number; u1: number; v1: number;
  /** height (px) at (u0, v0) */
  z0: number;
  /** height gradient per unit along u and v (or S and D for `sd` surfaces) */
  gu: number; gv: number;
  kind: SurfaceKind;
  sd?: boolean;
  name?: string;
  /** set for surfaces backed by the pixel height map */
  hm?: { map: HeightMap; comp: HmComponent };
  /** walls only block marbles whose height is within [wall floor - 30, wall floor + wallH] */
  wallH?: number;
}

export type ZoneKind = 'goal' | 'bonus' | 'timezone' | 'checkpoint' | 'kill';

export interface Zone {
  kind: ZoneKind;
  u0: number; v0: number; u1: number; v1: number;
  value?: number;
  id?: string;
  /** optional height band so a zone only fires on the intended floor */
  zMin?: number; zMax?: number;
}

export interface Pipe {
  /** entry footprint */
  u0: number; v0: number; u1: number; v1: number;
  zMin?: number; zMax?: number;
  /** exit point (+ height) and exit velocity (tiles/s) */
  exit: { u: number; v: number; z?: number; vu: number; vv: number };
  duration: number;
  bonus?: number;
}

export type HazardKind = 'steelie' | 'worm' | 'slime' | 'hammer' | 'vacuum' | 'birds' | 'wand';

export interface HazardSpawn {
  kind: HazardKind;
  u: number; v: number;
  /** wander / patrol radius in tiles (slime, worm) */
  range?: number;
  /** activation region for birds / wand (u+v band), default whole stage */
  band?: [number, number];
  period?: number;
  phase?: number;
  count?: number;
  facing?: 1 | -1;
}

export interface StageDef {
  id: number;
  name: string;
  music: string;
  image: string;
  width: number;
  height: number;
  /** map-x offset when the image is wider than the 288 px view */
  viewX0: number;
  /** seconds added at race start */
  timeAdd: number;
  /** whether the previous race's remaining time carries over */
  carryTime: boolean;
  /** progress direction: +1 = descend (u+v increases), -1 = ascend (Silly race) */
  progressDir: 1 | -1;
  surfaces: Surface[];
  start: { u: number; v: number; z?: number };
  checkpoints: { u: number; v: number }[];
  zones: Zone[];
  pipes: Pipe[];
  hazards: HazardSpawn[];
  /** lowest floor height; falling below this minus a margin is fatal */
  floorMin: number;
  /** true when the stage uses the art-derived height map (attached at load) */
  heightmap?: HeightMap;
  /** manual surfaces authored in the stage file (kept separate so a reload can re-attach) */
  manualSurfaces: Surface[];
}

export interface Support { z: number; s: Surface }

export function heightOn(s: Surface, u: number, v: number): number {
  if (s.hm) return s.hm.map.zOf(s.hm.comp, u, v);
  if (s.sd) {
    const S = u + v, D = u - v;
    return s.z0 + s.gu * (S - s.u0) + s.gv * (D - s.v0);
  }
  return s.z0 + s.gu * (u - s.u0) + s.gv * (v - s.v0);
}

/** dz/du, dz/dv of a surface (constant per surface). */
export function gradientOn(s: Surface, u = 0, v = 0): { gu: number; gv: number } {
  if (s.hm) return s.hm.map.gradient(s.hm.comp, u, v);
  if (s.sd) return { gu: s.gu + s.gv, gv: s.gu - s.gv };
  return { gu: s.gu, gv: s.gv };
}

export function inRect(r: { u0: number; v0: number; u1: number; v1: number; sd?: boolean; hm?: Surface['hm'] }, u: number, v: number): boolean {
  if (r.hm) return r.hm.map.hit(r.hm.comp, u, v, r.hm.map.zOf(r.hm.comp, u, v));
  if (r.sd) {
    const S = u + v, D = u - v;
    return S >= r.u0 && S <= r.u1 && D >= r.v0 && D <= r.v1;
  }
  return u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;
}

/** Highest surface at (u,v) whose height is at most zRef + stepUp. */
export function supportAt(level: StageDef, u: number, v: number, zRef: number, stepUp = STEP_UP, prefer?: Surface | null): Support | null {
  const lim = zRef + stepUp;
  // hysteresis: keep standing on the current surface while it is still under the marble
  if (prefer && prefer.kind !== 'wall' && inRect(prefer, u, v)) {
    const zp = heightOn(prefer, u, v);
    if (zp <= lim && zp >= zRef - 6) return { z: zp, s: prefer };
  }
  let best: Support | null = null;
  for (const s of level.surfaces) {
    if (s.kind === 'wall') continue;
    if (!inRect(s, u, v)) continue;
    const z = heightOn(s, u, v);
    if (z <= lim && (!best || z > best.z)) best = { z, s };
  }
  return best;
}

/** Highest surface at (u,v) below zRef + wallMax (used to detect wall faces). */
export function highestBelow(level: StageDef, u: number, v: number, zRef: number, wallMax = WALL_MAX, ignore?: Set<number>): Support | null {
  let best: Support | null = null;
  const lim = zRef + wallMax;
  for (const s of level.surfaces) {
    if (ignore && ignore.has(s.id)) continue;
    if (!inRect(s, u, v)) continue;
    if (s.kind === 'wall') {
      const zw = heightOn(s, u, v);
      const h = s.wallH ?? 300;
      if (zRef <= zw + h && zRef >= zw - 8) return { z: zRef + wallMax, s };   // solid obstacle in the marble's height band
      continue;
    }
    const z = heightOn(s, u, v);
    if (z <= lim && (!best || z > best.z)) best = { z, s };
  }
  return best;
}

/** Highest surface at (u,v) regardless of height (for spawning objects). */
export function topAt(level: StageDef, u: number, v: number): Support | null {
  return supportAt(level, u, v, 1e9, 0);
}

export function zonesAt(level: StageDef, u: number, v: number, z: number): Zone[] {
  const out: Zone[] = [];
  for (const zn of level.zones) {
    if (!inRect(zn, u, v)) continue;
    if (zn.zMin !== undefined && z < zn.zMin) continue;
    if (zn.zMax !== undefined && z > zn.zMax) continue;
    out.push(zn);
  }
  return out;
}

export function pipeAt(level: StageDef, u: number, v: number, z: number): Pipe | null {
  for (const p of level.pipes) {
    if (!inRect(p, u, v)) continue;
    if (p.zMin !== undefined && z < p.zMin) continue;
    if (p.zMax !== undefined && z > p.zMax) continue;
    return p;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Authoring helpers                                                         */
/* ------------------------------------------------------------------------ */

export interface StageOpts {
  id: number; name: string; music: string; image: string;
  width: number; height: number; timeAdd: number; carryTime: boolean;
  progressDir?: 1 | -1; viewX0?: number;
}

/**
 * Fluent builder used by src/levels/*.ts. Coordinates passed to `plat`/`ramp`
 * are MAP PIXELS of the platform's top corner (the topmost vertex of its floor
 * diamond) so they can be read straight off the stage image.
 */
export class LevelBuilder {
  private nextId = 1;
  readonly def: StageDef;

  constructor(o: StageOpts) {
    this.def = {
      id: o.id, name: o.name, music: o.music, image: o.image, width: o.width, height: o.height,
      viewX0: o.viewX0 ?? Math.max(0, Math.floor((o.width - 288) / 2)),
      timeAdd: o.timeAdd, carryTime: o.carryTime, progressDir: o.progressDir ?? 1,
      surfaces: [], start: { u: 0, v: 0 }, checkpoints: [], zones: [], pipes: [], hazards: [], floorMin: 0, manualSurfaces: [],
    };
  }

  /** world coords of a map pixel at height z (snapped to half tiles) */
  uv(x: number, y: number, z: number): { u: number; v: number } {
    const w = toWorld(x, y, z);
    return { u: Math.round(w.u * 2) / 2, v: Math.round(w.v * 2) / 2 };
  }

  /** Flat platform. (x,y) = map pixel of top corner, lenU/lenV in tiles, z height. */
  plat(x: number, y: number, lenU: number, lenV: number, z: number, name?: string): Surface {
    const { u, v } = this.uv(x, y, z);
    return this.rect(u, v, u + lenU, v + lenV, z, 0, 0, name);
  }

  /**
   * Sloped platform. z is the height at the top corner (u0,v0); gu/gv are px of
   * height change per tile along u and v (negative = descends).
   */
  ramp(x: number, y: number, lenU: number, lenV: number, z: number, gu: number, gv: number, name?: string): Surface {
    const { u, v } = this.uv(x, y, z);
    return this.rect(u, v, u + lenU, v + lenV, z, gu, gv, name);
  }

  rect(u0: number, v0: number, u1: number, v1: number, z0: number, gu = 0, gv = 0, name?: string, kind: SurfaceKind = 'floor'): Surface {
    const s: Surface = { id: this.nextId++, u0, v0, u1, v1, z0, gu, gv, kind, name };
    this.def.surfaces.push(s);
    return s;
  }

  /**
   * Screen-aligned band: map-pixel x range [x0,x1], top edge at map y = yTop where the
   * height is zTop; extends lenS tiles down-screen with slope gS (px of height per unit S,
   * negative = descends) and gD across (px per unit D).
   */
  band(x0: number, x1: number, yTop: number, lenS: number, zTop: number, gS = 0, gD = 0, name?: string): Surface {
    const s0 = Math.round(((yTop + zTop) / HALF_H) * 2) / 2;
    const d0 = Math.round((x0 / HALF_W) * 2) / 2, d1 = Math.round((x1 / HALF_W) * 2) / 2;
    const s: Surface = { id: this.nextId++, u0: s0, v0: d0, u1: s0 + lenS, v1: d1, z0: zTop, gu: gS, gv: gD, kind: 'floor', sd: true, name };
    this.def.surfaces.push(s);
    return s;
  }

  /**
   * Axis-aligned strip between two map points (with heights): a ramp/corridor `width` tiles wide
   * whose height varies linearly along its long axis (u or v, whichever changes more).
   */
  strip(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, name?: string, ext = 0.35): Surface {
    const a = toWorld(x0, y0, z0), b = toWorld(x1, y1, z1);
    const du = b.u - a.u, dv = b.v - a.v;
    const half = width / 2;
    // `ext` tiles of overlap at both ends so the marble never finds a gap at the junctions
    if (Math.abs(du) >= Math.abs(dv)) {
      const gu = (z1 - z0) / (b.u - a.u);
      const u0 = Math.min(a.u, b.u) - ext, u1 = Math.max(a.u, b.u) + ext;
      const vc = (a.v + b.v) / 2;
      const zAtU0 = (a.u <= b.u ? z0 : z1) - gu * ext;
      return this.rect(u0, vc - half, u1, vc + half, zAtU0, gu, 0, name);
    }
    const gv = (z1 - z0) / (b.v - a.v);
    const v0 = Math.min(a.v, b.v) - ext, v1 = Math.max(a.v, b.v) + ext;
    const uc = (a.u + b.u) / 2;
    const zAtV0 = (a.v <= b.v ? z0 : z1) - gv * ext;
    return this.rect(uc - half, v0, uc + half, v1, zAtV0, 0, gv, name);
  }

  /** Solid rails along both long edges of a strip (so the marble stays in the chute). */
  rails(s: Surface, thickness = 0.6, wallH = 14): void {
    const alongU = (s.u1 - s.u0) >= (s.v1 - s.v0);
    const mk = (u0: number, v0: number, u1: number, v1: number, name: string) => {
      const r = this.rect(u0, v0, u1, v1, heightOn(s, u0, v0), s.gu, s.gv, name, 'wall');
      r.wallH = wallH;
    };
    if (alongU) {
      mk(s.u0, s.v0 - thickness, s.u1, s.v0, `${s.name ?? 'strip'}-railA`);
      mk(s.u0, s.v1, s.u1, s.v1 + thickness, `${s.name ?? 'strip'}-railB`);
    } else {
      mk(s.u0 - thickness, s.v0, s.u0, s.v1, `${s.name ?? 'strip'}-railA`);
      mk(s.u1, s.v0, s.u1 + thickness, s.v1, `${s.name ?? 'strip'}-railB`);
    }
  }

  /** Solid rails along both D edges of a screen-aligned band (half-pipe walls). */
  bandRails(b: Surface, thickness = 0.6, wallH = 14): void {
    // same plane as the band (S/D gradients), offset in D
    this.def.surfaces.push({ id: this.nextId++, u0: b.u0, v0: b.v0 - thickness, u1: b.u1, v1: b.v0, z0: b.z0 - b.gv * thickness, gu: b.gu, gv: b.gv, kind: 'wall', sd: true, name: `${b.name ?? 'band'}-railA`, wallH });
    this.def.surfaces.push({ id: this.nextId++, u0: b.u0, v0: b.v1, u1: b.u1, v1: b.v1 + thickness, z0: b.z0 + b.gv * (b.v1 - b.v0), gu: b.gu, gv: b.gv, kind: 'wall', sd: true, name: `${b.name ?? 'band'}-railB`, wallH });
  }

  /** Solid obstacle (tent, post, cube cluster): blocks the marble at any height. Map-pixel screen rectangle. */
  wallBand(x0: number, x1: number, y0: number, y1: number, zRef: number, name?: string): Surface {
    const s0 = (y0 + zRef) / HALF_H, s1 = (y1 + zRef) / HALF_H;
    const d0 = x0 / HALF_W, d1 = x1 / HALF_W;
    const s: Surface = { id: this.nextId++, u0: s0, v0: d0, u1: s1, v1: d1, z0: 0, gu: 0, gv: 0, kind: 'wall', sd: true, name };
    this.def.surfaces.push(s);
    return s;
  }

  /** Solid obstacle from a world-space rectangle around a map pixel at height z. */
  wallAt(x: number, y: number, z: number, halfU: number, halfV: number, name?: string): Surface {
    const { u, v } = this.uv(x, y, z);
    return this.rect(u - halfU, v - halfV, u + halfU, v + halfV, z, 0, 0, name, 'wall');
  }

  /** band continuing below another band (shares the edge S = from.u1) */
  bandBelow(from: Surface, lenS: number, gS = 0, gD = 0, name?: string, d0?: number, d1?: number): Surface {
    const S0 = from.u1;
    const D0 = d0 ?? from.v0;
    const z0 = from.z0 + from.gu * (S0 - from.u0) + from.gv * (D0 - from.v0);
    const s: Surface = { id: this.nextId++, u0: S0, v0: D0, u1: S0 + lenS, v1: d1 ?? from.v1, z0, gu: gS, gv: gD, kind: 'floor', sd: true, name };
    this.def.surfaces.push(s);
    return s;
  }

  /** Rectangle continuing from an existing surface's edge (same height at the shared edge). */
  extend(from: Surface, side: 'u1' | 'v1' | 'u0' | 'v0', lenU: number, lenV: number, gu = 0, gv = 0, name?: string): Surface {
    let u0: number, v0: number;
    if (side === 'u1') { u0 = from.u1; v0 = from.v0; }
    else if (side === 'v1') { u0 = from.u0; v0 = from.v1; }
    else if (side === 'u0') { u0 = from.u0 - lenU; v0 = from.v0; }
    else { u0 = from.u0; v0 = from.v0 - lenV; }
    const z0 = heightOn(from, u0, v0);
    return this.rect(u0, v0, u0 + lenU, v0 + lenV, z0, gu, gv, name);
  }

  start(u: number, v: number, z?: number): void { this.def.start = { u, v, z }; }
  checkpoint(u: number, v: number): void { this.def.checkpoints.push({ u, v }); }

  zone(kind: ZoneKind, u0: number, v0: number, u1: number, v1: number, value?: number, id?: string, zMin?: number, zMax?: number): void {
    this.def.zones.push({ kind, u0, v0, u1, v1, value, id, zMin, zMax });
  }

  /** zone defined from a surface footprint */
  zoneOn(kind: ZoneKind, s: Surface, value?: number, id?: string): void {
    this.def.zones.push({ kind, u0: s.u0, v0: s.v0, u1: s.u1, v1: s.v1, value, id, zMin: Math.min(heightOn(s, s.u0, s.v0), heightOn(s, s.u1, s.v1)) - 6, zMax: Math.max(heightOn(s, s.u0, s.v0), heightOn(s, s.u1, s.v1)) + 6 });
  }

  pipe(p: Pipe): void { this.def.pipes.push(p); }
  hazard(h: HazardSpawn): void { this.def.hazards.push(h); }

  build(): StageDef {
    // invisible boundary walls just outside the map's left/right edges
    const dMax = this.def.width / HALF_W;
    const sMax = (this.def.height + 400) / HALF_H;
    this.def.surfaces.push({ id: this.nextId++, u0: -100, v0: -6, u1: sMax, v1: -0.4, z0: -3000, gu: 0, gv: 0, kind: 'wall', sd: true, name: 'edgeL', wallH: 6000 });
    this.def.surfaces.push({ id: this.nextId++, u0: -100, v0: dMax + 0.4, u1: sMax, v1: dMax + 6, z0: -3000, gu: 0, gv: 0, kind: 'wall', sd: true, name: 'edgeR', wallH: 6000 });
    this.def.manualSurfaces = [...this.def.surfaces];
    computeFloorMin(this.def);
    return this.def;
  }
}

/** Map-space bounding box (in map pixels) of a surface, for the preview tool and culling. */
export function computeFloorMin(def: StageDef): void {
  let mn = Infinity;
  for (const s of def.manualSurfaces) {
    for (const c of surfaceCorners(s)) mn = Math.min(mn, heightOn(s, c.u, c.v));
  }
  if (def.heightmap) {
    for (const c of def.heightmap.comps) {
      // evaluate at bbox corners in map space: z = a + b x + c y
      const [x0, y0, x1, y1] = c.bbox;
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) mn = Math.min(mn, c.a + c.b * x + c.c * y);
    }
  }
  def.floorMin = Number.isFinite(mn) ? mn : 0;
}

/** Attach an art-derived height map: its components become surfaces alongside the manual ones. */
export function attachHeightMap(def: StageDef, hm: HeightMap): void {
  def.heightmap = hm;
  const hmSurfaces: Surface[] = hm.comps.map((comp) => ({
    id: 1000 + comp.id, u0: 0, v0: 0, u1: 0, v1: 0, z0: comp.a, gu: 0, gv: 0, kind: 'floor', hm: { map: hm, comp },
    name: `hm${comp.id}`,
  }));
  def.surfaces = [...def.manualSurfaces, ...hmSurfaces];
  computeFloorMin(def);
}

export function surfaceCorners(s: Surface): { u: number; v: number }[] {
  if (s.sd) {
    const c = (S: number, D: number) => ({ u: (S + D) / 2, v: (S - D) / 2 });
    return [c(s.u0, s.v0), c(s.u1, s.v0), c(s.u1, s.v1), c(s.u0, s.v1)];
  }
  return [{ u: s.u0, v: s.v0 }, { u: s.u1, v: s.v0 }, { u: s.u1, v: s.v1 }, { u: s.u0, v: s.v1 }];
}

export function surfaceMapPolygon(s: Surface): { x: number; y: number }[] {
  const pts = surfaceCorners(s);
  return pts.map((p) => {
    const z = heightOn(s, p.u, p.v);
    return { x: (p.u - p.v) * HALF_W, y: (p.u + p.v) * HALF_H - z };
  });
}
