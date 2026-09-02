// Six arcade courses, rebuilt from the Stage 1–6 source maps in the repo.
// Each row is a cell spreadsheet: glyphs carry surface + height (kinds.ts),
// patches add contour (waves, cube faces, ice, rails). Down the page is +z
// and usually downhill. `buildLevel` rejects neighbour drops > MAX_STEP.

import { buildLevel } from './build.js';
import type { LevelDef } from './types.js';

function pad(rows: string[], fill = ' '): string[] {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, fill));
}

const DEFS: LevelDef[] = [
  // =====================================================================
  // 1. PINK GARDENS — Practice Race (Arcade Stage 1.png)
  //    Raised magenta pad, perimeter pines, corrugated waves, right-then
  //    left chicane, then a real isometric cube you roll around (rock core
  //    on top, east drop, south ledge) into the goal pipe.
  // =====================================================================
  {
    id: 1,
    name: 'Pink Gardens',
    subtitle: 'Practice race — ride the waves',
    theme: 'garden',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 1.png',
    baseHeight: 12,
    time: 75,
    start: [10.4, 3.4],
    layout: pad([
      '      tttttttttt      ',
      '    tt..........tt    ',
      '   t..............t   ',
      '   t......P.......t   ',
      '   t..............t   ',
      '    tt..........tt    ',
      '     t..........t     ',
      '     t..........t     ',
      '     t..........t     ',
      '     t..........t     ',
      '     t..........t     ',
      '     t..........t     ',
      '     t..........t     ',
      '     t..........t     ',
      '              ......  ',
      '              ......  ',
      '     ..........       ',
      '     ..........       ',
      '     ......           ',
      '     ......           ',
      '     t88888888t       ',
      '     t8kkkkkk8t       ',
      '     t8k....k8t       ',
      '     t8k.kk.k8t       ',
      '     t8k....k8t       ',
      '     t88888888t       ',
      '     t..4444..t       ',
      '     t..2222..t       ',
      '     t....$...t       ',
      '      tttttttt        ',
    ]),
    patches: {
      cells: {
        '4,1:17,5': { surf: 'path', h: 8 },
        '10,3': { surf: 'path', h: 8, prop: 'checkpoint' },
        '5,1:6,1': { surf: 'tree', h: 8, solid: true },
        '15,1:16,1': { surf: 'tree', h: 8, solid: true },
        '3,2:3,4': { surf: 'tree', h: 8, solid: true },
        '18,2:18,4': { surf: 'tree', h: 8, solid: true },
        '4,5:5,5': { surf: 'tree', h: 8, solid: true },
        '16,5:17,5': { surf: 'tree', h: 8, solid: true },

        '6,6:15,6': { surf: 'path', h: 6, fall: 'S' },
        '6,7:15,7': { surf: 'path', h: 5, fall: 'S' },

        '6,8:15,8': { surf: 'path', h: 5 },
        '6,9:15,9': { surf: 'path', h: 3, fall: 'S' },
        '6,10:15,10': { surf: 'path', h: 5 },
        '6,11:15,11': { surf: 'path', h: 3, fall: 'S' },
        '6,12:15,12': { surf: 'path', h: 5 },
        '6,13:15,13': { surf: 'path', h: 4, fall: 'S' },
        '8,10': { surf: 'path', h: 5, prop: 'item' },
        '13,8': { surf: 'path', h: 5, prop: 'item' },

        '14,14:19,15': { surf: 'path', h: 4 },
        '5,16:14,17': { surf: 'path', h: 4 },
        '5,18:10,19': { surf: 'path', h: 4, fall: 'S' },
        '6,16': { surf: 'path', h: 4, prop: 'checkpoint' },
        '6,19:13,19': { surf: 'path', h: 6, fall: 'S' },

        '6,20:13,25': { surf: 'path', h: 8 },
        '7,21:12,21': { surf: 'rock', h: 8, solid: true },
        '7,22': { surf: 'rock', h: 8, solid: true },
        '12,22': { surf: 'rock', h: 8, solid: true },
        '7,23': { surf: 'rock', h: 8, solid: true },
        '9,23:10,23': { surf: 'rock', h: 8, solid: true },
        '12,23': { surf: 'rock', h: 8, solid: true },
        '7,24': { surf: 'rock', h: 8, solid: true },
        '12,24': { surf: 'rock', h: 8, solid: true },
        '5,20:5,28': { surf: 'tree', h: 8, solid: true },
        '14,20:14,28': { surf: 'tree', h: 4, solid: true },
        '15,22:17,26': { surf: 'path', h: 4, fall: 'S' },
        '6,26:13,26': { surf: 'path', h: 6, fall: 'S' },
        '6,27:13,27': { surf: 'path', h: 4, fall: 'S' },
        '7,28:12,28': { surf: 'path', h: 2 },
        '10,28': { surf: 'path', h: 2, prop: 'goal' },
        '8,24': { surf: 'path', h: 8, prop: 'item' },
      },
    },
    hazards: [],
  },

  // =====================================================================
  // 2. ARCTIC ADVENTURE — Beginner Race (Arcade Stage 2.png)
  //    Ice pad, glacial cube, twin chutes, catwalk over a crevasse,
  //    then The Reach (indented ice ribbon — stay left or drop).
  // =====================================================================
  {
    id: 2,
    name: 'Arctic Adventure',
    subtitle: 'Beginner race — mind the crevasses',
    theme: 'arctic',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 2.png',
    baseHeight: 14,
    time: 95,
    start: [8.4, 2.4],
    layout: pad([
      '  mmmmmmmmmmmmmmmm    ',
      '  miiiiiiiiiiiiim     ',
      '  miiiiPiiiiiiiim     ',
      '  miiiiiiiiiiiiim     ',
      '  mmmmiiiiiiiimmm     ',
      '  m  oooooooo  m      ',
      '  m  oiiiiiiio m      ',
      '  m  oiiiiiiio m      ',
      '  m  oooooooo  m      ',
      '  miiii  iiiiim       ',
      '  mbbbb  ffffim       ',
      '  miiii  iiiiim       ',
      '  miiiiiiiiiiim       ',
      '  m====mm====m        ',
      '  miiii  jjjjim       ',
      '  miiii      im       ',
      '  miiii  jjjjim       ',
      '  miiiiiiiiiiim       ',
      '  miiii                   ',
      '  miii                    ',
      '  miiiiii                 ',
      '  miii                    ',
      '  miiiiii                 ',
      '  miiiiiiii               ',
      '  miiiiPiiii              ',
      '  miiiiiiii               ',
      '  miiii$iii               ',
      '  mmmmmmmm                ',
    ]),
    patches: {
      cells: {
        '3,1:16,4': { surf: 'snow', h: 6 },
        '8,2': { surf: 'snow', h: 6, prop: 'checkpoint' },
        '2,0:17,0': { surf: 'metal', h: 6 },
        '2,1:2,4': { surf: 'metal', h: 6 },
        '17,1:17,4': { surf: 'wall', h: 6, solid: true },

        '5,5:14,8': { surf: 'snow', h: 6 },
        '6,6:13,7': { surf: 'snow', h: 6 },
        '8,6:11,7': { surf: 'rock', h: 6, solid: true },

        '3,9:6,12': { surf: 'snow', h: 5, fall: 'SW' },
        '9,9:14,12': { surf: 'snow', h: 5, fall: 'SE' },
        '3,12:14,12': { surf: 'snow', h: 3 },

        '3,13:6,13': { surf: 'water', h: 0 },
        '11,13:14,13': { surf: 'water', h: 0 },
        '7,13:10,13': { surf: 'metal', h: 3 },

        '3,14:6,17': { surf: 'snow', h: 3 },
        '11,14:14,14': { surf: 'metal', h: 4 },
        '11,15:14,15': { surf: 'void' },
        '11,16:14,16': { surf: 'metal', h: 2 },
        '7,14:10,17': { surf: 'snow', h: 3 },
        '14,17': { surf: 'snow', h: 3, prop: 'item' },

        '3,18:6,19': { surf: 'snow', h: 3, fall: 'S' },
        '3,20:8,20': { surf: 'snow', h: 2 },
        '3,21:5,21': { surf: 'snow', h: 2 },
        '3,22:8,22': { surf: 'snow', h: 2 },
        '3,23:10,23': { surf: 'snow', h: 2 },
        '3,24:10,24': { surf: 'snow', h: 2 },
        '7,24': { surf: 'snow', h: 2, prop: 'checkpoint' },
        '3,25:10,25': { surf: 'snow', h: 1 },
        '3,26:10,26': { surf: 'snow', h: 1 },
        '7,26': { surf: 'snow', h: 1, prop: 'goal' },
        '5,20': { surf: 'snow', h: 2, prop: 'item' },
      },
    },
    hazards: [
      { kind: 'bat', x: 8, z: 7, h: 12, period: 3.4, axis: 'x', range: 4, speed: 0.26 },
      { kind: 'blade', x: 8, z: 16, h: 5, period: 2.8, axis: 'x', range: 4, speed: 0.32 },
      { kind: 'snake', x: 4, z: 22, h: 5, path: [[4, 22], [8, 23], [6, 25]], speed: 0.3 },
      { kind: 'bomber', x: 10, z: 11, h: 10, period: 5.2, axis: 'x', range: 4, speed: 0.24 },
    ],
  },

  // =====================================================================
  // 3. EDGY MAZE — Intermediate Race (Arcade Stage 3.png)
  //    Wall labyrinth, glass chutes, acid pools, rolling-floor waves,
  //    then a curved run into the goal chamber.
  // =====================================================================
  {
    id: 3,
    name: 'Edgy Maze',
    subtitle: 'Intermediate — four floors of geometry',
    theme: 'edgy',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 3.png',
    baseHeight: 16,
    time: 100,
    start: [3.4, 2.4],
    layout: pad([
      '######################',
      '#........##.........#',
      '#..P.....##....g....#',
      '#........##.........#',
      '####..#######..######',
      '#........##.........#',
      '#.bbb....##....fff.#',
      '#........##.........#',
      '#....=======........#',
      '#........##.........#',
      '####..##....##..#####',
      '#..................#',
      '#..xxxx............#',
      '#..................#',
      '#.....HHHHHH.......#',
      '#.....ssssss.......#',
      '#.....HHHHHH.......#',
      '#..................#',
      '#........P.........#',
      '#..................#',
      '#.............$.#..#',
      '######################',
    ], '#'),
    patches: {
      cells: {
        '1,1:8,3': { surf: 'path', h: 6 },
        '3,2': { surf: 'path', h: 6, prop: 'checkpoint' },
        '11,1:19,3': { surf: 'path', h: 6 },
        '16,2': { surf: 'glass', h: 6 },

        '1,5:8,7': { surf: 'path', h: 4 },
        '2,6:4,6': { surf: 'glass', h: 4, fall: 'SW' },
        '11,5:19,7': { surf: 'path', h: 4 },
        '15,6:17,6': { surf: 'glass', h: 4, fall: 'SE' },

        '1,8:19,9': { surf: 'path', h: 3 },
        '5,8:11,8': { surf: 'water', h: 0 },
        '4,9': { surf: 'path', h: 3, prop: 'item' },

        '1,11:19,13': { surf: 'path', h: 3 },
        '3,12:6,12': { surf: 'path', h: 3, prop: 'blade' },

        '5,14:16,16': { surf: 'path', h: 3, fall: 'S' },
        '5,14:16,14': { surf: 'path', h: 4, fall: 'S' },
        '5,15:16,15': { surf: 'path', h: 2 },
        '5,16:16,16': { surf: 'path', h: 4, fall: 'S' },

        '1,17:19,20': { surf: 'path', h: 2 },
        '9,18': { surf: 'path', h: 2, prop: 'checkpoint' },
        '14,20': { surf: 'path', h: 2, prop: 'goal' },
        '16,18': { surf: 'path', h: 2, prop: 'item' },

        '9,1:10,9': { surf: 'wall', h: 4, solid: true },
        '0,0:21,0': { surf: 'wall', h: 4, solid: true },
        '0,21:21,21': { surf: 'wall', h: 3, solid: true },
      },
    },
    hazards: [
      { kind: 'blade', x: 4, z: 12, h: 6, period: 3, axis: 'x', range: 3.4, speed: 0.3 },
      { kind: 'bat', x: 14, z: 6, h: 12, period: 3.6, axis: 'z', range: 3, speed: 0.27 },
      { kind: 'bat', x: 4, z: 6, h: 12, period: 4, axis: 'z', range: 3, speed: 0.25 },
      { kind: 'snake', x: 8, z: 15, h: 6, path: [[8, 15], [14, 15], [12, 18]], speed: 0.32 },
      { kind: 'bomber', x: 16, z: 11, h: 11, period: 5.5, axis: 'x', range: 3.5, speed: 0.28 },
    ],
  },

  // =====================================================================
  // 4. DUSTY TRAIL — Aerial Race (Arcade Stage 4.png)
  //    Sand mesa, steep slide, plank over a gorge, geyser field, catapult
  //    (springboard) across a second gap, hammers, then the canyon goal.
  // =====================================================================
  {
    id: 4,
    name: 'Dusty Trail',
    subtitle: 'Aerial race — gorge, geysers, catapult',
    theme: 'desert',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 4.png',
    baseHeight: 13,
    time: 100,
    start: [6.4, 2.4],
    layout: pad([
      '  ~~~~~~~~~~~~~~~~    ',
      '  ~..............~    ',
      '  ~......P.......~    ',
      '  ~..............~    ',
      '  ~~............~~    ',
      '   ~............~     ',
      '   ~............~     ',
      '   ~bbbbbbbbbbb~~     ',
      '   ~............~     ',
      '   ~~..........~~     ',
      '    ~..mmmmmm..~      ',
      '    ~..........~      ',
      '    ~..........~      ',
      '    ~~~......~~~      ',
      '      ~.^^^^.~        ',
      '      ~......~        ',
      '      ~.^^^^.~        ',
      '      ~......~        ',
      '      ~..R...~        ',
      '      ~      ~        ',
      '      ~      ~        ',
      '      ~......~        ',
      '      ~......~        ',
      '      ~..P...~        ',
      '      ~..$...~        ',
      '       ~~~~~~         ',
    ]),
    patches: {
      cells: {
        '3,1:16,4': { surf: 'sand', h: 4 },
        '6,2': { surf: 'sand', h: 4, prop: 'checkpoint' },
        '4,3': { surf: 'sand', h: 4, prop: 'item' },

        '4,5:15,6': { surf: 'sand', h: 3, fall: 'S' },
        '4,7:15,7': { surf: 'sand', h: 3, fall: 'SW' },
        '4,8:15,8': { surf: 'sand', h: 2 },

        '5,10:12,10': { surf: 'metal', h: 4 },
        '5,11:12,11': { surf: 'void' },
        '5,12:12,12': { surf: 'metal', h: 2 },
        '4,9:13,9': { surf: 'sand', h: 2 },
        '4,13:13,13': { surf: 'sand', h: 2 },

        '7,14:10,14': { surf: 'sand', h: 1, prop: 'spike' },
        '6,15:11,15': { surf: 'sand', h: 1 },
        '7,16:10,16': { surf: 'sand', h: 1, prop: 'spike' },
        '6,17:11,17': { surf: 'sand', h: 1 },
        '7,18': { surf: 'sand', h: 2, prop: 'springboard' },
        '6,18:11,18': { surf: 'sand', h: 1 },

        '6,19:11,20': { surf: 'void' },
        '6,21:11,24': { surf: 'sand', h: 1 },
        '8,23': { surf: 'sand', h: 1, prop: 'checkpoint' },
        '9,24': { surf: 'sand', h: 1, prop: 'goal' },
        '10,22': { surf: 'sand', h: 1, prop: 'item' },
      },
    },
    hazards: [
      { kind: 'snake', x: 6, z: 8, h: 5, path: [[6, 8], [14, 8], [10, 12]], speed: 0.3 },
      { kind: 'blade', x: 8, z: 16, h: 4, period: 3.4, axis: 'x', range: 3, speed: 0.3 },
      { kind: 'bat', x: 9, z: 11, h: 9, period: 3.2, axis: 'x', range: 4, speed: 0.28 },
      { kind: 'bomber', x: 10, z: 21, h: 8, period: 5, axis: 'z', range: 2.5, speed: 0.24 },
    ],
  },

  // =====================================================================
  // 5. DRILLIN' RYE — mine race (Arcade Stage 5.png)
  //    Shafts, ore-cart rails, springboards over spike pits, hammers.
  // =====================================================================
  {
    id: 5,
    name: "Drillin' Rye",
    subtitle: 'Mine race — rails, hammers, ore carts',
    theme: 'mine',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 5.png',
    baseHeight: 15,
    time: 105,
    start: [4.4, 2.4],
    layout: pad([
      '######################',
      '#....................#',
      '#....P...............#',
      '#....................#',
      '####....####....######',
      '#....................#',
      '#..R....##....R......#',
      '#....................#',
      '#mmmmmmmmmmmmmmmmmmm#',
      '#mmmmmmmmmmmmmmmmmmm#',
      '#mmmmmmmmmmmmmmmmmmm#',
      '#....................#',
      '#..xx..........xx....#',
      '#....................#',
      '####....####....######',
      '#....................#',
      '#....R..........R....#',
      '#....................#',
      '#.........P..........#',
      '#....................#',
      '#.................$..#',
      '######################',
    ], '#'),
    patches: {
      cells: {
        '1,1:20,3': { surf: 'path', h: 6 },
        '4,2': { surf: 'path', h: 6, prop: 'checkpoint' },

        '1,4:3,4': { surf: 'wall', h: 5, solid: true },
        '8,4:11,4': { surf: 'wall', h: 5, solid: true },
        '16,4:20,4': { surf: 'wall', h: 5, solid: true },
        '4,4:7,4': { surf: 'metal', h: 5 },
        '5,4:6,4': { surf: 'void' },
        '12,4:15,4': { surf: 'metal', h: 5 },
        '13,4:14,4': { surf: 'void' },

        '1,5:20,7': { surf: 'path', h: 4 },
        '3,6': { surf: 'path', h: 4, prop: 'springboard' },
        '14,6': { surf: 'path', h: 4, prop: 'springboard' },
        '9,6:10,6': { surf: 'wall', h: 5, solid: true },

        '1,8:19,8': { surf: 'metal', h: 4, fall: 'S' },
        '1,9:19,9': { surf: 'metal', h: 2, fall: 'S' },
        '1,10:19,10': { surf: 'metal', h: 1 },

        '1,11:20,13': { surf: 'path', h: 1 },
        '3,12:4,12': { surf: 'path', h: 1, prop: 'blade' },
        '15,12:16,12': { surf: 'path', h: 1, prop: 'blade' },
        '8,12': { surf: 'path', h: 1, prop: 'item' },

        '4,14:7,14': { surf: 'metal', h: 1 },
        '5,14:6,14': { surf: 'void' },
        '12,14:15,14': { surf: 'metal', h: 1 },
        '13,14:14,14': { surf: 'void' },
        '1,15:20,17': { surf: 'path', h: 1 },
        '5,16': { surf: 'path', h: 1, prop: 'springboard' },
        '16,16': { surf: 'path', h: 1, prop: 'springboard' },
        '7,16': { surf: 'sand', h: 1, prop: 'spike' },
        '14,16': { surf: 'sand', h: 1, prop: 'spike' },

        '1,18:20,20': { surf: 'path', h: 1 },
        '10,18': { surf: 'path', h: 1, prop: 'checkpoint' },
        '18,20': { surf: 'path', h: 1, prop: 'goal' },
        '4,19': { surf: 'path', h: 1, prop: 'item' },
      },
    },
    hazards: [
      { kind: 'snake', x: 3, z: 9, h: 6, path: [[3, 9], [17, 9], [17, 12], [3, 12]], speed: 0.34 },
      { kind: 'snake', x: 16, z: 10, h: 6, path: [[16, 10], [2, 10], [2, 18], [16, 18]], speed: 0.28 },
      { kind: 'blade', x: 10, z: 12, h: 5, period: 3.6, axis: 'x', range: 4, speed: 0.3 },
      { kind: 'bat', x: 12, z: 16, h: 8, period: 3.5, axis: 'x', range: 3.5, speed: 0.26 },
    ],
  },

  // =====================================================================
  // 6. SPACE DEMENTIA — Ultimate Race (Arcade Stage 6.png)
  //    Cloud start, floating plates, glass links, holo traps (fall
  //    through), striped speedbumps, then the goal plate.
  // =====================================================================
  {
    id: 6,
    name: 'Space Dementia',
    subtitle: 'Ultimate race — thin air, holo traps',
    theme: 'space',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 6.png',
    baseHeight: 16,
    time: 110,
    start: [5.4, 2.4],
    layout: pad([
      'cccccccccccccccccccccc',
      'cc..................cc',
      'cc....P.............cc',
      'cc..................cc',
      'c....................c',
      'c....CCCC............c',
      'c....CCCC....CCCC....c',
      'c............CCCC....c',
      'c....................c',
      'c......gg............c',
      'c......gg....----....c',
      'c....................c',
      'c....CCCC............c',
      'c....CCCC....CCCC....c',
      'c............CCCC....c',
      'c....................c',
      'c.........P..........c',
      'c....................c',
      'c..............$.....c',
      'cccccccccccccccccccccc',
    ]),
    patches: {
      cells: {
        '2,1:19,3': { surf: 'cloud', h: 6 },
        '5,2': { surf: 'cloud', h: 6, prop: 'checkpoint' },
        '0,0:21,0': { surf: 'cloud', h: 5 },
        '0,19:21,19': { surf: 'cloud', h: 2 },

        // open sky between plates — later keys punch the islands back in
        '1,4:20,18': { surf: 'void' },

        '5,4:8,4': { surf: 'glass', h: 5, fall: 'S' },
        '5,5:8,6': { surf: 'cloud', h: 5 },
        '9,6:12,6': { surf: 'glass', h: 5 },
        '13,6:16,7': { surf: 'cloud', h: 5 },
        '13,8:16,8': { surf: 'glass', h: 4, fall: 'S' },
        '13,10:16,10': { surf: 'holo', h: 4 },
        '5,11:8,11': { surf: 'glass', h: 4, fall: 'S' },
        '5,12:8,13': { surf: 'cloud', h: 3 },
        '9,13:12,13': { surf: 'glass', h: 3 },
        '13,13:16,14': { surf: 'cloud', h: 3 },
        '8,15:12,15': { surf: 'cloud', h: 3, fall: 'S' },
        '8,16:12,16': { surf: 'cloud', h: 3 },
        '10,16': { surf: 'cloud', h: 3, prop: 'checkpoint' },
        '2,16:19,18': { surf: 'cloud', h: 2 },
        '15,18': { surf: 'cloud', h: 2, prop: 'goal' },
        '16,7': { surf: 'cloud', h: 5, prop: 'item' },
        '6,13': { surf: 'cloud', h: 3, prop: 'item' },
        '4,17': { surf: 'sand', h: 2 },
        '5,17': { surf: 'sand', h: 2 },
        '3,2': { surf: 'cloud', h: 6, prop: 'spike' },
      },
    },
    hazards: [
      { kind: 'bomber', x: 10, z: 6, h: 12, period: 4.5, axis: 'x', range: 5, speed: 0.3 },
      { kind: 'bomber', x: 14, z: 13, h: 12, period: 5.5, axis: 'z', range: 3, speed: 0.28 },
      { kind: 'bat', x: 7, z: 14, h: 11, period: 3, axis: 'x', range: 4, speed: 0.3 },
      { kind: 'blade', x: 12, z: 17, h: 6, period: 3.8, axis: 'z', range: 3, speed: 0.28 },
    ],
  },
];

export const LEVELS = DEFS.map((def) => buildLevel(def));

export function levelCount(): number {
  return LEVELS.length;
}
