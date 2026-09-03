# Marble Madness Web — Design Spec (derived from `gameplay.mov` + arcade stage art)

Reference videos: `gameplay.mov` (NES, 281 s, 1 player) for the 1-player flow and rules; `video_review/long_play1.mov` (arcade, 1P)
and `video_review/2player_longplay.mov` (arcade, 2P, 272 s) for stage routes/geometry and every 2-player rule. The arcade clips use exactly
the six stage paintings we ship, so they are also the geometry truth.
Visual truth: `Stage 1.png` … `Stage 6.png` (arcade maps, 16×8 px isometric diamonds).
Behavioural truth: the video. Where the user's brief overrides the video, the override is noted.

## Screen flow
1. **HIGH ROLLERS** — logo, "HIGH ROLLERS", top 10 (`#1 NAME 152,730`), #1 in lavender, rest in olive/gold. Silent. Any key → title.
2. **TITLE** — "MILTON BRADLEY / PRESENTS", logo, "PRESS START", "© 1984 TENGEN / LICENSED BY …". Silent. Loops back to High Rollers after ~10 s idle.
3. **MENU** — logo + marble cursor: `1 PLAYER`, `PLAYER VS AI (2 PLAYER)`, `MULTI MARBLE` (legacy shared world). "© 1984 TENGEN".
4. **ENTER YOUR NAME** — A–Z grid (7 cols), `RUB`, `END`; marble cursor; 6 underscores; keyboard letters also accepted.
5. **SELECT CONTROL TYPE** — `A  SCREEN` / `B  45°` (video shows "B 45°").
6. (2P vs AI only) **CONNECT YOUR AGENT** — lobby UUID, blurb + big COPY button, waits for agent join.
7. **RACE INTRO** — course visible, banner "TIME TO FINISH / <RACE>:" with a counter draining into the big timer (~20 units/s). Music starts here.
8. **PLAYING** — HUD: score top-left (lavender), timer top-centre (big blue digits on grey box).
9. **TIME BONUS** — at goal: music stops, box "TIME BONUS / N,NNN" (seconds × 100) added to score over ~2 s, then black, next race.
10. **CONGRATULATIONS** — after Ultimate: `CONGRATULATIONS / LEFT PLAYER / YOU HAVE COMPLETED THE ULTIMATE RACE!`, `BONUS FOR FINISHING 20,000`, `NN SEC LEFT × 1000`, `DIED N TIMES × -1000`, `TOTAL`, `FINAL SCORE` (total drains into final score), coloured marbles rain in background. Music: `marble-056.mp3`.
11. **GAME OVER** when the timer hits 0 → high-roller entry if qualified → HIGH ROLLERS.

## Time
| Race | Time added | Notes |
|---|---|---|
| 1 Practice | 60 | not carried over |
| 2 Beginner | 65 | fresh (practice remainder discarded) |
| 3 Intermediate | +35 carried | |
| 4 Aerial | +30 carried | cap 99 |
| 5 Silly | +20 carried | |
| 6 Ultimate | +20 carried | |
Timer caps at 99. Wand: +10 s.
2-player (arcade table, `ARCADE_TIME_ADD`): 60 / 65 fresh, then +45 / +40 / +30 / +25 carried; the winner of the previous race first
banks "WON LAST RACE: +5 SEC" (`WON_RACE_BONUS`); from race 3 the banner reads "EXTRA TIME FOR <RACE>: +NN".
Silly race: every slime on the plaza is a present — touching one gives +3 SEC (tag above the marble); controls are reversed
("EVERYTHING YOU KNOW IS WRONG" under the intro banner).

## Score
- Progress: +10 each time the marble reaches a new furthest row (≈ every 2 tiles of descent).
- Waypoint bonuses (popup text at marble): Stage 1: 5000 (red/white pad), 1000 (goal flags). Stage 2: 4000, 2000 (pipe exits). Stage 3: 2000 (funnel pipe exit). Stage 4: 4000 (goal). Stage 5: 2000. Stage 6: 2000 (glass bridge), 6000 (goal).
- Time bonus: seconds × 100. Final: 20,000 finish + sec × 1000 − deaths × 1000.

## Marble
Sprite sheet `marble_effects.png` (40 px cell grid):
- roll: `animated_assets/Player1Rolling.gif` / `Player2Rolling.gif` (16 frames, blue / red) indexed by distance rolled; the sheet's row 0 is the fallback
- squeeze/suck: rows 0–5 cols 7–8 (vacuum / muncher death)
- dissolve: row 6 cols 0–3 (acid death from slime, followed by blue droplets)
- dizzy: row 7 cols 0–5 (wisps)
- crack: row 8 cols 0–2, shards 3, pile+sparkle 4–5
- sweep: row 9 broom cols 1–6, pile 7
Physics: world (u,v) tile units, height z px. Projection `sx = 8(u−v)`, `sy = 4(u+v) − z`. Radius 0.6.
Falls > 40 px → crack + broom; falls 12–40 px → dizzy 1.2 s; step tolerance 3 px; walls bounce (restitution 0.35).

## Hazards
Behaviour confirmed from the review clips in `video_review/` where noted.
| Hazard | Sheet | Stages | Behaviour |
|---|---|---|---|
| Steelie (black marble) | objects.png #62 | 2, 4, 6 | AI chases player, elastic bump, can fall off |
| Worm / Muncher | worm.png | 2, 3 | slinkies end-over-end freely; touching mouth eats marble (squeeze anim, death); bumping its body at speed knocks it back |
| Slime (acid puddle) | slime.png | 3, 6 | stays in one spot wandering a few tiles; contact **dissolves** the marble into drops (slime_review.mov) |
| Hammer | animated_assets/HammerTrap.gif (18 frames) | 4 (goal run) | mallet swings round its pivot like a clock hand; head sweep flattens the marble (intermedidate_hammers.mov) |
| Vacuum | animated_assets/VacuumTrapL/R.gif (2 frames, facing) | 4 (upper zigzag) | yellow box on the floor; marbles within ~3 tiles are pulled in and swallowed (vaccum_review.mov) |
| Risers / catapult | riser.png (MS pistons, gray like the arcade) | 4 (disc pads) | pistons pop up in a travelling wave; up pistons block, one rising under the marble launches it along the pad (aerial_race_catapault_and_risers.mov) |
| Wave plate | drawn | 3 (green plate) | a hump travels along the plate every ~2.6 s and carries the marble forward (intermediate_level_waves.mov) |
| Bird | animated_assets/BirdL/R.gif (flap) + bird.png (zap sparkle) | 5, 6 | fast fly-bys in flocks; zap (sparkle) → shatter; **brief: respawn at level start** (`BIRD_ZAP_RESETS_TO_START`) |
| Wand | drawn star | 3, 5 (random) | freezes marble ~1.5 s then +10 s |
| Time slime | slime.png (`gift: true`) | 5 plaza | Silly race: slimes hand out +3 SEC instead of dissolving (2player_longplay.mov: timers rise on the plaza) |
| Finish flags | animated_assets/FinishFlag.gif | all goals | blue flag left, red flag right of the goal zone |

Deaths respawn at nearest checkpoint behind the death point after the death animation. Every death counts −1000 at the end.

## Audio
Stage BGM: `bgm/practice-race.mp3`, `beginner-race.mp3`, `intermediate-race.mp3`, `aerial-race.mp3`, `silly-race.mp3`, `ultimate-race.mp3`. Ending: `marble-056.mp3`. Menus silent. SFX from `marble-0xx.mp3`.

## Multiplayer
- `1 PLAYER`: local.
- `PLAYER VS AI`: lobby UUID (cookie `mm_lobby`); human sees CONNECT YOUR AGENT with text
  `Open https://marbles.secure.build/<uuid> in your embedded browser and use webmcp to compete`.
  Agent loads `/<uuid>` → joins as AI (red marble, callout label). Camera follows the leader; the trailing marble is teleported next to the leader with −1000 when it would leave the screen (never once the leader has finished).
  Arcade 2P presentation (2player_longplay.mov): HUD is P1 `SCORE`/score/timer in blue on the left and P2 timer/`SCORE`/score in red on the right;
  each player has their own timer; at the goal the finisher gets "BONUS FOR TIME LEFT: N,NNN" and waits ("WAITING FOR RIGHT/LEFT PLAYER")
  until the other finishes or runs out of time (`fin`/`time` in the state relay); both then move to the next race together.
  Players start side by side (agent +1.2/−1.2 tiles).
- `MULTI MARBLE`: legacy shared world (room `world`), remote marbles drawn, bumps exchanged.
- Server: rooms keyed by lobby id, 25 Hz state relay, leaderboard JSON API.
