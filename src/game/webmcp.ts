/**
 * WebMCP (Web Model Context Protocol) Integration for Marble Madness 3D.
 * Exposes browser-native tools via document.modelContext / navigator.modelContext
 * and window.webmcp for AI agents (ChatGPT, Chromium WebMCP agents, autonomous bots).
 *
 * Designed with physical realism and trackball inertia constraints:
 * - Agents do NOT have teleportation or deterministic coordinate overrides.
 * - Actions impart physical torque/impulses with friction, centrifugal drift, and slope gravity.
 * - Calling WebMCP tools automatically labels the player as Intelligence: 'AI' ([AI]).
 */

import type { GameManager } from './state.js';

export interface WebMCPToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export class WebMCPController {
  private game: GameManager;
  private steerTimer: number | null = null;

  constructor(game: GameManager) {
    this.game = game;
    this.registerWebMCPTools();
  }

  public registerWebMCPTools(): void {
    const tools: WebMCPToolDefinition[] = [
      {
        name: 'get_game_state',
        description:
          'Inspect real-time Marble Madness 3D sensory state: position, velocity, slope gradient, surface traction, nearby hazards (Steelies, Munchers, Blades), other player marbles, timer, score, and lives.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: () => this.getGameState(),
      },
      {
        name: 'steer_trackball',
        description:
          'Apply an angular torque impulse to the physical trackball to steer the marble. ' +
          'Direction can be a cardinal/ordinal string ("N", "NE", "E", "SE", "S", "SW", "W", "NW") or angle in degrees (0-360, where 0 is North/Up-Slope). ' +
          'Impulse force is 0.05 (gentle nudge) to 1.0 (maximum flick). ' +
          'Warning: Excessive speed on slopes or icy snow will cause skidding or flying off ledges!',
        inputSchema: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              description: 'Direction: "N", "NE", "E", "SE", "S", "SW", "W", "NW" or numerical angle in degrees (0-360)',
            },
            impulse: {
              type: 'number',
              description: 'Impulse force magnitude between 0.05 and 1.0 (default 0.5)',
              minimum: 0.05,
              maximum: 1.0,
            },
            duration_ms: {
              type: 'number',
              description: 'Duration of spin impulse in milliseconds (30 to 400ms, default 120ms)',
              minimum: 30,
              maximum: 400,
            },
          },
          required: ['direction'],
        },
        execute: (args) => this.steerTrackball(args),
      },
      {
        name: 'apply_brake',
        description:
          'Apply physical braking drag to arrest marble momentum and prevent rolling off steep slopes or ledges.',
        inputSchema: {
          type: 'object',
          properties: {
            duration_ms: {
              type: 'number',
              description: 'Braking duration in milliseconds (50 to 600ms, default 200ms)',
              minimum: 50,
              maximum: 600,
            },
          },
        },
        execute: (args) => this.applyBrake(args),
      },
      {
        name: 'start_or_respawn',
        description:
          'Start the game from the title/countdown screen or trigger an immediate respawn at the active checkpoint.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: () => this.startOrRespawn(),
      },
      {
        name: 'submit_leaderboard_score',
        description:
          'Submit final score and 3-character AI tag (e.g. "GPT", "BOT", "CPU") to the global unauthenticated Top 50 Leaderboard.',
        inputSchema: {
          type: 'object',
          properties: {
            initials: {
              type: 'string',
              description: '3-letter arcade initials tag (e.g. "GPT", "AI1", "BOT")',
              maxLength: 6,
            },
          },
          required: ['initials'],
        },
        execute: (args) => this.submitScore(args),
      },
    ];

    // 1. Browser Native WebMCP: document.modelContext (W3C 2026 standard)
    const doc = document as unknown as { modelContext?: { registerTool: (t: WebMCPToolDefinition) => void } };
    if (doc.modelContext && typeof doc.modelContext.registerTool === 'function') {
      try {
        for (const t of tools) {
          doc.modelContext.registerTool(t);
        }
        console.log('[WebMCP] Registered 5 tools via document.modelContext');
      } catch (err) {
        console.warn('[WebMCP] document.modelContext registration warning:', err);
      }
    }

    // 2. Legacy / Alias: navigator.modelContext (Chromium early preview)
    const nav = navigator as unknown as { modelContext?: { registerTool: (t: WebMCPToolDefinition) => void } };
    if (nav.modelContext && typeof nav.modelContext.registerTool === 'function') {
      try {
        for (const t of tools) {
          nav.modelContext.registerTool(t);
        }
        console.log('[WebMCP] Registered 5 tools via navigator.modelContext');
      } catch (err) {
        console.warn('[WebMCP] navigator.modelContext registration warning:', err);
      }
    }

    // 3. Direct global hook for browser agents and test harnesses: window.webmcp
    const win = window as unknown as {
      webmcp?: {
        listTools: () => WebMCPToolDefinition[];
        callTool: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
      };
    };

    win.webmcp = {
      listTools: () => tools,
      callTool: async (name: string, args: Record<string, unknown> = {}) => {
        const tool = tools.find((t) => t.name === name);
        if (!tool) {
          throw new Error(`[WebMCP] Unknown tool: ${name}. Available: ${tools.map((t) => t.name).join(', ')}`);
        }
        return await tool.execute(args);
      },
    };

    console.log('[WebMCP] Initialized WebMCP interface: window.webmcp available');
  }

  private tagAsAI(): void {
    if (!this.game.isAIMarble) {
      this.game.isAIMarble = true;
      this.game.intelligenceType = 'AI';
      if (this.game.multiplayer) {
        this.game.multiplayer.setIntelligenceType('AI');
      }
      this.game.hud.showBanner('🤖 AI AGENT DETECTED', 'PLAYING VIA WEBMCP', 2000);
    }
  }

  public getGameState(): Record<string, unknown> {
    const p = this.game.physics.marble;
    const ground = this.game.physics.getGroundHeightAt(p.x, p.z);
    const level = this.game.currentLevel;

    // Nearest hazards
    const hazardsNear = this.game.hazards.hazards
      .filter((h) => h.active)
      .map((h) => {
        const dx = h.x - p.x;
        const dz = h.z - p.z;
        const dist = Math.hypot(dx, dz);
        return {
          kind: h.def.kind,
          distance: Number(dist.toFixed(2)),
          relX: Number(dx.toFixed(2)),
          relZ: Number(dz.toFixed(2)),
        };
      })
      .filter((h) => h.distance < 8.0)
      .sort((a, b) => a.distance - b.distance);

    // Nearby multiplayer marbles
    const otherMarblesNear = Array.from(this.game.multiplayer.remotePlayers.values())
      .map((rp) => {
        const dx = rp.x - p.x;
        const dz = rp.z - p.z;
        const dist = Math.hypot(dx, dz);
        return {
          id: rp.id,
          name: rp.name,
          intelligence: rp.intelligence ?? 'NI',
          distance: Number(dist.toFixed(2)),
          relX: Number(dx.toFixed(2)),
          relZ: Number(dz.toFixed(2)),
        };
      })
      .filter((m) => m.distance < 10.0)
      .sort((a, b) => a.distance - b.distance);

    return {
      status: 'ok',
      gamePhase: this.game.state,
      stage: {
        id: this.game.currentStageIndex + 1,
        name: level.def.name,
        theme: level.def.theme,
        timeLimit: level.def.time,
      },
      stats: {
        timeLeft: Number(this.game.timeLeft.toFixed(1)),
        score: this.game.score,
        lives: this.game.lives,
        itemsCollected: this.game.itemsCollected,
        knockouts: this.game.knockoutCount,
        intelligence: this.game.intelligenceType,
      },
      marble: {
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        vx: Number(p.vx.toFixed(3)),
        vy: Number(p.vy.toFixed(3)),
        vz: Number(p.vz.toFixed(3)),
        speed: Number(p.speed.toFixed(3)),
        grounded: p.grounded,
        skidding: p.skidding,
        inWater: p.inWater,
        surface: ground.cell?.surf ?? 'void',
        slopeNormal: [
          Number(ground.normal[0].toFixed(2)),
          Number(ground.normal[1].toFixed(2)),
          Number(ground.normal[2].toFixed(2)),
        ],
      },
      hazardsNear,
      otherMarblesNear,
      hints: {
        cameraPerspective: 'Isometric (Screen Up-Right = +X, Screen Down-Left = +Z)',
        momentumWarning: p.speed > 0.22 ? 'High speed! Apply brake before tight turns.' : 'Normal speed.',
      },
    };
  }

  public steerTrackball(args: Record<string, unknown>): Record<string, unknown> {
    this.tagAsAI();

    const dirArg = String(args.direction ?? 'N').toUpperCase().trim();
    const impulse = Math.max(0.05, Math.min(1.0, Number(args.impulse ?? 0.5)));
    const duration = Math.max(30, Math.min(400, Number(args.duration_ms ?? 120)));

    let screenX = 0;
    let screenY = 0;

    // Parse direction
    if (!isNaN(Number(dirArg))) {
      const deg = Number(dirArg);
      const rad = (deg * Math.PI) / 180;
      screenX = Math.sin(rad);
      screenY = -Math.cos(rad);
    } else {
      switch (dirArg) {
        case 'N':
        case 'UP':
          screenX = 0; screenY = -1; break;
        case 'NE':
        case 'UP-RIGHT':
          screenX = 0.707; screenY = -0.707; break;
        case 'E':
        case 'RIGHT':
          screenX = 1; screenY = 0; break;
        case 'SE':
        case 'DOWN-RIGHT':
          screenX = 0.707; screenY = 0.707; break;
        case 'S':
        case 'DOWN':
          screenX = 0; screenY = 1; break;
        case 'SW':
        case 'DOWN-LEFT':
          screenX = -0.707; screenY = 0.707; break;
        case 'W':
        case 'LEFT':
          screenX = -1; screenY = 0; break;
        case 'NW':
        case 'UP-LEFT':
          screenX = -0.707; screenY = -0.707; break;
        default:
          screenX = 0; screenY = -1; break;
      }
    }

    // Set virtual joystick / AI input in InputManager
    this.game.input.setAIInput(screenX, screenY, impulse, false);

    if (this.steerTimer !== null) {
      clearTimeout(this.steerTimer);
    }

    this.steerTimer = window.setTimeout(() => {
      this.game.input.setAIInput(0, 0, 0, false);
      this.steerTimer = null;
    }, duration);

    return {
      status: 'impulse_applied',
      direction: dirArg,
      impulse,
      duration_ms: duration,
      marbleSpeed: Number(this.game.physics.marble.speed.toFixed(3)),
    };
  }

  public applyBrake(args: Record<string, unknown>): Record<string, unknown> {
    this.tagAsAI();

    const duration = Math.max(50, Math.min(600, Number(args.duration_ms ?? 200)));
    this.game.input.setAIInput(0, 0, 0, true);

    if (this.steerTimer !== null) {
      clearTimeout(this.steerTimer);
    }

    this.steerTimer = window.setTimeout(() => {
      this.game.input.setAIInput(0, 0, 0, false);
      this.steerTimer = null;
    }, duration);

    return {
      status: 'brake_applied',
      duration_ms: duration,
      marbleSpeed: Number(this.game.physics.marble.speed.toFixed(3)),
    };
  }

  public startOrRespawn(): Record<string, unknown> {
    this.tagAsAI();

    if (this.game.state === 'TITLE' || this.game.state === 'COUNTDOWN') {
      this.game.startGameDirect();
      return { status: 'game_started', stage: this.game.currentStageIndex + 1 };
    }

    if (this.game.state === 'GAME_OVER' || this.game.state === 'VICTORY') {
      this.game.setupStage(0);
      this.game.startGameDirect();
      return { status: 'game_restarted', stage: 1 };
    }

    this.game.physics.respawn(this.game.hazards.activeCheckpoint ?? undefined);
    return { status: 'respawned_at_checkpoint' };
  }

  public async submitScore(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rawTag = String(args.initials ?? 'CPU').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'CPU';
    const tag = `[AI] ${rawTag}`;

    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tag,
          score: this.game.score,
          intelligence: 'AI',
          stage: this.game.currentStageIndex + 1,
          timeRemaining: Math.floor(this.game.timeLeft),
          knockouts: this.game.knockoutCount,
          token: this.game.sessionToken,
        }),
      });
      const data = await res.json();
      return { status: 'score_submitted', leaderboardResult: data };
    } catch (err) {
      return { status: 'submission_failed', error: String(err) };
    }
  }
}
