import type { BuiltLevel } from '../data/build.js';
import type { HazardInstance } from './hazards.js';
import type { MarbleState } from './physics.js';
import type { RemotePlayer } from './multiplayer.js';
import { retroLogo, retroSpriteStrip, retroText } from './retro-assets.js';

export interface LeaderboardEntry {
  rank?: number;
  name: string;
  score: number;
  intelligence: 'AI' | 'NI';
  stage: number;
  timeRemaining: number;
  knockouts: number;
  date?: string;
}

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

  // Leaderboard and Countdown UI elements
  private lbTableBody: HTMLElement | null;
  private countdownOverlay: HTMLElement | null;
  private countdownNumEl: HTMLElement | null;
  private countdownTitleEl: HTMLElement | null;
  private countdownLbContent: HTMLElement | null;
  private nameEntryModal: HTMLElement | null;
  private nameEntrySubtitle: HTMLElement | null;
  private initialsInput: HTMLInputElement | null;
  private initialsSubmitBtn: HTMLElement | null;

  private leaderboardData: LeaderboardEntry[] = [];
  private activeFilter: 'ALL' | 'NI' | 'AI' = 'ALL';

  private bannerTimeout: number | null = null;
  private fpsFrames = 0;
  private lastFpsTime = performance.now();
  private currentFps = 60;

  public onSelectCourse?: (stageId: number) => void;
  public onResumeGame?: () => void;
  public onRestartGame?: () => void;
  public onNameSubmitted?: (initials: string) => void;
  public onMusicVolumeChange?: (volume: number) => void;
  public musicVolume = 0.16;

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

    this.lbTableBody = document.getElementById('lb-table-body');
    this.countdownOverlay = document.getElementById('countdown-overlay');
    this.countdownNumEl = document.getElementById('countdown-num');
    this.countdownTitleEl = document.getElementById('countdown-title');
    this.countdownLbContent = document.getElementById('countdown-lb-content');
    this.nameEntryModal = document.getElementById('name-entry-modal');
    this.nameEntrySubtitle = document.getElementById('name-entry-subtitle');
    this.initialsInput = document.getElementById('player-initials-input') as HTMLInputElement | null;
    this.initialsSubmitBtn = document.getElementById('player-initials-submit');

    this.bindLeaderboardTabs();
    this.bindNameEntry();
  }

  private bindLeaderboardTabs(): void {
    const tabs = document.querySelectorAll('.lb-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', (e) => {
        tabs.forEach((t) => t.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        this.activeFilter = (target.getAttribute('data-filter') as 'ALL' | 'NI' | 'AI') || 'ALL';
        this.renderLeaderboard();
      });
    });
  }

  private bindNameEntry(): void {
    const submit = () => {
      let val = this.initialsInput?.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'AAA';
      if (this.onNameSubmitted) {
        this.onNameSubmitted(val);
      }
      this.hideNameEntry();
    };

    this.initialsSubmitBtn?.addEventListener('click', submit);
    this.initialsInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  public setLeaderboard(entries: LeaderboardEntry[]): void {
    this.leaderboardData = entries;
    this.renderLeaderboard();
    this.renderCountdownMiniLb();
  }

  public getLeaderboard(): LeaderboardEntry[] {
    return this.leaderboardData;
  }

  public checkQualifiesForLeaderboard(score: number): { qualifies: boolean; rank: number } {
    if (this.leaderboardData.length < 50) {
      return { qualifies: true, rank: this.leaderboardData.length + 1 };
    }
    const lowest = this.leaderboardData[this.leaderboardData.length - 1].score;
    if (score > lowest) {
      const rank = this.leaderboardData.findIndex((e) => score > e.score) + 1;
      return { qualifies: true, rank: rank > 0 ? rank : 50 };
    }
    return { qualifies: false, rank: -1 };
  }

  public renderLeaderboard(): void {
    if (!this.lbTableBody) return;

    const filtered = this.leaderboardData.filter((entry) => {
      if (this.activeFilter === 'ALL') return true;
      return entry.intelligence === this.activeFilter;
    });

    if (filtered.length === 0) {
      this.lbTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--dim);padding:10px">No records found for ${this.activeFilter}.</td></tr>`;
      return;
    }

    let rows = '';
    filtered.slice(0, 50).forEach((item, index) => {
      const isAI = item.intelligence === 'AI';
      const badge = isAI
        ? `<span class="badge-ai">🤖 AI</span>`
        : `<span class="badge-ni">🧠 NI</span>`;
      const rank = item.rank ?? index + 1;

      rows += `
        <tr>
          <td style="color:${rank <= 3 ? 'var(--warn)' : 'var(--dim)'};font-weight:700">${rank}</td>
          <td>${badge}</td>
          <td style="font-weight:600;color:#fff">${item.name}</td>
          <td style="text-align:right;color:var(--cool);font-weight:700">${item.score.toLocaleString()}</td>
          <td style="text-align:center;color:var(--dim)">S${item.stage}</td>
          <td style="text-align:right;color:${item.knockouts > 0 ? 'var(--hot)' : 'var(--dim)'}">${item.knockouts}</td>
        </tr>
      `;
    });

    this.lbTableBody.innerHTML = rows;
  }

  private renderCountdownMiniLb(): void {
    if (!this.countdownLbContent) return;
    const top3 = this.leaderboardData.slice(0, 3);
    if (top3.length === 0) {
      this.countdownLbContent.textContent = 'Be the first to set a high score!';
      return;
    }

    let html = '<div style="display:flex;flex-direction:column;gap:3px">';
    top3.forEach((e, idx) => {
      const icon = e.intelligence === 'AI' ? '🤖' : '🧠';
      html += `
        <div style="display:flex;justify-content:space-between">
          <span><b>#${idx + 1}</b> ${icon} ${e.name} (S${e.stage})</span>
          <span style="color:var(--cool);font-weight:700">${e.score.toLocaleString()} PTS</span>
        </div>
      `;
    });
    html += '</div>';
    this.countdownLbContent.innerHTML = html;
  }

  public showCountdown(seconds: number, stageName: string): void {
    if (!this.countdownOverlay) return;
    this.countdownOverlay.classList.add('show');
    if (this.countdownTitleEl) this.countdownTitleEl.textContent = stageName.toUpperCase();
    this.updateCountdown(seconds);
    this.renderCountdownMiniLb();
  }

  public updateCountdown(seconds: number): void {
    if (!this.countdownNumEl) return;
    if (seconds > 0) {
      this.countdownNumEl.textContent = String(seconds);
    } else {
      this.countdownNumEl.textContent = 'GO!';
    }
  }

  public hideCountdown(): void {
    this.countdownOverlay?.classList.remove('show');
  }

  public showNameEntry(score: number, rank: number, isAI: boolean, onSubmit: (name: string) => void): void {
    if (!this.nameEntryModal) return;
    this.nameEntryModal.classList.remove('hidden');

    if (this.nameEntrySubtitle) {
      const badge = isAI ? '[AI]' : '[NI]';
      this.nameEntrySubtitle.textContent = `RANK #${rank} · SCORE: ${score.toLocaleString()} (${badge})`;
    }

    if (this.initialsInput) {
      this.initialsInput.value = isAI ? 'BOT' : 'ACE';
      this.initialsInput.focus();
      this.initialsInput.select();
    }

    this.onNameSubmitted = onSubmit;
  }

  public hideNameEntry(): void {
    this.nameEntryModal?.classList.add('hidden');
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

  public showBanner(title: string, sub?: string, durationMs = 2000): void {
    if (!this.bannerEl) return;
    if (this.bannerTimeout !== null) {
      clearTimeout(this.bannerTimeout);
    }

    this.bannerEl.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    this.bannerEl.classList.add('show');

    this.bannerTimeout = window.setTimeout(() => {
      this.bannerEl?.classList.remove('show');
      this.bannerTimeout = null;
    }, durationMs);
  }

  public showMenu(stageCount: number, currentStage: number, isGameOver = false, finalScore = 0): void {
    if (!this.menuEl) return;
    this.menuEl.classList.remove('hidden');

    const courseNames = ['PINK GARDENS', 'ARCTIC ADVENTURE', 'ASTRAL SPIRE', 'PYRAMID OASIS', 'EDGY MAZE', 'DUSTY TRAIL', "DRILLIN' RYE", 'SPACE DEMENTIA'];
    let courseButtons = '';
    for (let i = 1; i <= stageCount; i++) {
      const isCurrent = i === currentStage;
      const label = `${i} ${courseNames[i - 1] ?? `STAGE ${i}`}`;
      courseButtons += `<button class="click" data-stage="${i}" aria-label="${label}" ${isCurrent ? 'aria-current="true"' : ''}>${retroText(label)}</button>`;
    }

    this.menuEl.innerHTML = `
      <div class="retro-menu-panel">
        ${retroLogo()}
        ${retroSpriteStrip()}
        <div class="retro-menu-state">${retroText(isGameOver ? 'GAME OVER' : 'SELECT RACE')}</div>
        <div class="sub">${isGameOver ? `FINAL SCORE: ${finalScore}` : 'ORIGINAL ARCADE SPRITES / 3D RACE'}</div>
        <div class="courses">${courseButtons}</div>
        <label class="music-control" for="menu-music-volume">
          ${retroText('MUSIC')}
          <input id="menu-music-volume" type="range" min="0" max="100" step="1" value="${Math.round(this.musicVolume * 100)}">
          <output id="menu-music-output">${Math.round(this.musicVolume * 100)}%</output>
        </label>
        <button class="go click" id="menu-resume">${retroText(isGameOver ? 'PLAY AGAIN' : 'PRESS START')}</button>
        <div class="fine">ARROWS / WASD STEER &nbsp; SPACE BRAKES &nbsp; M MUTES</div>
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

    const volume = this.menuEl.querySelector('#menu-music-volume') as HTMLInputElement | null;
    const output = this.menuEl.querySelector('#menu-music-output');
    volume?.addEventListener('input', () => {
      this.musicVolume = Number(volume.value) / 100;
      if (output) output.textContent = `${volume.value}%`;
      this.onMusicVolumeChange?.(this.musicVolume);
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
      } else if (h.def.kind === 'blade' || h.def.kind === 'bat' || h.def.kind === 'snake' || h.def.kind === 'steelie' || h.def.kind === 'muncher') {
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
