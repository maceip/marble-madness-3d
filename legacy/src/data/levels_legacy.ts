// Eight arcade courses, including the classic 6 courses plus the two new
// courses: Astral Spire (Celestial Tower) and Pyramid Oasis (Pharaoh's Sands).
// Each row is a cell spreadsheet: glyphs carry surface + height (kinds.ts),
// patches add contour (waves, cube faces, ice, rails, pyramids, obelisks).
// Down the page is +z and usually downhill.

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
    hazards: [
      { kind: 'muncher', x: 10, z: 12, h: 5 },
      { kind: 'steelie', x: 9, z: 22, h: 8, range: 2.5 },
    ],
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
      '  miiii               ',
      '  miii                ',
      '  miiiiii             ',
      '  miii                ',
      '  miiiiii             ',
      '  miiiiiiii           ',
      '  miiiiPiiii          ',
      '  miiiiiiii           ',
      '  miiii$iii           ',
      '  mmmmmmmm            ',
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
      { kind: 'steelie', x: 8, z: 8, h: 5, range: 3.0 },
      { kind: 'muncher', x: 6, z: 18, h: 3 },
      { kind: 'bat', x: 8, z: 7, h: 12, period: 3.4, axis: 'x', range: 4, speed: 0.26 },
      { kind: 'blade', x: 8, z: 16, h: 5, period: 2.8, axis: 'x', range: 4, speed: 0.32 },
      { kind: 'snake', x: 4, z: 22, h: 5, path: [[4, 22], [8, 23], [6, 25]], speed: 0.3 },
      { kind: 'bomber', x: 10, z: 11, h: 10, period: 5.2, axis: 'x', range: 4, speed: 0.24 },
    ],
  },

  // =====================================================================
  // 3. ASTRAL SPIRE — Celestial Tower (Image #1)
  //    Sky-blue stone citadel with relief mural balustrades, gold stars,
  //    chutes, funnel shaft, stepped pyramid terraces, and maze finish.
  // =====================================================================
  {
    id: 3,
    name: 'Astral Spire',
    subtitle: 'Celestial tower — starlight and carved stone',
    theme: 'celestial',
    sourceArt: 'stage_tower.jpg',
    baseHeight: 18,
    time: 110,
    start: [12.4, 2.4],
    layout: pad([
      '      ####gggggg####  ',
      '     #....gggggg....# ',
      '    #.....P.........# ',
      '    #....bbbbbbbb...# ',
      '   #.....bbbbbbbb....#',
      '   #..##kkkkkkkk##...#',
      '   #..#..........#...#',
      '   #..#..........#...#',
      '   #..#..ffffffff#...#',
      '   #..#..ffffffff#...#',
      '   #..#..##....##....#',
      '   #..#..............#',
      '   #..#..000000..#...#',
      '   #..#..000000..#...#',
      '   #..#..bbbbbb..#...#',
      '   #..#..bbbbbb..#...#',
      '   #..#..........#...#',
      '   #..#..P.......#...#',
      '   #..#..........#...#',
      '   #..#..ffffffff#...#',
      '   #..#..ffffffff#...#',
      '   #..##kkkkkkkk##...#',
      '   #.................#',
      '   #..222222222222...#',
      '   #..244444444422...#',
      '   #..246666664422...#',
      '   #..246k..k64422...#',
      '   #..246k.$k64422...#',
      '   #..246666664422...#',
      '   #..244444444422...#',
      '   #..222222222222...#',
      '   ###################',
    ]),
    patches: {
      cells: {
        '6,0:15,0': { surf: 'wall', h: 4, solid: true },
        '9,0:15,3': { surf: 'glass', h: 4 },
        '9,2': { surf: 'path', h: 4, prop: 'checkpoint' },
        '5,3:15,4': { surf: 'path', h: 4, fall: 'SW' },
        '6,5:14,5': { surf: 'wall', h: 3, solid: true },
        '5,6:15,7': { surf: 'path', h: 3 },
        '7,8:14,9': { surf: 'path', h: 3, fall: 'SE' },
        '6,10:15,11': { surf: 'path', h: 2 },
        '7,12:12,13': { surf: 'water', h: 0 },
        '7,14:14,15': { surf: 'path', h: 2, fall: 'SW' },
        '5,16:15,18': { surf: 'path', h: 2 },
        '8,17': { surf: 'path', h: 2, prop: 'checkpoint' },
        '6,19:14,20': { surf: 'path', h: 2, fall: 'SE' },
        '4,23:17,30': { surf: 'path', h: 2 },
        '7,25:14,28': { surf: 'path', h: 3 },
        '9,26:12,27': { surf: 'path', h: 4 },
        '10,27': { surf: 'path', h: 4, prop: 'goal' },
        '6,7': { surf: 'path', h: 3, prop: 'item' },
        '14,11': { surf: 'path', h: 2, prop: 'item' },
        '13,18': { surf: 'path', h: 2, prop: 'item' },
      },
    },
    hazards: [
      { kind: 'steelie', x: 11, z: 10, h: 3, range: 3.5 },
      { kind: 'muncher', x: 8, z: 24, h: 2 },
      { kind: 'bat', x: 10, z: 6, h: 12, period: 3.6, axis: 'x', range: 4, speed: 0.3 },
      { kind: 'blade', x: 8, z: 11, h: 6, period: 3.2, axis: 'x', range: 3.5, speed: 0.28 },
      { kind: 'blade', x: 11, z: 18, h: 5, period: 2.8, axis: 'z', range: 3, speed: 0.32 },
      { kind: 'bat', x: 7, z: 24, h: 8, period: 4.2, axis: 'x', range: 4.5, speed: 0.26 },
    ],
  },

  // =====================================================================
  // 4. PYRAMID OASIS — Sands of the Pharaoh (Image #2)
  //    Great Pyramid tomb entrance, desert dunes, black obelisks with
  //    glowing hieroglyphs, sunken oasis pool, chasm bridge & dual goals.
  // =====================================================================
  {
    id: 4,
    name: 'Pyramid Oasis',
    subtitle: "Pharaoh's tombs and black obelisks",
    theme: 'egyptian',
    sourceArt: 'stage_pyramid.jpg',
    baseHeight: 16,
    time: 115,
    start: [7.4, 2.4],
    layout: pad([
      '   kkkkkkkkkkkkkkkk   ',
      '  k...kkk....kkk...k  ',
      '  k.t.kkk.P..kkk.t.k  ',
      '  k...kkk....kkk...k  ',
      '  k~~~~~~~~~~~~~~~~k  ',
      '  k~..kk......kk..~k  ',
      '  k~..kk......kk..~k  ',
      '  k~..jj......jj..~k  ',
      '  k~..jj......jj..~k  ',
      '  k~..............~k  ',
      '  k~..##......##..~k  ',
      '  k~..##......##..~k  ',
      '  k~..............~k  ',
      '  k~bbbbbb..ffffff~k  ',
      '  k~bbbbbb..ffffff~k  ',
      '  k~..............~k  ',
      '  k~.t..........t.~k  ',
      '  k~....======....~k  ',
      '  k~....======....~k  ',
      '  k~....======....~k  ',
      '  k~..............~k  ',
      '  k~..P........P..~k  ',
      '  k~..............~k  ',
      '  k~....ffffff....~k  ',
      '  k~....ffffff....~k  ',
      '  k~....mmmmmm....~k  ',
      '  k~....mmmmmm....~k  ',
      '  k~gg..........gg~k  ',
      '  k~$g..........g$~k  ',
      '   kkkkkkkkkkkkkkkk   ',
    ]),
    patches: {
      cells: {
        '2,0:17,0': { surf: 'rock', h: 4, solid: true },
        '5,1:7,3': { surf: 'rock', h: 4, solid: true },
        '11,1:13,3': { surf: 'rock', h: 4, solid: true },
        '8,2': { surf: 'sand', h: 4, prop: 'checkpoint' },
        '3,2': { surf: 'tree', h: 4, solid: true },
        '15,2': { surf: 'tree', h: 4, solid: true },

        '3,4:16,4': { surf: 'sand', h: 4, fall: 'S' },
        '5,5:7,6': { surf: 'rock', h: 4, solid: true },
        '11,5:13,6': { surf: 'rock', h: 4, solid: true },
        '5,7:7,8': { surf: 'metal', h: 4 },
        '11,7:13,8': { surf: 'metal', h: 4 },

        '5,10:7,11': { surf: 'wall', h: 3, solid: true },
        '11,10:13,11': { surf: 'wall', h: 3, solid: true },

        '3,13:8,14': { surf: 'sand', h: 3, fall: 'SW' },
        '10,13:15,14': { surf: 'sand', h: 3, fall: 'SE' },

        '3,16': { surf: 'tree', h: 2, solid: true },
        '15,16': { surf: 'tree', h: 2, solid: true },

        '6,17:12,19': { surf: 'water', h: 0 },
        '3,20:15,22': { surf: 'sand', h: 2 },
        '4,21': { surf: 'sand', h: 2, prop: 'checkpoint' },
        '14,21': { surf: 'sand', h: 2, prop: 'checkpoint' },

        '6,23:12,24': { surf: 'sand', h: 2, fall: 'SE' },
        '6,25:12,26': { surf: 'metal', h: 2 },
        '3,27:5,28': { surf: 'glass', h: 2 },
        '13,27:15,28': { surf: 'glass', h: 2 },
        '3,28': { surf: 'glass', h: 2, prop: 'goal' },
        '15,28': { surf: 'glass', h: 2, prop: 'goal' },

        '9,9': { surf: 'sand', h: 3, prop: 'item' },
        '9,15': { surf: 'sand', h: 2, prop: 'item' },
        '9,21': { surf: 'sand', h: 2, prop: 'item' },
      },
    },
    hazards: [
      { kind: 'steelie', x: 9, z: 11, h: 4, range: 4.0 },
      { kind: 'muncher', x: 12, z: 18, h: 3 },
      { kind: 'bomber', x: 9, z: 5, h: 12, period: 4.8, axis: 'x', range: 4.5, speed: 0.28 },
      { kind: 'snake', x: 4, z: 9, h: 6, path: [[4, 9], [14, 9], [14, 12], [4, 12]], speed: 0.32 },
      { kind: 'blade', x: 9, z: 15, h: 5, period: 3.5, axis: 'x', range: 4, speed: 0.3 },
      { kind: 'snake', x: 4, z: 20, h: 4, path: [[4, 20], [14, 20], [10, 23]], speed: 0.34 },
    ],
  },

  // =====================================================================
  // 5. EDGY MAZE — Intermediate Race (Arcade Stage 3.png)
  //    Wall labyrinth, glass chutes, acid pools, rolling-floor waves,
  //    then a curved run into the goal chamber.
  // =====================================================================
  {
    id: 5,
    name: 'Edgy Maze',
    subtitle: 'Intermediate — four floors of geometry',
    theme: 'edgy',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 3.png',
    baseHeight: 16,
    time: 100,
    start: [3.4, 2.4],
    layout: pad([
      '  ##################  ',
      '  #..gg..-....-..gg.# ',
      '  #.bbbb.-#..-.ffff.# ',
      '  #.bbbb.-#..-.ffff.# ',
      '  #......#....#.....# ',
      '  #.xxxx.#....#.xx..# ',
      '  #......#....#.....# ',
      '  #...#..........#..# ',
      '  ##################  ',
      '      #........#      ',
      '      #..P..$..#      ',
      '      #........#      ',
      '      ##########      ',
    ]),
    patches: {
      cells: {
        '1,0:18,0': { surf: 'wall', h: 4, solid: true },
        '1,8:18,8': { surf: 'wall', h: 2, solid: true },
        '7,1:7,7': { surf: 'wall', h: 3, solid: true, fall: 'none' },
        '12,1:12,7': { surf: 'wall', h: 3, solid: true, fall: 'none' },

        '3,1:5,1': { surf: 'glass', h: 4 },
        '14,1:16,1': { surf: 'glass', h: 4 },
        '2,2:5,3': { surf: 'glass', h: 3, fall: 'SW' },
        '13,2:16,3': { surf: 'glass', h: 3, fall: 'SE' },

        '7,2:7,3': { surf: 'holo', h: 2, solid: false, fall: 'none' },
        '11,2:11,3': { surf: 'holo', h: 2, solid: false, fall: 'none' },
        '8,4:11,7': { surf: 'holo', h: 1, solid: false, fall: 'none' },

        '2,4:6,7': { surf: 'path', h: 2 },
        '13,4:17,7': { surf: 'path', h: 2 },

        '7,9:14,11': { surf: 'path', h: 1 },
        '8,10': { surf: 'path', h: 1, prop: 'checkpoint' },
        '12,10': { surf: 'path', h: 1, prop: 'goal' },
        '4,4': { surf: 'path', h: 2, prop: 'item' },
        '15,4': { surf: 'path', h: 2, prop: 'item' },
      },
    },
    hazards: [
      { kind: 'muncher', x: 5, z: 6, h: 2 },
      { kind: 'muncher', x: 14, z: 6, h: 2 },
      { kind: 'steelie', x: 9, z: 10, h: 1, range: 2.5 },
      { kind: 'blade', x: 4, z: 5, h: 4, period: 2.8, axis: 'x', range: 3, speed: 0.32 },
      { kind: 'blade', x: 15, z: 5, h: 4, period: 2.8, axis: 'x', range: 3, speed: 0.32 },
      { kind: 'bat', x: 9, z: 3, h: 10, period: 3.5, axis: 'z', range: 3, speed: 0.25 },
      { kind: 'bomber', x: 9, z: 6, h: 9, period: 5.0, axis: 'x', range: 4, speed: 0.28 },
    ],
  },

  // =====================================================================
  // 6. DUSTY TRAIL — Expert Race (Arcade Stage 4.png)
  //    Desert mesa, gorge crossing on narrow wooden boards, geysers,
  //    then a fast downhill bowl.
  // =====================================================================
  {
    id: 6,
    name: 'Dusty Trail',
    subtitle: 'Expert — gorge crossing and geysers',
    theme: 'desert',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 4.png',
    baseHeight: 14,
    time: 105,
    start: [3.4, 2.4],
    layout: pad([
      '  ~~~~~~~~~~~~~~~~    ',
      '  ~..*..^^...$..~~    ',
      '  ~..............~    ',
      '  ~..mmm....mmm..~    ',
      '  ~..m.m....m.m..~    ',
      '  ~..............~    ',
      '   ~..bbbbbb..~~~     ',
      '    ~..b...b.~~       ',
      '     ~..bbb.~         ',
      '      ~~...~~         ',
      '       ~$P~           ',
      '        ~~            ',
    ]),
    patches: {
      cells: {
        '4,3:7,4': { surf: 'metal', h: 3 },
        '11,3:14,4': { surf: 'metal', h: 3 },
        '4,6:10,8': { surf: 'sand', h: 2, fall: 'SW' },
        '6,8': { surf: 'sand', h: 1, prop: 'spike' },
        '8,9': { surf: 'sand', h: 1, prop: 'blade' },
        '8,10': { surf: 'sand', h: 1, prop: 'checkpoint' },
        '9,10': { surf: 'sand', h: 1, prop: 'goal' },
        '4,1': { surf: 'sand', h: 2, prop: 'item' },
      },
    },
    hazards: [
      { kind: 'muncher', x: 8, z: 3, h: 3 },
      { kind: 'acid', x: 6, z: 7, h: 2 },
      { kind: 'snake', x: 4, z: 3, h: 4, path: [[4, 3], [13, 3], [13, 7], [6, 9]], speed: 0.32 },
      { kind: 'bat', x: 8, z: 4, h: 8, period: 3.2, axis: 'x', range: 4, speed: 0.3 },
      { kind: 'bomber', x: 10, z: 5, h: 8, period: 5, axis: 'z', range: 3, speed: 0.26 },
    ],
  },

  // =====================================================================
  // 7. DRILLIN' RYE — Ore Carts & Shafts (Arcade Stage 5.png)
  //    Underground shafts, springboards, ore-cart rail slopes.
  // =====================================================================
  {
    id: 7,
    name: "Drillin' Rye",
    subtitle: 'Underground — mind the ore carts and shafts',
    theme: 'mine',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 5.png',
    baseHeight: 15,
    time: 110,
    start: [3.4, 2.4],
    layout: pad([
      '  ################    ',
      '  #..==.##...^^..#    ',
      '  #..==.##.......#    ',
      '  #..R..##.......#    ',
      '  #......##.####.#    ',
      '  #....R.....R...#    ',
      '  #..............#    ',
      '  ##..xx....xx..##    ',
      '  #..............#    ',
      '  #..P........$..#    ',
      '  ################    ',
    ]),
    patches: {
      cells: {
        '3,1:4,2': { surf: 'void' },
        '3,3:4,3': { surf: 'holo', h: 1 },
        '3,4': { surf: 'path', h: 1, prop: 'springboard' },
        '6,5': { surf: 'path', h: 1, prop: 'springboard' },
        '12,5': { surf: 'path', h: 1, prop: 'springboard' },
        '3,9': { surf: 'path', h: 1, prop: 'checkpoint' },
        '13,9': { surf: 'path', h: 1, prop: 'goal' },
      },
    },
    hazards: [
      { kind: 'steelie', x: 10, z: 5, h: 3, range: 3.0 },
      { kind: 'muncher', x: 9, z: 8, h: 2 },
      { kind: 'snake', x: 4, z: 5, h: 5, path: [[4, 5], [13, 5], [13, 8], [4, 8]], speed: 0.36 },
      { kind: 'blade', x: 8, z: 3, h: 8, period: 3.5, axis: 'z', range: 3, speed: 0.28 },
      { kind: 'bat', x: 10, z: 7, h: 8, period: 3.2, axis: 'x', range: 3.5, speed: 0.26 },
    ],
  },

  // =====================================================================
  // 8. SPACE DEMENTIA — Anti-Gravity (Arcade Stage 6.png)
  //    Floating cloud platforms, glass links, thin air and cosmic void.
  // =====================================================================
  {
    id: 8,
    name: 'Space Dementia',
    subtitle: 'Anti-gravity — thin air and cosmic abyss',
    theme: 'space',
    sourceArt: 'Arcade - Marble Madness - Stages - Stage 6.png',
    baseHeight: 16,
    time: 120,
    start: [3.4, 2.4],
    layout: pad([
      '  cccccccccccccccccc  ',
      '  cc..bb....bb....cc  ',
      '  cc..bb....bb....cc  ',
      '  c....ss...ss....c   ',
      '  c....ss...ss....c   ',
      '  c..4..........4.c   ',
      '  c..4..P....$..4.c   ',
      '  cccccccccccccccccc  ',
    ]),
    patches: {
      cells: {
        '3,3:4,4': { surf: 'glass', h: 3, fall: 'S' },
        '9,3:10,4': { surf: 'glass', h: 3, fall: 'S' },
        '7,6': { surf: 'cloud', h: 2, prop: 'checkpoint' },
        '12,6': { surf: 'cloud', h: 2, prop: 'goal' },
      },
    },
    hazards: [
      { kind: 'steelie', x: 8, z: 3, h: 3, range: 4.0 },
      { kind: 'acid', x: 11, z: 4, h: 3 },
      { kind: 'bomber', x: 6, z: 2, h: 10, period: 4.5, axis: 'x', range: 5, speed: 0.34 },
      { kind: 'bat', x: 5, z: 5, h: 9, period: 3.0, axis: 'x', range: 4, speed: 0.32 },
      { kind: 'blade', x: 11, z: 5, h: 8, period: 3.8, axis: 'z', range: 3, speed: 0.28 },
    ],
  },
];

export const LEVELS = DEFS.map((def) => buildLevel(def));

export function levelCount(): number {
  return LEVELS.length;
}
