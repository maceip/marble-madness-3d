# Marble Madness 3D 🔵⚡

A high-performance modern WebGL & Three.js 3D isometric remake of the 1984 arcade classic **Marble Madness**, complete with full physical course dynamics, mobile rotameter / gyroscope steering, high-resolution thematic stage environments, spatial audio, real-time multiplayer collisions, **WebMCP AI agent integration**, and an unauthenticated **Top 50 Hall of Fame Leaderboard** tracking AI vs. Natural Intelligence (Human) players.

![Stage 1 Preview](www/images/stage1.png)

---

## 🎮 Features

- **True 3D Isometric Physics Simulation**:
  - Full 3D quaternion rotational momentum, trackball inertia, downhill slope gravity, and surface resistance (path, grass, sand, water drag, icy snow, and glass).
  - High-drop impact shatter and dynamic skid mark particle trails.
  - Custom continuous-slope wedge geometry and collision mesh generation from ASCII course definitions.
  - Interactive hazards: Steelie rival marbles, Marble Muncher chompers, acid puddles, buzzsaws, bats, bombers, acid worms, and springboards.
- **8 Thematic High-Resolution Stages**:
  1. **Pink Gardens** — Practice race: magenta waves, chicane, isometric cube.
  2. **Arctic Adventure** — Glacial crevasses, ice slides, and igloos.
  3. **Astral Spire** — Celestial tower: starlight relief murals, gold star clusters, chutes, and stepped ziggurat terraces.
  4. **Pyramid Oasis** — Pharaoh's sands: Great Pyramids, obsidian obelisks with glowing hieroglyphs, palm trees, and sunken oasis.
  5. **Edgy Maze** — Cyberpunk wireframe grid abyss and synthwave geometry.
  6. **Dusty Trail** — Sandstone mesas, desert canyons, and geysers.
  7. **Drillin' Rye** — Underground ore-cart mine shafts and stalactites.
  8. **Space Dementia** — Floating anti-gravity cloud walkways, asteroids, and orbital rings.
- **Web-Optimized Video Splash Boot Screen**:
  - Arcade video splash screen (`splash.mp4`) with scanlines, brand logo, and smooth transition.
  - One-tap audio unlocking and accelerometer rotameter calibration.
- **🤖 WebMCP Browser AI Agent Integration**:
  - Implements the W3C WebMCP (Web Model Context Protocol) standard via `document.modelContext.registerTool()`, `navigator.modelContext.registerTool()`, and `window.webmcp`.
  - Exposes 5 browser-native AI tools: `get_game_state`, `steer_trackball`, `apply_brake`, `start_or_respawn`, and `submit_leaderboard_score`.
  - **Physical Inertia Challenge**: Designed so state-of-the-art AI agents cannot easily win with instantaneous commands. Agents must master trackball torque impulses, slope gravity, counter-steering, and braking friction just like a human player.
  - Players using WebMCP are automatically tagged with `[AI]` Intelligence and circuit-cyan themes.
- **🏆 Unauthenticated Top 50 Hall of Fame (AI vs Natural Intelligence)**:
  - Tracks top 50 scores globally distinguishing `🧠 [NI]` (Natural Intelligence / Human Web) vs. `🤖 [AI]` (Artificial Intelligence / WebMCP).
  - **Scoring System**:
    - **Opposing Intelligence Knockout**: **+2,500 pts** when a human knocks off an AI or an AI knocks off a human.
    - **Rival Marble Knockout**: **+1,500 pts** for same-intelligence knockouts.
    - **NPC Steelie Cracked**: **+1,000 pts** for bumping rival black marbles into the void.
    - **Bumps & Items**: **+250 pts** per bump, **+500 pts** per crystal, and **time_left × 50 pts** stage clear bonuses.
  - Interactive Splash Screen Leaderboard with tab filters (`ALL`, `🧠 NI`, `🤖 AI`).
  - Pre-game countdown overlay with real-time record holder preview.
  - Retro 3-character arcade initials entry prompt upon qualifying for Top 50.
- **🛡️ Server Flood Protection & Anti-Cheat**:
  - IP connection rate limiting (max 40 connections/min).
  - Per-client token-bucket WebSocket rate limiter (60 packets/sec).
  - Signed session challenge tokens (`X-Marble-Session` / DBSC-compatible verification).
  - Physics-bound score sanity validation preventing score spoofing.
- **Hosted Real-Time Multiplayer Mode**:
  - Zero setup, shared-world architecture (no rooms or pairings) supporting 100+ simultaneous marbles.
  - 25Hz server world tick batching with client dead-reckoning extrapolation.
- **Universal Controls**:
  - **Mobile**: DeviceOrientation accelerometer (Excel rotameter tilt steering) + on-screen touch joystick and brake.
  - **Desktop**: Mouse drag, Arrow keys / WASD, and Spacebar brake.
  - **AI Agent**: WebMCP tool calls via `document.modelContext` / `window.webmcp`.

---

## 🕹️ Controls

| Control | Desktop | Mobile | AI (WebMCP) |
| :--- | :--- | :--- | :--- |
| **Steer** | Mouse Drag / Arrow Keys / `WASD` | Device Tilt (Rotameter) / Touch Drag | `steer_trackball(direction, impulse)` |
| **Brake** | `Spacebar` / Mouse Down | On-screen **BRAKE** button | `apply_brake(duration_ms)` |
| **State** | HUD display | HUD display | `get_game_state()` |
| **Restart** | `R` key | Menu button | `start_or_respawn()` |
| **Leaderboard** | High score prompt | High score prompt | `submit_leaderboard_score(initials)` |

---

## 🚀 Quick Start

### 1. Installation

```bash
npm install
```

### 2. Build the TypeScript Bundle

```bash
npm run build
```

### 3. Launch the Game & Multiplayer Server

```bash
npm start
```

Visit **`http://localhost:3000/`** in your browser.

---

## 🤖 WebMCP Tool Reference

```json
{
  "tools": [
    {
      "name": "get_game_state",
      "description": "Inspect real-time Marble Madness 3D sensory state: position, velocity, slope gradient, surface traction, nearby hazards, and other player marbles."
    },
    {
      "name": "steer_trackball",
      "description": "Apply angular torque impulse to physical trackball (direction: N, NE, E, SE, S, SW, W, NW or 0-360 deg, impulse: 0.05-1.0, duration_ms: 30-400)."
    },
    {
      "name": "apply_brake",
      "description": "Apply physical braking drag to arrest forward momentum (duration_ms: 50-600)."
    },
    {
      "name": "start_or_respawn",
      "description": "Start game from countdown screen or trigger instant checkpoint respawn."
    },
    {
      "name": "submit_leaderboard_score",
      "description": "Submit final score and 3-character initials tag to the global unauthenticated Top 50 Leaderboard."
    }
  ]
}
```

---

## 📜 License

MIT License. Arcade assets and designs homage to Atari Games (1984).
