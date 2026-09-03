# Marble Madness — UI state map

Every screen the app can show, how you reach it, what's on it, and its current mobile-portrait status. Use this to
point at what's still wrong. Screenshots (phone portrait, prod) are in `artifacts/screens/`. The screen state lives in
`game.screen` (`src/game/game.ts`); rendering is in `src/game/screens.ts`.

Flow: `boot → highrollers ⇄ title → menu → name → control → (connect, 2P only) → intro → race → timebonus → …next race… → congrats`.
`race → gameover` when the timer hits 0. Any end screen returns toward `title` (agent page returns to `connect`).

| # | screen | how you get there | what's on it | leaves to | mobile status |
|---|--------|-------------------|--------------|-----------|---------------|
| 1 | **boot** | app load | black; assets loading | auto → highrollers (or connect on an agent URL) | fine (brief) |
| 2 | **highrollers** | boot; idle on title; after game over | logo, HIGH ROLLERS LEADERBOARD table (rank/player/intel), PRESS START, volume+haptics bar | tap → title | fixed portrait; **the top logo is small and there's dead space** — flag if you want it bigger |
| 3 | **title** | tap on highrollers | full title art (Milton Bradley / MARBLE MADNESS / HUMANS VS AGENTS / PRESS START / Chrome+MCP icons) | tap → menu | renders as full-screen art; check the logo isn't cut on your phone |
| 4 | **menu** (SELECT GAME MODE) | tap on title | `1 PLAYER` and `2 PLAYERS` boxes, marble cursor | pick → name | looks OK |
| 5 | **name** (ENTER YOUR NAME) | pick a mode | GitHub / Twitter login buttons, name field, A–Z grid + RUB/END, START RACE | confirm → control | looks OK |
| 6 | **control** (SELECT CONTROL TYPE) | after name | `A SCREEN` / `B 45°`, marble cursor, hint line | pick → connect (2P) or intro (1P) | **just fixed** — was tiny/off, now centered |
| 7 | **connect** (CONNECT YOUR AGENT) | 2P only, after control | lobby URL + COPY button, blurb, waiting spinner. Agent page shows a WAITING panel instead | agent joins → intro | panel renders; **spacing is loose on tall screens** — flag if bad |
| 8 | **intro** (TIME TO FINISH) | race start | course visible, TIME TO FINISH banner counting into the timer, music starts | auto → race | uses the 288×240 race view (letterboxed) |
| 9 | **race** | after intro | the 288×240 scrolling arcade view, HUD (score, timer), on-screen trackball widget, volume bar | goal → timebonus; timer 0 → gameover | view scrolls with the marble; **gameplay/collision is the open work** |
| 10 | **timebonus** (TIME BONUS) | reaching the goal | TIME BONUS box counting seconds×100 into the score | auto → next intro, or congrats after the last race | race-view space |
| 11 | **gameover** | timer hits 0 | GAME OVER, SCORE, TAP TO CONTINUE | tap → title (agent → connect) | **just fixed** — centered portrait |
| 12 | **congrats** | finishing the last race | CONGRATULATIONS, name, tally (finish bonus / sec left / deaths / total / final score), marble rain | tap → title | **just fixed** — centered portrait |

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
