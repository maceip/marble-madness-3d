import type { Game, Screen } from './game';
import { VIEW_W, VIEW_H } from '../engine/constants';
import { fmtScore, type FontVariant } from '../engine/font';
import { FRAMES } from '../engine/assets';
import { isFold, foldInset } from '../engine/layout';
import { HtmlMenus } from '../ui/menus';
import { colorVariant } from '../ui/pixel';

const LETTERS = ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', 'VWXYZ'];
const NAME_MAX = 6;

/** Menu / title screens drawn with the bitmap font, matching the NES flow. */
export class Screens {
  cursor = 0;
  nameCur = { r: 0, c: 0 };
  blink = 0;
  idle = 0;
  rain: { x: number; y: number; vy: number; c: number }[] = [];
  bounce: { x: number; y: number; vx: number; vy: number; c: number; sz: number }[] = [];
  html: HtmlMenus;

  constructor(private g: Game) { this.html = new HtmlMenus(g); }

  menuDelay = 0;
  authPending: 'github' | 'twitter' | null = null;
  authCancelTimer = 0;
  authSuccessTimer = 0;

  setAuthPending(provider: 'github' | 'twitter'): void {
    this.authPending = provider;
    this.authCancelTimer = 0;
    this.authSuccessTimer = 0;
  }

  startAuthCancelTimer(seconds = 2.0): void {
    if (this.authPending) {
      this.authCancelTimer = seconds;
    }
  }

  clearAuthPending(): void {
    this.authPending = null;
    this.authCancelTimer = 0;
    localStorage.removeItem('mm_auth_nonce');
  }

  onAuthSuccess(handle: string): void {
    this.authPending = null;
    this.authCancelTimer = 0;
    this.g.playerName = handle;
    this.g.sound.sfx('item');
    if (this.g.screen === 'name') {
      // Show prefilled handle and proceed to game after brief 500ms confirmation
      this.authSuccessTimer = 0.5;
    }
  }

  enter(screen: Screen): void {
    this.idle = 0;
    if (screen === 'menu') {
      this.cursor = 0;
      this.menuDelay = 0.35; // Input debounce so dismissing title doesn't instantly pick 1P
    }
    if (screen === 'name') {
      this.nameCur = { r: 3, c: 3 }; // Hover on Y as shown in pickname.png
      if (!this.g.playerName) this.g.playerName = '';
    }
    if (screen === 'control') this.cursor = 1;
    if (screen === 'congrats') {
      this.rain = [];
      for (let i = 0; i < 26; i++) this.rain.push({ x: Math.random() * VIEW_W, y: -Math.random() * VIEW_H, vy: 30 + Math.random() * 50, c: Math.floor(Math.random() * 6) });
    }
    if (screen === 'gameover') { void this.g.submitScore(); }
    if (screen === 'rematch') { void this.g.submitScore(); this.initBounce(); }
    if (screen === 'title') this.initBounce();   // leaderboard shows the bouncing-marbles celebration
    this.html.show(screen);
  }

  copiedTimer = 0;

  // ---- retro chunky button-press feedback ----------------------------------------------------------------
  // Every non-gameplay tap target routes through tapButton(): it flashes a depress animation on the element and
  // (for screen-changing buttons) runs the action a beat later so the press is actually visible before we leave.
  private press: { key: string; t: number } | null = null;
  private pendingAction: (() => void) | null = null;
  private readonly PRESS_DUR = 0.12;

  /** press intensity for a given element key: 1 = fully depressed, eases to 0 */
  pressAmt(key: string): number {
    if (!this.press || this.press.key !== key) return 0;
    return Math.max(0, Math.min(1, this.press.t / this.PRESS_DUR));
  }
  /** flash a press on `key`; run `action` immediately (in-place edits) or deferred (screen changes) */
  private tapButton(key: string, action: () => void, immediate = false): void {
    if (this.pendingAction) return;                 // ignore taps while a deferred press is resolving
    this.g.sound.sfx('tick', 0.5);
    this.press = { key, t: this.PRESS_DUR };
    if (immediate) action(); else this.pendingAction = action;
  }
  private tickPress(dt: number): void {
    if (!this.press) return;
    this.press.t -= dt;
    if (this.press.t <= 0) { this.press = null; const a = this.pendingAction; this.pendingAction = null; if (a) a(); }
  }
  /** draw a retro chunky button (raised face over a darker base; depresses when pressed). returns the face's
   *  vertical offset so the caller can place its label on the face. */
  private chunkyBtn(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, key: string,
    face: string, base: string, edge: string, radius = 10): number {
    const depth = Math.max(3, Math.min(Math.round(h * 0.16), 10));
    const oy = Math.round(this.pressAmt(key) * depth);
    ctx.fillStyle = base;                                   // base/shadow block
    ctx.beginPath(); ctx.roundRect(x, y + depth, w, h, radius); ctx.fill();
    ctx.fillStyle = face;                                   // raised face (slides down to the base when pressed)
    ctx.beginPath(); ctx.roundRect(x, y + oy, w, h, radius); ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y + oy, w, h, radius); ctx.stroke();
    return oy;
  }

  chooseMode(idx: number): void {
    const g = this.g;
    g.sound.sfx('item');
    g.mode = (idx === 0) ? '1p' : 'ai';
    // Mode selection always proceeds to Pick Name screen (the final screen before playing)
    g.go('name');
  }

  async copyAgentLink(): Promise<void> {
    const g = this.g;
    const origin = g.publicOrigin || location.origin;
    const url = `${origin}/${g.lobbyId}`;
    const text = `Marble Madness 2-player challenge:
${url}

Open the link in your embedded browser. WebMCP registers automatically.
1. Call set_name once.
2. Wait for race_start with wait_for_race_event.
3. Steer with spin_trackball; counter-spin to brake.
4. After race_end, keep the page open. PLAY AGAIN starts the rematch.`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    this.copiedTimer = 2.4;
    g.sound.sfx('item');
  }

  update(dt: number): void {
    const g = this.g;
    this.blink += dt; this.idle += dt;
    this.tickPress(dt);
    this.html.tick(dt);
    if (g.screen === 'title' || g.screen === 'rematch') this.updateBounce(dt);
    if (this.copiedTimer > 0) this.copiedTimer -= dt;
    if (this.authCancelTimer > 0) {
      this.authCancelTimer -= dt;
      if (this.authCancelTimer <= 0) this.clearAuthPending();
    }
    if (this.authSuccessTimer > 0) {
      this.authSuccessTimer -= dt;
      if (this.authSuccessTimer <= 0) this.finishName();
    }
    const presses = g.input.takePresses();
    const clicks = g.input.takeClicks();
    const any = presses.length > 0 || clicks.length > 0;
    switch (g.screen) {
      case 'title':
        // the single leaderboard/attract screen (shown once before gameplay; returned to once after).
        if (any) { g.sound.init(); g.sound.sfx('item'); g.go('menu'); }
        break;
      case 'menu': {
        if (this.menuDelay > 0) {
          this.menuDelay -= dt;
          break;
        }
        for (const p of presses) {
          if (p === 'ArrowUp' || p === 'KeyW' || p === 'ArrowDown' || p === 'KeyS') {
            this.cursor = 1 - this.cursor;
            g.sound.sfx('tick', 0.4);
          }
          if (p === 'Enter' || p === 'Space') {
            this.chooseMode(this.cursor);
            return;
          }
          if (p === 'Escape') { g.go('title'); return; }
        }
        for (const clk of clicks) {
          const a = this.html.box('#ui-mode-0'), b = this.html.box('#ui-mode-1');
          const start = this.html.box('#ui-menu-press');
          if (a && Math.abs(clk.x - a.x) <= a.w / 2 && Math.abs(clk.y - a.y) <= a.h / 2) { this.cursor = 0; g.sound.sfx('tick', 0.4); return; }
          if (b && Math.abs(clk.x - b.x) <= b.w / 2 && Math.abs(clk.y - b.y) <= b.h / 2) { this.cursor = 1; g.sound.sfx('tick', 0.4); return; }
          if (start && Math.abs(clk.x - start.x) <= start.w / 2 && Math.abs(clk.y - start.y) <= start.h / 2) { this.chooseMode(this.cursor); return; }
        }
        break;
      }
      case 'name': this.updateName(presses, clicks); break;
      case 'control': {
        for (const p of presses) {
          if (p === 'ArrowUp' || p === 'ArrowDown' || p === 'KeyW' || p === 'KeyS') { this.cursor = 1 - this.cursor; g.sound.sfx('tick', 0.4); }
          if (p === 'Enter' || p === 'Space') this.chooseControl();
          if (p === 'Escape') g.go('menu');
        }
        for (const clk of clicks) {
          const L = this.controlLayout();   // tap directly on A or B (all sizes) selects that option and proceeds
          for (let i = 0; i < 2; i++) {
            if (clk.x >= L.optX && clk.x <= L.optX + L.optW && Math.abs(clk.y - L.cy[i]) <= L.optH / 2 + L.ch * 0.02) { this.cursor = i; this.tapButton('opt' + i, () => this.chooseControl()); break; }
          }
        }
        break;
      }
      case 'connect': {
        if (g.isAgentPage) break;                 // the agent has nothing to do here but wait
        for (const p of presses) {
          if (p === 'Escape') g.go('menu');
          if (p === 'KeyC' || p === 'Space' || p === 'Enter') void this.copyAgentLink();
        }
        for (const clk of clicks) {
          const L = this.connectLayout();   // native copy-link button rect (matches the renderer)
          if ((clk.x >= L.copyX && clk.x <= L.copyX + L.copyW && clk.y >= L.copyY && clk.y <= L.copyY + L.copyH) ||
              (clk.y >= L.urlY && clk.y <= L.urlY + Math.round(L.S * 0.075))) this.tapButton('copy', () => { void this.copyAgentLink(); }, true);
        }
        break;
      }
      case 'gameover':
        if (this.idle > 4 || any) g.go(g.isAgentPage ? 'connect' : 'title');   // the agent returns to the lobby, never to the menus
        break;
      case 'congrats': {
        for (const m of this.rain) { m.y += m.vy * dt; if (m.y > VIEW_H + 10) { m.y = -12; m.x = Math.random() * VIEW_W; } }
        const tally = g.finalTally;
        if (this.idle > 2.5 && tally.drained < tally.total) {
          const step = Math.min(tally.total - tally.drained, Math.ceil(tally.total * dt / 3 / 100) * 100);
          tally.drained += step; g.score += step;
        }
        if (this.idle > 2.5 && tally.drained >= tally.total && !this.g.scoreSubmitted) { void g.submitScore(); }
        if ((any && this.idle > 4) || this.idle > 30) { g.sound.stopBgm(); g.go(g.isAgentPage ? 'connect' : 'title'); }
        break;
      }
      case 'rematch': {
        // 2P post-race: PLAY AGAIN challenges the agent again; EXIT shows the leaderboard (with bouncing marbles)
        for (const clk of clicks) {
          const L = this.rematchLayout();
          if (clk.x >= L.btnX && clk.x <= L.btnX + L.btnW && clk.y >= L.y0 && clk.y <= L.y0 + L.btnH) { this.tapButton('playAgain', () => g.rematch()); return; }
          if (clk.x >= L.btnX && clk.x <= L.btnX + L.btnW && clk.y >= L.y1 && clk.y <= L.y1 + L.btnH) { this.tapButton('exit', () => g.go('title')); return; }
        }
        for (const p of presses) {
          if (p === 'Enter' || p === 'Space') { g.sound.sfx('item'); g.rematch(); return; }
          if (p === 'Escape') { g.go('title'); return; }
        }
        break;
      }
      default: break;
    }
  }

  private updateName(presses: string[], clicks: { x: number; y: number }[]): void {
    const g = this.g;

    if (this.authPending) {
      for (const p of presses) {
        if (p === 'Escape') {
          this.clearAuthPending();
          return;
        }
      }
      return;
    }

    if (this.authSuccessTimer > 0) {
      if (presses.length > 0 || clicks.length > 0) {
        this.finishName();
        return;
      }
    }

    // Handle clicks (native layout, all sizes — same geometry the renderer uses)
    for (const clk of clicks) {
      const L = this.nameLayout();
      const cw = L.cw;
      // GitHub / Twitter buttons
      if (clk.x >= L.ghX && clk.x <= L.ghX + L.btnW && clk.y >= L.btnY && clk.y <= L.btnY + L.btnH) {
        this.tapButton('github', () => { (window as any).triggerAuth?.('github'); }); return;
      }
      if (clk.x >= L.twX && clk.x <= L.twX + L.btnW && clk.y >= L.btnY && clk.y <= L.btnY + L.btnH) {
        this.tapButton('twitter', () => { (window as any).triggerAuth?.('twitter'); }); return;
      }

      let hitGrid = false;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 7; c++) {
          const bx = L.gridLeft + c * L.cellW, by = L.gridTop + r * L.cellH;
          if (clk.x >= bx && clk.x <= bx + L.cellW && clk.y >= by && clk.y <= by + L.cellH) {
            hitGrid = true;
            this.nameCur = { r, c };
            const key = `cell_${r}_${c}`;
            if (r === 3 && c === 5) this.tapButton(key, () => { g.playerName = g.playerName.slice(0, -1); }, true);           // RUB
            else if (r === 3 && c === 6) this.tapButton(key, () => { if (g.playerName.length > 0) this.finishName(); });      // END (deferred -> press shows)
            else { const cc = LETTERS[r][c]; this.tapButton(key, () => { if (cc && g.playerName.length < NAME_MAX) g.playerName += cc; }, true); }
            break;
          }
        }
        if (hitGrid) break;
      }

      if (!hitGrid && clk.y >= L.startBtnY && clk.y <= L.startBtnY + L.startBtnH && clk.x >= cw * 0.1 && clk.x <= cw * 0.9) {
        this.tapButton('start', () => { if (g.playerName.length > 0) this.finishName(); });
        return;
      }
    }

    // Keyboard inputs
    for (const p of presses) {
      if (p.startsWith('Key') && p.length === 4) {
        const ch = p[3];
        if (g.playerName.length < NAME_MAX) { g.playerName += ch; g.sound.sfx('tick', 0.4); }
        for (let r = 0; r < LETTERS.length; r++) { const c = LETTERS[r].indexOf(ch); if (c >= 0) this.nameCur = { r, c }; }
        continue;
      }
      if (p === 'Backspace') { g.playerName = g.playerName.slice(0, -1); g.sound.sfx('tick', 0.3); continue; }
      if (p === 'Escape') { g.go('menu'); return; }
      const cols = 7;
      if (p === 'ArrowLeft' || p === 'KeyA') this.nameCur.c = (this.nameCur.c + cols - 1) % cols;
      if (p === 'ArrowRight' || p === 'KeyD') this.nameCur.c = (this.nameCur.c + 1) % cols;
      if (p === 'ArrowUp' || p === 'KeyW') this.nameCur.r = (this.nameCur.r + 3) % 4;
      if (p === 'ArrowDown' || p === 'KeyS') this.nameCur.r = (this.nameCur.r + 1) % 4;
      if (p.startsWith('Arrow')) g.sound.sfx('tick', 0.3);
      if (p === 'Enter') { this.finishName(); return; }
      if (p === 'Space') {
        const { r, c } = this.nameCur;
        if (r === 3 && c === 5) { g.playerName = g.playerName.slice(0, -1); g.sound.sfx('tick'); }
        else if (r === 3 && c === 6) { if (g.playerName.length > 0) this.finishName(); }
        else {
          const ch = LETTERS[r][c];
          if (ch && g.playerName.length < NAME_MAX) { g.playerName += ch; g.sound.sfx('tick', 0.4); }
        }
      }
    }
  }

  finishName(): void {
    const g = this.g;
    if (!g.playerName) g.playerName = 'ACE';
    g.sound.sfx('item');
    g.beginMode();
    // steering-angle screen is parked; keep the default control type and go play / lobby
    if (g.mode === 'ai') g.go('connect');
    else g.newGame(0);
  }

  /* ---------------------------------------------------------------------- */

  render(): void {
    const g = this.g; const r = g.r;
    r.clear('#000');
    this.html.show(g.screen);
    switch (g.screen) {
      case 'boot':
        r.textC('LOADING', VIEW_W / 2, VIEW_H / 2 - 4, 'lavender');
        break;
      case 'title': this.renderTitle(); break;
      case 'menu': this.renderMenu(); break;
      case 'name': this.renderName(); break;
      case 'control': this.renderControl(); break;
      case 'connect': this.renderConnect(); break;
      case 'gameover': {
        // full-canvas at every size (S=min(w,h) keeps portrait sizing identical and scales landscape/desktop sanely)
        const c = this.pctx(), cw = r.canvas.width, ch = r.canvas.height, S = Math.min(cw, ch);
        this.pline(c, 'GAME OVER', cw / 2, ch * 0.42, Math.round(S * 0.11), '#cfd2ff', '900');
        this.pline(c, `SCORE ${fmtScore(g.score)}`, cw / 2, ch * 0.54, Math.round(S * 0.06), '#ffba3b');
        this.pline(c, 'TAP TO CONTINUE', cw / 2, ch * 0.64, Math.round(S * 0.04), '#656b88');
        break;
      }
      case 'congrats': this.renderCongrats(); break;
      case 'rematch': this.renderRematch(); break;
      default: break;
    }
  }

  private pctx(): CanvasRenderingContext2D { const c = this.g.r.screenCtx; c.fillStyle = '#0a0c16'; c.fillRect(0, 0, this.g.r.canvas.width, this.g.r.canvas.height); return c; }
  private pline(c: CanvasRenderingContext2D, text: string, cx: number, y: number, px: number, color: string, _weight = 'bold'): void {
    const font = this.g.r.font;
    const scale = Math.max(1, Math.round(px / font.meta.cell));
    font.drawCentered(c, text, cx, Math.round(y - (font.meta.cell * scale) / 2), colorVariant(color), scale);
  }

  private blit(c: CanvasRenderingContext2D, text: string, x: number, y: number, variant: FontVariant, scale: number, align: 'left' | 'center' | 'right' = 'left'): void {
    const font = this.g.r.font;
    let px = x;
    if (align === 'center') px = x - (font.width(text) * scale) / 2;
    if (align === 'right') px = x - font.width(text) * scale;
    font.draw(c, text, Math.round(px), Math.round(y), variant, Math.max(1, scale));
  }

  /** px reserved at the bottom of every portrait screen for the always-on #settings bar (bottom-left, ~44px tall) */
  private barReserve(): number { return Math.max(44, Math.round(this.g.r.canvas.height * 0.05)); }

  /** menu portrait geometry, shared by renderMenu() and its tap hit-test so they never drift apart */
  private menuLayout(): { cw: number; ch: number; logoY: number; logoH: number; headerY: number; hintY: number; cardX: number; cardW: number; cardH: number; y0: number; y1: number } {
    const r = this.g.r, cw = r.canvas.width, ch = r.canvas.height;
    const top = Math.round(ch * 0.05);
    const logoH = Math.round(Math.min(ch * 0.16, cw * 0.42));
    const logoY = top;
    const headerY = logoY + logoH + Math.round(ch * 0.04);
    const hintY = ch - this.barReserve() - Math.round(ch * 0.02);
    const cardsTop = headerY + Math.round(ch * 0.05);
    const cardsBottom = hintY - Math.round(ch * 0.05);
    const gap = Math.round(ch * 0.03);
    const cardH = Math.round((cardsBottom - cardsTop - gap) / 2);
    let cardW = Math.min(Math.round(cw * 0.88), Math.round(ch * 0.92)), cardX = Math.round((cw - cardW) / 2);
    if (isFold(cw, ch)) { const inset = foldInset(cw); cardW = cw - inset * 2; cardX = inset; }
    return { cw, ch, logoY, logoH, headerY, hintY, cardX, cardW, cardH, y0: cardsTop, y1: cardsTop + cardH + gap };
  }

  /** name portrait geometry, shared by renderName() and updateName()'s tap hit-test */
  private nameLayout(): { cw: number; ch: number; h1Y: number; h2Y: number; btnH: number; btnY: number; btnW: number; ghX: number; twX: number; nameCardH: number; nameCardY: number; nameCardX: number; nameCardW: number; startBtnH: number; startBtnY: number; startBtnX: number; startBtnW: number; gridTop: number; gridLeft: number; gridW: number; cellW: number; cellH: number } {
    const r = this.g.r, cw = r.canvas.width, ch = r.canvas.height;
    const top = Math.round(ch * 0.035);
    const h1Y = top + Math.round(ch * 0.012);
    const h2Y = h1Y + Math.round(ch * 0.036);
    const btnH = Math.min(66, Math.max(44, Math.round(ch * 0.05)));
    const btnY = h2Y + Math.round(ch * 0.036);
    const fold = isFold(cw, ch);
    const inset = fold ? foldInset(cw) : Math.round(cw * 0.06);
    const gap = fold ? Math.round(cw * 0.02) : Math.round(cw * 0.04);
    const btnW = Math.round((cw - inset * 2 - gap) / 2), ghX = inset, twX = inset + btnW + gap;
    const nameCardH = Math.min(72, Math.max(44, Math.round(ch * 0.06)));
    const nameCardY = btnY + btnH + Math.round(ch * 0.022);
    const startBtnH = Math.min(80, Math.max(50, Math.round(ch * 0.07)));
    const startBtnY = ch - this.barReserve() - startBtnH - Math.round(ch * 0.012);
    const gridTop = nameCardY + nameCardH + Math.round(ch * 0.025);
    const gridBottom = startBtnY - Math.round(ch * 0.022);
    const gridW = cw - inset * 2, gridLeft = inset;
    const cellW = Math.round(gridW / 7);
    const cellH = Math.round((gridBottom - gridTop) / 4);
    const nameCardX = inset, nameCardW = cw - inset * 2, startBtnX = inset, startBtnW = cw - inset * 2;
    return { cw, ch, h1Y, h2Y, btnH, btnY, btnW, ghX, twX, nameCardH, nameCardY, nameCardX, nameCardW, startBtnH, startBtnY, startBtnX, startBtnW, gridTop, gridLeft, gridW, cellW, cellH };
  }

  private renderTitle(): void {
    const r = this.g.r, ctx = r.screenCtx;
    ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, r.canvas.width, r.canvas.height);
  }

  private renderMenu(): void {
    const r = this.g.r, ctx = r.screenCtx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, r.canvas.width, r.canvas.height);
  }

  private renderName(): void {
    const r = this.g.r, ctx = r.screenCtx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, r.canvas.width, r.canvas.height);
  }

  /** control-select geometry, shared by renderControl() and its tap hit-test */
  private controlLayout(): { cw: number; ch: number; S: number; optX: number; optW: number; optH: number; cy: number[] } {
    const r = this.g.r, cw = r.canvas.width, ch = r.canvas.height, S = Math.min(cw, ch);
    let optW = Math.min(Math.round(cw * 0.62), Math.round(S * 0.92)), optX = Math.round((cw - optW) / 2);
    if (isFold(cw, ch)) { const inset = foldInset(cw); optW = cw - inset * 2; optX = inset; }
    const optH = Math.round(ch * 0.11);
    return { cw, ch, S, optX, optW, optH, cy: [Math.round(ch * 0.42), Math.round(ch * 0.42 + ch * 0.14)] };
  }

  private chooseControl(): void {
    const g = this.g;
    g.input.controlType = this.cursor === 0 ? 'screen' : 'iso45';
    g.sound.sfx('item');
    if (g.mode === 'ai') g.go('connect'); else g.newGame(0);
  }

  /** bouncing marbles for the leaderboard/rematch "end" celebration (the longplay ending animation) */
  private initBounce(): void {
    const r = this.g.r, cw = r.canvas.width, ch = r.canvas.height, S = Math.min(cw, ch);
    this.bounce = [];
    for (let i = 0; i < 14; i++) {
      const sz = Math.round(S * (0.05 + Math.random() * 0.045));
      this.bounce.push({ x: Math.random() * (cw - sz), y: Math.random() * (ch * 0.5), vx: (Math.random() * 2 - 1) * cw * 0.28, vy: Math.random() * ch * 0.15, c: Math.floor(Math.random() * 6), sz });
    }
  }
  private updateBounce(dt: number): void {
    const r = this.g.r, cw = r.canvas.width, ch = r.canvas.height;
    for (const b of this.bounce) {
      b.vy += 1500 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx); } else if (b.x + b.sz > cw) { b.x = cw - b.sz; b.vx = -Math.abs(b.vx); }
      if (b.y + b.sz > ch) { b.y = ch - b.sz; b.vy = -Math.abs(b.vy) * 0.86; if (Math.abs(b.vy) < ch * 0.15) b.vy = -ch * (0.34 + Math.random() * 0.14); }
      if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy); }
    }
  }
  private drawBounce(ctx: CanvasRenderingContext2D): void {
    const sheet = this.g.assets.sheets.marble; if (!sheet) return;
    const f = FRAMES.marble.roll[Math.floor(this.blink * 6) % 6];
    for (const b of this.bounce) {
      ctx.save(); ctx.globalAlpha = 0.92; ctx.filter = `hue-rotate(${b.c * 60}deg)`;
      ctx.drawImage(sheet, f.x, f.y, f.w, f.h, Math.round(b.x), Math.round(b.y), b.sz, b.sz);
      ctx.restore();
    }
  }

  /** rematch (2P post-race) button geometry, shared by renderRematch() and its tap hit-test */
  private rematchLayout(): { cw: number; ch: number; S: number; btnX: number; btnW: number; btnH: number; y0: number; y1: number } {
    const r = this.g.r, cw = r.canvas.width, ch = r.canvas.height, S = Math.min(cw, ch);
    let btnW = Math.min(Math.round(cw * 0.72), Math.round(S * 1.1)), btnX = Math.round((cw - btnW) / 2);
    if (isFold(cw, ch)) { const inset = foldInset(cw); btnW = cw - inset * 2; btnX = inset; }
    const btnH = Math.round(S * 0.11), gap = Math.round(ch * 0.035);
    const y0 = Math.round(ch * 0.54), y1 = y0 + btnH + gap;
    return { cw, ch, S, btnX, btnW, btnH, y0, y1 };
  }

  private renderRematch(): void {
    const r = this.g.r, ctx = r.screenCtx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, r.canvas.width, r.canvas.height);
    this.drawBounce(ctx);
  }

  /** Test/debug: tappable target centers for the current screen, computed from the SAME shared layout the
   *  renderer + hit-tests use — so a test tapping these coords exercises the real tap handling at any size. */
  debugTargets(): Record<string, { x: number; y: number; w: number; h: number }> {
    const g = this.g, cw = g.r.canvas.width, ch = g.r.canvas.height;
    const t: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const whole = { x: Math.round(cw / 2), y: Math.round(ch / 2), w: cw, h: ch };
    switch (g.screen) {
      case 'title': {
        t.start = this.html.box('#ui-press-start') || whole;
        t.column = this.html.box('#ui-title') || { x: Math.round(cw / 2), y: Math.round(ch / 2), w: cw, h: ch };
        break;
      }
      case 'menu': {
        t.card0 = this.html.box('#ui-mode-0') || whole;
        t.card1 = this.html.box('#ui-mode-1') || whole;
        t.start = this.html.box('#ui-menu-press') || whole;
        t.column = this.html.box('#ui-menu') || { x: Math.round(cw / 2), y: Math.round(ch / 2), w: cw, h: ch };
        break;
      }
      case 'name': {
        t.github = this.html.box('#ui-github') || whole;
        t.twitter = this.html.box('#ui-twitter') || whole;
        for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) t[`cell_${r}_${c}`] = this.html.box(`#ui-key-${r}-${c}`) || whole;
        t.start = this.html.box('#ui-name-start') || whole;
        break;
      }
      case 'control': { const L = this.controlLayout(); t.optA = { x: Math.round(cw / 2), y: L.cy[0], w: L.optW, h: L.optH }; t.optB = { x: Math.round(cw / 2), y: L.cy[1], w: L.optW, h: L.optH }; break; }
      case 'connect': { t.copy = this.html.box('#ui-copy') || whole; break; }
      case 'rematch': {
        t.playAgain = this.html.box('#ui-play-again') || whole;
        t.exit = this.html.box('#ui-exit-lb') || whole;
        break;
      }
      case 'gameover': t.continue = whole; t.column = { x: Math.round(cw / 2), y: Math.round(ch / 2), w: cw, h: ch }; break;
      case 'congrats': {
        const fold = isFold(cw, ch);
        const bw = fold ? cw - foldInset(cw) * 2 : Math.min(cw, ch * 1.4);
        t.continue = whole; t.column = { x: Math.round(cw / 2), y: Math.round(ch / 2), w: bw, h: ch };
        break;
      }
    }
    return t;
  }

  private renderControl(): void {
    const L = this.controlLayout();
    const c = this.pctx(), cw = L.cw, ch = L.ch, S = L.S;
    this.pline(c, 'PLAYER 1', cw / 2, ch * 0.16, Math.round(S * 0.06), '#cfd2ff');
    this.pline(c, 'SELECT CONTROL TYPE', cw / 2, ch * 0.22, Math.round(S * 0.05), '#8e96b8');
    const opts = ['A   SCREEN', 'B   45°'];
    opts.forEach((o, i) => {
      const y = L.cy[i], on = this.cursor === i;
      const oy = this.chunkyBtn(c, L.optX, y - L.optH / 2, L.optW, L.optH, 'opt' + i, on ? '#1b223d' : '#111524', '#05070f', on ? '#ffe019' : '#333b5c', 12);
      this.pline(c, o, cw / 2, y + oy, Math.round(S * 0.06), on ? '#ffe019' : '#c5cbdf', on ? '900' : 'bold');
    });
    this.pline(c, 'TAP A OR B  ·  MOUSE = TRACKBALL', cw / 2, ch - this.barReserve() - Math.round(ch * 0.03), Math.round(S * 0.035), '#656b88');
  }

  /** connect (human) copy-link button rect, shared by renderConnect() and its tap hit-test */
  private connectLayout(): { cw: number; ch: number; S: number; bw: number; bx: number; copyX: number; copyY: number; copyW: number; copyH: number; urlY: number } {
    const r = this.g.r, cw = r.canvas.width, ch = r.canvas.height, S = Math.min(cw, ch);
    let bw = Math.min(Math.round(cw * 0.9), Math.round(ch * 1.15)), bx = Math.round((cw - bw) / 2);
    let copyW = Math.min(Math.round(bw * 0.78), Math.round(S * 1.15));
    if (isFold(cw, ch)) { const inset = foldInset(cw); bw = cw - inset * 2; bx = inset; copyW = bw; }
    const copyH = Math.round(S * 0.09);
    const copyX = Math.round((cw - copyW) / 2), copyY = Math.round(ch * 0.52);
    return { cw, ch, S, bw, bx, copyX, copyY, copyW, copyH, urlY: Math.round(ch * 0.4) };
  }

  private renderConnect(): void {
    if (this.g.isAgentPage) {
      // the agent's side of the lobby: nothing to copy, nothing to press — it is waiting for the human.
      // full-canvas (works at any size the embedded browser uses); must NOT rely on present() (offscreen is empty here).
      const r = this.g.r;
      const c = this.pctx(), cw = r.canvas.width, ch = r.canvas.height, S = Math.min(cw, ch);
      this.pline(c, 'PLAYER VS AI', cw / 2, ch * 0.2, Math.round(S * 0.05), '#b7a7ff', '900');
      this.pline(c, 'AGENT CONNECTED', cw / 2, ch * 0.34, Math.round(S * 0.07), '#4be3d0', '900');
      this.pline(c, 'LOBBY ' + this.g.lobbyId.slice(0, 8).toUpperCase(), cw / 2, ch * 0.44, Math.round(S * 0.04), '#c5cbdf');
      this.pline(c, 'WAITING FOR THE HUMAN', cw / 2, ch * 0.58, Math.round(S * 0.05), '#ffba3b');
      this.pline(c, 'TO START THE RACE', cw / 2, ch * 0.64, Math.round(S * 0.05), '#ffba3b');
      this.pline(c, this.g.net.connected ? 'LINK OK' : 'RECONNECTING...', cw / 2, ch * 0.8, Math.round(S * 0.035), this.g.net.connected ? '#8e96b8' : '#ff8a3b');
      return;
    }
    const r = this.g.r, ctx = r.screenCtx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, r.canvas.width, r.canvas.height);
  }

  private renderCongrats(): void {
    const r = this.g.r, ctx = r.screenCtx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, r.canvas.width, r.canvas.height);
  }

}
