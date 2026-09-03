# Marble Madness (web)

A faithful browser remake of Marble Madness: the six arcade stage paintings are the actual
playfields, the rules and screen flow follow the NES version frame by frame, and a second
marble can be driven by an AI agent over WebMCP.

## Play

```bash
npm install
npm run assets      # (re)generate runtime assets from the source art (python3 + Pillow + scipy)
npm run build       # bundle src/ -> www/bundle.js
npm run serve       # http://127.0.0.1:3000/
```

Controls: arrows / WASD, or drag the mouse like a trackball (touch drag on mobile).
Control type B ("45°") rotates the stick to the isometric axes. `?stage=N` jumps straight
into race N for testing.

Screen flow: High Rollers → Milton Bradley presents / Press Start → 1 Player · Player vs AI ·
Multi Marble → Enter Your Name → Select Control Type → (Connect Your Agent) → races.

## Modes

- **1 Player** – the six races (Practice, Beginner, Intermediate, Aerial, Silly, Ultimate).
- **Player vs AI (2 Player)** – the browser gets a lobby id (cookie `mm_lobby`). The
  *Connect Your Agent* screen shows a copyable blurb:
  `Open https://marbles.secure.build/<uuid> in your embedded browser and use webmcp to compete`.
  When the agent opens that link it joins as the red marble; the race starts on both screens.
  The camera follows the leader; a marble left behind is teleported next to the leader for −1000.
- **Multi Marble** – legacy shared world: everyone on the server rolls on the same course.

Set `PUBLIC_ORIGIN=https://marbles.secure.build` when serving so the blurb uses the public URL.

## WebMCP

The page registers tools on `navigator.modelContext` / `document.modelContext` when present and
always exposes `window.webmcp.listTools()` / `window.webmcp.callTool(name, args)`:

| tool | purpose |
|---|---|
| `get_game_state` | screen, race, timer, score, marble x/y/height/velocity in map pixels, opponent |
| `steer_trackball` | push in a screen direction (N…NW or degrees) with impulse 0.1–1 for 50–600 ms |
| `apply_brake` | stop pushing for a while |
| `start_or_respawn` | advance menus / confirm readiness in a lobby |
| `submit_leaderboard_score` | post to High Rollers (tagged AI) |

## Layout

- `src/engine/` – isometric projection, level model (height-map components + hand-authored
  strips/bands/walls), marble physics, sprites, bitmap font, input, audio.
- `src/game/` – state machine and screens, hazards (steelie, worm, slime, hammer, vacuum,
  birds, wand), lobby client, WebMCP.
- `src/levels/stageN.ts` – per-race data: start, checkpoints, bonus/goal zones, pipes, hazards,
  manual ramps. `levels/hm/stageN.json` configures the art-derived collision extractor.
- `tools/heightmap.py` – derives a per-pixel collision map from a stage painting
  (`www/assets/stages/stageN.labels.png` + `.comps.json`); `tools/level_overlay.py` renders
  debugging overlays; `tools/test_game.mjs`, `route_check.mjs`, `stage_tour.mjs`,
  `test_lobby.mjs` drive the game in headless Chrome.
- `tools/serve.mjs` – static files, lobby WebSocket relay, High Rollers API.

Audio: race music `www/audio/bgm/*.mp3` (practice, beginner, intermediate, aerial, silly,
ultimate), ending `marble-056.mp3`, effects `marble-0xx.mp3`. Title screens are silent, as in
the original.

Bonus stages (`bonus_stage1.png`, `bonus_stage2.png`) are not wired in yet.
