// Character DSL for course layouts. One character = one ground cell and it
// carries that cell's surface, its height (in 0.5 world-unit steps) and the
// direction it falls. Layouts are drawn as a diagonal (isometric) map: +x runs
// down-right, +z runs down-left, so "down the page" means downhill.

export type Surf =
  | 'path'
  | 'glass'
  | 'sand'
  | 'water'
  | 'holo'
  | 'tree'
  | 'rock'
  | 'metal'
  | 'snow'
  | 'cloud'
  | 'wall'
  | 'void';

export type FallDir = 'none' | 'E' | 'W' | 'S' | 'N' | 'SE' | 'SW' | 'NE' | 'NW';

export interface CellDef {
  surf: Surf;
  /** height above the course base, in 0.5 world-unit steps */
  h: number;
  fall: FallDir;
  /** prop drawn on top of the cell surface (also read by the hazard spawner) */
  prop?: 'spike' | 'sand' | 'item' | 'checkpoint' | 'goal' | 'blade' | 'springboard';
  /** impassable: the marble bounces off it */
  solid?: boolean;
}

const d = (s: Partial<CellDef> & { surf: Surf }): CellDef => ({
  solid: false,
  fall: 'none',
  h: 2,
  ...s,
});

export const GLYPHS: Record<string, CellDef> = {
  ' ': d({ surf: 'void', h: 0 }),

  // flat path at an explicit height (1 step = 0.5 world units)
  '.': d({ surf: 'path', h: 2 }),
  '0': d({ surf: 'path', h: 0 }),
  '1': d({ surf: 'path', h: 1 }),
  '2': d({ surf: 'path', h: 2 }),
  '3': d({ surf: 'path', h: 3 }),
  '4': d({ surf: 'path', h: 4 }),
  '5': d({ surf: 'path', h: 5 }),
  '6': d({ surf: 'path', h: 6 }),
  '7': d({ surf: 'path', h: 7 }),
  '8': d({ surf: 'path', h: 8 }),

  // ramps falling towards +x / -x / +z / -z: the *suffix* is the direction,
  // the *prefix* is the height (1 step = 0.5 world units)
  e: d({ surf: 'path', h: 1, fall: 'E' }),
  E: d({ surf: 'path', h: 2, fall: 'E' }),
  U: d({ surf: 'path', h: 3, fall: 'E' }),
  Y: d({ surf: 'path', h: 4, fall: 'E' }),
  w: d({ surf: 'path', h: 1, fall: 'W' }),
  W: d({ surf: 'path', h: 2, fall: 'W' }),
  V: d({ surf: 'path', h: 3, fall: 'W' }),
  n: d({ surf: 'path', h: 1, fall: 'N' }),
  N: d({ surf: 'path', h: 2, fall: 'N' }),
  M: d({ surf: 'path', h: 3, fall: 'N' }),
  s: d({ surf: 'path', h: 1, fall: 'S' }),
  S: d({ surf: 'path', h: 2, fall: 'S' }),
  H: d({ surf: 'path', h: 3, fall: 'S' }),
  // diagonal chutes (corner-cut: slope on both axes)
  f: d({ surf: 'path', h: 2, fall: 'SE' }),
  F: d({ surf: 'path', h: 3, fall: 'SE' }),
  b: d({ surf: 'path', h: 2, fall: 'SW' }),
  B: d({ surf: 'path', h: 3, fall: 'SW' }),
  '/': d({ surf: 'path', h: 2, fall: 'NE' }),
  q: d({ surf: 'path', h: 3, fall: 'NE' }),
  '\\': d({ surf: 'path', h: 2, fall: 'NW' }),
  a: d({ surf: 'path', h: 3, fall: 'NW' }),

  // surfaces (flat unless noted)
  g: d({ surf: 'glass', h: 2 }),
  '%': d({ surf: 'glass', h: 1, fall: 'E' }),
  '&': d({ surf: 'glass', h: 3, fall: 'E' }),
  G: d({ surf: 'glass', h: 4 }),
  '~': d({ surf: 'sand', h: 1 }),
  '!': d({ surf: 'sand', h: 1, prop: 'sand' }),
  '=': d({ surf: 'water', h: 0 }),
  '9': d({ surf: 'water', h: 0, fall: 'SE' }),
  '-': d({ surf: 'holo', h: 3 }),
  '+': d({ surf: 'holo', h: 1, fall: 'SE' }),
  t: d({ surf: 'tree', h: 1, solid: true }),
  k: d({ surf: 'rock', h: 2, solid: true }),
  m: d({ surf: 'metal', h: 2 }),
  j: d({ surf: 'metal', h: 4 }),
  c: d({ surf: 'cloud', h: 5 }),
  C: d({ surf: 'cloud', h: 3 }),
  '#': d({ surf: 'wall', h: 3, solid: true }),
  // ice / snow — Beginner race
  i: d({ surf: 'snow', h: 2 }),
  I: d({ surf: 'snow', h: 4 }),
  o: d({ surf: 'snow', h: 6 }),

  // props
  '^': d({ surf: 'path', h: 2, prop: 'spike' }),
  '*': d({ surf: 'path', h: 2, prop: 'item' }),
  P: d({ surf: 'path', h: 2, prop: 'checkpoint' }),
  $: d({ surf: 'path', h: 2, prop: 'goal' }),
  x: d({ surf: 'path', h: 2, prop: 'blade' }),
  R: d({ surf: 'path', h: 1, prop: 'springboard' }),
};

export function glyphCell(ch: string): CellDef {
  return GLYPHS[ch] ?? d({ surf: 'void', h: 0 });
}

/** surfaces the marble cannot pass through */
export function isSolidSurf(s: Surf): boolean {
  return s === 'wall' || s === 'tree' || s === 'rock';
}

/** surfaces that are drawn but not standable (holo decks are solid until hit) */
export function isDriveable(s: Surf): boolean {
  return s !== 'void' && !isSolidSurf(s);
}
