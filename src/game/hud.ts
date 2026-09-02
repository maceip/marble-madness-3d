import { soundManager } from '../audio.js';
import type { BuiltLevel } from '../data/build.js';
import type { HazardInstance } from './hazards.js';
import type { MarbleState } from './physics.js';
import type { RemotePlayer } from './multiplayer.js';
import type { RadarIndicator } from './renderer.js';
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
  private zeroTiltBtn: HTMLElement | null;
  private radarContainerEl: HTMLElement | null;
  private minimapCanvas: HTMLCanvasElement | null;
  private minimapCtx: CanvasRenderingContext2D | null;

  // Offscreen canvas cache for minimap static terrain
  public cachedMinimapCanvas: HTMLCanvasElement | null = null;
  public cachedMinimapStage = -1;

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

  // Spectator Mode UI elements
  private spectatorOverlay: HTMLElement | null;
  private spectatorTargetName: HTMLElement | null;
  private specPrevBtn: HTMLElement | null;
  private specNextBtn: HTMLElement | null;
  private specRespawnBtn: HTMLElement | null;

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
  public onZeroTilt?: () => void;
  public onSpectatorPrev?: () => void;
  public onSpectatorNext?: () => void;
  public onSpectatorRespawn?: () => void;
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
    this.zeroTiltBtn = document.getElementById('btn-zero-tilt');
    this.radarContainerEl = document.getElementById('mp-radar');
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

    this.spectatorOverlay = document.getElementById('spectator-overlay');
    this.spectatorTargetName = document.getElementById('spectator-target-name');
    this.specPrevBtn = document.getElementById('spec-prev-btn');
    this.specNextBtn = document.getElementById('spec-next-btn');
    this.specRespawnBtn = document.getElementById('spec-respawn-btn');

    this.zeroTiltBtn?.addEventListener('click', () => {
      this.onZeroTilt?.();
      this.showBanner('🎯 TILT RE-CENTERED', 'NEUTRAL POSITION SET', 1200);
    });

    this.specPrevBtn?.addEventListener('click', () => this.onSpectatorPrev?.());
    this.specNextBtn?.addEventListener('click', () => this.onSpectatorNext?.());
    this.specRespawnBtn?.addEventListener('click', () => this.onSpectatorRespawn?.());

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
    this.countdownOverlay.style.display = 'flex';
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
    if (!this.countdownOverlay) return;
    this.countdownOverlay.classList.remove('show');
    this.countdownOverlay.style.display = 'none';
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

    const courseNames = [
      'PRACTICE RACE',
      'PYRAMID OASIS',
      'ASTRAL SPIRE',
      'BEGINNER RACE',
      'AERIAL RACE',
      'SILLY RACE',
      'ULTIMATE RACE',
      'SPACE DEMENTIA',
    ];
    let courseButtons = '';
    for (let i = 1; i <= stageCount; i++) {
      const isCurrent = i === currentStage;
      const label = `${i} ${courseNames[i - 1] ?? `STAGE ${i}`}`;
      courseButtons += `<button class="click" data-stage="${i}" aria-label="${label}" ${isCurrent ? 'aria-current="true"' : ''}>${retroText(label)}</button>`;
    }

    const musicPct = Math.round(soundManager.musicVolume * 100);
    const sfxPct = Math.round(soundManager.sfxVolume * 100);

    this.menuEl.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:4px">
        <img src="/sprites/retro_logo.png" style="max-width:280px;height:auto;image-rendering:pixelated;filter:drop-shadow(0 0 12px rgba(255,59,92,0.7));" alt="Marble Madness Arcade" />
      </div>
      <h1 class="title">${isGameOver ? 'GAME OVER' : 'MARBLE MADNESS'}</h1>
      <div class="sub">${isGameOver ? `FINAL SCORE: ${finalScore}` : '3D ISOMETRIC ARCADE RUN · MULTIPLAYER SHARED WORLD'}</div>
      
      <!-- Retro Sprite Showcase (Blue Marble & Red Rival & Enemies) -->
      <div class="retro-marquee">
        <img src="/sprites/marbles_blue/frame_00.png" class="retro-marble-anim" id="menu-marble-b" alt="Player Marble" />
        <span style="font-size:10.5px;color:var(--cool);letter-spacing:0.1em">ORIGINAL 1986 ARCADE SPRITE PHYSICS</span>
        <img src="/sprites/marbles_red/frame_00.png" class="retro-marble-anim" id="menu-marble-r" alt="Rival Marble" />
      </div>

      <div class="courses">${courseButtons}</div>

      <!-- In-Game Audio Volume Sliders -->
      <div class="volume-group click">
        <div class="vol-control">
          <span>🎵 MUSIC</span>
          <input type="range" id="menu-music-vol" min="0" max="100" value="${musicPct}" />
          <span class="vol-val" id="menu-music-val">${musicPct}%</span>
        </div>
        <div class="vol-control">
          <span>🔊 SFX</span>
          <input type="range" id="menu-sfx-vol" min="0" max="100" value="${sfxPct}" />
          <span class="vol-val" id="menu-sfx-val">${sfxPct}%</span>
        </div>
      </div>

      <button class="go click" id="menu-resume">${isGameOver ? 'PLAY AGAIN' : 'PRESS START'}</button>
      <div class="fine">
        Steer with Device Tilt (Mobile Rotameter), Touch Joystick, or Arrow Keys / WASD.<br>
        Multiplayer: Bump into other marbles to knock them off balance (+250 pts) or off ledges (+2500 pts vs Opposing Intelligence)!
      </div>
    `;

    // Setup animated marble spinning frames
    let animFrame = 0;
    const mbImg = this.menuEl.querySelector('#menu-marble-b') as HTMLImageElement | null;
    const mrImg = this.menuEl.querySelector('#menu-marble-r') as HTMLImageElement | null;
    const interval = setInterval(() => {
      if (!this.isMenuOpen()) {
        clearInterval(interval);
        return;
      }
      animFrame = (animFrame + 1) % 14;
      const fStr = animFrame.toString().padStart(2, '0');
      if (mbImg) mbImg.src = `/sprites/marbles_blue/frame_${fStr}.png`;
      if (mrImg) mrImg.src = `/sprites/marbles_red/frame_${fStr}.png`;
    }, 90);

    // Bind volume sliders
    const musicSlider = this.menuEl.querySelector('#menu-music-vol') as HTMLInputElement | null;
    const musicVal = this.menuEl.querySelector('#menu-music-val');
    const sfxSlider = this.menuEl.querySelector('#menu-sfx-vol') as HTMLInputElement | null;
    const sfxVal = this.menuEl.querySelector('#menu-sfx-val');

    musicSlider?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      soundManager.setMusicVolume(val / 100);
      if (musicVal) musicVal.textContent = `${val}%`;
    });

    sfxSlider?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      soundManager.setSfxVolume(val / 100);
      if (sfxVal) sfxVal.textContent = `${val}%`;
      soundManager.playSfx('bounce', 1.0);
    });

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
    const targetHeight = Math.round((H / W) * 120);

    // Prerender static course terrain once per level change to an offscreen canvas
    if (
      this.cachedMinimapStage !== currentStage ||
      !this.cachedMinimapCanvas ||
      this.cachedMinimapCanvas.width !== 120 ||
      this.cachedMinimapCanvas.height !== targetHeight
    ) {
      if (canvas.width !== 120) canvas.width = 120;
      if (canvas.height !== targetHeight) canvas.height = targetHeight;

      if (!this.cachedMinimapCanvas) {
        this.cachedMinimapCanvas = document.createElement('canvas');
      }
      this.cachedMinimapCanvas.width = 120;
      this.cachedMinimapCanvas.height = targetHeight;

      const offCtx = this.cachedMinimapCanvas.getContext('2d');
      if (offCtx) {
        offCtx.fillStyle = '#0b0e18dd';
        offCtx.fillRect(0, 0, 120, targetHeight);

        const cellW = 120 / W;
        const cellH = targetHeight / H;

        // Draw static terrain tiles
        for (let r = 0; r < H; r++) {
          for (let c = 0; c < W; c++) {
            const cell = level.layout.cells[r * W + c];
            if (!cell || cell.surf === 'void') continue;

            switch (cell.surf) {
              case 'wall':
              case 'rock':
              case 'tree':
                offCtx.fillStyle = '#3a4466';
                break;
              case 'water':
                offCtx.fillStyle = '#2277cc';
                break;
              case 'sand':
                offCtx.fillStyle = '#c2a649';
                break;
              case 'snow':
                offCtx.fillStyle = '#cde2f5';
                break;
              case 'glass':
              case 'holo':
                offCtx.fillStyle = '#44eecc';
                break;
              default:
                offCtx.fillStyle = '#1e263d';
                break;
            }
            offCtx.fillRect(c * cellW, r * cellH, cellW - 0.5, cellH - 0.5);
          }
        }
      }
      this.cachedMinimapStage = currentStage;
    }

    // Fast single blit of pre-rendered terrain buffer
    ctx.drawImage(this.cachedMinimapCanvas, 0, 0);

    const cellW = canvas.width / W;
    const cellH = canvas.height / H;

    // Draw dynamic hazards and pickups
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

  public updateRadarIndicators(indicators: RadarIndicator[]): void {
    if (!this.radarContainerEl) return;
    if (indicators.length === 0) {
      if (this.radarContainerEl.children.length > 0) {
        this.radarContainerEl.innerHTML = '';
      }
      return;
    }

    let html = '';
    for (const ind of indicators) {
      const isAI = ind.intelligence === 'AI';
      const intelBadge = isAI ? '🤖' : '🧠';
      const alertClass = ind.isAlert ? ' alert' : '';
      const tagColor = ind.color;
      html += `
        <div class="radar-marker${alertClass}" style="left:${ind.screenX}px;top:${ind.screenY}px">
          <div class="radar-chevron" style="transform:rotate(${ind.angle}rad);border-bottom-color:${tagColor}"></div>
          <div class="radar-tag" style="border-color:${tagColor}">
            <span>${intelBadge} ${ind.name}</span>
            <span style="color:var(--warn);margin-left:3px">${ind.distance}m</span>
          </div>
        </div>
      `;
    }
    this.radarContainerEl.innerHTML = html;
  }

  public showSpectatorMode(targetName: string, intel: 'AI' | 'NI' = 'NI'): void {
    if (!this.spectatorOverlay) return;
    this.spectatorOverlay.classList.remove('hidden');
    this.updateSpectatorTarget(targetName, intel);
  }

  public hideSpectatorMode(): void {
    this.spectatorOverlay?.classList.add('hidden');
  }

  public updateSpectatorTarget(targetName: string, intel: 'AI' | 'NI' = 'NI'): void {
    if (this.spectatorTargetName) {
      const badge = intel === 'AI' ? '🤖' : '🧠';
      this.spectatorTargetName.textContent = `${badge} ${targetName}`;
    }
  }
}
