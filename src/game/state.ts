import { LEVELS } from '../data/levels.js';
import type { BuiltLevel } from '../data/build.js';
import { soundManager } from '../audio.js';
import { PhysicsEngine } from './physics.js';
import { HazardManager } from './hazards.js';
import { HudManager } from './hud.js';
import { GameRenderer } from './renderer.js';
import { InputManager } from './input.js';
import { MultiplayerClient } from './multiplayer.js';
import { WebMCPController } from './webmcp.js';
import {
  CHECKPOINT_BONUS,
  COURSE_TIME,
  ITEM_BONUS,
  START_LIVES,
} from '../lib/constants.js';

export type GameState =
  | 'TITLE'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'RESPAWNING'
  | 'STAGE_CLEAR'
  | 'GAME_OVER'
  | 'VICTORY';

export class GameManager {
  public currentStageIndex = 0;
  public currentLevel: BuiltLevel;
  public state: GameState = 'TITLE';

  public score = 0;
  public hiscore = 0;
  public lives = START_LIVES;
  public timeLeft = COURSE_TIME;
  public itemsCollected = 0;
  public itemsTotal = 0;
  public knockoutCount = 0;

  public isAIMarble = false;
  public intelligenceType: 'AI' | 'NI' = 'NI';
  public sessionToken = '';

  public input: InputManager;
  public physics: PhysicsEngine;
  public hazards: HazardManager;
  public hud: HudManager;
  public renderer: GameRenderer;
  public multiplayer: MultiplayerClient;
  public webmcp: WebMCPController;

  private respawnTimer = 0;
  private countdownTimer = 3.0;
  private isAudioStarted = false;

  constructor() {
    this.currentLevel = LEVELS[0];
    this.input = new InputManager();
    this.physics = new PhysicsEngine(this.currentLevel);
    this.hazards = new HazardManager(this.currentLevel);
    this.hud = new HudManager();
    this.renderer = new GameRenderer();
    this.multiplayer = new MultiplayerClient();
    this.webmcp = new WebMCPController(this);

    this.loadHiscore();
    this.fetchSessionToken();
    this.fetchLeaderboard();
    this.bindEvents();
    this.bindMultiplayer();
    this.setupStage(0, false);
    this.state = 'TITLE';
    this.hud.showMenu(LEVELS.length, 1);
  }

  private async fetchSessionToken(): Promise<void> {
    try {
      const res = await fetch('/api/session-token');
      if (res.ok) {
        const data = await res.json();
        this.sessionToken = data.token || '';
      }
    } catch (err) {
      console.warn('[Session] Token acquisition fallback:', err);
    }
  }

  private async fetchLeaderboard(): Promise<void> {
    try {
      const res = await fetch('/api/leaderboard');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.top50)) {
          this.hud.setLeaderboard(data.top50);
          if (data.top50.length > 0 && data.top50[0].score > this.hiscore) {
            this.hiscore = data.top50[0].score;
          }
        }
      }
    } catch (err) {
      console.warn('[Leaderboard] Failed to fetch leaderboard:', err);
    }
  }

  private loadHiscore(): void {
    const saved = localStorage.getItem('marble_madness_hiscore');
    if (saved) {
      this.hiscore = parseInt(saved, 10) || 0;
    }
  }

  private saveHiscore(): void {
    if (this.score > this.hiscore) {
      this.hiscore = this.score;
      localStorage.setItem('marble_madness_hiscore', String(this.hiscore));
    }
  }

  private bindEvents(): void {
    // Splash screen boot / press start
    const splashEl = document.getElementById('splash-screen');
    const splashBtn = document.getElementById('splash-start-btn');

      const startFromSplash = async () => {
        try {
          this.startAudio();
          await this.input.requestDeviceOrientationPermission();
          this.input.calibrateNow();
        } catch (err) {
          console.warn('[Splash] Audio/orientation init err:', err);
        }

        if (splashEl) {
          splashEl.classList.add('fade-out');
          splashEl.style.display = 'none';
          splashEl.remove();
        }

        this.startCountdownSequence();
      };

    if (splashBtn) {
      splashBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void startFromSplash();
      });
    }
    if (splashEl) {
      // Splash marble animation
      let splashFrame = 0;
      const spB = document.getElementById('splash-marble-b') as HTMLImageElement | null;
      const spR = document.getElementById('splash-marble-r') as HTMLImageElement | null;
      const splashInterval = setInterval(() => {
        if (!document.getElementById('splash-screen')) {
          clearInterval(splashInterval);
          return;
        }
        splashFrame = (splashFrame + 1) % 14;
        const fStr = splashFrame.toString().padStart(2, '0');
        if (spB) spB.src = `/sprites/marbles_blue/frame_${fStr}.png`;
        if (spR) spR.src = `/sprites/marbles_red/frame_${fStr}.png`;
      }, 90);

      splashEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.lb-container') || target.closest('button') || target.closest('table')) {
          return;
        }
        void startFromSplash();
      });
    }

    // Input callbacks
    this.input.onRestart = () => this.restartCurrentStage();
    this.input.onToggleMenu = () => {
      if (this.hud.isMenuOpen()) {
        this.hud.hideMenu();
      } else {
        this.hud.showMenu(LEVELS.length, this.currentStageIndex + 1);
      }
    };
    this.input.onToggleMute = () => {
      const isMuted = soundManager.toggleMute();
      this.hud.showBanner(isMuted ? 'MUTED' : 'UNMUTED', '', 1200);
    };

    // HUD callbacks
    this.hud.onSelectCourse = (stage) => this.setupStage(stage - 1);
    this.hud.onResumeGame = () => {
      this.startAudio();
      if (this.state === 'TITLE') {
        this.startCountdownSequence();
      }
    };
    this.hud.onRestartGame = () => {
      this.score = 0;
      this.knockoutCount = 0;
      this.lives = START_LIVES;
      this.setupStage(0);
      this.startCountdownSequence();
    };

    // Physics events
    this.physics.events.onBounce = (force) => {
      soundManager.playSfx('bounce', Math.min(1, force * 1.5));
      this.renderer.triggerScreenShake(Math.min(0.32, force * 0.22));
    };
    this.physics.events.onShatter = () => {
      soundManager.playSfx('shatter', 1.0);
      this.renderer.triggerScreenShake(0.48);
      this.handleDeath('shatter');
    };
    this.physics.events.onSkid = (intensity) => {
      this.renderer.emitSkidMarks(
        [this.physics.marble.x, this.physics.marble.y, this.physics.marble.z],
        intensity,
      );
    };
    this.physics.events.onSpringboard = () => {
      soundManager.playSfx('springboard', 1.0);
      this.renderer.triggerScreenShake(0.18);
    };
    this.physics.events.onFall = () => {
      soundManager.playSfx('fall', 1.0);
      this.handleDeath('fall');
    };

    // Hazards events
    this.hazards.events.onCollectItem = () => {
      soundManager.playSfx('item', 1.0);
      this.itemsCollected++;
      this.score += ITEM_BONUS;
      this.saveHiscore();
      this.hud.showBanner(`+${ITEM_BONUS}`, 'ITEM COLLECTED', 1000);
    };

    this.hazards.events.onCheckpoint = () => {
      soundManager.playSfx('checkpoint', 1.0);
      this.score += CHECKPOINT_BONUS;
      this.timeLeft = Math.min(COURSE_TIME, this.timeLeft + 15);
      this.saveHiscore();
      this.hud.showBanner('CHECKPOINT!', '+15 SECONDS', 1500);
    };

    this.hazards.events.onGoal = () => {
      if (this.state === 'PLAYING') {
        this.handleStageClear();
      }
    };

    this.hazards.events.onKill = (reason) => {
      this.handleDeath(reason);
    };

    this.hazards.events.onHitBat = () => {
      soundManager.playSfx('bounce', 0.8);
      this.renderer.triggerScreenShake(0.2);
    };

    this.hazards.events.onSteelieBump = (_steelie, force) => {
      soundManager.playSfx('bounce', 1.0);
      this.renderer.emitBumpSparks([
        this.physics.marble.x,
        this.physics.marble.y,
        this.physics.marble.z,
      ]);
      this.renderer.triggerScreenShake(Math.min(0.4, force * 0.8));
    };

    this.hazards.events.onSteelieCracked = () => {
      soundManager.playSfx('shatter', 1.0);
      const points = 1000;
      this.score += points;
      this.knockoutCount++;
      this.saveHiscore();
      this.hud.showBanner('💥 STEELIE CRACKED!', `+${points} PTS NPC KNOCKOUT`, 2200);
      this.hud.addFeedEvent(`🏆 Knocked Steelie off ledge! +${points} PTS`);
    };

    // Global gesture to start audio
    const gestureHandler = () => {
      this.startAudio();
      window.removeEventListener('click', gestureHandler);
      window.removeEventListener('keydown', gestureHandler);
      window.removeEventListener('touchstart', gestureHandler);
    };
    window.addEventListener('click', gestureHandler);
    window.addEventListener('keydown', gestureHandler);
    window.addEventListener('touchstart', gestureHandler);
  }

  private bindMultiplayer(): void {
    this.multiplayer.events.onPlayerJoined = (player) => {
      const intelBadge = player.intelligence === 'AI' ? '🤖' : '🧠';
      this.hud.addFeedEvent(`👋 ${intelBadge} ${player.name} joined the world!`);
    };

    this.multiplayer.events.onPlayerLeft = (_id, name) => {
      this.hud.addFeedEvent(`🚪 ${name} left`);
    };

    this.multiplayer.events.onBumpReceived = (attackerName, impulse) => {
      soundManager.playSfx('bounce', 1.0);
      this.renderer.emitBumpSparks([
        this.physics.marble.x,
        this.physics.marble.y,
        this.physics.marble.z,
      ]);
      this.physics.marble.vx += impulse[0];
      this.physics.marble.vy += impulse[1];
      this.physics.marble.vz += impulse[2];
      this.hud.addFeedEvent(`💥 ${attackerName} bumped you!`);
    };

    this.multiplayer.events.onBumpScored = (targetName, points) => {
      soundManager.playSfx('item', 0.9);
      this.score += points;
      this.saveHiscore();
      this.renderer.emitBumpSparks([
        this.physics.marble.x,
        this.physics.marble.y,
        this.physics.marble.z,
      ]);
      this.hud.addFeedEvent(`⚡ Bumped ${targetName}! +${points} PTS`);
    };

    this.multiplayer.events.onKnockoutScored = (targetName, targetIntelligence, points) => {
      soundManager.playSfx('goal', 1.0);
      this.score += points;
      this.knockoutCount++;
      this.saveHiscore();
      this.renderer.triggerScreenShake(0.4);

      const isOpposing = targetIntelligence !== this.intelligenceType;
      const title = isOpposing ? '⚔️ OPPOSING INTELLIGENCE DESTROYED!' : '🏆 RIVAL KNOCKED OUT!';
      this.hud.showBanner(title, `+${points} PTS · ${targetName}`, 2500);
      this.hud.addFeedEvent(`💀 Knocked out ${targetName}! +${points} PTS`);
    };

    this.multiplayer.events.onPlayerCountChange = (count) => {
      this.hud.updatePlayerCount(count);
      if (this.multiplayer.localName) {
        this.renderer.setLocalPlayerInfo(
          this.multiplayer.localName,
          this.multiplayer.localColor,
        );
      }
    };
  }

  public startCountdownSequence(): void {
    this.state = 'COUNTDOWN';
    this.countdownTimer = 3.0;
    this.hud.hideMenu();
    this.hud.showCountdown(3, `STAGE 1: ${this.currentLevel.def.name}`);
  }

  public startGameDirect(): void {
    this.state = 'PLAYING';
    this.hud.hideMenu();
    this.hud.hideCountdown();
    this.hud.showBanner(`STAGE ${this.currentStageIndex + 1}`, this.currentLevel.def.name, 2000);
  }

  private startAudio(): void {
    if (!this.isAudioStarted) {
      this.isAudioStarted = true;
      soundManager.init();
      void this.input.requestDeviceOrientationPermission().then((ok) => {
        if (ok) this.input.calibrateNow();
      });
      soundManager.playBgm(this.currentStageIndex + 1);
    }
  }

  public setupStage(index: number, autoPlay = true): void {
    this.currentStageIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    this.currentLevel = LEVELS[this.currentStageIndex];
    this.timeLeft = this.currentLevel.def.time || COURSE_TIME;
    this.itemsCollected = 0;
    this.itemsTotal = this.currentLevel.props.filter((p) => p.kind === 'item').length;

    this.physics.setLevel(this.currentLevel);
    this.hazards.initLevel(this.currentLevel);
    this.renderer.buildLevelMesh(this.currentLevel);
    this.renderer.syncHazards(this.hazards.hazards);

    if (this.isAudioStarted) {
      soundManager.playBgm(this.currentStageIndex + 1);
    }

    if (autoPlay) {
      this.state = 'PLAYING';
      this.hud.showBanner(`STAGE ${this.currentStageIndex + 1}`, this.currentLevel.def.name, 2200);
    }
  }

  private restartCurrentStage(): void {
    this.setupStage(this.currentStageIndex);
  }

  private handleDeath(reason: string): void {
    if (this.state !== 'PLAYING') return;

    this.state = 'RESPAWNING';
    this.respawnTimer = 1.4;
    this.lives--;

    this.renderer.emitShatterParticles([
      this.physics.marble.x,
      this.physics.marble.y,
      this.physics.marble.z,
    ]);

    if (reason === 'muncher') {
      soundManager.playSfx('muncher', 1.0);
      this.hud.showBanner('CHOMPED!', 'AVOID MUNCHERS', 1600);
    } else if (reason === 'shatter') {
      soundManager.playSfx('shatter', 1.0);
      this.hud.showBanner('SHATTERED!', 'HIGH DROP', 1600);
    } else if (reason === 'acid') {
      soundManager.playSfx('fall', 1.0);
      this.hud.showBanner('DISSOLVED!', 'ACID POOL', 1600);
    } else if (reason === 'blade') {
      soundManager.playSfx('shatter', 1.0);
      this.hud.showBanner('SLICED!', 'WATCH THE BLADES', 1600);
    } else if (reason === 'snake') {
      soundManager.playSfx('muncher', 1.0);
      this.hud.showBanner('CRUSHED!', 'ACID WORM', 1600);
    } else if (reason === 'bomb') {
      soundManager.playSfx('shatter', 1.0);
      this.hud.showBanner('BLOWN UP!', 'DODGE BOMBS', 1600);
    } else {
      soundManager.playSfx('fall', 0.9);
      this.hud.showBanner('FELL OFF!', 'WATCH THE EDGES', 1500);
    }

    if (this.lives <= 0) {
      this.state = 'GAME_OVER';
      soundManager.playBgm('intro');
      this.checkAndPromptLeaderboard();
    }
  }

  private checkAndPromptLeaderboard(): void {
    const check = this.hud.checkQualifiesForLeaderboard(this.score);
    if (check.qualifies && this.score > 0) {
      this.hud.showNameEntry(this.score, check.rank, this.isAIMarble, (initials) => {
        void this.submitHighScore(initials);
      });
    } else {
      this.hud.showMenu(LEVELS.length, this.currentStageIndex + 1, true, this.score);
    }
  }

  private async submitHighScore(initials: string): Promise<void> {
    const rawTag = initials.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'ACE';
    const tag = `[${this.intelligenceType}] ${rawTag}`;

    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tag,
          score: this.score,
          intelligence: this.intelligenceType,
          stage: this.currentStageIndex + 1,
          timeRemaining: Math.floor(this.timeLeft),
          knockouts: this.knockoutCount,
          token: this.sessionToken,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.top50)) {
          this.hud.setLeaderboard(data.top50);
        }
        this.hud.showBanner('🏆 HIGH SCORE SUBMITTED!', `${tag} — ${this.score} PTS`, 3000);
      }
    } catch (err) {
      console.warn('[Leaderboard] Submission error:', err);
    }

    this.hud.showMenu(LEVELS.length, this.currentStageIndex + 1, true, this.score);
  }

  private handleStageClear(): void {
    this.state = 'STAGE_CLEAR';
    soundManager.playSfx('goal', 1.0);

    const timeBonus = Math.floor(this.timeLeft * 50);
    this.score += timeBonus;
    this.saveHiscore();

    this.hud.showBanner('STAGE CLEAR!', `TIME BONUS +${timeBonus}`, 2500);

    setTimeout(() => {
      if (this.currentStageIndex + 1 < LEVELS.length) {
        this.setupStage(this.currentStageIndex + 1);
      } else {
        this.state = 'VICTORY';
        this.hud.showBanner('VICTORY!', `ALL COURSES CLEARED! FINAL SCORE: ${this.score}`, 5000);
        this.checkAndPromptLeaderboard();
      }
    }, 2600);
  }

  public update(dt: number): void {
    const inputSample = this.input.getSample(dt);

    if (this.state === 'COUNTDOWN') {
      this.countdownTimer -= dt;
      const sec = Math.ceil(this.countdownTimer);
      this.hud.updateCountdown(sec);

      if (this.countdownTimer <= 0) {
        this.hud.hideCountdown();
        this.state = 'PLAYING';
        this.hud.showBanner(`STAGE ${this.currentStageIndex + 1}`, this.currentLevel.def.name, 2000);
      }
    } else if (this.state === 'PLAYING') {
      // Countdown timer
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) {
        this.handleDeath('time');
      }

      // Physics update
      this.physics.update(inputSample);

      // Check marble-on-marble multiplayer collisions
      this.multiplayer.checkPlayerCollisions(
        this.currentStageIndex + 1,
        this.physics.marble,
        (target, _force) => {
          soundManager.playSfx('bounce', 1.0);
          this.score += 250;
          this.saveHiscore();
          this.renderer.emitBumpSparks([
            this.physics.marble.x,
            this.physics.marble.y,
            this.physics.marble.z,
          ]);
          this.hud.addFeedEvent(`⚡ Bumped ${target.name}! +250 PTS`);
        },
      );

      // Audio roll pitch & volume
      if (this.physics.marble.grounded) {
        soundManager.setRollVolume(this.physics.marble.speed / 0.16);
      } else {
        soundManager.setRollVolume(0);
      }

      // Hazards update
      this.hazards.update(dt, this.physics.marble);
    } else if (this.state === 'RESPAWNING') {
      soundManager.setRollVolume(0);
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        const cp = this.hazards.activeCheckpoint;
        this.physics.respawn(cp ?? undefined);
        this.state = 'PLAYING';
      }
    }

    // Multiplayer sync & interpolation
    this.multiplayer.updateInterpolation(dt);
    this.multiplayer.sendUpdate(
      this.currentStageIndex + 1,
      this.physics.marble,
      this.score,
    );

    // HUD stats update
    this.hud.updateStats(
      this.score,
      this.hiscore,
      this.lives,
      this.currentLevel.def.name,
      this.timeLeft,
      this.physics.marble.speed,
      this.itemsCollected,
      this.itemsTotal,
    );

    const onlinePlayers = this.multiplayer.getOnlinePlayers();

    // Minimap update
    this.hud.drawMinimap(
      this.currentLevel,
      this.physics.marble,
      this.hazards.hazards,
      onlinePlayers,
      this.currentStageIndex + 1,
    );

    // 3D Scene Rendering
    this.renderer.render(
      this.physics.marble,
      this.hazards.hazards,
      onlinePlayers,
      this.currentStageIndex + 1,
      dt,
    );
  }
}
