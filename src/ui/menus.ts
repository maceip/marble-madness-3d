import type { Game } from '../game/game';
import type { BitmapFont, FontVariant } from '../engine/font';
import { fmtScore } from '../engine/font';
import { FRAMES } from '../engine/assets';
import { pxCanvas, pxFill, pxSpread, uiScale, flashPress } from './pixel';
import { MarbleRain } from './confetti';
import { AuthCelebration } from './auth_fx';

const LETTERS = ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', 'VWXYZ'];
const HTML_SCREENS = new Set(['title', 'menu', 'name', 'connect', 'congrats', 'rematch']);

/**
 * HTML overlays for every menu. Bitmap font (sprites/font.png) on every label.
 * Title/end board matches the arcade PLAYER | INTELLIGENCE card.
 * Name matches pickname.png. Connect matches the Codex paste card.
 * Congrats matches the NES ending tally + marble rain.
 */
export class HtmlMenus {
  private bound = false;
  private lastScreen = '';
  private lastSig = '';
  private lastScale = 0;
  private keysReady = false;
  private agentChooserOpen = false;
  private agentTeaserDismissed = false;
  readonly rain = new MarbleRain();
  readonly authFx = new AuthCelebration();
  private fx: HTMLCanvasElement | null = null;

  constructor(private readonly game: Game) {}

  private font(): BitmapFont { return this.game.assets.font; }

  /** sign-in verdict on the name screen: bird fly-by + sparkles + speech bubble over the menu. Returns how long it
   *  runs so the caller can hold the screen that long (a tap on the overlay skips ahead on success). */
  celebrateAuth(kind: 'ok' | 'error', lines: string[]): number {
    this.bind();
    this.authFx.start(kind, lines, window.innerWidth, window.innerHeight, uiScale() + 1);
    this.game.sound.sfx('chirp');
    return this.authFx.duration;
  }

  bind(): void {
    if (this.bound) return;
    this.bound = true;
    this.fx = document.getElementById('ui-fx') as HTMLCanvasElement | null;
    this.authFx.onFlock = () => this.game.sound.sfx('chirp', 0.8, 1.15);
    // while the verdict plays the overlay sits over the buttons: a tap moves on instead of re-firing a sign-in
    this.fx?.addEventListener('click', () => {
      if (this.authFx.active && this.authFx.kind === 'ok' && this.game.screens.authSuccessTimer > 0) this.game.screens.finishName();
    });

    const goMenu = (el?: HTMLElement | null) => {
      flashPress(el ?? null);
      this.game.sound.init();
      this.game.sound.sfx('item');
      window.setTimeout(() => this.game.go('menu'), 90);
    };
    document.getElementById('ui-press-start')?.addEventListener('click', (e) => {
      e.stopPropagation();
      goMenu(e.currentTarget as HTMLElement);
    });
    document.getElementById('ui-title')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      goMenu();
    });
    // The mode card is the whole control: tapping 1 PLAYER / 2 PLAYERS selects and starts that mode
    // (there is no separate PRESS START on this screen any more).
    for (const id of ['ui-mode-0', 'ui-mode-1']) {
      document.getElementById(id)?.addEventListener('click', (e) => {
        const i = id.endsWith('0') ? 0 : 1;
        flashPress(e.currentTarget as HTMLElement);
        this.game.screens.cursor = i;
        this.game.sound.init();
        this.game.sound.sfx('item');
        this.lastSig = '';
        this.sync('menu');
        window.setTimeout(() => { if (this.game.screen === 'menu') this.game.screens.chooseMode(i); }, 120);
      });
    }

    document.getElementById('ui-github')?.addEventListener('click', (e) => {
      flashPress(e.currentTarget as HTMLElement);
      this.game.sound.sfx('tick', 0.5);
      (window as unknown as { triggerAuth?: (p: string) => void }).triggerAuth?.('github');
    });
    document.getElementById('ui-twitter')?.addEventListener('click', (e) => {
      flashPress(e.currentTarget as HTMLElement);
      this.game.sound.sfx('tick', 0.5);
      (window as unknown as { triggerAuth?: (p: string) => void }).triggerAuth?.('twitter');
    });
    document.getElementById('ui-name-start')?.addEventListener('click', (e) => {
      if (!this.game.playerName.length) return;
      flashPress(e.currentTarget as HTMLElement);
      window.setTimeout(() => this.game.screens.finishName(), 110);
    });
    document.getElementById('ui-copy')?.addEventListener('click', (e) => {
      flashPress(e.currentTarget as HTMLElement);
      void this.game.screens.copyAgentLink();
    });
    document.getElementById('ui-chrome-ai')?.addEventListener('click', (e) => {
      flashPress(e.currentTarget as HTMLElement);
      this.game.sound.init();
      void this.game.chromeAgent.start();
    });
    document.getElementById('ui-no-codex')?.addEventListener('click', (e) => {
      flashPress(e.currentTarget as HTMLElement);
      this.agentTeaserDismissed = true;
      this.agentChooserOpen = true;
      this.lastSig = '';
      this.sync('connect');
    });
    document.getElementById('ui-agent-picker-close')?.addEventListener('click', () => {
      this.agentChooserOpen = false;
      this.agentTeaserDismissed = false;
      this.lastSig = '';
      this.sync('connect');
    });
    document.getElementById('ui-agent-picker')?.addEventListener('click', (e) => {
      if (e.target !== e.currentTarget) return;
      this.agentChooserOpen = false;
      this.agentTeaserDismissed = false;
      this.lastSig = '';
      this.sync('connect');
    });
    document.getElementById('ui-agent-option-chrome')?.addEventListener('click', (e) => {
      if (!this.game.chromeAgent.optionVisible || this.game.chromeAgent.active) return;
      flashPress(e.currentTarget as HTMLElement);
      this.agentChooserOpen = false;
      this.agentTeaserDismissed = true;
      this.game.sound.init();
      this.lastSig = '';
      void this.game.chromeAgent.start();
    });
    window.addEventListener('mm:chrome-agent-status', () => {
      this.lastSig = '';
      if (this.game.screen === 'connect') this.sync('connect');
    });
    document.getElementById('ui-play-again')?.addEventListener('click', (e) => {
      flashPress(e.currentTarget as HTMLElement);
      window.setTimeout(() => this.game.rematch(), 110);
    });
    document.getElementById('ui-exit-lb')?.addEventListener('click', (e) => {
      flashPress(e.currentTarget as HTMLElement);
      // "no rematch": tabulate the score (confetti only if every stage was beaten), then the leaderboard
      window.setTimeout(() => this.game.go('congrats'), 110);
    });
    document.getElementById('ui-congrats')?.addEventListener('click', () => {
      if (this.game.screens.idle > 4) {
        this.game.sound.stopBgm();
        this.game.go(this.game.isAgentPage ? 'connect' : 'title');
      }
    });
  }

  show(screen: string): void {
    this.bind();
    const root = document.getElementById('ui-root');
    if (!root) return;
    const humanHtml = HTML_SCREENS.has(screen) && !(screen === 'connect' && this.game.isAgentPage);
    root.hidden = !humanHtml;
    for (const id of ['ui-title', 'ui-menu', 'ui-name', 'ui-connect', 'ui-congrats', 'ui-rematch']) {
      const el = document.getElementById(id);
      if (el) el.hidden = !humanHtml || screen !== id.slice(3);
    }
    // id is ui-title → title after slice(3). ui-menu → menu. Good.
    // ui-name → name, ui-connect → connect, ui-congrats → congrats, ui-rematch → rematch.
    this.game.r.canvas.style.pointerEvents = humanHtml ? 'none' : '';
    if (this.authFx.active && screen !== 'name') this.authFx.stop();
    if (this.fx) {
      this.fx.hidden = !(screen === 'congrats' || this.authFx.active);
      // the verdict draws over the name screen (and swallows taps on success); the tally rain stays underneath
      this.fx.classList.toggle('ui-fx-front', this.authFx.active);
      this.fx.classList.toggle('ui-fx-catch', this.authFx.active && this.authFx.kind === 'ok');
    }
    if (screen !== this.lastScreen) {
      if (screen === 'connect') {
        this.agentChooserOpen = false;
        this.agentTeaserDismissed = false;
      }
      this.lastSig = '';
      this.lastScreen = screen;
      this.lastScale = 0;
      if (screen === 'congrats') this.rain.reset(window.innerWidth, window.innerHeight, this.game.beatAllStages ? 36 : 0);
      if (humanHtml) this.paintStatic(screen);
    }
    if (humanHtml) this.sync(screen);
  }

  tick(dt: number): void {
    const rain = this.game.screen === 'congrats';
    if ((!rain && !this.authFx.active) || !this.fx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    if (this.fx.width !== Math.round(w * dpr) || this.fx.height !== Math.round(h * dpr)) {
      this.fx.width = Math.round(w * dpr);
      this.fx.height = Math.round(h * dpr);
      this.fx.style.width = w + 'px';
      this.fx.style.height = h + 'px';
    }
    if (rain) this.rain.update(dt, w, h);
    this.authFx.update(dt, w, h);
    const ctx = this.fx.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (rain) this.rain.draw(ctx);
    this.authFx.draw(ctx, this.game.assets);
  }

  private paintStatic(screen: string): void {
    const font = this.font();
    const sc = uiScale();
    if (screen === 'title') {
      pxSpread(document.getElementById('ui-spread'), font, 'WEBMCP HACKATHON', 'white', sc);
      pxFill(document.getElementById('ui-presents'), font, 'PRESENTS', 'white', Math.max(1, sc - 1));
      pxFill(document.getElementById('ui-col-player'), font, 'PLAYER', 'orange', sc);
      pxFill(document.getElementById('ui-col-intel'), font, 'INTELLIGENCE', 'orange', sc);
    }
    if (screen === 'name') {
      pxFill(document.getElementById('ui-name-p1'), font, 'PLAYER 1', 'cyan', sc);
      pxFill(document.getElementById('ui-name-h'), font, 'ENTER YOUR NAME', 'cyan', sc);
      pxFill(document.getElementById('ui-oauth-hint'), font, 'USE YOUR USERNAME INSTEAD', 'cyan', Math.max(1, sc - 1));
      pxFill(document.getElementById('ui-github-label'), font, 'GITHUB', 'white', sc + 1);
      pxFill(document.getElementById('ui-twitter-label'), font, 'TWITTER', 'cyan', sc + 1);
      this.ensureKeys(font, sc);
    }
    if (screen === 'connect') {
      this.paintCopy(false, font, sc);
      pxFill(document.getElementById('ui-speech'), font, 'paste this into codex', 'white', 1);
      pxFill(document.getElementById('ui-connect-h'), font, 'CONNECT YOUR AGENT', 'cyan', sc);
      this.paintConnectBody(font, sc);
      this.paintChromeAgentButton(font, sc);
    }
    if (screen === 'rematch') {
      pxFill(document.getElementById('ui-play-again'), font, 'PLAY AGAIN', 'blue', sc);
      pxFill(document.getElementById('ui-exit-lb'), font, 'EXIT TO LEADERBOARD', 'white', Math.max(1, sc - 1));
    }
  }

  sync(screen: string): void {
    const font = this.font();
    const sc = uiScale();
    const blink = Math.floor(this.game.screens.blink * 3) % 2 === 0;
    if (sc !== this.lastScale) {
      this.lastScale = sc;
      this.lastSig = '';
      this.keysReady = false;
      this.paintStatic(screen);
    }
    if (screen === 'title') {
      const rows = this.game.rollers.slice(0, 5);
      const sig = rows.map((e) => `${e.rank}${e.name}${e.intelligence}`).join('|') + (blink ? '1' : '0');
      if (sig === this.lastSig) return;
      this.lastSig = sig;
      this.fillBoard(rows, font, sc);
      pxFill(document.getElementById('ui-press-start'), font, 'PRESS START', blink ? 'orange' : 'white', sc);
    }
    if (screen === 'menu') {
      const cur = this.game.screens.cursor;
      const sig = `${cur}|${blink ? 1 : 0}|${sc}`;
      if (sig === this.lastSig) return;
      this.lastSig = sig;
      this.paintMode(0, '1 PLAYER', cur === 0, font, sc);
      this.paintMode(1, '2 PLAYERS', cur === 1, font, sc);
    }
    if (screen === 'name') this.syncName(font, sc, blink);
    if (screen === 'connect') this.syncConnect(font, sc);
    if (screen === 'congrats') this.syncCongrats(font, sc);
    if (screen === 'rematch') this.syncRematch(font, sc);
  }

  private fillBoard(rows: { name?: string; intelligence?: string; rank?: number }[], font: BitmapFont, sc: number): void {
    const host = document.getElementById('ui-lb-rows');
    if (!host) return;
    host.replaceChildren();
    rows.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'ui-lb-row';
      const raw = String(e.name || '');
      const name = raw.slice(0, 12);
      const you = raw.toUpperCase() === this.game.playerName.toUpperCase() || raw.toUpperCase() === '@MACEIP' || i === 0;
      const intel = /agent|artificial/i.test(e.intelligence || '') ? 'Artificial' : 'Natural';
      const rank = document.createElement('div');
      rank.className = 'ui-lb-rank';
      rank.appendChild(pxCanvas(font, String(e.rank ?? i + 1), 'orange', sc));
      const nm = document.createElement('div');
      nm.className = 'ui-lb-name' + (you ? ' you' : '');
      nm.appendChild(pxCanvas(font, name, you ? 'cyan' : 'white', sc));
      const intelEl = document.createElement('div');
      intelEl.className = 'ui-lb-intel';
      intelEl.appendChild(pxCanvas(font, intel, 'white', sc));
      row.append(rank, nm, intelEl);
      host.appendChild(row);
    });
  }

  private paintMode(i: number, title: string, on: boolean, font: BitmapFont, sc: number): void {
    const btn = document.getElementById('ui-mode-' + i);
    if (!btn) return;
    btn.classList.toggle('on', on);
    const mark = document.createElement('span');
    mark.className = 'ui-mark';
    const marble = document.createElement('canvas');
    marble.width = 32; marble.height = 32;
    marble.className = 'ui-mode-marble';
    mark.appendChild(marble);
    this.paintKeyMarble(marble, on);
    const col = document.createElement('span');
    col.className = 'ui-mode-col';
    col.append(pxCanvas(font, title, 'white', sc + 1));
    btn.replaceChildren(mark, col);
  }

  private ensureKeys(font: BitmapFont, sc: number): void {
    const host = document.getElementById('ui-keys');
    if (!host) return;
    host.replaceChildren();
    this.keysReady = true;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 7; c++) {
        if (r === 3 && c > 6) continue;
        const label = (r === 3 && c === 5) ? 'RUB' : (r === 3 && c === 6) ? 'END' : (LETTERS[r][c] || '');
        if (!label) {
          const spacer = document.createElement('div');
          host.appendChild(spacer);
          continue;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ui-tap ui-key';
        btn.id = `ui-key-${r}-${c}`;
        btn.dataset.r = String(r);
        btn.dataset.c = String(c);
        const variant: FontVariant = label === 'RUB' ? 'orange' : label === 'END' ? 'cyan' : 'white';
        const marble = document.createElement('canvas');
        marble.className = 'ui-key-marble';
        marble.width = 32; marble.height = 32;
        btn.append(marble, pxCanvas(font, label, variant, label.length > 1 ? Math.max(1, sc - 1) : sc));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hitKey(r, c, btn);
        });
        host.appendChild(btn);
      }
    }
  }

  private hitKey(r: number, c: number, btn: HTMLElement): void {
    const g = this.game;
    g.screens.nameCur = { r, c };
    flashPress(btn);
    g.sound.sfx('tick', 0.45);
    if (r === 3 && c === 5) g.playerName = g.playerName.slice(0, -1);
    else if (r === 3 && c === 6) {
      if (g.playerName.length > 0) window.setTimeout(() => g.screens.finishName(), 110);
    } else {
      const ch = LETTERS[r][c];
      if (ch && g.playerName.length < 6 && !g.playerName.startsWith('@')) g.playerName += ch;
    }
    this.lastSig = '';
    this.sync('name');
  }

  private syncName(font: BitmapFont, sc: number, blink: boolean): void {
    if (!this.keysReady) this.ensureKeys(font, sc);
    const { r, c } = this.game.screens.nameCur;
    const sig = `${this.game.playerName}|${r},${c}|${this.game.screens.authPending}|${blink ? 1 : 0}|${sc}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    document.querySelectorAll('.ui-key').forEach((el) => {
      const on = (el as HTMLElement).dataset.r === String(r) && (el as HTMLElement).dataset.c === String(c);
      el.classList.toggle('on', on);
      const cv = el.querySelector('canvas.ui-key-marble') as HTMLCanvasElement | null;
      if (cv) this.paintKeyMarble(cv, on);
    });
    document.getElementById('ui-github')?.classList.toggle('on', this.game.screens.authPending === 'github');
    document.getElementById('ui-twitter')?.classList.toggle('on', this.game.screens.authPending === 'twitter');
    const isHandle = this.game.playerName.startsWith('@');
    const maxLen = isHandle ? 16 : 6;
    const shown = (this.game.playerName || '').toUpperCase().slice(0, maxLen);
    const blinkChar = blink ? '_' : ' ';
    const padded = isHandle ? shown : (shown + blinkChar).padEnd(6, '_');
    pxFill(document.getElementById('ui-name-val'), font, padded, 'orange', sc + 1);
    const start = document.getElementById('ui-name-start');
    if (start) {
      start.classList.toggle('dim', this.game.playerName.length === 0);
      pxFill(start, font, this.game.mode === 'ai' ? 'CONNECT AGENT' : 'START RACE', 'blue', sc);
    }
  }

  private paintKeyMarble(cv: HTMLCanvasElement, on: boolean): void {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!on) return;
    const sheet = this.game.assets.sheets.marble;
    if (!sheet) return;
    const f = FRAMES.marble.roll[Math.floor(this.game.screens.blink * 6) % 6];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, cv.width, cv.height);
  }

  private paintCopy(copied: boolean, font: BitmapFont, sc: number): void {
    const btn = document.getElementById('ui-copy');
    if (!btn) return;
    const label = document.createElement('span');
    label.className = 'ui-copy-callout';
    label.appendChild(pxCanvas(font, copied ? 'COPIED' : 'COPY TO CLIPBOARD', 'orange', Math.max(1, sc - 1)));
    const icon = document.createElement('img');
    icon.className = 'ui-copy-icon';
    icon.src = '/assets/screens/parts/copybutton.png';
    icon.alt = '';
    btn.replaceChildren(label, icon);
  }

  private paintChromeAgentButton(font: BitmapFont, sc: number): void {
    const btn = document.getElementById('ui-chrome-ai') as HTMLButtonElement | null;
    if (!btn) return;
    btn.hidden = true;
  }

  private paintAgentChooser(font: BitmapFont, sc: number): void {
    const agent = this.game.chromeAgent;
    const picker = document.getElementById('ui-agent-picker');
    const teaser = document.getElementById('ui-agent-teaser');
    const desktop = matchMedia('(pointer: fine)').matches && window.innerWidth >= 760;
    const showTeaser = desktop && this.game.screens.idle >= 30 && !this.agentTeaserDismissed &&
      !this.agentChooserOpen && !agent.active && !this.game.agentJoined;
    if (teaser) teaser.hidden = !showTeaser;
    if (picker) picker.hidden = !this.agentChooserOpen;

    if (showTeaser) {
      pxFill(document.getElementById('ui-no-codex'), font, "DON'T HAVE CODEX?", 'white', Math.max(1, sc - 1));
      this.paintSlippy(Math.floor(this.game.screens.blink * 5) % 2 === 0);
    }
    if (!this.agentChooserOpen) return;
    pxFill(document.getElementById('ui-agent-picker-title'), font, 'CHOOSE YOUR AGENT', 'cyan', sc);
    const chrome = document.getElementById('ui-agent-option-chrome') as HTMLButtonElement | null;
    if (chrome) {
      chrome.disabled = !agent.optionVisible || agent.active;
      const suffix = !agent.optionVisible ? ' - UNAVAILABLE'
        : agent.availability === 'downloadable' || agent.availability === 'downloading' ? ' - DOWNLOAD' : ' - READY';
      const label = 'CHROME AI' + suffix;
      chrome.setAttribute('aria-label', label);
      pxFill(chrome, font, label, agent.optionVisible ? 'orange' : 'lavender', Math.max(1, sc - 1));
    }
    pxFill(document.getElementById('ui-agent-option-llama'), font, 'LLAMA.CPP', 'lavender', Math.max(1, sc - 1));
    pxFill(document.getElementById('ui-agent-option-mtplx'), font, 'MTPLX', 'lavender', Math.max(1, sc - 1));
    pxFill(document.getElementById('ui-agent-picker-note'), font, 'LOCAL BRIDGE REQUIRED', 'lavender', 1);
  }

  private paintSlippy(mouthOpen: boolean): void {
    const cv = document.getElementById('ui-slippy') as HTMLCanvasElement | null;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, 48, 48);
    const rect = (x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    // Shoulders and flight suit.
    rect(10, 38, 28, 8, '#07132f'); rect(14, 36, 20, 8, '#346dce'); rect(20, 36, 8, 10, '#dcecff');
    // Frog head silhouette, cheeks, and snout.
    rect(8, 14, 32, 22, '#07132f'); rect(11, 11, 10, 8, '#07132f'); rect(27, 11, 10, 8, '#07132f');
    rect(10, 16, 28, 18, '#36b857'); rect(13, 12, 7, 9, '#50dc70'); rect(28, 12, 7, 9, '#50dc70');
    rect(7, 22, 7, 8, '#36b857'); rect(34, 22, 7, 8, '#36b857'); rect(14, 25, 20, 10, '#6ee883');
    rect(17, 27, 14, 5, '#8df49a');
    // Eyes and pupils.
    rect(13, 14, 7, 8, '#f7fff2'); rect(28, 14, 7, 8, '#f7fff2');
    rect(16, 16, 3, 5, '#081020'); rect(29, 16, 3, 5, '#081020'); rect(17, 16, 1, 2, '#4ec4ff'); rect(30, 16, 1, 2, '#4ec4ff');
    // Blue headset and microphone.
    rect(7, 15, 3, 14, '#1d66d8'); rect(38, 15, 3, 14, '#1d66d8'); rect(10, 9, 28, 3, '#2f8fff');
    rect(37, 27, 3, 6, '#2f8fff'); rect(34, 31, 5, 2, '#ffe019');
    // Talking mouth: two deliberately chunky frames.
    if (mouthOpen) { rect(19, 30, 10, 5, '#07101e'); rect(21, 33, 6, 2, '#e85a63'); }
    else { rect(18, 31, 12, 2, '#15341f'); rect(22, 30, 4, 1, '#f3f08a'); }
  }

  private paintConnectBody(font: BitmapFont, sc: number): void {
    const host = document.getElementById('ui-connect-body');
    if (!host) return;
    host.replaceChildren();
    const origin = (this.game.publicOrigin || location.origin).replace(/^https?:\/\//, '').replace(/\/$/, '');
    const lobby = this.game.lobbyId;
    const lines: { t: string; c: FontVariant }[][] = [
      [{ t: 'COPY + PASTE INTO CODEX:', c: 'white' }],
      [{ t: 'OPEN THIS URL IN YOUR', c: 'white' }],
      [{ t: 'BUILT-IN BROWSER:', c: 'white' }],
      [{ t: origin + '/', c: 'cyan' }],
      [{ t: lobby, c: 'cyan' }],
    ];
    const lineSc = Math.max(1, sc - 1);
    for (const parts of lines) {
      const row = document.createElement('div');
      row.className = 'ui-connect-line';
      for (const p of parts) row.appendChild(pxCanvas(font, p.t, p.c, lineSc));
      host.appendChild(row);
    }
  }

  private syncConnect(font: BitmapFont, sc: number): void {
    const copied = this.game.screens.copiedTimer > 0;
    const wait = this.game.chromeAgent.statusText || (this.game.agentJoined
      ? 'AGENT CONNECTED'
      : 'Waiting for agent to join' + '.'.repeat(1 + (Math.floor(this.game.screens.blink * 2) % 3)));
    const teaserReady = this.game.screens.idle >= 30 ? 1 : 0;
    const mouth = Math.floor(this.game.screens.blink * 5) % 2;
    const sig = `${copied ? 1 : 0}|${wait}|${sc}|${this.game.chromeAgent.buttonLabel}|${this.game.chromeAgent.optionVisible}|${teaserReady}|${this.agentChooserOpen ? 1 : 0}|${this.agentTeaserDismissed ? 1 : 0}|${mouth}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.paintCopy(copied, font, sc);
    this.paintChromeAgentButton(font, sc);
    this.paintAgentChooser(font, sc);
    pxFill(document.getElementById('ui-connect-wait'), font, wait, 'cyan', Math.max(1, sc - 1));
    this.paintConnectMarble();
  }

  private paintConnectMarble(): void {
    const cv = document.getElementById('ui-connect-marble') as HTMLCanvasElement | null;
    const sheet = this.game.assets.sheets.marble;
    if (!cv || !sheet) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const f = FRAMES.marble.roll[Math.floor(this.game.screens.blink * 8) % 6];
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, cv.width, cv.height);
  }

  private syncCongrats(font: BitmapFont, sc: number): void {
    const g = this.game;
    const sec = g.beatAllStages ? Math.floor(g.timeLeft) : 0;   // a time-up has no seconds-left bonus
    const dest = g.aiDestroyed;
    const dizzy = g.aiDizzied;
    const remain = Math.max(0, g.finalTally.total - g.finalTally.drained);
    const sig = `${g.playerName}|${g.score}|${g.deaths}|${sec}|${dest}|${dizzy}|${remain}|${sc}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const beat = g.beatAllStages;
    pxFill(document.getElementById('ui-win-h'), font, beat ? 'CONGRATULATIONS' : 'TIME UP', beat ? 'blue' : 'orange', sc);
    pxFill(document.getElementById('ui-win-who'), font, g.playerName || 'LEFT PLAYER', 'white', Math.max(1, sc - 1));
    pxFill(document.getElementById('ui-win-sub'), font, beat ? 'YOU HAVE COMPLETED' : 'YOU RAN OUT OF TIME ON', 'cyan', Math.max(1, sc - 1));
    pxFill(document.getElementById('ui-win-sub2'), font, beat ? 'THE ULTIMATE RACE' : `RACE ${g.stageIdx + 1}`, 'cyan', Math.max(1, sc - 1));
    const rows: [string, string][] = [
      ['BONUS FOR FINISHING', fmtScore(beat ? 20000 : 0)],
      [`${sec} SEC LEFT X 1000`, fmtScore(sec * 1000)],
      [`DIED ${g.deaths} TIMES X -1000`, `-${fmtScore(g.deaths * 1000)}`],
      [`DESTROYED ${dest} AI`, String(dest)],
      [`KNOCKED DIZZY ${dizzy}`, String(dizzy)],
      ['TOTAL', fmtScore(remain)],
    ];
    const host = document.getElementById('ui-win-rows');
    if (host) {
      host.replaceChildren();
      for (const [a, b] of rows) {
        const row = document.createElement('div');
        row.className = 'ui-win-row';
        row.append(pxCanvas(font, a, 'cyan', Math.max(1, sc - 1)), pxCanvas(font, b, 'orange', Math.max(1, sc - 1)));
        host.appendChild(row);
      }
    }
    pxFill(document.getElementById('ui-win-final'), font, `FINAL SCORE  ${fmtScore(g.score)}`, 'blue', sc);
  }

  private syncRematch(font: BitmapFont, sc: number): void {
    const g = this.game;
    const sig = `${g.wonLast}|${g.score}|${sc}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    pxFill(document.getElementById('ui-rematch-h'), font, g.wonLast ? 'YOU BEAT THE AGENT' : 'THE AGENT WON', g.wonLast ? 'orange' : 'white', sc);
    pxFill(document.getElementById('ui-rematch-score'), font, `SCORE ${fmtScore(g.score)}`, 'lavender', Math.max(1, sc - 1));
  }

  box(sel: string): { x: number; y: number; w: number; h: number; sel: string } | null {
    const el = document.querySelector(sel);
    const canvas = this.game.r.canvas;
    if (!el || !canvas) return null;
    const r = el.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, cr.width);
    const sy = canvas.height / Math.max(1, cr.height);
    return {
      x: Math.round((r.left - cr.left + r.width / 2) * sx),
      y: Math.round((r.top - cr.top + r.height / 2) * sy),
      w: Math.round(r.width * sx),
      h: Math.round(r.height * sy),
      sel,
    };
  }
}
