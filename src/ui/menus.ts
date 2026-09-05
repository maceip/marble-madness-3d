import type { Game } from '../game/game';
import type { BitmapFont } from '../engine/font';
import { fmtScore } from '../engine/font';
import { FRAMES } from '../engine/assets';
import { pxCanvas, pxFill, pxTint, pxFillTint, pxWords, uiScale, flashPress, UI } from './pixel';
import { MarbleRain } from './confetti';
import { AuthCelebration } from './auth_fx';

const LETTERS = ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', 'VWXYZ'];
const HTML_SCREENS = new Set(['title', 'menu', 'name', 'connect', 'congrats', 'rematch']);

/**
 * HTML overlays for every menu, composed to the conformance wireframes (docs/MANDATORY_CONFORMANCE):
 * bitmap font (sprites/font.png) on every label, headings one scale step above body copy, palette in UI.
 * Title = arcade HIGH ROLLERS board; menu = 1/2 PLAYERS with the marble cursor; name = NES letter grid with
 * the marble rolling onto the chosen letter; connect = the WebMCP prompt card; modals for the provider picker
 * and the rematch question; congrats = the NES ending tally + marble rain.
 */
export class HtmlMenus {
  private bound = false;
  private lastScreen = '';
  private lastSig = '';
  private lastScale = 0;
  private keysReady = false;
  private agentChooserOpen = false;
  private agentTeaserDismissed = false;
  private teaserShownAt = 0;
  private titleScale = 0;
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
    // Mode screen (wireframe): tapping 1 PLAYER / 2 PLAYERS rolls the marble cursor to it; PRESS START (or Enter) goes.
    for (const id of ['ui-mode-0', 'ui-mode-1']) {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = id.endsWith('0') ? 0 : 1;
        this.game.sound.init();
        if (this.game.screens.cursor !== i) this.game.sound.sfx('tick', 0.4);
        this.game.screens.cursor = i;
        this.lastSig = '';
        this.sync('menu');
      });
    }
    document.getElementById('ui-menu-press')?.addEventListener('click', (e) => {
      e.stopPropagation();
      flashPress(e.currentTarget as HTMLElement);
      this.game.sound.init();
      this.game.sound.sfx('item');
      window.setTimeout(() => { if (this.game.screen === 'menu') this.game.screens.chooseMode(this.game.screens.cursor); }, 120);
    });

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
    window.addEventListener('resize', () => { this.lastSig = ''; });
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
        this.teaserShownAt = 0;
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

  /** the atlas has no '#': the rank column header is drawn as an 8x8 glyph in the font's style */
  private hashGlyph(color: string, scale: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 8 * scale; c.height = 8 * scale;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    const rows = ['..#..#..', '..#..#..', '#######.', '..#..#..', '..#..#..', '#######.', '..#..#..', '..#..#..'];
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') ctx.fillRect(x * scale, y * scale, scale, scale); }));
    c.style.width = `${c.width}px`; c.style.height = `${c.height}px`; c.style.imageRendering = 'pixelated';
    c.setAttribute('aria-hidden', 'true');
    return c;
  }

  /** heading scale: one step above body copy (phone 2x, mid 3x, desktop 4x) */
  private hs(sc: number): number { return sc + 1; }
  /** small caption scale */
  private ss(sc: number): number { return Math.max(1, sc - 1); }

  private paintStatic(screen: string): void {
    const font = this.font();
    const sc = uiScale();
    document.getElementById('ui-root')?.style.setProperty('--sc', String(sc));
    if (screen === 'title') {
      pxFill(document.getElementById('ui-presents'), font, 'PRESENTS', 'white', 1);
      this.titleScale = 0;
    }
    if (screen === 'menu') {
      pxFill(document.getElementById('ui-menu-sub'), font, 'HUMAN VS AGENT', 'white', this.hs(sc));
      pxFillTint(document.getElementById('ui-menu-press'), font, 'PRESS START', UI.yellow, this.hs(sc));
    }
    if (screen === 'name') {
      pxFillTint(document.getElementById('ui-name-p1'), font, 'PLAYER 1', UI.blue, this.hs(sc));
      pxFillTint(document.getElementById('ui-name-h'), font, 'ENTER YOUR NAME.', UI.blue, this.hs(sc));
      pxFillTint(document.getElementById('ui-oauth-hint'), font, 'USE YOUR USERNAME INSTEAD', UI.blue, this.ss(sc));
      this.ensureKeys(font, sc);
    }
    if (screen === 'connect') {
      this.paintCopy(false, font, sc);
      pxFillTint(document.getElementById('ui-connect-h'), font, 'CONNECT YOUR AGENT', UI.blue, this.hs(sc));
      this.paintConnectBody(font, sc);
      pxFillTint(document.getElementById('ui-dots-l'), font, '...', UI.blue, this.hs(sc));
      pxFillTint(document.getElementById('ui-dots-r'), font, '...', UI.blue, this.hs(sc));
      this.paintChromeAgentButton(font, sc);
    }
    if (screen === 'rematch') {
      this.paintFlags();
      pxWords(document.getElementById('ui-rematch-h'), font, 'WOULD YOU LIKE TO CHALLENGE THE AI AGAIN?', UI.white, this.hs(sc));
      pxFillTint(document.getElementById('ui-play-again'), font, 'YES', UI.yellow, this.hs(sc));
      pxFillTint(document.getElementById('ui-exit-lb'), font, 'NO', UI.blue, this.hs(sc));
      pxFillTint(document.getElementById('ui-rematch-score'), font, 'SAME TRACK. HIGHER INTELLIGENCE.', UI.blue, this.ss(sc));
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
      const rows = this.game.rollers.slice(0, 10);
      const sig = rows.map((e) => `${e.rank}${e.name}${e.score}${e.intelligence}`).join('|') + (blink ? '1' : '0');
      if (sig === this.lastSig) return;
      this.lastSig = sig;
      this.fillBoard(rows, font, sc);
      pxFillTint(document.getElementById('ui-press-start'), font, 'PRESS START', blink ? UI.gold : UI.white, Math.max(2, this.titleScale || sc));
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

  /** largest scale <= preferred at which `chars` glyphs fit in `maxPx` (never below `min`) */
  private fitScale(chars: number, maxPx: number, preferred: number, min = 1): number {
    let s = preferred;
    while (s > min && chars * 8 * s > maxPx) s--;
    return s;
  }

  private fillBoard(rows: { name?: string; intelligence?: string; rank?: number; score?: number }[], font: BitmapFont, sc: number): void {
    const host = document.getElementById('ui-lb-rows');
    if (!host) return;
    const lb = host.parentElement;   // .ui-lb
    // 4 columns (# PLAYER SCORE INTELLIGENCE) must fit the board: 2 + 10 + 7 + 12 glyphs plus 3 column gaps (--lbgap glyphs)
    const width = lb?.clientWidth || window.innerWidth * 0.92;
    const gap = lb ? parseFloat(getComputedStyle(lb).getPropertyValue('--lbgap')) || 1.2 : 1.2;
    const ts = this.fitScale(31 + 3 * gap, width, sc);
    lb?.style.setProperty('--glyph', `${8 * ts}px`);
    if (ts !== this.titleScale) {      // heading + PRESS START stay one step above the table
      this.titleScale = ts;
      pxFillTint(document.getElementById('ui-lb-title'), font, 'HIGH ROLLERS', UI.blue, this.hs(ts));
    }
    document.getElementById('ui-col-rank')?.replaceChildren(this.hashGlyph(UI.gold, ts));
    pxFillTint(document.getElementById('ui-col-player'), font, 'PLAYER', UI.gold, ts);
    pxFillTint(document.getElementById('ui-col-score'), font, 'SCORE', UI.gold, ts);
    pxFillTint(document.getElementById('ui-col-intel'), font, 'INTELLIGENCE', UI.gold, ts);
    host.replaceChildren();
    rows.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'ui-lb-row';
      const raw = String(e.name || '');
      const name = raw.replace(/^@/, '').toUpperCase().slice(0, 10);   // the font has no '@'
      const top = i === 0;                                                         // the wireframe picks out the #1 roller
      const color = top ? UI.cyan : UI.white;
      const intel = /agent|artificial/i.test(e.intelligence || '') ? 'ARTIFICIAL' : 'NATURAL';
      const rank = document.createElement('div');
      rank.className = 'ui-lb-rank';
      rank.appendChild(pxTint(font, String(e.rank ?? i + 1), UI.gold, ts));
      const nm = document.createElement('div');
      nm.className = 'ui-lb-name' + (top ? ' you' : '');
      nm.appendChild(pxTint(font, name, color, ts));
      const score = document.createElement('div');
      score.className = 'ui-lb-score';
      score.appendChild(pxTint(font, fmtScore(Math.max(0, Math.round(e.score ?? 0))), color, ts));
      const intelEl = document.createElement('div');
      intelEl.className = 'ui-lb-intel';
      intelEl.appendChild(pxTint(font, intel, color, ts));
      row.append(rank, nm, score, intelEl);
      host.appendChild(row);
    });
  }

  private paintMode(i: number, title: string, on: boolean, font: BitmapFont, sc: number): void {
    const btn = document.getElementById('ui-mode-' + i);
    if (!btn) return;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const mark = document.createElement('span');
    mark.className = 'ui-mark';
    const marble = document.createElement('canvas');
    marble.width = 32; marble.height = 32;
    marble.className = 'ui-mode-marble';
    mark.appendChild(marble);
    this.paintMarble(marble, on);
    const col = document.createElement('span');
    col.className = 'ui-mode-col';
    col.append(pxCanvas(font, title, 'white', this.hs(sc)));
    btn.replaceChildren(mark, col);
  }

  private ensureKeys(font: BitmapFont, sc: number): void {
    const host = document.getElementById('ui-keys');
    if (!host) return;
    host.replaceChildren();
    this.keysReady = true;
    const letterScale = this.hs(sc);
    const wideScale = sc === 1 ? 2 : sc;          // RUB / END: 3 glyphs must stay inside one cell
    const wideSpacing = sc === 1 ? -1 : 0;        // ...and on phones they tuck in by a pixel per glyph
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 7; c++) {
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
        btn.setAttribute('aria-label', label);
        const glyphs = label === 'RUB' ? pxTint(font, label, UI.gold, wideScale, wideSpacing)
          : label === 'END' ? pxTint(font, label, UI.cyan, wideScale, wideSpacing)
          : pxCanvas(font, label, 'white', letterScale);
        btn.append(glyphs);
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
    const sig = `${this.game.playerName}|${r},${c}|${this.game.screens.authPending}|${blink ? 1 : 0}|${sc}|${window.innerWidth}x${window.innerHeight}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    document.querySelectorAll('.ui-key').forEach((el) => {
      const on = (el as HTMLElement).dataset.r === String(r) && (el as HTMLElement).dataset.c === String(c);
      el.classList.toggle('on', on);
      el.setAttribute('aria-current', on ? 'true' : 'false');
    });
    this.placeNameMarble(r, c);
    document.getElementById('ui-github')?.classList.toggle('on', this.game.screens.authPending === 'github');
    document.getElementById('ui-twitter')?.classList.toggle('on', this.game.screens.authPending === 'twitter');
    const isHandle = this.game.playerName.startsWith('@');
    const maxLen = isHandle ? 16 : 6;
    const shown = (this.game.playerName || '').replace(/^@/, '').toUpperCase().slice(0, maxLen);   // the font has no '@'
    const cursor = !isHandle && shown.length < maxLen ? (blink ? '_' : ' ') : '';
    pxFillTint(document.getElementById('ui-name-val'), font, shown + cursor, UI.yellow, this.hs(sc));
    const start = document.getElementById('ui-name-start');
    if (start) {
      start.classList.toggle('dim', this.game.playerName.length === 0);
      pxFill(start, font, this.game.mode === 'ai' ? 'CONNECT AGENT' : 'START RACE', 'blue', sc);
    }
  }

  /** The marble is the cursor (NES name entry): it rolls to the chosen letter and sits behind it. */
  private placeNameMarble(r: number, c: number): void {
    const cv = document.getElementById('ui-name-marble') as HTMLCanvasElement | null;
    const key = document.getElementById(`ui-key-${r}-${c}`);
    const wrap = cv?.parentElement;
    if (!cv || !key || !wrap) return;
    const kr = key.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), mr = cv.getBoundingClientRect();
    const size = mr.width || cv.clientWidth;
    const x = kr.left - wr.left + kr.width / 2 - size / 2;
    const y = kr.top - wr.top + kr.height / 2 - size / 2;
    cv.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.paintMarble(cv, true);
  }

  /** the rolling marble sprite on a small canvas (cursor marks, loaders, dividers) */
  private paintMarble(cv: HTMLCanvasElement, on: boolean, speed = 6): void {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!on) return;
    const sheet = this.game.assets.sheets.marble;
    if (!sheet) return;
    const f = FRAMES.marble.roll[Math.floor(this.game.screens.blink * speed) % 6];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, cv.width, cv.height);
  }

  private paintCopy(copied: boolean, font: BitmapFont, sc: number): void {
    const btn = document.getElementById('ui-copy');
    if (!btn) return;
    const label = document.createElement('span');
    label.className = 'ui-copy-callout';
    label.appendChild(pxTint(font, copied ? 'COPIED!' : 'COPY PROMPT', UI.yellow, sc));
    const frame = document.createElement('span');
    frame.className = 'ui-copy-frame';
    const icon = document.createElement('img');
    icon.className = 'ui-copy-icon';
    icon.src = '/assets/screens/parts/copybutton_yellow.png';   // the supplied clipboard recoloured to the reference yellow
    icon.alt = '';
    frame.appendChild(icon);
    btn.replaceChildren(label, frame);
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
    // free band between the connect copy and the settings bar: 300 px fits the full mascot + bubble, 220 the compact pair
    const box = document.querySelector('#ui-connect .ui-connect-box')?.getBoundingClientRect();
    const free = box ? window.innerHeight - box.bottom - 50 : 0;
    const size = free >= 250 ? 'full' : free >= 190 ? 'compact' : 'none';
    const showTeaser = desktop && size !== 'none' && this.game.screens.idle >= 30 && !this.agentTeaserDismissed &&
      !this.agentChooserOpen && !agent.active && !this.game.agentJoined;
    if (teaser) { teaser.hidden = !showTeaser; teaser.classList.toggle('compact', size === 'compact'); }
    if (picker) picker.hidden = !this.agentChooserOpen;

    // REMOVE_SLIPPY: the marble mascot springs in, then (0.6 s later) asks in its speech bubble; the bubble is the button
    const mascot = document.getElementById('ui-mascot');
    const bubble = document.getElementById('ui-no-codex');
    if (showTeaser) {
      if (!this.teaserShownAt) this.teaserShownAt = performance.now();
      mascot?.classList.remove('hidden');
      const askNow = performance.now() - this.teaserShownAt >= 600;
      if (bubble) {
        if (!bubble.childElementCount) bubble.appendChild(pxTint(font, "DON'T HAVE CODEX?", '#000000', 2));
        bubble.classList.toggle('hidden', !askNow);
      }
    } else {
      this.teaserShownAt = 0;
      bubble?.classList.add('hidden');
      mascot?.classList.add('hidden');
    }
    if (!this.agentChooserOpen) return;
    pxFillTint(document.getElementById('ui-agent-picker-title'), font, sc === 1 ? 'SELECT LOCAL MODEL' : 'SELECT LOCAL MODEL PROVIDER', UI.blue, 2);
    const chrome = document.getElementById('ui-agent-option-chrome') as HTMLButtonElement | null;
    const optScale = Math.max(2, sc);
    const option = (btn: HTMLElement | null, icon: 'chrome' | 'llama' | 'mtplx', label: string, enabled: boolean, tag = '') => {
      if (!btn) return;
      const ic = document.createElement('span');
      ic.className = 'ui-agent-icon' + (icon === 'chrome' ? ' ui-agent-icon-chrome' : '');
      if (icon === 'llama') ic.innerHTML = '<svg viewBox="0 0 16 16"><path d="M5 2h3v2h1v1h2v3h1v2h-1v2h-1v2h-2v-2H7v2H5v-2H4v-2H3V9h1V6h1V3h0z"/></svg>';
      if (icon === 'mtplx') ic.innerHTML = '<svg viewBox="0 0 16 16"><path d="M8 1l6 3.5v7L8 15 2 11.5v-7L8 1zm0 2.3L4.2 5.5 8 7.7l3.8-2.2L8 3.3zM4 7.2v3.2l3 1.7V9L4 7.2zm8 0L9 9v3.1l3-1.7V7.2z"/></svg>';
      btn.replaceChildren(ic, pxCanvas(font, label, enabled ? 'white' : 'lavender', optScale));
      if (tag) {
        const t = document.createElement('span');
        t.className = 'ui-agent-tag';
        t.appendChild(pxCanvas(font, tag, 'lavender', 1));
        btn.appendChild(t);
      }
    };
    if (chrome) {
      chrome.disabled = !agent.optionVisible || agent.active;
      const tag = !agent.optionVisible ? 'UNAVAILABLE'
        : agent.availability === 'downloadable' || agent.availability === 'downloading' ? 'DOWNLOAD' : '';
      chrome.setAttribute('aria-label', 'CHROME AI' + (tag ? ' - ' + tag : ''));
      chrome.classList.toggle('on', agent.optionVisible && !agent.active);
      option(chrome, 'chrome', 'CHROME AI', agent.optionVisible, tag);
    }
    const bridge = sc === 1 ? 'BRIDGE' : 'LOCAL BRIDGE';
    option(document.getElementById('ui-agent-option-llama'), 'llama', 'LLAMA.CPP', false, bridge);
    option(document.getElementById('ui-agent-option-mtplx'), 'mtplx', 'MTPLX', false, bridge);
    const selected = document.getElementById('ui-agent-selected');
    if (selected) {
      const ic = document.createElement('span'); ic.className = 'ui-agent-icon ui-agent-icon-chrome';
      const caret = document.createElement('span'); caret.className = 'ui-agent-caret';
      selected.replaceChildren(ic, pxCanvas(font, 'CHROME AI', 'white', optScale), caret);
    }
    pxFillTint(document.getElementById('ui-agent-picker-note'), font, 'RUN LOCALLY. PLAY ANYWHERE.', UI.blue, this.ss(sc));
    const deco = document.getElementById('ui-agent-deco');
    if (deco) {
      const marble = document.createElement('canvas');
      marble.className = 'ui-deco-marble'; marble.width = 32; marble.height = 32;
      this.paintMarble(marble, true);
      deco.replaceChildren(pxTint(font, '//', UI.blue, 2), marble, pxTint(font, '//', UI.blue, 2));
    }
  }

  private paintConnectBody(font: BitmapFont, sc: number): void {
    const host = document.getElementById('ui-connect-body');
    if (!host) return;
    host.replaceChildren();
    const origin = (this.game.publicOrigin || location.origin).replace(/\/$/, '').toUpperCase();
    const lobby = this.game.lobbyId.toUpperCase();
    // the lobby id is part of the URL the agent must open; the font is uppercase-only
    const lines: { t: string; c: string }[][] = [
      [{ t: 'OPEN', c: UI.white }],
      [{ t: origin + '/', c: UI.cyan }],
      [{ t: lobby, c: UI.cyan }],
      [{ t: 'IN YOUR EMBEDDED BROWSER', c: UI.white }],
      [{ t: 'AND USE WEBMCP TO CHALLENGE', c: UI.white }],
      [{ t: 'AND BEAT YOUR HUMAN OPPONENT.', c: UI.white }],
    ];
    // the URL / lobby id cannot wrap: the whole body steps down a size when they would not fit
    const longest = Math.max(...lines.map((l) => l.reduce((n, p) => n + p.t.length, 0)));
    const bodyScale = this.fitScale(longest, (host.parentElement?.clientWidth || window.innerWidth * 0.94), sc);
    for (const parts of lines) {
      const row = document.createElement('div');
      row.className = 'ui-connect-line';
      for (const p of parts) row.appendChild(pxTint(font, p.t, p.c, bodyScale));
      host.appendChild(row);
    }
  }

  private syncConnect(font: BitmapFont, sc: number): void {
    const copied = this.game.screens.copiedTimer > 0;
    const wait = this.game.chromeAgent.statusText || (this.game.agentJoined
      ? 'AGENT CONNECTED'
      : 'WAITING FOR AGENT TO JOIN' + '.'.repeat(1 + (Math.floor(this.game.screens.blink * 2) % 3)));
    const teaserReady = this.game.screens.idle >= 30 ? 1 : 0;
    const ask = this.teaserShownAt && performance.now() - this.teaserShownAt >= 600 ? 1 : 0;
    const marbleFrame = Math.floor(this.game.screens.blink * 8) % 6;
    const sig = `${copied ? 1 : 0}|${wait}|${sc}|${this.game.chromeAgent.buttonLabel}|${this.game.chromeAgent.optionVisible}|${teaserReady}|${ask}|${this.agentChooserOpen ? 1 : 0}|${this.agentTeaserDismissed ? 1 : 0}|${marbleFrame}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.paintCopy(copied, font, sc);
    this.paintChromeAgentButton(font, sc);
    this.paintAgentChooser(font, sc);
    // one line where it fits (tablets/desktops step down one size for it); phones wrap at heading size
    const waitEl = document.getElementById('ui-connect-wait');
    const waitScale = sc >= 2 ? this.fitScale(wait.length, waitEl?.parentElement?.clientWidth || window.innerWidth * 0.94, this.hs(sc), sc) : this.hs(sc);
    pxWords(waitEl, font, wait.toUpperCase(), UI.blue, waitScale);
    const cv = document.getElementById('ui-connect-marble') as HTMLCanvasElement | null;
    if (cv) this.paintMarble(cv, true, 8);
  }

  /** two crossed checkered flags (blue / white, like the wireframe) for the rematch modal, drawn as pixel art */
  private paintFlags(): void {
    const host = document.getElementById('ui-flags');
    if (!host) return;
    host.replaceChildren();
    const cv = document.createElement('canvas');
    const W = 64, H = 44;                        // logical pixel grid; CSS scales it up crisply
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    // one flag: the pole leans inward from its top corner so the pair crosses like an X; the checkered
    // field (6x4 cells of 3px, 1px wave on the free columns) hangs outward from the top of the pole
    const flag = (mirror: boolean) => {
      const px = (x: number, y: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(mirror ? W - 1 - x : x, y, 1, 1); };
      for (let i = 0; i < 40; i++) { const x = 27 + Math.round(i * 0.4), y = 2 + i; px(x, y, '#ffffff'); px(x + 1, y, '#8fc4ff'); }
      for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 6; cx++) {
        const wave = cx <= 1 ? 1 : 0;
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
          px(8 + cx * 3 + dx, 3 + cy * 3 + dy + wave, (cx + cy) % 2 ? '#5ab4ff' : '#ffffff');
        }
      }
      for (let y = 4; y < 16; y++) px(7, y, '#0b2a55');   // free edge outline so it reads against black
    };
    flag(false);
    flag(true);
    host.appendChild(cv);
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
    const frame = Math.floor(g.screens.blink * 6) % 6;
    const sig = `${g.wonLast}|${g.score}|${sc}|${frame}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const cv = document.getElementById('ui-rematch-marble') as HTMLCanvasElement | null;
    if (cv) this.paintMarble(cv, true);
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
