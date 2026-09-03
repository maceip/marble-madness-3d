/** Tunable gameplay constants (units: tiles for u/v, px for z, seconds). */
export const VIEW_W = 288;
export const VIEW_H = 240;

export const MARBLE_R = 0.55;          // collision radius in tile units
export const MARBLE_SPRITE_R = 8;      // px

export const ACCEL = 26;               // trackball acceleration at full deflection (tiles/s^2)
export const FRICTION = 2.0;           // 1/s exponential damping when grounded
export const MAX_SPEED = 16;           // tiles/s
export const SLOPE_K = 1.7;            // tiles/s^2 per (px of drop per tile)
export const GRAVITY = 420;            // px/s^2 while airborne
export const STEP_UP = 10;             // px the marble can climb ramps/steps without it being a wall
export const DROP_SNAP = 14;           // px drop that is just followed (ramps, stairs)
export const WALL_MAX = 20;            // px wall detection window
export const BOUNCE = 0.68;            // wall restitution (high bounce factor all walls)
export const BOUNCE_SFX_SPEED = 2.5;
// The art's terraces are 30 px apart and the Practice chute ends with a ~40 px hop: one storey is a bounce,
// not a stun (arcade: you go flat after a real fall, shatter off a cliff)
export const DIZZY_FALL = 44;          // px fall height that stuns
export const SHATTER_FALL = 80;        // px fall height that shatters
export const DIZZY_TIME = 1.25;
export const VOID_FALL_TIME = 1.1;     // s of falling with no floor below before death
export const DEATH_ANIM = { shatter: 2.6, squeeze: 1.2, dissolve: 1.5, crush: 0.6, zap: 2.2, void: 1.0 } as const;
export const RESPAWN_DELAY = 0.4;

export const PROGRESS_STEP = 2;        // tiles of (u+v) advance per +10 points
export const PROGRESS_POINTS = 10;
export const TIME_CAP = 99;
export const WAND_FREEZE = 1.5;
export const WAND_BONUS = 10;
export const TIMEZONE_PERIOD = 1.7;
export const TIMEZONE_BONUS = 3;
export const DEATH_PENALTY = 1000;
export const FINISH_BONUS = 20000;
export const SEC_LEFT_BONUS = 1000;
export const TIME_BONUS_PER_SEC = 100;

export const BIRD_ZAP_RESETS_TO_START = true; // per brief (video respawns nearby)
export const TWO_PLAYER_TELEPORT_PENALTY = 1000;
/** arcade 2-player time table (2player_longplay.mov): 60 and 65 fresh, then +45/+40/+30/+25 carried */
export const ARCADE_TIME_ADD = [60, 65, 45, 40, 30, 25];
/** arcade 2-player: the winner of the previous race gets extra seconds ("WON LAST RACE: +5 sec") */
export const WON_RACE_BONUS = 5;
export const TWO_PLAYER_TRAIL_MARGIN = 40;    // px beyond the view edge before teleport
