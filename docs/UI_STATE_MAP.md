# Marble Madness — UI state map

Every screen the app can show, how you reach it, what's on it, and its current mobile-portrait status. Use this to
point at what's still wrong. Screenshots (phone portrait, prod) are in `artifacts/screens/`. The screen state lives in
`game.screen` (`src/game/game.ts`); rendering is in `src/game/screens.ts`.

Flow: `boot → title/leaderboard → menu → name → (connect, 2P only) → intro → race → timebonus → …next race… → congrats/rematch`.
`race → gameover/rematch` when the timer hits 0. An agent page returns to `connect`; the human gets `rematch` in 2P.

| # | screen | how you get there | what's on it | leaves to | mobile status |
|---|--------|-------------------|--------------|-----------|---------------|
| 1 | **boot** | app load | black; assets loading | auto → highrollers (or connect on an agent URL) | fine (brief) |
| 2 | **highrollers** | boot; idle on title; after game over | logo, HIGH ROLLERS LEADERBOARD table (rank/player/intel), PRESS START, volume+haptics bar | tap → title | fixed portrait; **the top logo is small and there's dead space** — flag if you want it bigger |
| 3 | **title** | tap on highrollers | full title art (Milton Bradley / MARBLE MADNESS / HUMANS VS AGENTS / PRESS START / Chrome+MCP icons) | tap → menu | renders as full-screen art; check the logo isn't cut on your phone |
| 4 | **menu** (SELECT GAME MODE) | tap on title | `1 PLAYER` and `2 PLAYERS` boxes, marble cursor | pick → name | looks OK |
| 5 | **name** (ENTER YOUR NAME) | pick a mode | GitHub / Twitter login buttons, name field, A–Z grid + RUB/END, START/CONNECT | confirm → connect (2P) or intro (1P) | looks OK |
| 6 | **control** (parked) | debug/legacy path only | `A SCREEN` / `B 45°`, marble cursor, hint line | pick → connect (2P) or intro (1P) | not in the normal flow |
| 7 | **connect** (CONNECT YOUR AGENT) | 2P only, after name; agent waits here between runs | lobby URL + COPY button, blurb, waiting spinner. Agent page shows a WAITING panel instead | agent joins/start message → intro | mobile-contained |
| 8 | **intro** (TIME TO FINISH) | race start | course visible, TIME TO FINISH banner counting into the timer, music starts | auto → race | uses the 288×240 race view (letterboxed) |
| 9 | **race** | after intro | the 288×240 scrolling arcade view, HUD (score, timer), on-screen trackball widget, volume bar | goal → timebonus; timer 0 → gameover | view scrolls with the marble; **gameplay/collision is the open work** |
| 10 | **timebonus** (TIME BONUS) | reaching the goal | TIME BONUS box counting seconds×100 into the score | auto → next intro, or congrats after the last race | race-view space |
| 11 | **gameover** | timer hits 0 | GAME OVER, SCORE, TAP TO CONTINUE | tap → title (agent → connect) | **just fixed** — centered portrait |
| 12 | **congrats** | finishing the last race | CONGRATULATIONS, name, tally (finish bonus / sec left / deaths / total / final score), marble rain | tap → title | **just fixed** — centered portrait |
| 13 | **rematch** | either 2P player finishes the full run or times out | winner, score, PLAY AGAIN, EXIT TO LEADERBOARD | play again → intro on both; exit → title | mobile-contained |

## Persistent overlays (DOM, on top of the canvas)
- **Volume + haptics bar** (bottom): Music / SFX sliders + Haptics checkbox. Shows on menu-type screens.
- **On-screen trackball** (bottom-right): the 3D marble control; shows only during intro/race/timebonus.
- **Connect panel** (`#connect-panel`): the copy-the-agent-link DOM panel for the human in 2P.

## Modes
- **1 PLAYER**: local, races 1–6.
- **2 PLAYERS (Human vs WebMCP Agent)**: human on the phone, agent (Codex) opens the lobby URL and plays via WebMCP. Camera follows the leader; the trailing marble is teleported with a penalty.
- **MULTI MARBLE**: legacy shared world (not on the current menu).

## Known-open, not yet fixed (so you don't re-report)
- **Level collision/elevation** — the core work; being redone from the art via the labeler.
- **highrollers / connect vertical spacing** on very tall screens — cosmetic, not yet tuned.
- **Title logo scale** — may look small; not yet adjusted.

## Not yet verified on a real phone by me (please check and flag)
- intro / timebonus banners at portrait (they use the race-view space, may be small).
- The trackball widget size/position and whether swipes on the game canvas steer as expected.
- Login round-trip from the phone (GitHub/Twitter → back into the name screen).
