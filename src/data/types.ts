// Shared data types for courses, terrain and hazards.
import type { CellDef } from './kinds.js';

/** One compiled course cell (a 10x10 tile in the reference artwork). */
export interface Cell extends CellDef {
  /** absolute height of the cell's top face, in 0.5-unit steps */
  H: number;
  /** -2..+2: slope of this cell towards +x / +z (negative = rising) */
  dx: number;
  dz: number;
}

export interface LevelLayout {
  W: number;
  H: number;
  cells: Cell[]; // row-major, W * H
}

/**
 * Extra authoring overrides applied after the ASCII rows are compiled.
 * Keys are "c,r" or "c1,r1:c2,r2" in cell coordinates.
 */
export interface LevelPatches {
  /** "c,r" or "c1,r1:c2,r2" -> forced cell (surface / height / fall / prop) */
  cells?: Record<string, Partial<CellDef>>;
}

export type ItemKind =
  | 'time'
  | 'magnet'
  | 'shield'
  | 'points'
  | 'whirlwind'
  | 'jet'
  | 'helicopter'
  | 'tunnel'
  | 'slalom';

export type HazardKind =
  | 'spike' // static spike: bounce + score
  | 'sand' // slowdown field
  | 'water' // slow + drown timer
  | 'holo' // non-solid: the marble falls through it
  | 'blade' // buzz saw: instant kill
  | 'bat' // sine-weaving bat that kills on contact
  | 'snake' // serpentine racer, killed by falling
  | 'bomber' // Bombardier: drops bombs
  | 'springboard'
  | 'checkpoint'
  | 'goal'
  | 'item';

export interface HazardDef {
  kind: HazardKind;
  /** cell x (world x = c * TILE) */
  x: number;
  /** cell z */
  z: number;
  /** surface height the hazard sits on (steps); defaults to the cell below */
  h?: number;
  sprite?: number;
  /** seconds per cycle, 0 = static prop */
  period?: number;
  /** travel axis for movers */
  axis?: 'x' | 'z';
  /** travel amplitude in cells */
  range?: number;
  /** phase offset 0..1 */
  phase?: number;
  /** base speed of movers, cells/second */
  speed?: number;
  /** item kind when kind === 'item' */
  item?: ItemKind;
  /** points on touch */
  points?: number;
  /** follow a course path (snakes, in course 3/5) */
  path?: [number, number][];
}

export type SurfaceId = CellDef['surf'];

export interface LevelDef {
  id: number;
  name: string;
  subtitle: string;
  theme: string;
  /** reference artwork shipped with the project */
  sourceArt: string;
  /** base height (steps) of row 0; each row drifts downhill from here */
  baseHeight: number;
  layout: string[];
  patches?: LevelPatches;
  hazards: HazardDef[];
  /** seconds on the clock when the course starts */
  time: number;
  /** marble start, in cells */
  start: [number, number];
}

export type ThemeName = 'pink' | 'cyan' | 'olive' | 'gold' | 'steel' | 'mint' | 'night';

export interface Theme {
  name: ThemeName;
  /** per-surface [top, side] colours */
  surfaces: Record<SurfaceId, [number, number]>;
  fog: number;
  sky: [number, number];
}
