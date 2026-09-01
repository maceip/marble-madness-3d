// Course compiler: ASCII rows -> flat collision/render grid.
// See kinds.ts for the glyph alphabet. The compiler only has to
//   1. expand glyphs into cells (height comes from the glyph itself),
//   2. derive slopes for *flat* cells from their neighbours (so a forced
//      plateau still drains),
//   3. refuse to build a course whose height deltas exceed one ramp run,
// which keeps every course fair and the ASCII self-documenting.

import { GLYPHS, glyphCell, isSolidSurf, type CellDef } from './kinds.js';
import type { Cell, HazardDef, LevelDef, LevelLayout } from './types.js';

export const STEP_H = 0.5; // world height of one slope step
export const MAX_STEP = 4; // legal height delta between neighbouring cells

/** true when the glyph was written as a ramp (its fall direction is explicit) */
export function isRampGlyph(ch: string): boolean {
  return (GLYPHS[ch]?.fall ?? 'none') !== 'none';
}

const FALL: Record<string, [number, number]> = {
  none: [0, 0],
  E: [1, 0],
  W: [-1, 0],
  S: [0, 1],
  N: [0, -1],
  SE: [1, 1],
  SW: [-1, 1],
  NE: [1, -1],
  NW: [-1, -1],
};

export interface BuiltLevel {
  def: LevelDef;
  layout: LevelLayout;
  /** hazards lifted out of the ASCII map (merged with def.hazards) */
  props: HazardDef[];
  problems: string[];
}

function parseKeys(spec: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const token of spec.split(/\s+/).filter(Boolean)) {
    const [a, b] = token.split(':');
    const [c1, r1] = a.split(',').map(Number);
    if (b === undefined) out.push([c1, r1, c1, r1]);
    else {
      const [c2, r2] = b.split(',').map(Number);
      out.push([Math.min(c1, c2), Math.min(r1, r2), Math.max(c1, c2), Math.max(r1, r2)]);
    }
  }
  return out;
}

export function buildLevel(def: LevelDef): BuiltLevel {
  const problems: string[] = [];
  const rows = def.layout;
  const H = rows.length;
  const W = Math.max(...rows.map((r) => r.length));
  const cells: (Cell | null)[] = new Array(W * H).fill(null);
  const props: HazardDef[] = [];
  const idx = (c: number, r: number) => r * W + c;

  // ---- pass 1: collect author overrides ---------------------------------
  const overrides = new Map<string, CellDef>();
  for (const [spec, patch] of Object.entries(def.patches?.cells ?? {})) {
    for (const [c, r, c2, r2] of parseKeys(spec)) {
      for (let rr = r; rr <= r2; rr++) {
        for (let cc = c; cc <= c2; cc++) {
          const k = `${cc},${rr}`;
          const prev = overrides.get(k) ?? { surf: 'void', h: 2, fall: 'none' };
          overrides.set(k, { ...prev, ...patch });
        }
      }
    }
  }

  // ---- pass 2: glyphs + overrides -> cells -------------------------------
  for (let r = 0; r < H; r++) {
    const row = rows[r];
    for (let c = 0; c < W; c++) {
      const raw = row[c] ?? ' ';
      let d: CellDef | undefined = raw === ' ' ? undefined : glyphCell(raw);
      const o = overrides.get(`${c},${r}`);
      if (o) {
        const base: CellDef = d ?? { surf: 'path', h: 2, fall: 'none' };
        d = Object.assign({}, base, o);
      }
      if (!d || d.surf === 'void') continue;
      const cell: Cell = {
        surf: d.surf,
        h: d.h,
        fall: d.fall,
        prop: d.prop,
        solid: d.solid ?? isSolidSurf(d.surf),
        H: def.baseHeight + d.h,
        dx: 0,
        dz: 0,
      };
      cells[idx(c, r)] = cell;
      if (d.prop) props.push({ kind: d.prop, x: c + 0.5, z: r + 0.5, h: d.h });
    }
  }

  // ---- pass 3: slopes ----------------------------------------------------
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const cell = cells[idx(c, r)];
      if (!cell) continue;
      const fall = FALL[cell.fall] ?? [0, 0];
      const [fx, fz] = fall;
      if (fx !== 0 || fz !== 0) {
        cell.dx = fx;
        cell.dz = fz;
        continue;
      }
      const east = heightAt(cells, idx(c + 1, r));
      const west = heightAt(cells, idx(c - 1, r));
      const south = heightAt(cells, idx(c, r + 1));
      const north = heightAt(cells, idx(c, r - 1));
      cell.dx = axisStep(west, east);
      cell.dz = axisStep(north, south);
    }
  }

  // ---- pass 4: sanity ----------------------------------------------------
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const cell = cells[idx(c, r)];
      if (!cell) continue;
      if (cell.solid && cell.fall !== 'none' && cell.surf !== 'glass' && cell.surf !== 'path') {
        problems.push(`${def.name}: solid cell (${c},${r}) also carries a fall direction`);
      }
      for (const [nc, nr] of [
        [c + 1, r],
        [c, r + 1],
      ]) {
        if (nc >= W || nr >= H) continue;
        const other = cells[idx(nc, nr)];
        if (!other) continue;
        // Ignore step drop checks across walls, trees, rocks or void boundaries
        if (cell.solid || other.solid || cell.surf === 'void' || other.surf === 'void') continue;
        const dh = Math.abs(other.H - cell.H);
        if (dh > MAX_STEP) {
          problems.push(
            `${def.name}: ${dh}-step drop between (${c},${r}) H=${cell.H} and (${nc},${nr}) H=${other.H}`,
          );
        }
      }
    }
  }

  // voids are stored as inert cells so the physics lookup stays branch-free
  const flat: Cell[] = [];
  for (let i = 0; i < W * H; i++) {
    flat.push(
      cells[i] ?? { surf: 'void', h: 0, fall: 'none', H: 0, dx: 0, dz: 0, solid: false },
    );
  }

  return { def, layout: { W, H, cells: flat }, props, problems };
}

/** row-major lookup used by physics + renderer; returns undefined off-course */
export function cellAt(layout: LevelLayout, c: number, r: number): Cell | undefined {
  if (c < 0 || r < 0 || c >= layout.W || r >= layout.H) return undefined;
  return layout.cells[r * layout.W + c];
}

function heightAt(cells: (Cell | null)[], i: number): number {
  const c = cells[i];
  return c ? c.H : NaN;
}

function axisStep(low: number, high: number): number {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 0;
  return Math.max(-MAX_STEP, Math.min(MAX_STEP, Math.round((high - low) / 2)));
}

/** ASCII dump of the compiled terrain (validator/debug aid) */
export function renderTerrain(built: BuiltLevel): string {
  const { W, H, cells } = built.layout;
  const lines: string[] = [];
  for (let r = 0; r < H; r++) {
    let line = `${String(r).padStart(2)} `;
    for (let c = 0; c < W; c++) {
      const cell = cells[r * W + c];
      if (!cell || cell.surf === 'void') line += '   . ';
      else if (cell.fall !== 'none') line += ` ${cell.surf.slice(0, 2).toUpperCase()}${cell.fall.padEnd(2)}`;
      else line += ` ${cell.surf.slice(0, 2).toUpperCase()}${String(cell.H).padStart(2)} `;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
