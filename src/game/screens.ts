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

  menuDelay = 0;

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
    this.showConnect(false);
  }

  copiedTimer = 0;

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
    const text = `Play 2-Player Marble Madness against me using WebMCP!

Challenge URL:
${url}

Instructions for Codex / AI Agent:
1. Open the Challenge URL above in your embedded browser.
2. WebMCP tools will automatically register in your session:
   - steer_trackball(du, dv): apply steering impulse
   - spin_trackball(velocity_u, velocity_v): direct velocity fling
   - apply_brake(factor): slow down around sharp corners
   - get_game_state(): read position, speed, and hazard telemetry
   - wait_for_tick(): synchronize with next 60Hz physics tick
3. Race as the Red AI Marble against my Blue Marble and beat me to the finish line!`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.getElementById('connect-text') as HTMLTextAreaElement | null;
      if (ta) { ta.value = text; ta.select(); document.execCommand('copy'); }
    }
    this.copiedTimer = 2.4;
    g.sound.sfx('item');
  }

  update(dt: number): void {
    const g = this.g;
    this.blink += dt; this.idle += dt;
    if (this.copiedTimer > 0) this.copiedTimer -= dt;
    const presses = g.input.takePresses();
    const clicks = g.input.takeClicks();
    const any = presses.length > 0 || clicks.length > 0;
    switch (g.screen) {
      case 'highrollers':
        if (any || this.idle > 9) g.go('title');
        break;
      case 'title':
        if (any) { g.sound.init(); g.sound.sfx('item'); g.go('menu'); }
        else if (this.idle > 12) g.go('highrollers');
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
          const img = g.assets.screenCache.get('select_base') || g.assets.screenCache.get('select');
          if (img) {
            const scale = Math.min(g.r.canvas.width / img.width, g.r.canvas.height / img.height);
            const rw = img.width * scale, rh = img.height * scale;
            const ry = (g.r.canvas.height - rh) / 2;
            const iy = (clk.y - ry) * (img.height / rh);
            if (iy >= 390 && iy <= 475) {
              this.chooseMode(0);
              return;
            } else if (iy > 475 && iy <= 570) {
              this.chooseMode(1);
              return;
            }
          }
          this.chooseMode(this.cursor);
          return;
        }
        break;
      }
      case 'name': this.updateName(presses, clicks); break;
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
        for (const p of presses) {
          if (p === 'Escape') g.go('menu');
          if (p === 'KeyC' || p === 'Space' || p === 'Enter') void this.copyAgentLink();
        }
        for (const clk of clicks) {
          const img = g.assets.screenCache.get('player2webmcp');
          if (img) {
            const scale = Math.min(g.r.canvas.width / img.width, g.r.canvas.height / img.height);
            const rw = img.width * scale, rh = img.height * scale;
            const rx = (g.r.canvas.width - rw) / 2, ry = (g.r.canvas.height - rh) / 2;
            const ix = (clk.x - rx) * (img.width / rw);
            const iy = (clk.y - ry) * (img.height / rh);
            if ((ix >= 840 && ix <= 1400 && iy >= 50 && iy <= 190) || (ix >= 240 && ix <= 1200 && iy >= 380 && iy <= 680)) {
              void this.copyAgentLink();
            }
          } else {
            void this.copyAgentLink();
          }
        }
        break;
      }
      case 'gameover':
        if (this.idle > 4 || any) g.go('title');
        break;
      case 'congrats': {
        for (const m of this.rain) { m.y += m.vy * dt; if (m.y > VIEW_H + 10) { m.y = -12; m.x = Math.random() * VIEW_W; } }
        const tally = g.finalTally;
        if (this.idle > 2.5 && tally.drained < tally.total) {
          const step = Math.min(tally.total - tally.drained, Math.ceil(tally.total * dt / 3 / 100) * 100);
          tally.drained += step; g.score += step;
        }
        if (this.idle > 2.5 && tally.drained >= tally.total && !this.g.scoreSubmitted) { void g.submitScore(); }
        if ((any && this.idle > 4) || this.idle > 30) { g.sound.stopBgm(); g.go('title'); }
        break;
      }
      default: break;
    }
  }

  private updateName(presses: string[], clicks: { x: number; y: number }[]): void {
    const g = this.g;
    const colX = [366, 507, 647, 787, 927, 1067, 1207];
    const rowY = [383, 508, 632, 759];

    // Handle clicks
    const img = g.assets.screenCache.get('pickname_base') || g.assets.screenCache.get('pickname');
    for (const clk of clicks) {
      if (img) {
        const scale = Math.min(g.r.canvas.width / img.width, g.r.canvas.height / img.height);
        const rw = img.width * scale, rh = img.height * scale;
        const rx = (g.r.canvas.width - rw) / 2, ry = (g.r.canvas.height - rh) / 2;
        const ix = (clk.x - rx) * (img.width / rw);
        const iy = (clk.y - ry) * (img.height / rh);

        // 1. GitHub button (x: 628..727, y: 209..290)
        if (ix >= 615 && ix <= 735 && iy >= 195 && iy <= 300) {
          g.sound.sfx('item');
          (window as any).triggerAuth?.('github');
          return;
        }
        // 2. Twitter / X button (x: 751..849, y: 209..290)
        if (ix >= 740 && ix <= 860 && iy >= 195 && iy <= 300) {
          g.sound.sfx('item');
          (window as any).triggerAuth?.('twitter');
          return;
        }

        // 3. Grid cell clicks
        let matchedGrid = false;
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 7; c++) {
            const cx = colX[c], cy = rowY[r];
            if (Math.abs(ix - cx) <= 60 && Math.abs(iy - cy) <= 50) {
              matchedGrid = true;
              this.nameCur = { r, c };
              if (r === 3 && c === 5) {
                // RUB
                g.playerName = g.playerName.slice(0, -1);
                g.sound.sfx('tick', 0.4);
              } else if (r === 3 && c === 6) {
                // END
                if (g.playerName.length > 0) this.finishName();
                return;
              } else {
                const ch = LETTERS[r][c];
                if (ch && g.playerName.length < NAME_MAX) {
                  g.playerName += ch;
                  g.sound.sfx('tick', 0.4);
                }
              }
              break;
            }
          }
          if (matchedGrid) break;
        }

        // Click on bottom name area to confirm
        if (!matchedGrid && iy >= 850 && g.playerName.length > 0) {
          this.finishName();
          return;
        }
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

  private finishName(): void {
    const g = this.g;
    if (!g.playerName) g.playerName = 'ACE';
    g.sound.sfx('item');
    g.beginMode();
    if (g.mode === 'ai') {
      g.go('connect');
    } else {
      g.newGame(0);
    }
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
    // Both beginning and end leaderboards must match completely
    this.renderTitle();
  }

  private renderTitle(): void {
    const g = this.g; const r = g.r;
    const img = g.assets.screenCache.get('title_base') || g.assets.screenCache.get('title2');
    if (img) {
      const bounds = r.drawFullScreenImage(img);
      const { rx, ry, rw, rh } = bounds;
      const iw = img.width, ih = img.height;
      const sx = (x: number) => rx + (x / iw) * rw;
      const sy = (y: number) => ry + (y / ih) * rh;

      // Render the dynamic leaderboard rows into the 5 table slots!
      const rows = g.rollers.slice(0, 5);
      const ys = [495, 548, 602, 656, 712];
      const fontSize = Math.max(12, Math.round((28 / ih) * rh));
      r.screenCtx.font = `bold ${fontSize}px "Courier New", monospace`;
      r.screenCtx.textBaseline = 'middle';

      for (let i = 0; i < 5; i++) {
        const e = rows[i];
        if (!e) continue;
        const cy = sy(ys[i]);

        // 1. Rank: gold (#ffe019), centered at x=478
        r.screenCtx.fillStyle = '#ffe019';
        r.screenCtx.textAlign = 'center';
        r.screenCtx.fillText(String(e.rank ?? (i + 1)), sx(478), cy);

        // 2. Player Name: left-aligned at x=540
        const isUser = e.name === '@MACEIP' || (g.playerName && e.name.toUpperCase() === g.playerName.toUpperCase());
        r.screenCtx.fillStyle = isUser ? '#79a8ff' : '#ffffff';
        r.screenCtx.textAlign = 'left';
        r.screenCtx.fillText(e.name, sx(540), cy);

        // Underline current user
        if (isUser) {
          const nw = r.screenCtx.measureText(e.name).width;
          r.screenCtx.strokeStyle = '#79a8ff';
          r.screenCtx.lineWidth = Math.max(1, Math.round(2 * (rh / ih)));
          r.screenCtx.beginPath();
          r.screenCtx.moveTo(sx(540), cy + fontSize * 0.55);
          r.screenCtx.lineTo(sx(540) + nw, cy + fontSize * 0.55);
          r.screenCtx.stroke();
        }

        // 3. Intelligence: centered at x=1035, white (#ffffff)
        const intel = e.intelligence || 'Natural';
        r.screenCtx.fillStyle = '#ffffff';
        r.screenCtx.textAlign = 'center';
        r.screenCtx.fillText(intel, sx(1035), cy);
      }
    } else {
      r.logo(VIEW_W / 2, 52);
      r.textC('PRESS START', VIEW_W / 2, 160, 'orange');
    }
  }

  private renderMenu(): void {
    const g = this.g; const r = g.r;
    const img = g.assets.screenCache.get('select_base') || g.assets.screenCache.get('select');
    if (img) {
      const bounds = r.drawFullScreenImage(img);
      const { rx, ry, rw, rh } = bounds;
      const iw = img.width, ih = img.height;
      const sx = (x: number) => rx + (x / iw) * rw;
      const sy = (y: number) => ry + (y / ih) * rh;

      // Draw cursor at 1 PLAYER (x=560, y=435) or 2 PLAYERS (x=560, y=515)
      const cursorImg = g.assets.screenCache.get('cursor');
      const curY = this.cursor === 0 ? 435 : 515;
      if (cursorImg) {
        const cw = (cursorImg.width / iw) * rw;
        const ch = (cursorImg.height / ih) * rh;
        r.screenCtx.drawImage(cursorImg, sx(560), sy(curY), cw, ch);
      }

      // When 1 PLAYER is active, black out the 'HUMAN VS AGENT' area so it only shows for 2 PLAYERS
      if (this.cursor === 0) {
        r.screenCtx.fillStyle = '#000000';
        r.screenCtx.fillRect(sx(540), sy(660), (600 / iw) * rw, (45 / ih) * rh);
      }
    } else {
      r.logo(VIEW_W / 2, 14);
      const items = ['1 PLAYER', '2 PLAYERS'];
      const x = 84, y0 = 116;
      items.forEach((it, i) => r.text(it, x, y0 + i * 16, 'white'));
      drawFrame(r.ctx, g.assets.sheets.marble, FRAMES.marble.roll[Math.floor(this.blink * 6) % 6], x - 18, y0 + this.cursor * 16 + 4);
    }
  }

  private renderName(): void {
    const g = this.g; const r = g.r;
    const img = g.assets.screenCache.get('pickname_base') || g.assets.screenCache.get('pickname');
    if (img) {
      const bounds = r.drawFullScreenImage(img);
      const { rx, ry, rw, rh } = bounds;
      const iw = img.width, ih = img.height;
      const sx = (x: number) => rx + (x / iw) * rw;
      const sy = (y: number) => ry + (y / ih) * rh;

      // 4x7 letter grid centers matching pickname.png
      const colX = [366, 507, 647, 787, 927, 1067, 1207];
      const rowY = [383, 508, 632, 759];

      // Draw marble cursor at selected letter
      const curX = colX[this.nameCur.c];
      const curY = rowY[this.nameCur.r];
      const marbleSize = Math.round((72 / ih) * rh);
      const marbleFrame = FRAMES.marble.roll[Math.floor(this.blink * 6) % 6];
      const mx = sx(curX) - marbleSize / 2;
      const my = sy(curY) - marbleSize / 2;
      const sheet = g.assets.sheets.marble;
      if (sheet) {
        r.screenCtx.drawImage(
          sheet,
          marbleFrame.x, marbleFrame.y, marbleFrame.w, marbleFrame.h,
          mx, my, marbleSize, marbleSize
        );
      }

      // Draw player name at bottom in arcade yellow font
      const fontSize = Math.max(16, Math.round((36 / ih) * rh));
      r.screenCtx.font = `bold ${fontSize}px "Courier New", monospace`;
      r.screenCtx.textBaseline = 'middle';
      r.screenCtx.textAlign = 'center';
      r.screenCtx.fillStyle = '#ffe019';
      
      const blinkChar = (Math.floor(this.blink * 3) % 2 === 0) ? '_' : ' ';
      const displayName = (g.playerName || '').toUpperCase().slice(0, NAME_MAX);
      const padded = (displayName + blinkChar).padEnd(NAME_MAX, '_');
      r.screenCtx.fillText(padded, sx(806), sy(895));
    } else {
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
    const img = g.assets.screenCache.get('player2webmcp_base') || g.assets.screenCache.get('player2webmcp');
    if (img) {
      const bounds = r.drawFullScreenImage(img);
      const { rx, ry, rw, rh } = bounds;
      const iw = img.width, ih = img.height;
      const sx = (x: number) => rx + (x / iw) * rw;
      const sy = (y: number) => ry + (y / ih) * rh;

      // 1. Dynamic Instructions inside the blue frame with unique slug!
      const fontSize = Math.max(12, Math.round((28 / ih) * rh));
      r.screenCtx.font = `bold ${fontSize}px "Courier New", monospace`;
      r.screenCtx.textBaseline = 'middle';

      const cx = sx(724);
      const y0 = sy(460);
      const dy = (52 / ih) * rh;

      // Line 1: 'Open ' (white) + 'https://marbles.secure.build/<slug>' (electric cyan)
      const prefix = 'Open ';
      const slug = g.lobbyId || 'lobby';
      const urlText = `https://marbles.secure.build/${slug}`;
      const wPrefix = r.screenCtx.measureText(prefix).width;
      const wUrl = r.screenCtx.measureText(urlText).width;
      const totalW = wPrefix + wUrl;
      const startX = cx - totalW / 2;

      r.screenCtx.textAlign = 'left';
      r.screenCtx.fillStyle = '#ffffff';
      r.screenCtx.fillText(prefix, startX, y0);
      r.screenCtx.fillStyle = '#61afef';
      r.screenCtx.fillText(urlText, startX + wPrefix, y0);

      // Line 2: 'in your embedded browser and' (white)
      r.screenCtx.textAlign = 'center';
      r.screenCtx.fillStyle = '#ffffff';
      r.screenCtx.fillText('in your embedded browser and', cx, y0 + dy);

      // Line 3: 'use WebMCP to challenge and' (white)
      r.screenCtx.fillText('use WebMCP to challenge and', cx, y0 + dy * 2);

      // Line 4: 'beat your human opponent' (white)
      r.screenCtx.fillText('beat your human opponent', cx, y0 + dy * 3);

      // 2. Center animated rolling blue marble over (721, 771)
      const mcx = sx(721), mcy = sy(771);
      const mw = (78 / iw) * rw;
      const mh = (78 / ih) * rh;
      const f = FRAMES.marble.roll[Math.floor(this.blink * 8) % 6];
      r.screenCtx.drawImage(g.assets.sheets.marble, f.x, f.y, f.w, f.h, mcx - mw / 2, mcy - mh / 2, mw, mh);

      // 3. Feedback badge if copied to clipboard
      if (this.copiedTimer > 0) {
        const bx = sx(860), by = sy(55), bw = (520 / iw) * rw, bh = (125 / ih) * rh;
        r.screenCtx.fillStyle = '#fff44f';
        r.screenCtx.fillRect(bx, by, bw, bh);
        r.screenCtx.strokeStyle = '#ffffff';
        r.screenCtx.lineWidth = Math.max(2, Math.round(3 * (rh / ih)));
        r.screenCtx.strokeRect(bx, by, bw, bh);
        r.screenCtx.fillStyle = '#000000';
        r.screenCtx.font = `bold ${Math.round((28 / ih) * rh)}px "Courier New", monospace`;
        r.screenCtx.textAlign = 'center';
        r.screenCtx.textBaseline = 'middle';
        r.screenCtx.fillText('COPIED TO CLIPBOARD!', bx + bw / 2, by + bh / 2);
      }

      // 4. Status text at bottom (x=724, y=962)
      r.screenCtx.font = `bold ${Math.round((22 / ih) * rh)}px "Courier New", monospace`;
      r.screenCtx.textAlign = 'center';
      r.screenCtx.textBaseline = 'middle';
      if (g.agentJoined) {
        r.screenCtx.fillStyle = '#50fa7b';
        r.screenCtx.fillText('AGENT CONNECTED! STARTING RACE...', cx, sy(962));
      } else {
        const dots = '.'.repeat(1 + (Math.floor(this.blink * 2) % 3));
        r.screenCtx.fillStyle = '#79a8ff';
        r.screenCtx.fillText(`Waiting for agent to join${dots}`, cx, sy(962));
      }
    } else {
      r.textC('PLAYER VS AI', VIEW_W / 2, 30, 'lavender');
      r.textC('CONNECT YOUR AGENT', VIEW_W / 2, 46, 'lavender');
      r.textC('LOBBY', VIEW_W / 2, 90, 'white');
      r.textC(g.lobbyId.slice(0, 8).toUpperCase(), VIEW_W / 2, 102, 'cyan');
      const dots = '.'.repeat(1 + (Math.floor(this.blink * 2) % 3));
      r.textC(g.agentJoined ? 'AGENT CONNECTED!' : `WAITING FOR AGENT${dots}`, VIEW_W / 2, 150, 'orange');
      r.textC('ESC TO CANCEL', VIEW_W / 2, 210, 'white');
    }
  }

  private renderCongrats(): void {
    const g = this.g; const r = g.r;
    // rain of coloured marbles in the background
    const F = FRAMES.marble.roll;
    for (const m of this.rain) {
      r.ctx.save();
      r.ctx.filter = `hue-rotate(${m.c * 60}deg)`;
      drawFrame(r.ctx, g.assets.sheets.marble, F[((Math.floor((this.blink + m.y) * 0.3) % 6) + 6) % 6], m.x, m.y);
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
