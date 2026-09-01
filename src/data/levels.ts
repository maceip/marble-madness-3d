// The six courses, hand-built from the arcade stage maps. Each character of a
// layout row is a complete ground cell (surface + height + fall direction, see
// kinds.ts) and rows read as a diagonal isometric map: +x runs down-right, +z
// runs down-left. `npm run validate` compiles every course and rejects illegal
// height jumps, so the ASCII stays a faithful picture of the terrain.

import { buildLevel } from './build.js';
import type { LevelDef } from './types.js';

const DEFS: LevelDef[] = [
  // =====================================================================
  // 1. WILD WOODS - a green plateau ringed by trees, a duck pond, two
  //    sawmills, spike fields and diagonal chutes down to the goal bowl.
  // =====================================================================
  {
    id: 1,
    name: 'Wild Woods',
    subtitle: 'Watch out for the sawmill blades',
    theme: 'woodland',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 1.png',
    baseHeight: 12,
    time: 125,
    start: [3.4, 2.0],
    layout: [
      ' ##tt###...tt##   ',
      ' #.tt.........#   ',
      ' #..=..^..=...#   ',
      ' #..==..2..==.#   ',
      ' #..t.P.t....t#   ',
      ' #^^..2..2..^^#   ',
      ' #............#   ',
      ' #..bBBBBb....#   ',
      ' #..b........b#   ',
      ' #R.4..^^^^.4b#   ',
      ' #..4........4#   ',
      ' #..46.......64#  ',
      ' #..46.......64#  ',
      ' #..46.......64#  ',
      ' #..46.....$.64#  ',
      ' #...46.....64#   ',
      ' #....466664#     ',
      '  #..........#    ',
    ],
    patches: {
      cells: {
        // sunken, slippery pond
        '3,2:4,3': { surf: 'water', h: 0 },
        '7,2:8,3': { surf: 'water', h: 0 },
        // sawmills
        '6,3': { surf: 'path', h: 2, prop: 'blade' },
        '12,3': { surf: 'path', h: 2, prop: 'blade' },
        '9,5': { surf: 'path', h: 2, prop: 'item' },
        '10,5': { surf: 'path', h: 2, prop: 'item' },
        '2,5:3,5': { surf: 'path', h: 2, prop: 'spike' },
        // the chute walls are 2-step ramps, so the terrace they land on has
        // to be two steps higher than the plateau or the seam is a cliff
        '3,7:8,7': { surf: 'path', h: 5, fall: 'SW' },
        '3,8': { surf: 'path', h: 5, fall: 'SW' },
        '9,8:10,8': { surf: 'path', h: 5, fall: 'E' },
        '11,8': { surf: 'path', h: 3, fall: 'E' },
        '12,7:15,7': { surf: 'path', h: 5, fall: 'SE' },
        '12,8:15,8': { surf: 'path', h: 3, fall: 'SE' },
        '16,7': { surf: 'path', h: 1, fall: 'SE' },
        '16,8': { surf: 'path', h: 0 },
        // springboard pad flings you over the lower spike field
        '2,9': { surf: 'path', h: 3, prop: 'springboard' },
        '13,9:16,9': { surf: 'path', h: 2, prop: 'spike' },
        // goal basin: floors step down 4 -> 2 so the run-in is a ramp
        '4,14:5,15': { surf: 'path', h: 4 },
        '6,15:11,16': { surf: 'path', h: 2 },
        '7,14': { surf: 'path', h: 2, prop: 'goal' },
        '8,16:11,16': { surf: 'path', h: 2 },
      },
    },
    hazards: [
      { kind: 'bat', x: 6, z: 2, h: 8, period: 3.2, axis: 'x', range: 3, speed: 0.28 },
      { kind: 'bat', x: 13, z: 6, h: 8, period: 4.1, axis: 'z', range: 3.4, speed: 0.24 },
      { kind: 'bomber', x: 10, z: 3, h: 9, period: 6, axis: 'x', range: 6, speed: 0.22 },
      { kind: 'snake', x: 4, z: 10, h: 6, path: [[4, 10], [8, 10], [10, 12], [13, 14]], speed: 0.3 },
      { kind: 'blade', x: 5, z: 12, h: 7, period: 4.5, axis: 'z', range: 3, speed: 0.22 },
    ],
  },

  // =====================================================================
  // 2. ARCTIC ADVENTURE - ice chutes, catwalks over a fatal drop, igloos,
  //    a frozen lake and long fast slides into the goal.
  // =====================================================================
  {
    id: 2,
    name: 'Arctic Adventure',
    subtitle: 'Mind the crevasses',
    theme: 'arctic',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 2.png',
    baseHeight: 14,
    time: 130,
    start: [2.2, 1.6],
    layout: [
      ' mmmmmmmmmmmmmmmmmm ',
      ' m........m.......m ',
      ' m.ebb.~~~.m.ebbb.m ',
      ' m.4..P..b.m.....m ',
      ' m......mmm...$..m ',
      ' m.=.....m.......m ',
      ' m..=..........^.m ',
      ' m.ee....x....ee.m ',
      ' m..............m  ',
      ' m..P.....*.....m  ',
      ' m.............m   ',
    ],
    patches: {
      cells: {
        // glacier: two wide ice chutes, 2 steps per cell, ending on the deck
        '4,2:8,2': { surf: 'snow', h: 5, fall: 'SW' },
        '12,2:15,2': { surf: 'snow', h: 5, fall: 'SE' },
        '3,3:7,3': { surf: 'snow', h: 3, fall: 'SW' },
        '8,3': { surf: 'snow', h: 1 },
        // the lake is sunken (h0) and drags the marble down
        '2,5:3,6': { surf: 'water', h: 0 },
        '9,5': { surf: 'water', h: 1 },
        // catwalk over the crevasse: h3 deck, void between the rails
        '12,5:16,5': { surf: 'metal', h: 3 },
        '12,6:16,6': { surf: 'void' },
        '12,7:16,7': { surf: 'metal', h: 1 },
        '11,5:11,7': { surf: 'metal', h: 2 },
        // drop chutes into the finish bowl
        '10,8:13,8': { surf: 'snow', h: 4, fall: 'SW' },
        '10,9:12,9': { surf: 'snow', h: 2, fall: 'SW' },
        '11,10:12,10': { surf: 'snow', h: 1, fall: 'SW' },
        // igloos
        '9,1:9,4': { surf: 'wall', h: 3 },
        '8,4:9,4': { surf: 'wall', h: 3 },
        // saw pit + pickups
        '12,4': { surf: 'path', h: 2, prop: 'blade' },
        '18,3': { surf: 'path', h: 2, prop: 'item' },
        '16,8': { surf: 'path', h: 2, prop: 'item' },
        '5,9': { surf: 'path', h: 2, prop: 'checkpoint' },
        '2,3': { surf: 'path', h: 2, prop: 'spike' },
        '3,7': { surf: 'path', h: 2, prop: 'spike' },
      },
    },
    hazards: [
      { kind: 'bomber', x: 6, z: 4, h: 9, period: 5, axis: 'x', range: 5, speed: 0.3 },
      { kind: 'bat', x: 14, z: 6, h: 9, period: 3.4, axis: 'z', range: 3.2, speed: 0.26 },
      { kind: 'blade', x: 6, z: 7, h: 4, period: 2.6, axis: 'x', range: 4, speed: 0.34 },
      { kind: 'snake', x: 3, z: 9, h: 5, path: [[3, 9], [9, 9], [11, 10]], speed: 0.32 },
    ],
  },

  // =====================================================================
  // 3. EDGY MAZE - four floors of lethal geometry: glass chutes, holo
  //    decks you fall through and a labyrinth of solid walls.
  // =====================================================================
  {
    id: 3,
    name: 'Edgy Maze',
    subtitle: 'Four floors of lethal geometry',
    theme: 'edgy',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 3.png',
    baseHeight: 16,
    time: 140,
    start: [2.0, 1.6],
    layout: [
      ' ################## ',
      ' #..g..#....#..g.# ',
      ' #.bbb.-#.-.fff.# ',
      ' #.bbb.-#.-.fff.# ',
      ' #......#....#..# ',
      ' #.xxxx.#....#.x# ',
      ' #......#....#..# ',
      ' #...#......#...# ',
      ' ################## ',
    ],
    patches: {
      cells: {
        // the maze spine: solid walls that bounce you, and two open corridors
        '6,1:6,7': { surf: 'wall', h: 3 },
        '7,1:7,7': { surf: 'wall', h: 3 },
        '12,1:12,7': { surf: 'void' },
        '13,2:13,6': { surf: 'void' },
        // glass chutes: 3-cell runs that drop from the h4 decks to h1
        '2,2:4,2': { surf: 'glass', h: 4, fall: 'SW' },
        '2,3:4,3': { surf: 'glass', h: 1, fall: 'SW' },
        '14,2:16,2': { surf: 'glass', h: 4, fall: 'SE' },
        '14,3:16,3': { surf: 'glass', h: 1, fall: 'SE' },
        // the sink: holo decks four steps above a hard floor - step on one
        // and it flickers out and you fall through to the level below
        '8,4:11,7': { surf: 'holo', h: 0 },
        '9,8:11,8': { surf: 'path', h: 0 },
        '3,8:5,8': { surf: 'path', h: 0 },
        // goal chamber + pickups
        '15,8': { surf: 'path', h: 1, prop: 'goal' },
        '4,4': { surf: 'path', h: 2, prop: 'item' },
        '5,5': { surf: 'path', h: 2, prop: 'item' },
        '14,6': { surf: 'path', h: 2, prop: 'checkpoint' },
      },
    },
    hazards: [
      { kind: 'blade', x: 3, z: 5, h: 6, period: 3, axis: 'x', range: 3.4, speed: 0.3 },
      { kind: 'bat', x: 10, z: 3, h: 12, period: 3.6, axis: 'z', range: 3, speed: 0.27 },
      { kind: 'bat', x: 4, z: 3, h: 12, period: 4, axis: 'z', range: 3, speed: 0.25 },
      { kind: 'bomber', x: 15, z: 5, h: 11, period: 5.5, axis: 'x', range: 3.5, speed: 0.28 },
      { kind: 'snake', x: 10, z: 6, h: 5, path: [[10, 6], [14, 6], [16, 8]], speed: 0.34 },
    ],
  },

  // =====================================================================
  // 4. DUSTY TRAIL - desert mesa: sand fields, a plank ramp across a
  //    gorge, geysers and a long slide into the goal.
  // =====================================================================
  {
    id: 4,
    name: 'Dusty Trail',
    subtitle: 'Gorge crossings and geysers',
    theme: 'desert',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 4.png',
    baseHeight: 13,
    time: 130,
    start: [2.4, 1.6],
    layout: [
      ' ~~~~~~~~~~~~~~~~ ',
      ' ~..*..^^...$..~ ',
      ' ~.............. ',
      ' ~..mmm....mmm.~ ',
      ' ~..m.m....m.m.~ ',
      ' ~.............. ',
      '  ~..bbbbb..~~~ ',
      '   ~..b...b.~~   ',
      '    ~..bbb~     ',
      '     ~~...~~      ',
      '      ~$P~       ',
      '       ~~        ',
    ],
    patches: {
      cells: {
        // gorge: a void you have to clear on the plank ramp
        '3,6:11,6': { surf: 'void' },
        '2,6': { surf: 'sand', h: 1 },
        '12,6': { surf: 'sand', h: 1 },
        // wooden boards laid across it: h3 deck, h1 landing
        '3,5:9,5': { surf: 'metal', h: 3 },
        '3,7:9,7': { surf: 'metal', h: 1 },
        // geysers punching out of the sand
        '6,8': { surf: 'sand', h: 1, prop: 'spike' },
        '7,9': { surf: 'sand', h: 1, prop: 'spike' },
        '5,9': { surf: 'sand', h: 1, prop: 'spike' },
        '8,10': { surf: 'sand', h: 1, prop: 'blade' },
        '3,2': { surf: 'sand', h: 1, prop: 'item' },
        '13,1': { surf: 'sand', h: 1, prop: 'checkpoint' },
      },
    },
    hazards: [
      { kind: 'snake', x: 3, z: 3, h: 5, path: [[3, 3], [12, 3], [12, 8], [6, 10]], speed: 0.32 },
      { kind: 'bat', x: 7, z: 4, h: 9, period: 3.2, axis: 'x', range: 4, speed: 0.3 },
      { kind: 'bomber', x: 11, z: 6, h: 9, period: 5, axis: 'z', range: 3.4, speed: 0.26 },
      { kind: 'blade', x: 4, z: 8, h: 4, period: 4.2, axis: 'x', range: 3, speed: 0.28 },
    ],
  },

  // =====================================================================
  // 5. DRILLIN' RYE - ore-cart rails, dark shafts, springboards and a
  //    tunnel that dumps you into a spike pit.
  // =====================================================================
  {
    id: 5,
    name: "Drillin' Rye",
    subtitle: 'Mind the ore carts',
    theme: 'mine',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 5.png',
    baseHeight: 15,
    time: 145,
    start: [2.2, 1.6],
    layout: [
      ' ################ ',
      ' #..==.##...^^.# ',
      ' #..==.##......# ',
      ' #..R..##.$...# ',
      ' #......##.####.# ',
      ' #....R.....R..# ',
      ' #.............# ',
      ' ##..xx....xx.# ',
      ' #.............# ',
      ' #..P........*.# ',
      ' ################ ',
    ],
    patches: {
      cells: {
        // shafts that swallow the marble whole
        '3,1:4,2': { surf: 'void' },
        '11,1:12,2': { surf: 'void' },
        '10,7:11,7': { surf: 'void' },
        // holo bridge across the first shaft
        '3,3:4,3': { surf: 'holo', h: 1 },
        // ore-cart rails: fast metal, three steps down the drift
        '2,5:13,5': { surf: 'metal', h: 3, fall: 'S' },
        '2,6:13,6': { surf: 'metal', h: 1, fall: 'S' },
        '2,7:13,7': { surf: 'metal', h: 0 },
        '14,5:14,7': { surf: 'path', h: 0 },
        // support pillars
        '7,2:7,4': { surf: 'wall', h: 3 },
        '8,2:8,4': { surf: 'wall', h: 3 },
        '6,8': { surf: 'sand', h: 1, prop: 'spike' },
        '9,9': { surf: 'sand', h: 1, prop: 'spike' },
        '4,8': { surf: 'path', h: 2, prop: 'item' },
        '3,9': { surf: 'path', h: 2, prop: 'checkpoint' },
        '12,3': { surf: 'path', h: 2, prop: 'goal' },
      },
    },
    hazards: [
      { kind: 'snake', x: 3, z: 5, h: 6, path: [[3, 5], [13, 5], [13, 8], [3, 8]], speed: 0.36 },
      { kind: 'snake', x: 12, z: 6, h: 6, path: [[12, 6], [2, 6], [2, 9], [12, 9]], speed: 0.3 },
      { kind: 'blade', x: 8, z: 3, h: 10, period: 4, axis: 'z', range: 3, speed: 0.28 },
      { kind: 'bat', x: 11, z: 9, h: 8, period: 3.5, axis: 'x', range: 3.5, speed: 0.26 },
    ],
  },

  // =====================================================================
  // 6. SPACE DEMENTIA - anti-gravity: cloud platforms, holo walkways over
  //    an abyss and glass links between floating plates.
  // =====================================================================
  {
    id: 6,
    name: 'Space Dementia',
    subtitle: 'Anti-gravity and thin air',
    theme: 'space',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 6.png',
    baseHeight: 16,
    time: 150,
    start: [2.2, 1.4],
    layout: [
      ' cccccccccccccccccc ',
      ' cc..bb....bb....cc ',
      ' cc..bb....bb....cc ',
      ' c....ss...ss....c  ',
      ' c....ss...ss....c  ',
      ' c..4..........4.c ',
      ' c..4..P....$..4.c ',
      ' cccccccccccccccccc ',
    ],
    patches: {
      cells: {
        // the middle of the course is open sky
        '2,3:15,6': { surf: 'void' },
        '1,1:16,2': { surf: 'cloud', h: 5 },
        // glass links: miss them and you drop into the void
        '4,3:5,4': { surf: 'glass', h: 3, fall: 'S' },
        '9,3:10,4': { surf: 'glass', h: 4, fall: 'S' },
        // holo walkways over the abyss (they will not hold you)
        '3,5:6,5': { surf: 'holo', h: 1 },
        '10,5:13,5': { surf: 'holo', h: 1 },
        // a genuine cloud bridge to the goal plate
        '7,6:9,6': { surf: 'cloud', h: 2 },
        '8,7': { surf: 'cloud', h: 1, prop: 'goal' },
        '13,4': { surf: 'path', h: 2, prop: 'item' },
        '3,4': { surf: 'path', h: 2, prop: 'spike' },
      },
    },
    hazards: [
      { kind: 'bomber', x: 6, z: 2, h: 12, period: 4.5, axis: 'x', range: 5, speed: 0.34 },
      { kind: 'bomber', x: 12, z: 5, h: 12, period: 5.5, axis: 'z', range: 3.4, speed: 0.3 },
      { kind: 'bat', x: 4, z: 6, h: 11, period: 3, axis: 'x', range: 4, speed: 0.32 },
      { kind: 'blade', x: 11, z: 6, h: 10, period: 3.8, axis: 'z', range: 3, speed: 0.28 },
    ],
  },
];

export const LEVELS = DEFS.map((def) => buildLevel(def));

export function levelCount(): number {
  return LEVELS.length;
}
