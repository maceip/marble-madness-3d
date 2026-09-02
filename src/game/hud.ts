import type { BuiltLevel } from '../data/build.js';
import type { HazardInstance } from './hazards.js';
import type { MarbleState } from './physics.js';
import type { RemotePlayer } from './multiplayer.js';

export class HudManager {
  private scoreEl: HTMLElement | null;
  private hiscoreEl: HTMLElement | null;
  private livesEl: HTMLElement | null;
  private courseEl: HTMLElement | null;
  private timeEl: HTMLElement | null;
  private speedEl: HTMLElement | null;
  private itemsEl: HTMLElement | null;
  private bannerEl: HTMLElement | null;
  private menuEl: HTMLElement | null;
  private fpsEl: HTMLElement | null;
  private mpCountEl: HTMLElement | null;
  private mpFeedEl: HTMLElement | null;
  private minimapCanvas: HTMLCanvasElement | null;
  private minimapCtx: CanvasRenderingContext2D | null;

  private bannerTimeout: number | null = null;
  private fpsFrames = 0;
  private lastFpsTime = performance.now();
  private currentFps = 60;

  public onSelectCourse?: (stageId: number) => void;
  public onResumeGame?: () => void;
  public onRestartGame?: () => void;

  constructor() {
    this.scoreEl = document.getElementById('score');
    this.hiscoreEl = document.getElementById('hiscore');
    this.livesEl = document.getElementById('lives');
    this.courseEl = document.getElementById('course');
    this.timeEl = document.getElementById('time');
    this.speedEl = document.getElementById('speed');
    this.itemsEl = document.getElementById('items');
    this.bannerEl = document.getElementById('banner');
    this.menuEl = document.getElementById('menu');
    this.fpsEl = document.getElementById('fps');
    this.mpCountEl = document.getElementById('mp-count');
    this.mpFeedEl = document.getElementById('mp-feed');
    this.minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement | null;
    this.minimapCtx = this.minimapCanvas?.getContext('2d') ?? null;
  }

  public updateStats(
    score: number,
    hiscore: number,
    lives: number,
    courseName: string,
    time: number,
    speed: number,
    itemsGot: number,
    itemsTotal: number,
  ): void {
    if (this.scoreEl) this.scoreEl.textContent = String(score);
    if (this.hiscoreEl) this.hiscoreEl.textContent = String(hiscore);
    if (this.courseEl) this.courseEl.textContent = courseName.toUpperCase();

    if (this.timeEl) {
      this.timeEl.textContent = time.toFixed(1);
      if (time <= 15.0) {
        this.timeEl.classList.add('low');
      } else {
        this.timeEl.classList.remove('low');
      }
    }

    if (this.speedEl) {
      this.speedEl.textContent = Math.round(speed * 120).toString();
    }

    if (this.itemsEl) {
      this.itemsEl.textContent = `${itemsGot}/${itemsTotal}`;
    }

    if (this.livesEl) {
      let dots = '';
      for (let i = 0; i < 3; i++) {
        dots += `<i class="${i < lives ? '' : 'off'}"></i>`;
      }
      this.livesEl.innerHTML = dots;
    }

    // FPS update
    this.fpsFrames++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = Math.round((this.fpsFrames * 1000) / (now - this.lastFpsTime));
      this.fpsFrames = 0;
      this.lastFpsTime = now;
      if (this.fpsEl) this.fpsEl.textContent = `${this.currentFps} FPS`;
    }
  }

  public updatePlayerCount(count: number): void {
    if (this.mpCountEl) {
      this.mpCountEl.textContent = count === 1 ? '1 Online (Solo)' : `${count} Players Online`;
    }
  }

  public addFeedEvent(text: string, durationMs = 3500): void {
    if (!this.mpFeedEl) return;

    const div = document.createElement('div');
    div.className = 'mp-event';
    div.textContent = text;
    this.mpFeedEl.prepend(div);

    // Limit to max 4 items
    while (this.mpFeedEl.children.length > 4) {
      this.mpFeedEl.lastElementChild?.remove();
    }

    setTimeout(() => {
      div.style.opacity = '0';
      div.style.transition = 'opacity 0.4s';
      setTimeout(() => div.remove(), 400);
    }, durationMs);
  }

  public showBanner(title: string, subtitle = '', durationMs = 2000): void {
    if (!this.bannerEl) return;
    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);

    this.bannerEl.innerHTML = `${title}${subtitle ? `<small>${subtitle}</small>` : ''}`;
    this.bannerEl.classList.add('show');

    this.bannerTimeout = window.setTimeout(() => {
      this.bannerEl?.classList.remove('show');
      this.bannerTimeout = null;
    }, durationMs);
  }

  public showMenu(stageCount: number, currentStage: number, isGameOver = false, finalScore = 0): void {
    if (!this.menuEl) return;
    this.menuEl.classList.remove('hidden');

    let courseButtons = '';
    for (let i = 1; i <= stageCount; i++) {
      const isCurrent = i === currentStage;
      courseButtons += `<button class="click" data-stage="${i}" ${isCurrent ? 'aria-current="true"' : ''}>STAGE ${i}</button>`;
    }

    this.menuEl.innerHTML = `
      <h1 class="title">${isGameOver ? 'GAME OVER' : 'MARBLE MADNESS'}</h1>
      <div class="sub">${isGameOver ? `FINAL SCORE: ${finalScore}` : '3D ISOMETRIC ARCADE RUN · MULTIPLAYER SHARED WORLD'}</div>
      <div class="courses">${courseButtons}</div>
      <button class="go click" id="menu-resume">${isGameOver ? 'PLAY AGAIN' : 'PRESS START'}</button>
      <div class="fine">
        Steer with Device Tilt (Mobile Rotameter), Touch Joystick, or Arrow Keys / WASD.<br>
        Multiplayer: Bump into other marbles to knock them off balance and score +250 points!
      </div>
    `;

    // Bind menu buttons
    this.menuEl.querySelectorAll('button[data-stage]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const stage = parseInt((e.currentTarget as HTMLElement).getAttribute('data-stage') || '1', 10);
        this.hideMenu();
        if (this.onSelectCourse) this.onSelectCourse(stage);
      });
    });

    const resumeBtn = this.menuEl.querySelector('#menu-resume');
    resumeBtn?.addEventListener('click', () => {
      this.hideMenu();
      if (isGameOver) {
        if (this.onRestartGame) this.onRestartGame();
      } else {
        if (this.onResumeGame) this.onResumeGame();
      }
    });
  }

  public hideMenu(): void {
    this.menuEl?.classList.add('hidden');
  }

  public isMenuOpen(): boolean {
    return !this.menuEl?.classList.contains('hidden');
  }

  public drawMinimap(
    level: BuiltLevel,
    marble: MarbleState,
    hazards: HazardInstance[],
    remotePlayers: RemotePlayer[],
    currentStage: number,
  ): void {
    const ctx = this.minimapCtx;
    const canvas = this.minimapCanvas;
    if (!ctx || !canvas) return;

    const W = level.layout.W;
    const H = level.layout.H;

    canvas.width = 120;
    canvas.height = Math.round((H / W) * 120);

    ctx.fillStyle = '#0b0e18dd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cellW = canvas.width / W;
    const cellH = canvas.height / H;

    // Draw terrain
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const cell = level.layout.cells[r * W + c];
        if (!cell || cell.surf === 'void') continue;

        switch (cell.surf) {
          case 'wall':
          case 'rock':
          case 'tree':
            ctx.fillStyle = '#3a4466';
            break;
          case 'water':
            ctx.fillStyle = '#2277cc';
            break;
          case 'sand':
            ctx.fillStyle = '#c2a649';
            break;
          case 'snow':
            ctx.fillStyle = '#cde2f5';
            break;
          case 'glass':
          case 'holo':
            ctx.fillStyle = '#44eecc';
            break;
          default:
            ctx.fillStyle = '#1e263d';
            break;
        }

        ctx.fillRect(c * cellW, r * cellH, cellW - 0.5, cellH - 0.5);
      }
    }

    // Draw hazards and pickups
    for (const h of hazards) {
      if (!h.active) continue;
      if (h.def.kind === 'goal') {
        ctx.fillStyle = '#33e0ff';
        ctx.beginPath();
        ctx.arc(h.x * cellW, h.z * cellH, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (h.def.kind === 'item') {
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(h.x * cellW - 1.5, h.z * cellH - 1.5, 3, 3);
      } else if (h.def.kind === 'blade' || h.def.kind === 'bat' || h.def.kind === 'snake') {
        ctx.fillStyle = '#ff3b5c';
        ctx.fillRect(h.x * cellW - 1.5, h.z * cellH - 1.5, 3, 3);
      }
    }

    // Draw remote other players
    for (const rp of remotePlayers) {
      if (rp.stage === currentStage) {
        ctx.fillStyle = rp.color || '#33e0ff';
        ctx.beginPath();
        ctx.arc(rp.x * cellW, rp.z * cellH, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw local player marble
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(marble.x * cellW, marble.z * cellH, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
