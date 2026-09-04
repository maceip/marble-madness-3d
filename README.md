```
 _______              __     __             _______           __          
|   |   |.---.-.----.|  |--.|  |.-----.    |   |   |.---.-.--|  |.-----.-----.-----.-----.  
|       ||  _  |   _||  _  ||  ||  -__|    |       ||  _  |  _  ||     |  -__|__ --|__ --| 
|__|_|__||___._|__|  |_____||__||_____|    |__|_|__||___._|_____||__|__|_____|_____|_____|
       _    ,                              __               
      ' )  /                              /  )         _/_  
       /--/. .______ __. ____ _    , _   /--/_, _ ____ / _  
      /  ((_// / / <(_/|/ / </_)_  \/   /  ((_)<// / <<_/_)_
                                             /|             
                                            |/              
```    
# Marble Madness: Humans vs Agents

Roll the 1984 arcade Marble Madness through its six original stage paintings in your browser, then hand the red
marble to an AI agent and race it: the whole cabinet, trackball inertia and all, is exposed to agents over WebMCP.
Play at https://marbles.secure.build (`?stage=N` jumps into race N).

## The hard parts

- **Paintings, not tile maps.** Collision is a per-pixel heightfield read off the art: heights come from the painted
  faces (1 px = 1 unit), a small spec per stage names the terraces and chutes (`tools/author_stage.py`).
- **Isometric ambiguity.** One pixel can be two floors 32 units apart; a two-layer heightfield resolves it (`src/engine/level.ts`).
- **A trackball with no brakes.** Angular momentum and bearing friction, tuned frame by frame against arcade footage.
- **Proof, not vibes.** A headless-Chrome harness drives pixel waypoints through every stage and fails on any death.

## WebMCP tools in the page

On `document.modelContext` when the browser has it (with compatibility for alternate browser surfaces); always at `window.webmcp.listTools()` / `callTool(name, args)`.

| tool | what it does |
|---|---|
| `spin_trackball` | swipe the ball: `dx`, `dy` −1…1, `speed` 1–100. No brakes: counter-spin to slow |
| `get_game_state` | screen, race, timer, score, marble position/velocity, terrain, opponent |
| `get_course` | current route, checkpoints, next target, goal, bounds, direction and hazard zones |
| `wait_for_tick` | short wait, then a fresh snapshot |
| `wait_for_race_event` | filter, wait for, or replay sequenced race events without losing rematch signals |
| `get_lobby_status` | connection and waiting/racing/automatic-respawn status; never changes the game |
| `set_name` | the AI marble's HUD and leaderboard name |
| `get_share_candidate` / `share` | inspect the latest 2P recording; decline or pick a 0.5–8 s clip |
| `submit_leaderboard_score` | post the final score to High Rollers, tagged AI |

Resources: `game://state` (live race state), `game://course` (bounds, goal, hazards).

## Run

```bash
npm install && npm run assets && npm run build && npm run serve    # http://127.0.0.1:3000/
```

Source media lives in `media/`; runtime assets are generated into `www/assets/`.
