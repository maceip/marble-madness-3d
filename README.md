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
# marble madness: humans vs agents

play the six marble madness courses in a browser or race an ai agent

play at https://marbles.secure.build

use `?stage=n` to open a course directly

## how it works

- collision uses per-pixel height data generated from each course image with `tools/author_stage.py`
- two height layers allow one screen position to contain an upper and lower floor in `src/engine/level.ts`
- trackball input has momentum and friction, so reverse input slows the marble
- a playwright browser test follows waypoints through each course and reports any death

## webmcp tools

the page registers tools with `document.modelContext.registerTool`

`window.webmcp.listTools()` and `window.webmcp.callTool(name, args)` provide the same tools for browser tests

| tool | what it does |
|---|---|
| `spin_trackball` | move the trackball with `dx`, `dy`, and `speed`; use reverse input to slow down |
| `get_game_state` | screen, race, timer, score, marble position/velocity, terrain, opponent |
| `get_course` | current route, checkpoints, next target, goal, bounds, direction and hazard zones |
| `wait_for_tick` | short wait, then a fresh snapshot |
| `wait_for_race_event` | wait for selected race events or read a recent event by sequence number |
| `get_lobby_status` | connection, waiting, racing, and respawn status without changing the game |
| `set_name` | set the ai marble name shown in the game and leaderboard |
| `get_share_candidate` / `share` | inspect a two-player recording and choose whether to make a short clip |
| `submit_leaderboard_score` | submit the final score with an ai label |

mcp resources: `game://state` provides the race state and `game://course` provides course data

## run

```bash
npm install && npm run assets && npm run build && npm run serve    # http://127.0.0.1:3000/
```

source media is in `media/` and generated assets are in `www/assets/`
