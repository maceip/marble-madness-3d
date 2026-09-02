// Eight faithful arcade courses redesigned to match the iconic original stage artwork
// from Stage 1.png through Stage 8.png, complete with physical tubes, funnels,
// drop pipes, windmills, canopy occlusions, and accurate stage themes.
//
// Previous levels are preserved intact in ./levels_legacy.ts (not deleted).

import { buildLevel, type BuiltLevel } from "./build.js";
import type { LevelDef } from "./types.js";
export { LEVELS as LEGACY_LEVELS } from "./levels_legacy.js";

function pad(rows: string[], fill = " "): string[] {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, fill));
}

export const DEFS: LevelDef[] = [
  // =====================================================================
  // 1. PRACTICE RACE (Stage 1.png)
  //    Checkered slopes, upper pits with red railings, twin spires with
  //    stairs & tunnel, downward chicane, curved S-chute, and sunken GOAL tube.
  // =====================================================================
  {
    id: 1,
    name: "Practice Race",
    subtitle: "The original downhill run — ride the waves",
    theme: "practice",
    sourceArt: "Stage 1.png",
    baseHeight: 16,
    time: 65,
    start: [12.4, 2.4],
    layout: pad([
      "       ffffffffffff       ",
      "      f............f      ",
      "     f......P.......f     ",
      "     f..............f     ",
      "    ff...##....##...ff    ",
      "    f....##....##....f    ",
      "    f................f    ",
      "    f................f    ",
      "    f....########....f    ",
      "    f....#..P...#....f    ",
      "    f....#......#....f    ",
      "    f....########....f    ",
      "    f................f    ",
      "    f................f    ",
      "    f....########....f    ",
      "     f..............f     ",
      "     f..............f     ",
      "     f..............f     ",
      "      ff..........ff      ",
      "       f..........f       ",
      "       f..........f       ",
      "        f........f        ",
      "        f........f        ",
      "        f...bb...f        ",
      "        f...bb...f        ",
      "         f......f         ",
      "         f......f         ",
      "         f..ff..f         ",
      "         f..ff..f         ",
      "          f....f          ",
      "          f....f          ",
      "          f.bb.f          ",
      "          f.bb.f          ",
      "          f....f          ",
      "          f....f          ",
      "          f.$..f          ",
      "           ffff           ",
    ]),
    patches: {
      cells: {
        "8,1:16,3": { surf: "path", h: 10 },
        "12,2": { surf: "path", h: 10, prop: "checkpoint" },
        "9,4:10,5": { surf: "wall", h: 10, solid: true },
        "15,4:16,5": { surf: "wall", h: 10, solid: true },
        "8,6:17,8": { surf: "path", h: 9 },

        // Twin spires courtyard & tunnel
        "9,9:16,11": { surf: "path", h: 8 },
        "12,9": { surf: "path", h: 8, prop: "checkpoint" },
        "9,8:16,8": { surf: "metal", h: 9, solid: true },
        "9,12:16,12": { surf: "metal", h: 9, solid: true },

        // Mid plateau
        "9,13:16,18": { surf: "path", h: 7 },
        "8,14:8,18": { surf: "metal", h: 8, solid: true },
        "17,14:17,18": { surf: "metal", h: 8, solid: true },

        // Curved S-chute
        "8,19:15,22": { surf: "path", h: 6, fall: "S" },
        "9,23:14,26": { surf: "path", h: 5, fall: "SW" },
        "10,24": { surf: "path", h: 5, prop: "checkpoint" },
        "10,27:15,30": { surf: "path", h: 4, fall: "SE" },
        "11,31:14,34": { surf: "path", h: 3, fall: "S" },
        "11,33": { surf: "path", h: 3, prop: "checkpoint" },

        // Sunken GOAL tube
        "11,35:14,36": { surf: "metal", h: 2 },
        "12,35": { surf: "metal", h: 2, prop: "goal" },
      },
    },
    hazards: [
      { kind: "steelie", x: 12, z: 16, h: 7, range: 2.5 },
      { kind: "muncher", x: 12, z: 28, h: 4 },
    ],
  },

  // =====================================================================
  // 2. PYRAMID OASIS (Stage 2.png)
  //    Great Pyramid tomb entrance, desert dunes, black hieroglyph obelisks,
  //    sunken oasis pool, stepped bridge over deep blue water to dual finish pads.
  // =====================================================================
  {
    id: 2,
    name: "Pyramid Oasis",
    subtitle: "Pharaohs sands — obelisks and the sunken oasis",
    theme: "egyptian",
    sourceArt: "Stage 2.png",
    baseHeight: 18,
    time: 100,
    start: [14.4, 3.4],
    layout: pad([
      "    kkkkkkkkkkkkkkkkkk    ",
      "   k~~~~~~~~~~~~~~~~~~k   ",
      "   k~~~~~~~~~~~~~~~~~~k   ",
      "   k~~~~~~~P~~~~~~~~~~k   ",
      "   k~~~~~~~~~~~~~~~~~~k   ",
      "   k~~..kk......kk..~~k   ",
      "   k~~..kk......kk..~~k   ",
      "   k~~..............~~k   ",
      "   k~~..jj......jj..~~k   ",
      "   k~~..jj......jj..~~k   ",
      "   k~~..............~~k   ",
      "   k~~..##......##..~~k   ",
      "   k~~..##......##..~~k   ",
      "   k~~..............~~k   ",
      "   k~~..............~~k   ",
      "   k~~bbbb......ffff~~k   ",
      "   k~~bbbb......ffff~~k   ",
      "   k~~~~~~~~~~~~~~~~~~k   ",
      "   k~~~~..P....P..~~~~k   ",
      "   k~~~~..........~~~~k   ",
      "   k~~~~...====...~~~~k   ",
      "   k~~~~...====...~~~~k   ",
      "   k~~~~...====...~~~~k   ",
      "   k~~~~..........~~~~k   ",
      "   k~~~~..........~~~~k   ",
      "   k~~~~...ffff...~~~~k   ",
      "   k~~~~...ffff...~~~~k   ",
      "   k~~~~...mmmm...~~~~k   ",
      "   k~~~~...mmmm...~~~~k   ",
      "   k~~gg..........gg~~k   ",
      "   k~~$g..........g$~~k   ",
      "    kkkkkkkkkkkkkkkkkk    ",
    ]),
    patches: {
      cells: {
        "4,1:19,4": { surf: "sand", h: 10 },
        "14,3": { surf: "sand", h: 10, prop: "checkpoint" },
        "7,5:9,6": { surf: "rock", h: 10, solid: true },
        "15,5:17,6": { surf: "rock", h: 10, solid: true },

        "7,8:9,9": { surf: "metal", h: 10 },
        "15,8:17,9": { surf: "metal", h: 10 },

        // Giant black obelisks with gold hieroglyphs
        "7,11:9,12": { surf: "wall", h: 9, solid: true },
        "15,11:17,12": { surf: "wall", h: 9, solid: true },

        "5,15:8,16": { surf: "sand", h: 8, fall: "SW" },
        "15,15:18,16": { surf: "sand", h: 8, fall: "SE" },

        "6,18": { surf: "sand", h: 7, prop: "checkpoint" },
        "16,18": { surf: "sand", h: 7, prop: "checkpoint" },

        // Sunken oasis water pool
        "9,20:14,22": { surf: "water", h: 0 },

        "9,25:14,26": { surf: "sand", h: 5, fall: "SE" },
        "9,27:14,28": { surf: "metal", h: 4 },

        // Dual checkered finish pads over water
        "5,29:7,30": { surf: "glass", h: 3 },
        "16,29:18,30": { surf: "glass", h: 3 },
        "6,30": { surf: "glass", h: 3, prop: "goal" },
        "17,30": { surf: "glass", h: 3, prop: "goal" },
      },
    },
    hazards: [
      { kind: "steelie", x: 12, z: 10, h: 9, range: 3.5 },
      { kind: "muncher", x: 14, z: 23, h: 6 },
      { kind: "bomber", x: 12, z: 6, h: 14, period: 4.6, axis: "x", range: 4, speed: 0.28 },
    ],
  },

  // =====================================================================
  // 3. ASTRAL SPIRE (Stage 3.png)
  //    Celestial blue citadel with carved stone face relief plaques, gold star murals,
  //    pipe chute drop, stepped ziggurat terraces, and terrace maze.
  // =====================================================================
  {
    id: 3,
    name: "Astral Spire",
    subtitle: "Celestial citadel — star murals and ziggurat terraces",
    theme: "celestial",
    sourceArt: "Stage 3.png",
    baseHeight: 20,
    time: 110,
    start: [18.4, 2.4],
    layout: pad([
      "       ########gggggg#       ",
      "      #........gggggg.#      ",
      "     #.........P.......#     ",
      "     #........bbbbbb...#     ",
      "    #.........bbbbbb....#    ",
      "    #..##kkkkkkkk##.....#    ",
      "    #..#..........#.....#    ",
      "    #..#..........#.....#    ",
      "    #..#..ffffffff#.....#    ",
      "    #..#..ffffffff#.....#    ",
      "    #..#..##....##......#    ",
      "    #..#................#    ",
      "    #..#..000000..#.....#    ",
      "    #..#..000000..#.....#    ",
      "    #..#..bbbbbb..#.....#    ",
      "    #..#..bbbbbb..#.....#    ",
      "    #..#..........#.....#    ",
      "    #..#..P.......#.....#    ",
      "    #..#..........#.....#    ",
      "    #..#..ffffffff#.....#    ",
      "    #..#..ffffffff#.....#    ",
      "    #..##kkkkkkkk##.....#    ",
      "    #...................#    ",
      "    #..222222222222.....#    ",
      "    #..244444444422.....#    ",
      "    #..246666664422.....#    ",
      "    #..246k..k64422.....#    ",
      "    #..246k.$k64422.....#    ",
      "    #..246666664422.....#    ",
      "    #..244444444422.....#    ",
      "    #..222222222222.....#    ",
      "    #####################    ",
    ]),
    patches: {
      cells: {
        "8,0:16,0": { surf: "wall", h: 14, solid: true },
        "15,0:20,3": { surf: "glass", h: 14 },
        "18,2": { surf: "path", h: 14, prop: "checkpoint" },

        // Upper tier & chute drop hole
        "6,3:17,4": { surf: "path", h: 12, fall: "SW" },
        "7,5:16,5": { surf: "wall", h: 12, solid: true },

        // Chute hole transport down to mid terrace
        "20,8": { surf: "metal", h: 12, prop: "item" },

        "6,8:16,9": { surf: "path", h: 10, fall: "SE" },
        "7,12:14,13": { surf: "water", h: 0 },
        "6,14:16,15": { surf: "path", h: 8, fall: "SW" },
        "10,17": { surf: "path", h: 7, prop: "checkpoint" },
        "7,19:16,20": { surf: "path", h: 6, fall: "SE" },

        // Stepped ziggurat terraces & Goal
        "5,23:18,30": { surf: "path", h: 4 },
        "8,25:15,28": { surf: "path", h: 6 },
        "10,26:13,27": { surf: "path", h: 8 },
        "11,27": { surf: "path", h: 8, prop: "goal" },
      },
    },
    hazards: [
      { kind: "funnel", x: 20, z: 8, h: 12, targetX: 12, targetY: 7, targetZ: 17, period: 0.75 },
      { kind: "steelie", x: 12, z: 10, h: 10, range: 3.5 },
      { kind: "bat", x: 12, z: 6, h: 16, period: 3.6, axis: "x", range: 4, speed: 0.3 },
      { kind: "blade", x: 9, z: 11, h: 10, period: 3.2, axis: "x", range: 3.5, speed: 0.28 },
      { kind: "muncher", x: 10, z: 24, h: 5 },
    ],
  },

  // =====================================================================
  // 4. BEGINNER RACE (Stage 4.png)
  //    4 square hazard pits, 3 pyramid spires, PURPLE FUNNEL PIPES with
  //    suction & flared mouths, corrugated wave bridge, branched tube,
  //    and translucent ice pond with GOAL ramp.
  // =====================================================================
  {
    id: 4,
    name: "Beginner Race",
    subtitle: "The Funnel Chutes — tubes, wave bridges and ice pond",
    theme: "funnels",
    sourceArt: "Stage 4.png",
    baseHeight: 22,
    time: 90,
    start: [12.4, 2.4],
    layout: pad([
      "       ffffffffffff       ",
      "      f............f      ",
      "     f......P.......f     ",
      "     f..##......##..f     ",
      "     f..##......##..f     ",
      "     f..............f     ",
      "     f......##......f     ",
      "     f......##......f     ",
      "     f..............f     ",
      "     f..............f     ",
      "     f..##..##..##..f     ",
      "     f..##..##..##..f     ",
      "     f..............f     ",
      "     f..............f     ",
      "     f..ssss..ssss..f     ",
      "     f..ssss..ssss..f     ",
      "     f..............f     ",
      "     f..............f     ",
      "     f........mm....f     ",
      "     f........mm....f     ",
      "     f..............f     ",
      "     f..ssssssssss..f     ",
      "     f..ssssssssss..f     ",
      "     f..............f     ",
      "     f..............f     ",
      "     f....mm..mm....f     ",
      "     f....mm..mm....f     ",
      "     f..............f     ",
      "     f..iiiiiiiiii..f     ",
      "     f..iiiiiiiiii..f     ",
      "     f..iiii##iiii..f     ",
      "     f..iiii##iiii..f     ",
      "     f..iiiiiiiiii..f     ",
      "     f..............f     ",
      "     f......$.......f     ",
      "      ffffffffffffff      ",
    ]),
    patches: {
      cells: {
        "8,1:16,3": { surf: "path", h: 14 },
        "12,2": { surf: "path", h: 14, prop: "checkpoint" },

        // Top 4 pits
        "9,3:10,4": { surf: "void" },
        "15,3:16,4": { surf: "void" },
        "12,6:13,7": { surf: "void" },

        // 3 Pyramid spires
        "9,10:10,11": { surf: "rock", h: 13, solid: true },
        "12,10:13,11": { surf: "rock", h: 13, solid: true },
        "15,10:16,11": { surf: "rock", h: 13, solid: true },

        // Middle terrace
        "8,12:16,13": { surf: "path", h: 12 },
        "12,13": { surf: "path", h: 12, prop: "checkpoint" },

        // Steep ramp
        "9,14:15,15": { surf: "path", h: 11, fall: "S" },

        // First Purple Funnel Pipe
        "14,18:15,19": { surf: "metal", h: 10 },

        // Corrugated wave bridge
        "9,21:15,22": { surf: "path", h: 9, fall: "S" },

        // Branched Purple Funnel Tube
        "10,25:11,26": { surf: "metal", h: 7 },
        "14,25:15,26": { surf: "metal", h: 7 },

        // Translucent blue ice pond
        "8,28:16,32": { surf: "snow", h: 4 },
        "12,30:13,31": { surf: "rock", h: 5, solid: true },

        // Exit runout & Goal
        "9,33:15,34": { surf: "path", h: 3 },
        "12,34": { surf: "path", h: 3, prop: "goal" },
      },
    },
    hazards: [
      // 1. Purple Funnel Pipe (hopper at 14.5,18.5 -> exit at 12,23)
      {
        kind: "funnel",
        x: 14.5,
        z: 18.5,
        h: 10,
        targetX: 12,
        targetY: 9,
        targetZ: 23,
        period: 0.8,
        exitVelocity: [0.0, -0.02, 0.18],
        tubeColor: "#8833cc",
      },
      // 2. Branched Funnel Pipe (inlet 1 at 10,25 -> exit at 12,28)
      {
        kind: "tube",
        x: 10.5,
        z: 25.5,
        h: 7,
        targetX: 12,
        targetY: 4,
        targetZ: 28,
        period: 0.7,
        exitVelocity: [0.05, -0.05, 0.16],
        tubeColor: "#8833cc",
      },
      // 3. Branched Funnel Pipe (inlet 2 at 14,25 -> exit at 12,28)
      {
        kind: "tube",
        x: 14.5,
        z: 25.5,
        h: 7,
        targetX: 12,
        targetY: 4,
        targetZ: 28,
        period: 0.7,
        exitVelocity: [-0.05, -0.05, 0.16],
        tubeColor: "#8833cc",
      },
      { kind: "steelie", x: 12, z: 12, h: 12, range: 3.0 },
      { kind: "muncher", x: 12, z: 21, h: 9 },
    ],
  },

  // =====================================================================
  // 5. AERIAL RACE / HIGH DIVE (Stage 5.png)
  //    Twin high launch towers, High Dive chasm drop onto stepping stones,
  //    vertical funnel drop pipe (spigot), acid pools, curved green ramps to GOAL.
  // =====================================================================
  {
    id: 5,
    name: "Aerial Race",
    subtitle: "High Dive — launch towers, drop pipe and acid pools",
    theme: "aerial",
    sourceArt: "Stage 5.png",
    baseHeight: 24,
    time: 105,
    start: [12.4, 2.4],
    layout: pad([
      "   ##ffffffffffff##   ",
      "   #..............#   ",
      "   #......P.......#   ",
      "   #..............#   ",
      "   #..##########..#   ",
      "   #..............#   ",
      "   #..............#   ",
      "   #..##########..#   ",
      "   #..............#   ",
      "   #......kk......#   ",
      "   #......kk......#   ",
      "   #..............#   ",
      "   #....kk..kk....#   ",
      "   #....kk..kk....#   ",
      "   #..............#   ",
      "   #......mm......#   ",
      "   #......mm......#   ",
      "   #..............#   ",
      "   #..==========..#   ",
      "   #..==========..#   ",
      "   #..............#   ",
      "   #..ssssssssss..#   ",
      "   #..ssssssssss..#   ",
      "   #..............#   ",
      "   #......$.......#   ",
      "    ##############    ",
    ]),
    patches: {
      cells: {
        "4,1:19,3": { surf: "path", h: 18 },
        "12,2": { surf: "path", h: 18, prop: "checkpoint" },

        // Launch towers on left and right
        "3,0:5,3": { surf: "wall", h: 22, solid: true },
        "18,0:20,3": { surf: "wall", h: 22, solid: true },

        // High Dive Chasm Drop onto stepping stones
        "5,4:18,8": { surf: "void" },
        "11,9:13,10": { surf: "rock", h: 12 }, // Stone 1
        "8,12:10,13": { surf: "rock", h: 9 },  // Stone 2
        "14,12:16,13": { surf: "rock", h: 9 }, // Stone 3

        // Middle terrace with Funnel Drop Pipe (Spigot)
        "9,15:15,17": { surf: "path", h: 7 },
        "12,15": { surf: "metal", h: 7 },
        "12,17": { surf: "path", h: 7, prop: "checkpoint" },

        // Acid pool along bottom
        "6,18:17,19": { surf: "water", h: 0 },

        // 3 Curved sloped green ramps
        "7,21:16,22": { surf: "path", h: 4, fall: "S" },

        // Catwalk to GOAL
        "8,23:15,24": { surf: "path", h: 2 },
        "12,24": { surf: "path", h: 2, prop: "goal" },
      },
    },
    hazards: [
      // Funnel Drop Pipe (Spigot): drops from top hopper to bottom launch elbow
      {
        kind: "spigot",
        x: 12.5,
        z: 15.5,
        h: 7,
        targetX: 12.5,
        targetY: 4,
        targetZ: 21,
        period: 0.75,
        exitVelocity: [0, 0, 0.22],
        tubeColor: "#aa5533",
      },
      { kind: "steelie", x: 12, z: 16, h: 7, range: 2.5 },
      { kind: "muncher", x: 12, z: 23, h: 2 },
    ],
  },

  // =====================================================================
  // 6. SILLY RACE / THE RED CLIFFS (Stage 6.png)
  //    Overhead suspension bridge between red cliffs, narrow zigzag ledges,
  //    sloped black canopy tunnel (with 3D occlusion), and cliff archway tunnel.
  // =====================================================================
  {
    id: 6,
    name: "Silly Race",
    subtitle: "The Red Cliffs — suspension bridge and cliff archways",
    theme: "red_cliffs",
    sourceArt: "Stage 6.png",
    baseHeight: 24,
    time: 110,
    start: [11.4, 2.4],
    layout: pad([
      "   ##ffffffffffff##   ",
      "   #..............#   ",
      "   #......P.......#   ",
      "   #..mmmmmmmmmm..#   ",
      "   #..mmmmmmmmmm..#   ",
      "   #..............#   ",
      "   #..ssssssssss..#   ",
      "   #..ssssssssss..#   ",
      "   #..............#   ",
      "   #..bbbbbbbbbb..#   ",
      "   #..bbbbbbbbbb..#   ",
      "   #..............#   ",
      "   #..ffffffffff..#   ",
      "   #..ffffffffff..#   ",
      "   #..............#   ",
      "   #..ssssssssss..#   ",
      "   #..ssssssssss..#   ",
      "   #..............#   ",
      "   #......$.......#   ",
      "    ##############    ",
    ]),
    patches: {
      cells: {
        "3,0:5,4": { surf: "wall", h: 22, solid: true },
        "17,0:19,4": { surf: "wall", h: 22, solid: true },

        // Overhead suspension bridge
        "6,3:16,4": { surf: "metal", h: 20 },
        "11,2": { surf: "metal", h: 20, prop: "checkpoint" },

        // Steep ramps & narrow zigzag ledges
        "6,6:16,7": { surf: "path", h: 16, fall: "S" },
        "6,9:16,10": { surf: "path", h: 13, fall: "SW" },
        "11,11": { surf: "path", h: 13, prop: "checkpoint" },
        "6,12:16,13": { surf: "path", h: 10, fall: "SE" },

        // Archway tunnel & canopy
        "6,15:16,16": { surf: "path", h: 7, fall: "S" },

        // Finish catwalk & GOAL
        "8,17:15,18": { surf: "path", h: 4 },
        "11,18": { surf: "path", h: 4, prop: "goal" },
      },
    },
    hazards: [
      // Canopy roof tunnel with 3D depth occlusion
      {
        kind: "canopy",
        x: 11,
        z: 9,
        h: 14,
        dims: [4, 1.4, 3],
        tubeColor: "#1a1a20",
      },
      // Cliff archway tunnel with 3D depth occlusion
      {
        kind: "canopy",
        x: 11,
        z: 15,
        h: 8,
        dims: [4, 1.4, 3],
        tubeColor: "#762110",
      },
      { kind: "steelie", x: 11, z: 12, h: 10, range: 3.0 },
      { kind: "muncher", x: 11, z: 17, h: 4 },
    ],
  },

  // =====================================================================
  // 7. ULTIMATE RACE / SWISS CHEESE (Stage 7.png)
  //    Yellow cliff walls with orange polka dots (Swiss cheese), crisscrossing
  //    bridges, dark sunken maze, and the central ROTATING 4-PADDLE WINDMILL.
  // =====================================================================
  {
    id: 7,
    name: "Ultimate Race",
    subtitle: "Swiss Cheese & The Windmill — mechanical chaos",
    theme: "swiss_cheese",
    sourceArt: "Stage 7.png",
    baseHeight: 22,
    time: 120,
    start: [12.4, 24.4],
    layout: pad([
      "       ffffffffffff       ",
      "      f............f      ",
      "     f......$.......f     ",
      "     f..............f     ",
      "     f..ffff..bbbb..f     ",
      "     f..ffff..bbbb..f     ",
      "     f..............f     ",
      "     f..............f     ",
      "     f..bbbb..ffff..f     ",
      "     f..bbbb..ffff..f     ",
      "     f..............f     ",
      "     f..............f     ",
      "     f..kkkk..kkkk..f     ",
      "     f..k..k..k..k..f     ",
      "     f..kkkk..kkkk..f     ",
      "     f..............f     ",
      "     f..............f     ",
      "     f..ffff..bbbb..f     ",
      "     f..ffff..bbbb..f     ",
      "     f..............f     ",
      "     f......P.......f     ",
      "     f..............f     ",
      "      ffffffffffffff      ",
    ]),
    patches: {
      cells: {
        // Start at lower section
        "8,20:16,22": { surf: "path", h: 4 },
        "12,20": { surf: "path", h: 4, prop: "checkpoint" },

        // Crisscrossing ramp bridges
        "9,17:15,18": { surf: "path", h: 6, fall: "S" },

        // Sunken maze courtyard
        "8,12:16,14": { surf: "path", h: 8 },
        "10,13:11,13": { surf: "rock", h: 9, solid: true },
        "13,13:14,13": { surf: "rock", h: 9, solid: true },

        // Mid terrace with windmill
        "8,9:16,11": { surf: "path", h: 10 },
        "12,10": { surf: "path", h: 10, prop: "checkpoint" },

        // Upper bridges
        "9,4:15,5": { surf: "path", h: 13, fall: "N" },

        // Elevated GOAL platform at top
        "9,1:15,3": { surf: "path", h: 15 },
        "12,2": { surf: "path", h: 15, prop: "goal" },
      },
    },
    hazards: [
      // The Rotating 4-Paddle Red Windmill
      {
        kind: "windmill",
        x: 12,
        z: 10,
        h: 10,
        radius: 3.2,
        rotationSpeed: 2.8,
        paddles: 4,
      },
      { kind: "steelie", x: 12, z: 16, h: 7, range: 3.0 },
      { kind: "muncher", x: 12, z: 7, h: 11 },
    ],
  },

  // =====================================================================
  // 8. SPACE DEMENTIA (Stage 8.png)
  //    Deep space starfield, floating gold platforms with red perimeter sides,
  //    triangular canopy tunnels (with 3D occlusion), cyan ice, elevated GOAL.
  // =====================================================================
  {
    id: 8,
    name: "Space Dementia",
    subtitle: "Cosmic Orbit — floating platforms, canopies and cyan ice",
    theme: "space",
    sourceArt: "Stage 8.png",
    baseHeight: 20,
    time: 115,
    start: [12.4, 2.4],
    layout: pad([
      "       ffffffffffff       ",
      "      f............f      ",
      "     f......P.......f     ",
      "     f..............f     ",
      "     f..ssss..ssss..f     ",
      "     f..ssss..ssss..f     ",
      "     f..............f     ",
      "     f..iiii..iiii..f     ",
      "     f..iiii..iiii..f     ",
      "     f..............f     ",
      "     f..##......##..f     ",
      "     f..##..gg..##..f     ",
      "     f..##..gg..##..f     ",
      "     f..##......##..f     ",
      "     f..............f     ",
      "     f..mmmmmmmmmm..f     ",
      "     f..mmmmmmmmmm..f     ",
      "     f..............f     ",
      "     f......$.......f     ",
      "      ffffffffffffff      ",
    ]),
    patches: {
      cells: {
        "8,1:16,3": { surf: "path", h: 14 },
        "12,2": { surf: "path", h: 14, prop: "checkpoint" },

        // Ramps under triangular canopies
        "9,4:15,5": { surf: "path", h: 12, fall: "S" },

        // Slippery cyan ice patches
        "9,7:15,8": { surf: "snow", h: 10 },
        "12,9": { surf: "path", h: 10, prop: "checkpoint" },

        // Elevated cyan glass pool with 4 corner spires
        "8,10:16,13": { surf: "glass", h: 8 },
        "9,10": { surf: "rock", h: 9, solid: true },
        "15,10": { surf: "rock", h: 9, solid: true },
        "9,13": { surf: "rock", h: 9, solid: true },
        "15,13": { surf: "rock", h: 9, solid: true },

        // Suspended black bridge
        "10,15:14,16": { surf: "metal", h: 6 },

        // Final golden platform & elevated GOAL
        "9,17:15,18": { surf: "path", h: 5 },
        "12,18": { surf: "path", h: 5, prop: "goal" },
      },
    },
    hazards: [
      // Triangular canopy tunnel 1 with 3D depth occlusion
      {
        kind: "canopy",
        x: 12,
        z: 4.5,
        h: 13,
        dims: [4, 1.2, 2.5],
        tubeColor: "#ffaa00",
      },
      { kind: "steelie", x: 12, z: 9, h: 10, range: 3.0 },
      { kind: "bomber", x: 12, z: 12, h: 16, period: 4.5, axis: "x", range: 4, speed: 0.26 },
      { kind: "muncher", x: 12, z: 17, h: 5 },
    ],
  },
];

export const LEVELS: BuiltLevel[] = DEFS.map(buildLevel);
