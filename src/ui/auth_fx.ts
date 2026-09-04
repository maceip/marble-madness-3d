import type { Assets } from '../engine/assets';
import { FRAMES, ASSET_ROOT } from '../engine/assets';

/**
 * Sign-in verdict on the name screen. The stage-5/6 bird flock (sprites/bird_l|r.png) does a fly-by trailing the
 * marble sparkle frames while the pixel speech bubble (assets/ui/bubble_body.png 9-slice + bubble_tail.png, see
 * tools/bubble_gen.py) pops up centre-screen saying SUCCESS or what went wrong. Drawn on the #ui-fx overlay
 * canvas in CSS px; `s` is the integer screen px per art cell (birds, bubble and text share it).
 */
interface Bird { x: number; y: number; vx: number; vy: number; phase: number; wob: number }
interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number }

const SLICE = { top: 3, right: 5, bottom: 4, left: 5 };   // bubble_body.png 15x8
const PAD = { top: 1, right: 2, bottom: 2, left: 2 };      // text inset inside the slice borders (cells)
const TAIL = { w: 10, h: 8, fromRight: 16, overlap: 2 };   // bubble_tail.png, anchored bottom-right
const SPARK_ROWS = 12;                                     // star-only rows of the marble sparkle frames

export class AuthCelebration {
  active = false;
  kind: 'ok' | 'error' = 'ok';
  /** total length; the screen flow waits this long before moving on */
  readonly duration = 2.6;
  private lines: string[] = [];
  private t = 0;
  private w = 1;
  private h = 1;
  private s = 2;
  private birds: Bird[] = [];
  private sparks: Spark[] = [];
  private wave2 = false;
  private body: HTMLImageElement | null = null;
  private tail: HTMLImageElement | null = null;
  private text: { key: string; canvas: HTMLCanvasElement } | null = null;
  /** fires when the second flock enters (a chirp cue for the caller) */
  onFlock: (() => void) | null = null;

  constructor() {
    for (const [k, f] of [['body', 'ui/bubble_body.png'], ['tail', 'ui/bubble_tail.png']] as const) {
      const im = new Image();
      im.onload = () => { this[k] = im; };
      im.src = ASSET_ROOT + f;
    }
  }

  start(kind: 'ok' | 'error', lines: string[], w: number, h: number, cellPx: number): void {
    this.active = true; this.kind = kind; this.lines = lines.map((l) => l.toUpperCase());
    this.t = 0; this.w = Math.max(1, w); this.h = Math.max(1, h); this.s = Math.max(2, Math.round(cellPx));
    this.birds = []; this.sparks = []; this.wave2 = false; this.text = null;
    this.flock(true);
  }

  stop(): void { this.active = false; this.birds = []; this.sparks = []; }

  /** a flock of 5 enters from one side at mid-height and crosses in ~1.1 s, loosely stacked like the stage fly-bys */
  private flock(fromLeft: boolean): void {
    const s = this.s, n = 5, midY = this.h * 0.42;
    for (let i = 0; i < n; i++) {
      const lead = i * 23 * s * 0.5;
      const x = fromLeft ? -30 * s - lead : this.w + 30 * s + lead;
      const y = midY + (i - (n - 1) / 2) * 11 * s + (Math.random() - 0.5) * 6 * s;
      const vx = (fromLeft ? 1 : -1) * (this.w + 80 * s) / 1.1;
      this.birds.push({ x, y, vx, vy: (Math.random() - 0.5) * 12 * s, phase: Math.random() * 10, wob: 2 + Math.random() * 3 });
    }
  }

  update(dt: number, w: number, h: number): void {
    if (!this.active) return;
    if (Math.abs(w - this.w) > 1 || Math.abs(h - this.h) > 1) { this.w = Math.max(1, w); this.h = Math.max(1, h); this.text = null; }
    this.t += dt;
    if (!this.wave2 && this.t > 0.75) { this.wave2 = true; this.flock(false); this.onFlock?.(); }
    const s = this.s;
    for (const b of this.birds) {
      b.x += b.vx * dt; b.y += b.vy * dt + Math.sin((this.t + b.phase) * b.wob * 2) * 0.6 * s * dt * 10;
      // sparkle trail: roughly one every 55 ms per bird, drifting behind and sinking
      if (Math.random() < dt / 0.055) {
        const back = b.vx > 0 ? -1 : 1;
        this.sparks.push({ x: b.x + back * 9 * s + (Math.random() - 0.5) * 6 * s, y: b.y + (Math.random() - 0.5) * 10 * s,
          vx: back * 12 * s, vy: 18 * s, age: 0, life: 0.32 + Math.random() * 0.2 });
      }
    }
    this.birds = this.birds.filter((b) => b.x > -60 * s && b.x < this.w + 60 * s);
    for (const p of this.sparks) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.sparks = this.sparks.filter((p) => p.age < p.life);
    if (this.t >= this.duration && !this.birds.length && !this.sparks.length) this.stop();
  }

  /** bubble scale: overshoot pop-in at 0.25 s, hold, shrink away over the last 0.3 s */
  private bubbleScale(): number {
    const a = (this.t - 0.25) / 0.35;
    if (a <= 0) return 0;
    const out = (this.t - (this.duration - 0.3)) / 0.3;
    if (out >= 1) return 0;
    if (out > 0) return 1 - out * out;
    if (a >= 1) return 1;
    const k = 1 - a;                                  // cubic-bezier(.2,1.4,.4,1)-ish: pop past 1 then settle
    return 1 + 0.18 * Math.sin(a * Math.PI) - k * k * k;
  }

  draw(ctx: CanvasRenderingContext2D, assets: Assets): void {
    if (!this.active) return;
    ctx.imageSmoothingEnabled = false;
    const s = this.s;
    // sparkles behind the birds: the goal sparkle star (small cross <-> 8-ray twinkle at 8 Hz). Those frames carry the
    // shattered-marble pile in their lower rows, so only the top SPARK_ROWS of each are used.
    const sheet = assets.sheets.marble, fr = [FRAMES.marble.sparkle[0], FRAMES.marble.pileSparkle[1]];
    for (const p of this.sparks) {
      const f = fr[Math.floor(p.age * 8) % fr.length];
      const k = 1 - p.age / p.life, sz = Math.max(1, Math.round(s * (0.5 + 0.5 * k)));
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.drawImage(sheet, f.x, f.y, f.w, SPARK_ROWS, Math.round(p.x - f.px * sz), Math.round(p.y - (SPARK_ROWS / 2) * sz), f.w * sz, SPARK_ROWS * sz);
    }
    ctx.globalAlpha = 1;
    for (const b of this.birds) {
      const dir = b.vx < 0 ? FRAMES.birdL : FRAMES.birdR;
      const img = b.vx < 0 ? assets.sheets.birdL : assets.sheets.birdR;
      const f = dir[Math.floor((this.t + b.phase) * 6) % dir.length];   // 2 flap frames at 160 ms, as in hazards.ts
      ctx.drawImage(img, f.x, f.y, f.w, f.h, Math.round(b.x - f.px * s), Math.round(b.y - f.py * s), f.w * s, f.h * s);
    }
    this.drawBubble(ctx, assets);
  }

  private drawBubble(ctx: CanvasRenderingContext2D, assets: Assets): void {
    const k = this.bubbleScale();
    if (k <= 0 || !this.body || !this.tail) return;
    const s = this.s, font = assets.font;
    const textW = Math.max(...this.lines.map((l) => font.width(l))) * s;
    const gap = 2 * s, lineH = font.meta.cell * s;
    const textH = this.lines.length * lineH + (this.lines.length - 1) * gap;
    const W = (SLICE.left + PAD.left + PAD.right + SLICE.right) * s + textW;
    const H = (SLICE.top + PAD.top + PAD.bottom + SLICE.bottom) * s + textH;
    const cx = Math.round(this.w / 2), cy = Math.round(this.h * 0.42);
    const x = Math.round(cx - W / 2), y = Math.round(cy - H / 2);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
    // 9-slice body: bubble_body.png is 15x8 cells, slices top 3 / right 5 / bottom 4 / left 5
    const b = this.body, bw = b.naturalWidth || 15, bh = b.naturalHeight || 8;
    const midW = bw - SLICE.left - SLICE.right, midH = bh - SLICE.top - SLICE.bottom;
    const cols = [[0, SLICE.left, x, SLICE.left * s], [SLICE.left, midW, x + SLICE.left * s, W - (SLICE.left + SLICE.right) * s], [bw - SLICE.right, SLICE.right, x + W - SLICE.right * s, SLICE.right * s]];
    const rows = [[0, SLICE.top, y, SLICE.top * s], [SLICE.top, midH, y + SLICE.top * s, H - (SLICE.top + SLICE.bottom) * s], [bh - SLICE.bottom, SLICE.bottom, y + H - SLICE.bottom * s, SLICE.bottom * s]];
    for (const [sy, sh, dy, dh] of rows) for (const [sx, sw, dx, dw] of cols) {
      if (sw > 0 && sh > 0 && dw > 0 && dh > 0) ctx.drawImage(b, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    // tail hangs off the bottom right, overlapping the body's outline + bevel rows
    ctx.drawImage(this.tail, x + W - TAIL.fromRight * s, y + H - TAIL.overlap * s, TAIL.w * s, TAIL.h * s);
    // verdict text in the bitmap font, recoloured black for the white fill
    const key = `${this.lines.join('\n')}|${s}`;
    if (!this.text || this.text.key !== key) {
      const c = document.createElement('canvas'); c.width = Math.max(1, textW); c.height = Math.max(1, textH);
      const tc = c.getContext('2d')!; tc.imageSmoothingEnabled = false;
      this.lines.forEach((l, i) => font.drawCentered(tc, l, textW / 2, i * (lineH + gap), 'white', s));
      tc.globalCompositeOperation = 'source-in'; tc.fillStyle = '#000'; tc.fillRect(0, 0, c.width, c.height);
      this.text = { key, canvas: c };
    }
    ctx.drawImage(this.text.canvas, x + (SLICE.left + PAD.left) * s, y + (SLICE.top + PAD.top) * s);
    ctx.restore();
  }
}
