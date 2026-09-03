import type { Game, Screen } from './game';
import { VIEW_W, VIEW_H } from '../engine/constants';
import { fmtScore } from '../engine/font';
import { FRAMES, drawFrame } from '../engine/assets';

const LETTERS = ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', 'VWXYZ'];
const NAME_MAX = 6;

/** Menu / title screens drawn with the bitmap font, matching the NES flow. */
export class Screens {
  cursor = 0;
  nameCur = { r: 0, c: 0 };
  blink = 0;
  idle = 0;
  rain: { x: number; y: number; vy: number; c: number }[] = [];
  connectVisible = false;

  constructor(private g: Game) {}

  enter(screen: Screen): void {
    this.idle = 0;
    if (screen === 'menu') this.cursor = 0;
    if (screen === 'name') { this.nameCur = { r: 0, c: 0 }; this.g.playerName = ''; }
    if (screen === 'control') this.cursor = 1;
    if (screen === 'congrats') {
      this.rain = [];
      for (let i = 0; i < 26; i++) this.rain.push({ x: Math.random() * VIEW_W, y: -Math.random() * VIEW_H, vy: 30 + Math.random() * 50, c: Math.floor(Math.random() * 6) });
    }
    if (screen === 'gameover') { void this.g.submitScore(); }
    this.showConnect(screen === 'connect' && !this.g.isAgentPage);
  }

  update(dt: number): void {
    const g = this.g;
    this.blink += dt; this.idle += dt;
    const presses = g.input.takePresses();
    const any = presses.length > 0;
    switch (g.screen) {
      case 'highrollers':
        if (any || this.idle > 9) g.go('title');
        break;
      case 'title':
        if (any) { g.sound.init(); g.go('menu'); }
        else if (this.idle > 12) g.go('highrollers');
        break;
      case 'menu': {
        const items = 3;
        for (const p of presses) {
          if (p === 'ArrowUp' || p === 'KeyW') { this.cursor = (this.cursor + items - 1) % items; g.sound.sfx('tick', 0.4); }
          if (p === 'ArrowDown' || p === 'KeyS') { this.cursor = (this.cursor + 1) % items; g.sound.sfx('tick', 0.4); }
          if (p === 'Enter' || p === 'Space' || p === 'Mouse' || p === 'Touch') {
            g.mode = (['1p', 'ai', 'multi'] as const)[this.cursor];
            g.sound.sfx('item');
            g.beginMode();
            g.go('name');
          }
          if (p === 'Escape') g.go('title');
        }
        break;
      }
      case 'name': this.updateName(presses); break;
      case 'control': {
        for (const p of presses) {
          if (p === 'ArrowUp' || p === 'ArrowDown' || p === 'KeyW' || p === 'KeyS') { this.cursor = 1 - this.cursor; g.sound.sfx('tick', 0.4); }
          if (p === 'Enter' || p === 'Space' || p === 'Mouse' || p === 'Touch') {
            g.input.controlType = this.cursor === 0 ? 'screen' : 'iso45';
            g.sound.sfx('item');
            if (g.mode === 'ai') g.go('connect');
            else g.newGame(0);
          }
          if (p === 'Escape') g.go('menu');
        }
        break;
      }
      case 'connect': {
        for (const p of presses) if (p === 'Escape') g.go('menu');
        break;
      }
      case 'gameover':
        if (this.idle > 4 || any) g.go('highrollers');
        break;
      case 'congrats': {
        for (const m of this.rain) { m.y += m.vy * dt; if (m.y > VIEW_H + 10) { m.y = -12; m.x = Math.random() * VIEW_W; } }
        const tally = g.finalTally;
        if (this.idle > 2.5 && tally.drained < tally.total) {
          const step = Math.min(tally.total - tally.drained, Math.ceil(tally.total * dt / 3 / 100) * 100);
          tally.drained += step; g.score += step;
        }
        if (this.idle > 2.5 && tally.drained >= tally.total && !this.g.scoreSubmitted) { void g.submitScore(); }
        if ((any && this.idle > 4) || this.idle > 30) { g.sound.stopBgm(); g.go('highrollers'); }
        break;
      }
      default: break;
    }
  }

  private updateName(presses: string[]): void {
    const g = this.g;
    for (const p of presses) {
      if (p.startsWith('Key') && p.length === 4) {
        const ch = p[3];
        if (g.playerName.length < NAME_MAX) { g.playerName += ch; g.sound.sfx('tick', 0.4); }
        // move cursor to the letter too
        for (let r = 0; r < LETTERS.length; r++) { const c = LETTERS[r].indexOf(ch); if (c >= 0) this.nameCur = { r, c }; }
        continue;
      }
      if (p === 'Backspace') { g.playerName = g.playerName.slice(0, -1); continue; }
      if (p === 'Escape') { g.go('menu'); return; }
      const cols = 7;
      if (p === 'ArrowLeft' || p === 'KeyA') this.nameCur.c = (this.nameCur.c + cols - 1) % cols;
      if (p === 'ArrowRight' || p === 'KeyD') this.nameCur.c = (this.nameCur.c + 1) % cols;
      if (p === 'ArrowUp' || p === 'KeyW') this.nameCur.r = (this.nameCur.r + 3) % 4;
      if (p === 'ArrowDown' || p === 'KeyS') this.nameCur.r = (this.nameCur.r + 1) % 4;
      if (p.startsWith('Arrow')) g.sound.sfx('tick', 0.3);
      if (p === 'Enter' && g.playerName.length > 0) { this.finishName(); return; }   // Enter confirms a typed name
      if (p === 'Enter' || p === 'Space' || p === 'Mouse' || p === 'Touch') {
        const { r, c } = this.nameCur;
        if (r === 3 && c === 5) { g.playerName = g.playerName.slice(0, -1); g.sound.sfx('tick'); }        // RUB
        else if (r === 3 && c === 6) { if (g.playerName.length > 0) this.finishName(); }                 // END
        else {
          const ch = LETTERS[r][c];
          if (ch && g.playerName.length < NAME_MAX) { g.playerName += ch; g.sound.sfx('tick', 0.4); }
        }
      }
    }
  }

  private finishName(): void {
    const g = this.g;
    if (!g.playerName) g.playerName = 'ACE';
    g.sound.sfx('item');
    g.go('control');
  }

  /* ---------------------------------------------------------------------- */

  render(): void {
    const g = this.g; const r = g.r;
    r.clear('#000');
    switch (g.screen) {
      case 'boot':
        r.textC('LOADING', VIEW_W / 2, VIEW_H / 2 - 4, 'lavender');
        break;
      case 'highrollers': this.renderHighRollers(); break;
      case 'title': this.renderTitle(); break;
      case 'menu': this.renderMenu(); break;
      case 'name': this.renderName(); break;
      case 'control': this.renderControl(); break;
      case 'connect': this.renderConnect(); break;
      case 'gameover':
        r.textC('GAME OVER', VIEW_W / 2, 100, 'lavender');
        r.textC(`SCORE ${fmtScore(g.score)}`, VIEW_W / 2, 124, 'orange');
        break;
      case 'congrats': this.renderCongrats(); break;
      default: break;
    }
  }

  private renderHighRollers(): void {
    const g = this.g; const r = g.r;
    r.logo(VIEW_W / 2, 18);
    r.textC('HIGH ROLLERS', VIEW_W / 2, 90, 'lavender');
    const rows = g.rollers.slice(0, 10);
    for (let i = 0; i < 10; i++) {
      const e = rows[i];
      const y = 106 + i * 10;
      const variant = i === 0 ? 'lavender' : 'orange';
      const rank = `#${i + 1}`;
      r.textR(rank, 70, y, variant);
      if (e) {
        r.text(e.name.replace(/\[(NI|AI)\]\s*/i, '').slice(0, 6), 78, y, variant);
        r.textR(fmtScore(e.score), 232, y, variant);
      }
    }
  }

  private renderTitle(): void {
    const r = this.g.r;
    r.textC('M I L T O N   B R A D L E Y', VIEW_W / 2, 12, 'white');
    r.textC('PRESENTS', VIEW_W / 2, 28, 'white');
    r.logo(VIEW_W / 2, 52);
    if (Math.floor(this.blink * 2) % 2 === 0) r.textC('PRESS START', VIEW_W / 2, 160, 'orange');
    r.textC('© 1984 TENGEN', VIEW_W / 2, 196, 'white');
    r.textC('LICENSED BY NINTENDO OF', VIEW_W / 2, 208, 'white');
    r.textC('AMERICA INC.', VIEW_W / 2, 218, 'white');
  }

  private renderMenu(): void {
    const g = this.g; const r = g.r;
    r.logo(VIEW_W / 2, 14);
    const items = ['1 PLAYER', 'PLAYER VS AI (2 PLAYER)', 'MULTI MARBLE'];
    const x = 84, y0 = 116;
    items.forEach((it, i) => r.text(it, x, y0 + i * 16, 'white'));
    drawFrame(r.ctx, g.assets.sheets.marble, FRAMES.marble.roll[Math.floor(this.blink * 6) % 6], x - 18, y0 + this.cursor * 16 + 4);
    r.textC('© 1984 TENGEN', VIEW_W / 2, 206, 'white');
  }

  private renderName(): void {
    const g = this.g; const r = g.r;
    r.textC('PLAYER 1', VIEW_W / 2, 30, 'lavender');
    r.textC('ENTER YOUR NAME.', VIEW_W / 2, 46, 'lavender');
    const x0 = 56, y0 = 78, dx = 27, dy = 24;
    for (let row = 0; row < 4; row++) {
      for (let c = 0; c < 7; c++) {
        const ch = LETTERS[row][c];
        const x = x0 + c * dx, y = y0 + row * dy;
        const sel = this.nameCur.r === row && this.nameCur.c === c;
        if (sel) drawFrame(r.ctx, g.assets.sheets.marble, FRAMES.marble.roll[Math.floor(this.blink * 6) % 6], x + 4, y + 4);
        if (row === 3 && c === 5) r.text('RUB', x - 6, y, 'white');
        else if (row === 3 && c === 6) r.text('END', x - 2, y, 'white');
        else if (ch) r.text(ch, x, y, sel ? 'cyan' : 'white');
      }
    }
    const name = g.playerName.padEnd(NAME_MAX, '_').split('').join(' ');
    r.textC(name, VIEW_W / 2, 190, 'orange');
  }

  private renderControl(): void {
    const g = this.g; const r = g.r;
    r.textC('PLAYER 1', VIEW_W / 2, 30, 'lavender');
    r.textC('SELECT CONTROL TYPE', VIEW_W / 2, 46, 'lavender');
    const opts = ['A   SCREEN', 'B   45'];
    opts.forEach((o, i) => {
      const y = 130 + i * 20;
      r.text(o, 110, y, 'white');
      if (i === 1) { r.ctx.strokeStyle = '#fff'; r.ctx.lineWidth = 1; r.ctx.beginPath(); r.ctx.arc(110 + 8 * 6 + 2.5, y + 1.5, 1.5, 0, Math.PI * 2); r.ctx.stroke(); }
      if (this.cursor === i) drawFrame(r.ctx, g.assets.sheets.marble, FRAMES.marble.roll[Math.floor(this.blink * 6) % 6], 94, y + 4);
    });
    r.textC('ARROWS/WASD  MOUSE=TRACKBALL', VIEW_W / 2, 200, 'orange');
  }

  private renderConnect(): void {
    const g = this.g; const r = g.r;
    if (g.isAgentPage) {
      r.textC('PLAYER VS AI', VIEW_W / 2, 30, 'lavender');
      r.textC('AGENT MARBLE', VIEW_W / 2, 46, 'orange');
      r.textC('LOBBY ' + g.lobbyId.slice(0, 8).toUpperCase(), VIEW_W / 2, 90, 'cyan');
      const dots = '.'.repeat(1 + (Math.floor(this.blink * 2) % 3));
      r.textC(g.net.connected ? `WAITING FOR HUMAN TO START${dots}` : `CONNECTING${dots}`, VIEW_W / 2, 130, 'white');
      r.textC('USE WEBMCP TOOLS TO STEER', VIEW_W / 2, 170, 'lavender');
      return;
    }
    r.textC('PLAYER VS AI', VIEW_W / 2, 30, 'lavender');
    r.textC('CONNECT YOUR AGENT', VIEW_W / 2, 46, 'lavender');
    r.textC('LOBBY', VIEW_W / 2, 90, 'white');
    r.textC(g.lobbyId.slice(0, 8).toUpperCase(), VIEW_W / 2, 102, 'cyan');
    const dots = '.'.repeat(1 + (Math.floor(this.blink * 2) % 3));
    r.textC(g.agentJoined ? 'AGENT CONNECTED!' : `WAITING FOR AGENT${dots}`, VIEW_W / 2, 150, 'orange');
    r.textC('ESC TO CANCEL', VIEW_W / 2, 210, 'white');
  }

  private renderCongrats(): void {
    const g = this.g; const r = g.r;
    // rain of coloured marbles in the background
    const F = FRAMES.marble.roll;
    for (const m of this.rain) {
      r.ctx.save();
      r.ctx.filter = `hue-rotate(${m.c * 60}deg)`;
      drawFrame(r.ctx, g.assets.sheets.marble, F[Math.floor((this.blink + m.y) * 0.3) % 6], m.x, m.y);
      r.ctx.restore();
    }
    r.textC('CONGRATULATIONS', VIEW_W / 2, 14, 'lavender');
    r.textC(g.playerName ? `${g.playerName}` : 'LEFT PLAYER', VIEW_W / 2, 28, 'white');
    r.textC('YOU HAVE COMPLETED', VIEW_W / 2, 44, 'white');
    r.textC('THE ULTIMATE RACE!', VIEW_W / 2, 54, 'white');
    const secLeft = Math.floor(g.timeLeft);
    const rows: [string, string][] = [
      ['BONUS FOR FINISHING', fmtScore(20000)],
      [`${secLeft} SEC LEFT X 1000`, fmtScore(secLeft * 1000)],
      [`DIED ${g.deaths} TIMES X -1000`, `-${fmtScore(g.deaths * 1000)}`],
      ['TOTAL', fmtScore(Math.max(0, g.finalTally.total - g.finalTally.drained))],
    ];
    rows.forEach(([a, b], i) => {
      const y = 84 + i * 14;
      r.textR(a, 186, y, i === 3 ? 'white' : 'white');
      r.textR(b, 268, y, 'orange');
    });
    r.text('FINAL SCORE:', 84, 150, 'lavender');
    r.textR(fmtScore(g.score), 268, 150, 'lavender');
  }

  /* ---------------------------------------------------------------------- */

  showConnect(show: boolean): void {
    const overlay = document.getElementById('overlay');
    const panel = document.getElementById('connect-panel');
    if (!overlay || !panel) return;
    overlay.classList.toggle('show', show);
    panel.style.display = show ? 'block' : 'none';
    if (show) {
      const g = this.g;
      const url = `${g.publicOrigin}/${g.lobbyId}`;
      const text = `Open ${url} in your embedded browser and use webmcp to compete`;
      const ta = document.getElementById('connect-text') as HTMLTextAreaElement | null;
      if (ta) ta.value = text;
      const lob = document.getElementById('connect-lobby'); if (lob) lob.textContent = g.lobbyId;
      const btn = document.getElementById('connect-copy');
      if (btn) {
        btn.onclick = async () => {
          try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied!'; }
          catch { ta?.select(); document.execCommand('copy'); btn.textContent = 'Copied!'; }
          setTimeout(() => { btn.textContent = 'Copy / Add to Clipboard'; }, 1500);
        };
      }
    }
    this.connectVisible = show;
  }

  setConnectStatus(text: string): void {
    const el = document.getElementById('connect-status'); if (el) el.textContent = text;
  }
}
