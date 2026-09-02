// Shared simulation/render constants. Units: world = half-tile (see coords.md),
// time = 1/60 s ("frames"). All gameplay code derives from these.

export const TILE = 1; // one ground cell = 1 unit in x/z (half a graphic tile)
// (heights are authored per-cell in the course files, see data/kinds.ts)

// --- camera / projection -------------------------------------------------
export const CAM_TILT = 50; // degrees, X-axis pitch
export const CAM_YAW = -45; // degrees, Y-axis yaw (match Arcade sprite angle)
export const FOV = 30; // narrow fov -> near-orthographic isometric look
export const VIEW_HEIGHT = 17; // world units of vertical screen kept visible
export const CAM_BACK = 62; // distance from pivot to camera
export const CAM_AHEAD = 20; // pivot lead ahead of the marble
export const NEAR = 0.5;
export const FAR = 260;

// --- physics -------------------------------------------------------------
export const DT = 1 / 60;
export const MAX_SPEED = 0.085; // units/frame (~5.1 u/s at the fixed 60 Hz clock)
export const MAX_SPEED_AIR = 0.12;
export const TERMINAL_FALL = 1.05; // hard cap on the vertical fall speed
export const AIRTIME = 0.26; // ground attraction after landing
export const LANDING_KICK = 0.02; // forward speed kept when landing downhill
export const LAND_BOUNCE = 0.05; // rebound when landing on a slope
export const LAND_SLIDE = 0.08; // speed gained sliding off a steep landing
export const LAND_SLIDE_MIN = 0.4; // speed below which we just splat

// --- hazards -------------------------------------------------------------
export const SPIKE_BOUNCE = 0.42;
export const WATER_BOUNCE = 0.17;
export const KILL_FALL = 1.15; // downward speed that kills on impact
export const CRUSH_CLEAR = 0.06; // gap needed above the marble to pass
export const SWING_SPEED = 0.036;
export const BOMB_INTERVAL = 120; // frames between bombs (Turbo runs)
export const BOMB_RADIUS = 1.7;
export const SPAWN_INVULN = 90;

// --- scoring -------------------------------------------------------------
export const TIME_BONUS_PER_FRAME = 2; // 120 -> 7200 pts
export const PERMUTATION_BONUS = 5000;
export const CHECKPOINT_BONUS = 1000;
export const ITEM_BONUS = 500;

// --- misc ----------------------------------------------------------------
export const START_LIVES = 3;
export const COURSE_TIME = 120; // seconds
export const MABLE_H = 0.34; // collision height of the marble
export const MABLE_R = 0.24; // collision radius
