import { toWorld, HALF_H, HALF_W } from './iso';
import { STEP_UP, WALL_MAX, DROP_SNAP } from './constants';

export type SurfaceKind = 'floor' | 'ice' | 'wall' | 'grate';

export interface HmPiece { yMax: number; a: number; b: number; c: number }
export interface HmComponent {
  id: number;
  /** flat / slope: z = a + b x + c y over the pixel; path: z from the nearest point of a centreline; wall: no floor */
  kind: 'flat' | 'slope' | 'wall' | 'path';
  a: number; b: number; c: number; area: number; bbox: number[]; wallH?: number; pieces?: HmPiece[]; name?: string;
  /** path kind: centreline vertices in map pixels with their heights, in travel order */
  path?: { x: number; y: number; z: number }[];
  /** path kind: an open ramp (no trough rim): the edges get no half-pipe lip */
  open?: boolean;
}

/** height of the nearest point of a polyline (map pixels) to (x, y): what a bent chute is at that pixel */
function pathZ(path: { x: number; y: number; z: number }[], x: number, y: number): number {
  let best = Infinity, z = path[0].z;
  for (let i = 0; i + 1 < path.length; i++) {
    const p = path[i], q = path[i + 1];
    const dx = q.x - p.x, dy = q.y - p.y, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / L2));
    const ex = p.x + dx * t - x, ey = p.y + dy * t - y, d = ex * ex + ey * ey;
    if (d < best) { best = d; z = p.z + (q.z - p.z) * t; }
  }
  return z;
}

/** tallest cliff face the terrain blocks; anything higher above the marble is an overpass it rolls under */
const TERRAIN_BLOCK_MAX = 120;
/** a floor this far above a lower layer is a bridge the marble rolls under; less is a cliff face (terraces are 30 apart;
 *  stage 3's raised cross overhangs the ramp tops by 32) */
const OVERPASS_CLEARANCE = 32;
/** longest hidden-floor gap (in 1/4-tile cells) that is bridged behind an occluder */
const OCCLUSION_FILL_MAX = 64;   // cells (px): a rail post or tent hides up to ~55 px of floor behind it
const OCCLUSION_FILL_DZ = 12;
/** floors labelled on both sides of a wall run within this are the same floor: the run is an obstacle on it */
const OBSTACLE_DZ = 6;
/** height of the synthesized rim on a `path` (half-pipe) component where it borders void */
const PATH_LIP = 14;
/** cells (S4 / x) around the last path vertex left without a lip: the exit the marble rolls off */
const PATH_END_OPEN = 14;

/**
 * Collision derived from the stage art: a label image (component id per map pixel, 0 = void)
 * plus a height per component (z = a + b*x + c*y in map pixels, or pieces of that).
 *
 * The picture is the only floor. Every painted floor pixel (x, y) with height z is one point of
 * the terrain at world S = (y + z) / 4, D = x / 8; the pixels are scattered into a WORLD-SPACE
 * grid (1/4 tile along S = u + v, 1/8 tile along D = u - v) that the physics reads back.
 *   - a marble stands exactly where the picture draws the floor, at that floor's height
 *   - leaving the painted silhouette means there is no cell: it falls
 *   - terrain higher than STEP_UP ahead is a cliff face: it blocks (from below), and from above
 *     the marble simply rolls off the last cell
 *   - wall pixels (rails, posts, block faces) become thin wall cells at their base line, with a
 *     height band read off the run of wall pixels in that column
 *   - floor hidden behind an occluder (a rail, a raised block, the chute passing in front) is
 *     bridged when both visible ends agree on height and no void pixel lies between
 */
export class HeightMap {
  /** 0 = empty, 1 = floor, 2 = wall */
  private readonly kindOf = new Uint8Array(256);
  /** per map pixel floor height, NaN where the pixel is not floor */
  readonly zpx: Float32Array;
  /** world grid: rows are S4 = 4 (u + v) cells, columns are x = 8 (u - v) */
  readonly gH: number;
  readonly z1: Float32Array;   // top floor layer (NaN = void)
  readonly z2: Float32Array;   // second layer under an overpass (NaN = none)
  readonly wLo: Float32Array;  // wall cell: bottom of the blocking band (NaN = no wall)
  readonly wHi: Float32Array;  // wall cell: top of the blocking band
  readonly zMax: number;

  constructor(readonly width: number, readonly height: number, readonly labels: Uint8Array, readonly comps: HmComponent[]) {
    for (const c of comps) this.kindOf[c.id & 255] = c.kind === 'wall' ? 2 : 1;
    const W = width, H = height;
    const byId: (HmComponent | undefined)[] = [];
    for (const c of comps) byId[c.id & 255] = c;

    // 1. per-pixel height from the component planes
    this.zpx = new Float32Array(W * H).fill(NaN);
    let zMax = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = byId[labels[y * W + x]];
        if (!c || c.kind === 'wall') continue;
        let z: number;
        if (c.kind === 'path' && c.path && c.path.length) z = pathZ(c.path, x, y);
        else if (c.pieces && c.pieces.length) {
          let p = c.pieces[c.pieces.length - 1];
          for (const q of c.pieces) { if (y <= q.yMax) { p = q; break; } }
          z = p.a + p.b * x + p.c * y;
        } else z = c.a + c.b * x + c.c * y;
        this.zpx[y * W + x] = z;
        if (z > zMax) zMax = z;
      }
    }
    this.zMax = zMax;
    const gH = this.gH = H + Math.ceil(zMax) + 8;
    const z1 = this.z1 = new Float32Array(gH * W).fill(NaN);
    const z2 = this.z2 = new Float32Array(gH * W).fill(NaN);
    const wLo = this.wLo = new Float32Array(gH * W).fill(NaN);
    const wHi = this.wHi = new Float32Array(gH * W).fill(NaN);

    const isPath = new Uint8Array(gH * W);   // cells that belong to a `path` component (a half-pipe chute)
    const put = (s: number, x: number, z: number, path = 0) => {
      if (s < 0 || s >= gH) return;
      const i = s * W + x;
      if (path) isPath[i] = path;
      const a = z1[i];
      if (Number.isNaN(a)) { z1[i] = z; return; }
      if (Math.abs(a - z) < 2) { if (z > a) z1[i] = z; return; }
      if (z > a) { z2[i] = a; z1[i] = z; return; }
      const b = z2[i];
      if (Number.isNaN(b) || z > b) z2[i] = z;
    };

    // 2. scatter floor pixels into world cells; interpolate between consecutive pixels of one component
    for (let x = 0; x < W; x++) {
      let prevS = NaN, prevZ = NaN, prevId = -1;
      for (let y = 0; y < H; y++) {
        const z = this.zpx[y * W + x];
        const id = labels[y * W + x];
        if (Number.isNaN(z)) { prevS = NaN; prevId = -1; continue; }
        const s = y + z;
        const path = byId[id]?.kind === 'path' ? (byId[id].open ? 2 : 1) : 0;   // 2 = open ramp: no lip
        if (!Number.isNaN(prevS) && id === prevId) {
          const a = Math.round(prevS), b = Math.round(s);
          if (b > a + 1) { for (let k = a + 1; k < b; k++) put(k, x, prevZ + (z - prevZ) * (k - prevS) / (s - prevS), path); }
          else if (b < a - 1) { for (let k = b + 1; k < a; k++) put(k, x, prevZ + (z - prevZ) * (k - prevS) / (s - prevS), path); }
        }
        put(Math.round(s), x, z, path);
        prevS = s; prevZ = z; prevId = id;
      }
    }

    // 3. hidden floor. In this projection only something HIGHER can cover a floor, so a gap in a world
    //    column is floor hidden behind an occluder when its would-be pixels are all painted (never void):
    //      - ends agree on height (a rail, a post, the chute passing in front): interpolate across
    //      - far end is much higher (a raised block, an upper floor): the low floor runs on flat until
    //        it meets the occluder's own cells, which then block as a face
    //      - near end is higher (the front edge of an upper floor): nothing is hidden, leave the gap
    for (let x = 0; x < W; x++) {
      let last = -1;
      for (let s = 0; s < gH; s++) {
        const i = s * W + x;
        if (Number.isNaN(z1[i])) continue;
        if (last >= 0 && s - last > 1 && s - last - 1 <= OCCLUSION_FILL_MAX) {
          const za = z1[last * W + x], zb = z1[i];
          const flat = zb - za > OCCLUSION_FILL_DZ;               // occluder ahead: continue the low floor
          if (flat || Math.abs(za - zb) <= OCCLUSION_FILL_DZ) {
            let ok = true;
            for (let k = last + 1; k < s && ok; k++) {
              const zk = flat ? za : za + (zb - za) * (k - last) / (s - last);
              const y = Math.round(k - zk);
              if (y < 0 || y >= H || labels[y * W + x] === 0) ok = false;
            }
            if (ok) for (let k = last + 1; k < s; k++) z1[k * W + x] = flat ? za : za + (zb - za) * (k - last) / (s - last);
          } else if (za - zb > OCCLUSION_FILL_DZ) {
            // near end higher (a cliff edge), far end the lower floor, and every would-be pixel of that lower floor
            // in the gap is painted WALL: a post / tent / pillar standing on the low floor in front of the cliff
            // hides its base strip. (Open air behind a cliff edge would be void pixels, so it is not this case.)
            let ok = true;
            for (let k = last + 1; k < s && ok; k++) {
              const y = Math.round(k - zb);
              if (y < 0 || y >= H || this.kindOf[labels[y * W + x]] !== 2) ok = false;
            }
            if (ok) for (let k = last + 1; k < s; k++) z1[k * W + x] = zb;
          }
        }
        last = s;
      }
    }

    // 3b. a floor hidden behind its own rim / a wall with a LOWER floor showing through the hole: the run of
    //     low cells between two cells of the same higher floor is the higher floor (the low one moves under
    //     it) when every would-be pixel of the higher floor is painted wall — the occluder, not open air.
    for (let x = 0; x < W; x++) {
      for (let s = 0; s < gH; s++) {
        const i = s * W + x;
        const za = z1[i];
        if (Number.isNaN(za)) continue;
        // find the next cell of about the same height with only lower cells in between
        let e = -1;
        for (let k = s + 1; k <= s + OCCLUSION_FILL_MAX && k < gH; k++) {
          const zk = z1[k * W + x];
          if (Number.isNaN(zk)) break;
          if (Math.abs(zk - za) <= OCCLUSION_FILL_DZ) { e = k; break; }
          if (zk > za) break;                                   // higher ahead: not a hole in this floor
        }
        if (e <= s + 1) continue;
        const zb = z1[e * W + x];
        let ok = true;
        for (let k = s + 1; k < e && ok; k++) {
          if (za - z1[k * W + x] < OCCLUSION_FILL_DZ) { ok = false; break; }     // not clearly lower: leave it
          const zk = za + (zb - za) * (k - s) / (e - s);
          const y = Math.round(k - zk);
          if (y < 0 || y >= H || this.kindOf[labels[y * W + x]] !== 2) ok = false;   // must be painted wall
        }
        if (!ok) continue;
        for (let k = s + 1; k < e; k++) {
          const j = k * W + x;
          const zk = za + (zb - za) * (k - s) / (e - s);
          if (Number.isNaN(z2[j]) || z1[j] > z2[j]) z2[j] = z1[j];
          z1[j] = zk;
          isPath[j] = isPath[i];
        }
        s = e - 1;
      }
    }

    // 4. walls from runs of wall pixels in each column
    const floorZ = (x: number, y: number): number => (y < 0 || y >= H) ? NaN : this.zpx[y * W + x];
    const mark = (s: number, x: number, lo: number, hi: number, back = 1) => {
      for (let k = s - back; k <= s + 1; k++) {
        if (k < 0 || k >= gH) continue;
        const i = k * W + x;
        if (Number.isNaN(wLo[i])) { wLo[i] = lo; wHi[i] = hi; }
        else { wLo[i] = Math.min(wLo[i], lo); wHi[i] = Math.max(wHi[i], hi); }
      }
    };
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H) {
        if (this.kindOf[labels[y * W + x]] !== 2) { y++; continue; }
        const y0 = y;
        while (y < H && this.kindOf[labels[y * W + x]] === 2) y++;
        const y1 = y;                     // run is [y0, y1)
        const above = floorZ(x, y0 - 1), below = floorZ(x, y1);
        const run = y1 - y0;
        if (Number.isNaN(below)) continue;                   // face into void / image edge: nothing stands there
        if (run <= 2) continue;                              // 1-2 px sliver: a painted outline / edge highlight, not a rail
        if (!Number.isNaN(above) && run < 4 && Math.abs(above - below) <= OBSTACLE_DZ) continue;   // tile seam between two floors, not a rail
        if (Number.isNaN(above) || Math.abs(above - below) <= OBSTACLE_DZ) {
          // obstacle standing on the floor in front of it (rail, post, block): base line at the run's bottom. Its
          // painted silhouette above the base is the thing itself seen from the front, so the footprint reaches
          // back under the upper half of the run (a raised block's top is drawn there; a post is just a post)
          mark(Math.round(y1 + below), x, below, below + run, Math.max(1, Math.min(6, Math.round(run / 6))) + (run > 12 ? Math.round(run / 2) - 6 : 0));
        } else if (above > below) {
          // cliff face: the terrain already blocks from below; this catches a face taller than the labels say
          mark(Math.round(y1 + below), x, below, above - 8);
        }
      }
    }

    // 5. half-pipe lips: a `path` component (chute) is a trough, so its cells that border void or a drop get
    //    a low wall band where the labeler did not paint the rim. Openings onto level floor (the mouth) stay
    //    open, and so does the last stretch of the path (the exit tongue the marble hops off).
    const pathEnds: { s: number; x: number }[] = [];
    for (const c of comps) {
      if (c.kind !== 'path' || !c.path?.length) continue;
      const e = c.path[c.path.length - 1];
      pathEnds.push({ s: e.y + e.z, x: e.x });
    }
    for (let s = 0; s < gH; s++) {
      for (let x = 0; x < W; x++) {
        const i = s * W + x;
        if (isPath[i] !== 1 || Number.isNaN(z1[i])) continue;   // only troughs (1) get a lip; open ramps (2) do not
        if (pathEnds.some((e) => Math.abs(e.s - s) <= PATH_END_OPEN && Math.abs(e.x - x) <= PATH_END_OPEN)) continue;
        const z = z1[i];
        // the lip lives on the cells OUTSIDE the trough (two deep, so the marble's probes cannot straddle it),
        // never on the floor the marble stands on
        for (const [ds, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const s2 = s + ds, x2 = x + dx;
          if (s2 < 0 || s2 >= gH || x2 < 0 || x2 >= W) continue;
          const zn = z1[s2 * W + x2];
          if (!(Number.isNaN(zn) || z - zn > DROP_SNAP)) continue;    // level neighbour: not an edge
          for (let d = 1; d <= 2; d++) {
            const s3 = s + ds * d, x3 = x + dx * d;
            if (s3 < 0 || s3 >= gH || x3 < 0 || x3 >= W) continue;
            const j = s3 * W + x3;
            if (isPath[j] && !Number.isNaN(z1[j]) && Math.abs(z1[j] - z) <= DROP_SNAP) break;   // back on the trough
            if (Number.isNaN(wLo[j])) { wLo[j] = z; wHi[j] = z + PATH_LIP; }
            else { wLo[j] = Math.min(wLo[j], z); wHi[j] = Math.max(wHi[j], z + PATH_LIP); }
          }
        }
      }
    }
  }

  floorPixel(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.kindOf[this.labels[y * this.width + x]] === 1;
  }

  private cell(u: number, v: number): { s: number; x: number } {
    return { s: Math.round(HALF_H * (u + v)), x: Math.round(HALF_W * (u - v)) };
  }

  /** highest floor layer at (u,v) not above `lim`; NaN when nothing is there */
  supportZ(u: number, v: number, lim: number): number {
    const { s, x } = this.cell(u, v);
    let best = this.layerAt(s, x, lim);
    if (!Number.isNaN(best)) return best;
    // tolerate half a cell of silhouette roughness so the marble is not dropped by one pixel
    for (const [ds, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      best = this.layerAt(s + ds, x + dx, lim);
      if (!Number.isNaN(best)) return best;
    }
    return NaN;
  }

  private layerAt(s: number, x: number, lim: number): number {
    if (s < 0 || s >= this.gH || x < 0 || x >= this.width) return NaN;
    const i = s * this.width + x;
    const a = this.z1[i];
    if (!Number.isNaN(a) && a <= lim) return a;
    const b = this.z2[i];
    if (!Number.isNaN(b) && b <= lim) return b;
    return NaN;
  }

  /** top layer (for spawning / debugging) */
  topZ(u: number, v: number): number { return this.supportZ(u, v, 1e9); }

  /**
   * Would a marble at height zRef be stopped entering (u,v)? Terrain higher than it can climb is a
   * cliff face (unless it fits under an overpass); explicit wall cells block within their band.
   */
  blocks(u: number, v: number, zRef: number): boolean { return this.blockReason(u, v, zRef) !== ''; }

  /** '' when passable, else why (u,v) stops a marble at zRef: which cell, wall band or terrain height */
  blockReason(u: number, v: number, zRef: number): string {
    const { s, x } = this.cell(u, v);
    // the course is the picture: where the art is cropped at the image border the marble meets an invisible
    // wall rather than rolling off the side of the world (fuzzing found many deaths at x<0 / x>=width)
    if (s < 0 || s >= this.gH || x < 0 || x >= this.width) return `picture edge cell(s${s},x${x})`;
    const i = s * this.width + x;
    const lo = this.wLo[i];
    if (!Number.isNaN(lo) && zRef >= lo - 6 && zRef <= this.wHi[i]) return `wall band ${lo.toFixed(0)}-${this.wHi[i].toFixed(0)} cell(s${s},x${x})`;
    const top = this.z1[i];
    if (!Number.isNaN(top) && top > zRef + STEP_UP && top <= zRef + TERRAIN_BLOCK_MAX) {
      const under = this.z2[i];
      if (!Number.isNaN(under) && zRef >= under - 6 && top - zRef >= OVERPASS_CLEARANCE) return '';   // rolls under a bridge
      return `terrain z${top.toFixed(0)}${Number.isNaN(under) ? '' : '/' + under.toFixed(0)} cell(s${s},x${x})`;
    }
    return '';
  }

  /** debug: what the wall grid holds at (u,v) */
  wallAt(u: number, v: number): { lo: number; hi: number } | null {
    const { s, x } = this.cell(u, v);
    if (s < 0 || s >= this.gH || x < 0 || x >= this.width) return null;
    const i = s * this.width + x;
    return Number.isNaN(this.wLo[i]) ? null : { lo: this.wLo[i], hi: this.wHi[i] };
  }

  /** debug: everything the grid knows about the cell under (u,v) */
  cellInfo(u: number, v: number): { s: number; x: number; z1: number | null; z2: number | null; wall: { lo: number; hi: number } | null; px: { x: number; y: number; label: number; comp: string } | null } {
    const { s, x } = this.cell(u, v);
    const inb = s >= 0 && s < this.gH && x >= 0 && x < this.width;
    const i = s * this.width + x;
    const z1 = inb && !Number.isNaN(this.z1[i]) ? +this.z1[i].toFixed(1) : null;
    const z2 = inb && !Number.isNaN(this.z2[i]) ? +this.z2[i].toFixed(1) : null;
    let px: { x: number; y: number; label: number; comp: string } | null = null;
    if (z1 !== null) {
      const y = Math.round(s - z1);
      if (y >= 0 && y < this.height) {
        const id = this.labels[y * this.width + x];
        const c = this.comps.find((k) => k.id === id);
        px = { x, y, label: id, comp: c ? `${c.name ?? c.id}:${c.kind}` : 'void' };
      }
    }
    return { s, x, z1, z2, wall: this.wallAt(u, v), px };
  }

  /**
   * debug: ASCII map of the grid around (u,v) at height zRef. Rows are S4 (down = toward the viewer),
   * columns are x. Each cell: floor height (2 digits, hundreds dropped), `..` void, `##` blocks a marble at zRef
   * (wall band or too-high terrain), `[]` marks the centre.
   */
  around(u: number, v: number, zRef: number, r = 6, step = 2): string {
    const { s: s0, x: x0 } = this.cell(u, v);
    const lines: string[] = [`grid around s${s0} x${x0} z${zRef.toFixed(0)}  (rows S4 step ${step}, cols x step ${step * 2})`];
    for (let ds = -r; ds <= r; ds++) {
      const s = s0 + ds * step;
      let line = `${String(s).padStart(4)} `;
      for (let dx = -r; dx <= r; dx++) {
        const x = x0 + dx * step * 2;
        let cellTxt: string;
        if (s < 0 || s >= this.gH || x < 0 || x >= this.width) cellTxt = '  ';
        else {
          const i = s * this.width + x;
          const z = this.z1[i];
          const uu = (s / 4 + x / 8) / 2, vv = (s / 4 - x / 8) / 2;
          if (this.blockReason(uu, vv, zRef)) cellTxt = '##';
          else if (Number.isNaN(z)) cellTxt = '..';
          else cellTxt = String(Math.round(z) % 100).padStart(2, '0');
        }
        if (ds === 0 && dx === 0) cellTxt = '[]';
        line += cellTxt + ' ';
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** dz/du, dz/dv of the floor the marble stands on (finite differences; edges and steps read as flat) */
  gradient(u: number, v: number, z: number): { gu: number; gv: number } {
    const lim = z + STEP_UP;
    const d = 0.5;
    const slope = (za: number, zb: number): number => {
      const okA = !Number.isNaN(za) && Math.abs(za - z) <= STEP_UP, okB = !Number.isNaN(zb) && Math.abs(zb - z) <= STEP_UP;
      if (okA && okB) return (zb - za) / (2 * d);
      if (okB) return (zb - z) / d;
      if (okA) return (z - za) / d;
      return 0;
    };
    const gu = slope(this.supportZ(u - d, v, lim), this.supportZ(u + d, v, lim));
    const gv = slope(this.supportZ(u, v - d, lim), this.supportZ(u, v + d, lim));
    return { gu, gv };
  }

  /**
   * Painted-path corner: a 2×2 of the floor mask that is 3-on/1-off (inside of a 90° / switchback)
   * or 1-on/3-off (outer tip). Straight edges are 2/2 and do not count.
   */
  nearPathCorner(u: number, v: number, z: number, radius = 14): boolean {
    const mx = Math.round(HALF_W * (u - v));
    const my = Math.round(HALF_H * (u + v) - z);
    const r = Math.ceil(radius);
    for (let y = my - r; y <= my + r - 1; y++) {
      for (let x = mx - r; x <= mx + r - 1; x++) {
        let n = 0;
        if (this.floorPixel(x, y)) n++;
        if (this.floorPixel(x + 1, y)) n++;
        if (this.floorPixel(x, y + 1)) n++;
        if (this.floorPixel(x + 1, y + 1)) n++;
        if (n === 1 || n === 3) return true;
      }
    }
    return false;
  }

  /** debug / teleport: the floor drawn at map pixel (x,y), as a world point */
  pickPixel(x: number, y: number): { u: number; v: number; z: number } | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const z = this.zpx[y * this.width + x];
    if (Number.isNaN(z)) return null;
    const w = toWorld(x, y, z);
    return { u: w.u, v: w.v, z };
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
  /** set for the one surface backed by the art-derived heightfield */
  hm?: { map: HeightMap };
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

export type HazardKind = 'steelie' | 'worm' | 'slime' | 'hammer' | 'vacuum' | 'birds' | 'wand' | 'risers' | 'wave' | 'catapult' | 'shifting';

export interface HazardSpawn {
  kind: HazardKind;
  u: number; v: number;
  /** floor height the spawn point was read at; the hazard snaps to the surface nearest this height */
  z?: number;
  /** wander / patrol radius in tiles (slime, worm) */
  range?: number;
  /** activation region for birds / wand (u+v band), default whole stage */
  band?: [number, number];
  period?: number;
  phase?: number;
  count?: number;
  facing?: 1 | -1;
  /** slime: instead of dissolving the marble it hands out seconds (Silly race plaza) */
  gift?: boolean;
  /** riser pad: tiles along u and v; launch velocity given to a marble popped by a piston */
  size?: [number, number];
  launch?: { du: number; dv: number };
  /** wave plate: rectangle in world tiles the hump travels along (+u) */
  rect?: { u0: number; v0: number; u1: number; v1: number };
}

/** scripted roll (Aerial race starting ramps): the marble follows these world points with no control and cannot
 *  fall off; at the last point it lands with the dizzy spin and control begins */
export interface Slide { pts: { u: number; v: number; z: number }[]; delay: number }

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
  /** Silly race: trackball directions are inverted ("EVERYTHING YOU KNOW IS WRONG") */
  reverseControls?: boolean;
  surfaces: Surface[];
  start: { u: number; v: number; z?: number; slide?: number };
  /** second player's start (arcade 2P: e.g. the other tower on the Aerial race); defaults to beside `start` */
  start2?: { u: number; v: number; z?: number; slide?: number };
  slides: Slide[];
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
  /** start / checkpoints / zones given as map pixels; resolved onto the heightfield when it attaches */
  pixelRefs?: PixelRef[];
}

export type PixelRef =
  | { kind: 'start' | 'start2'; x: number; y: number; slide?: number }
  | { kind: 'checkpoint'; x: number; y: number; cp?: { r: number; value: number; id: string } }
  | { kind: 'zone'; zone: ZoneKind; x: number; y: number; r: number; value?: number; id?: string }
  | { kind: 'pipe'; x: number; y: number; r: number; exit: { x: number; y: number; vu: number; vv: number }; duration: number; bonus?: number }
  | { kind: 'hazard'; x: number; y: number; h: Omit<HazardSpawn, 'u' | 'v' | 'z'> };

export interface Support { z: number; s: Surface; /** set when the heightfield answered as an obstacle: which cell / band / height */ why?: string }

export function heightOn(s: Surface, u: number, v: number): number {
  if (s.hm) return s.hm.map.topZ(u, v);
  if (s.sd) {
    const S = u + v, D = u - v;
    return s.z0 + s.gu * (S - s.u0) + s.gv * (D - s.v0);
  }
  return s.z0 + s.gu * (u - s.u0) + s.gv * (v - s.v0);
}

/** dz/du, dz/dv of a surface at (u,v); `z` picks the heightfield layer the marble stands on. */
export function gradientOn(s: Surface, u = 0, v = 0, z?: number): { gu: number; gv: number } {
  if (s.hm) return s.hm.map.gradient(u, v, z ?? s.hm.map.topZ(u, v));
  if (s.sd) return { gu: s.gu + s.gv, gv: s.gu - s.gv };
  return { gu: s.gu, gv: s.gv };
}

export function inRect(r: { u0: number; v0: number; u1: number; v1: number; sd?: boolean; hm?: Surface['hm'] }, u: number, v: number): boolean {
  if (r.hm) return !Number.isNaN(r.hm.map.topZ(u, v));
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
  if (prefer && prefer.kind !== 'wall') {
    const zp = prefer.hm ? prefer.hm.map.supportZ(u, v, lim) : (inRect(prefer, u, v) ? heightOn(prefer, u, v) : NaN);
    if (!Number.isNaN(zp) && zp <= lim && zp >= zRef - 6) return { z: zp, s: prefer };
  }
  let best: Support | null = null;
  // Authored manual surfaces (bridges, pads the art does not paint as floor) take precedence over the heightfield
  for (const s of level.manualSurfaces) {
    if (s.kind === 'wall') continue;
    if (!inRect(s, u, v)) continue;
    const z = heightOn(s, u, v);
    if (z <= lim && (!best || z > best.z)) best = { z, s };
  }
  if (best) return best;

  for (const s of level.surfaces) {
    if (s.kind === 'wall') continue;
    if (s.hm) {
      const z = s.hm.map.supportZ(u, v, lim);
      if (!Number.isNaN(z) && (!best || z > best.z)) best = { z, s };
      continue;
    }
    if (!inRect(s, u, v)) continue;
    const z = heightOn(s, u, v);
    if (z <= lim && (!best || z > best.z)) best = { z, s };
  }
  return best;
}

/**
 * Highest surface at (u,v) below zRef + wallMax (used to detect wall faces). The heightfield answers
 * as a solid obstacle when its terrain or a wall cell blocks a marble at zRef, else as a floor.
 */
export function highestBelow(level: StageDef, u: number, v: number, zRef: number, wallMax = WALL_MAX, ignore?: Set<number>): Support | null {
  let best: Support | null = null;
  const lim = zRef + wallMax;
  for (const s of level.surfaces) {
    if (ignore && ignore.has(s.id)) continue;
    if (s.hm) {
      const why = s.hm.map.blockReason(u, v, zRef);
      if (why) return { z: zRef + wallMax, s, why };
      const z = s.hm.map.supportZ(u, v, lim);
      if (!Number.isNaN(z) && (!best || z > best.z)) best = { z, s };
      continue;
    }
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

/**
 * Arcade corner-cut dizzy: the marble left the path at an inside 90° / switchback
 * (or an outer platform tip), not along a long straight edge.
 */
/**
 * Did the marble leave the floor at a convex corner (cutting the corner of the path)? Floor continues
 * along both axes but not diagonally. (A pixel-space heuristic used to live here; every diagonal edge in
 * an isometric picture is a pixel staircase, so it called every edge a corner.)
 */
export function leftPathAtCorner(level: StageDef, u: number, v: number, z: number): boolean {
  const R = 1.2;
  const walk = (du: number, dv: number) => !!supportAt(level, u + du, v + dv, z + 4, STEP_UP);
  const pairs: [number, number, number, number, number, number][] = [
    [R, 0, 0, R, R, R],
    [R, 0, 0, -R, R, -R],
    [-R, 0, 0, R, -R, R],
    [-R, 0, 0, -R, -R, -R],
  ];
  for (const [au, av, bu, bv, du, dv] of pairs) {
    if (walk(au, av) && walk(bu, bv) && !walk(du, dv)) return true;
  }
  return false;
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
  progressDir?: 1 | -1; viewX0?: number; reverseControls?: boolean;
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
      timeAdd: o.timeAdd, carryTime: o.carryTime, progressDir: o.progressDir ?? 1, reverseControls: o.reverseControls,
      surfaces: [], start: { u: 0, v: 0 }, slides: [], checkpoints: [], zones: [], pipes: [], hazards: [], floorMin: 0, manualSurfaces: [],
    };
  }

  /** world coords of a map pixel at height z (snapped to half tiles) */
  uv(x: number, y: number, z: number): { u: number; v: number; z: number } {
    const w = toWorld(x, y, z);
    return { u: Math.round(w.u * 2) / 2, v: Math.round(w.v * 2) / 2, z };
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

  start(u: number, v: number, z?: number, slide?: number): void { this.def.start = { u, v, z, slide }; }
  start2(u: number, v: number, z?: number, slide?: number): void { this.def.start2 = { u, v, z, slide }; }

  private ref(r: PixelRef): void { (this.def.pixelRefs ??= []).push(r); }
  /** start on the floor drawn at map pixel (x,y) (resolved when the heightfield attaches) */
  startPx(x: number, y: number, slide?: number): void { this.ref({ kind: 'start', x, y, slide }); }
  start2Px(x: number, y: number, slide?: number): void { this.ref({ kind: 'start2', x, y, slide }); }
  /** respawn point on the floor drawn at (x,y); with `zone` also a progress checkpoint zone of radius r tiles */
  checkpointPx(x: number, y: number, cp?: { r: number; value: number; id: string }): void { this.ref({ kind: 'checkpoint', x, y, cp }); }
  /** square zone of half-size r tiles centred on the floor drawn at (x,y), limited to that floor's height band */
  zonePx(zone: ZoneKind, x: number, y: number, r: number, value?: number, id?: string): void { this.ref({ kind: 'zone', zone, x, y, r, value, id }); }
  /** pipe: entering the floor drawn at (x,y) (half-size r tiles) teleports to the floor drawn at exit (x,y) after `duration` s */
  pipePx(x: number, y: number, r: number, exit: { x: number; y: number; vu: number; vv: number }, duration: number, bonus?: number): void {
    this.ref({ kind: 'pipe', x, y, r, exit, duration, bonus });
  }
  /** hazard spawned on the floor drawn at (x,y) */
  hazardPx(x: number, y: number, h: Omit<HazardSpawn, 'u' | 'v' | 'z'>): void { this.ref({ kind: 'hazard', x, y, h }); }
  /** scripted roll through MAP PIXEL points [x, y, z]; returns the slide index for start()/start2() */
  slide(pts: [number, number, number][], delay = 0.5): number {
    this.def.slides.push({ pts: pts.map(([x, y, z]) => { const w = toWorld(x, y, z); return { u: w.u, v: w.v, z }; }), delay });
    return this.def.slides.length - 1;
  }
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
    // invisible boundary walls at the map's left/right edges: the marble's centre stays a radius inside the art,
    // so a walkway painted right up to the edge (stage 3's left wing) still has floor pixels under the marble
    const dMax = this.def.width / HALF_W;
    const sMax = (this.def.height + 400) / HALF_H;
    this.def.surfaces.push({ id: this.nextId++, u0: -100, v0: -6, u1: sMax, v1: 0, z0: -3000, gu: 0, gv: 0, kind: 'wall', sd: true, name: 'edgeL', wallH: 6000 });
    this.def.surfaces.push({ id: this.nextId++, u0: -100, v0: dMax, u1: sMax, v1: dMax + 6, z0: -3000, gu: 0, gv: 0, kind: 'wall', sd: true, name: 'edgeR', wallH: 6000 });
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

/** Attach the art-derived heightfield: one surface standing for every painted floor pixel, beside the manual ones. */
export function attachHeightMap(def: StageDef, hm: HeightMap): void {
  def.heightmap = hm;
  const terrain: Surface = { id: 1000, u0: 0, v0: 0, u1: 0, v1: 0, z0: 0, gu: 0, gv: 0, kind: 'floor', hm: { map: hm }, name: 'terrain' };
  def.surfaces = [...def.manualSurfaces, terrain];
  resolvePixelRefs(def, hm);
  computeFloorMin(def);
}

/** Place pixel-anchored start / checkpoints / zones on the floor the art draws at those pixels. */
function resolvePixelRefs(def: StageDef, hm: HeightMap): void {
  if (!def.pixelRefs) return;
  const pick = (x: number, y: number, what: string): { u: number; v: number; z: number } | null => {
    // search a small neighbourhood so a pixel on a gridline / decal still finds its floor
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const p = hm.pickPixel(x + dx, y + dy);
        if (p) return p;
      }
    }
    console.warn(`stage ${def.id}: no floor drawn at pixel ${x},${y} for ${what}`);
    return null;
  };
  for (const r of def.pixelRefs) {
    if (r.kind === 'start' || r.kind === 'start2') {
      const p = pick(r.x, r.y, r.kind);
      if (p) def[r.kind] = { u: p.u, v: p.v, z: p.z, slide: r.slide };
    } else if (r.kind === 'checkpoint') {
      const p = pick(r.x, r.y, 'checkpoint');
      if (!p) continue;
      def.checkpoints.push({ u: p.u, v: p.v });
      if (r.cp) def.zones.push({ kind: 'checkpoint', u0: p.u - r.cp.r, v0: p.v - r.cp.r, u1: p.u + r.cp.r, v1: p.v + r.cp.r, value: r.cp.value, id: r.cp.id, zMin: p.z - 8, zMax: p.z + 8 });
    } else if (r.kind === 'zone') {
      const p = pick(r.x, r.y, `${r.zone} zone`);
      if (!p) continue;
      def.zones.push({ kind: r.zone, u0: p.u - r.r, v0: p.v - r.r, u1: p.u + r.r, v1: p.v + r.r, value: r.value, id: r.id, zMin: p.z - 10, zMax: p.z + 10 });
    } else if (r.kind === 'pipe') {
      const p = pick(r.x, r.y, 'pipe mouth'), e = pick(r.exit.x, r.exit.y, 'pipe exit');
      if (!p || !e) continue;
      def.pipes.push({ u0: p.u - r.r, v0: p.v - r.r, u1: p.u + r.r, v1: p.v + r.r, zMin: p.z - 60, zMax: p.z + 12, exit: { u: e.u, v: e.v, z: e.z, vu: r.exit.vu, vv: r.exit.vv }, duration: r.duration, bonus: r.bonus });
    } else if (r.kind === 'hazard') {
      const p = pick(r.x, r.y, `${r.h.kind} hazard`);
      if (p) def.hazards.push({ ...r.h, u: p.u, v: p.v, z: p.z });
    }
  }
  def.pixelRefs = undefined;   // resolved once
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
