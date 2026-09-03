import { VIEW_W, VIEW_H } from '../engine/constants';
import { toMap } from '../engine/iso';
import { StageDef } from '../engine/level';
import { Assets, drawFrame, FRAMES, Frame } from '../engine/assets';
import { BitmapFont, FontVariant } from '../engine/font';

export interface Camera { y: number; x: number }

const badFrameWarned = new Set<string>();

export interface Sprite {
  img: HTMLImageElement;
  frame: Frame;
  /** world position (ground point) */
  u: number; v: number; z: number;
  /** extra screen offset */
  dx?: number; dy?: number;
  flip?: boolean;
  /** draw order override (added to depth) */
  depthBias?: number;
  alpha?: number;
  /** optional shadow ellipse height above ground (px) */
  shadowZ?: number;
}

export interface Label {
  text: string; u: number; v: number; z: number; dy?: number; variant?: FontVariant; big?: boolean;
}

/**
 * Pixel renderer: draws into a 288x240 offscreen canvas, then blits with integer scaling.
 */
export class Renderer {
  readonly off: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly screenCtx: CanvasRenderingContext2D;
  scale = 3;
  cam: Camera = { x: 0, y: 0 };
  font: BitmapFont;

  viewW = VIEW_W;
  viewH = VIEW_H;

  constructor(readonly canvas: HTMLCanvasElement, readonly assets: Assets) {
    this.off = document.createElement('canvas');
    this.off.width = VIEW_W; this.off.height = VIEW_H;
    this.ctx = this.off.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;
    this.screenCtx = canvas.getContext('2d', { alpha: false })!;
    this.font = assets.font;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = (parent && parent !== document.body && parent.clientWidth > 0) ? parent.clientWidth : window.innerWidth;
    const h = (parent && parent !== document.body && parent.clientHeight > 0) ? parent.clientHeight : window.innerHeight;
    this.viewW = VIEW_W;
    // Adapt viewH to match aspect ratio so game fills the container without black borders
    this.viewH = Math.max(VIEW_H, Math.min(640, Math.round(VIEW_W * (h / w))));
    this.off.width = this.viewW;
    this.off.height = this.viewH;

    this.canvas.width = w;
    this.canvas.height = h;
    if (parent === document.body || !parent) {
      this.canvas.style.width = '100vw';
      this.canvas.style.height = '100vh';
    } else {
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
    }
    this.screenCtx.imageSmoothingEnabled = false;
  }

  /** world → view pixel */
  project(u: number, v: number, z: number): { x: number; y: number } {
    const m = toMap(u, v, z);
    return { x: Math.round(m.x - this.cam.x), y: Math.round(m.y - this.cam.y) };
  }

  clear(color = '#000'): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  drawStage(img: HTMLImageElement, stage: StageDef): void {
    const sx = this.cam.x, sy = this.cam.y;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.viewW, this.viewH);
    // clamp source rect to the image
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
    const x1 = Math.min(img.width, sx + this.viewW), y1 = Math.min(img.height, sy + this.viewH);
    if (x1 > x0 && y1 > y0) {
      this.ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0 - sx, y0 - sy, x1 - x0, y1 - y0);
    }
    void stage;
  }

  drawSprites(sprites: Sprite[]): void {
    sprites.sort((a, b) => ((a.u + a.v) * 4 + (a.depthBias ?? 0)) - ((b.u + b.v) * 4 + (b.depthBias ?? 0)));
    for (const s of sprites) {
      if (!s.frame) {
        // a bad frame index must never kill the render loop; report it once per sheet
        const key = s.img?.src ?? '?';
        if (!badFrameWarned.has(key)) { badFrameWarned.add(key); console.warn('[sprite] missing frame for', key, 'at', s.u.toFixed(1), s.v.toFixed(1), s.z.toFixed(1)); }
        continue;
      }
      const g = this.project(s.u, s.v, s.z);
      if (s.shadowZ !== undefined && s.shadowZ > 1) {
        const gs = this.project(s.u, s.v, s.z - s.shadowZ);
        this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
        this.ctx.beginPath();
        this.ctx.ellipse(gs.x, gs.y + 6, 6, 3, 0, 0, Math.PI * 2);
        this.ctx.fill();
      }
      if (s.alpha !== undefined && s.alpha < 1) this.ctx.globalAlpha = s.alpha;
      drawFrame(this.ctx, s.img, s.frame, g.x + (s.dx ?? 0), g.y + (s.dy ?? 0), s.flip);
      this.ctx.globalAlpha = 1;
    }
  }

  drawLabels(labels: Label[]): void {
    for (const l of labels) {
      const p = this.project(l.u, l.v, l.z);
      const y = p.y + (l.dy ?? -22);
      if (l.big) this.font.drawBig(this.ctx, l.text, p.x - this.font.bigWidth(l.text) / 2, y);
      else this.font.drawCentered(this.ctx, l.text, p.x, y, l.variant ?? 'white');
    }
  }

  /** score top-left, timer top-centre in a grey box */
  drawHud(scoreText: string, timeText: string, opts?: { scoreColor?: FontVariant; dim?: boolean }): void {
    const ctx = this.ctx;
    this.font.draw(ctx, scoreText, 12, 22, opts?.scoreColor ?? 'lavender');
    const tw = this.font.bigWidth(timeText);
    const bx = Math.round(this.viewW / 2 - tw / 2) - 3;
    ctx.fillStyle = '#7d7d7d';
    ctx.fillRect(bx, 5, tw + 6, 18);
    this.font.drawBig(ctx, timeText, bx + 3, 7);
  }

  private tintCanvas: HTMLCanvasElement | null = null;
  /** draw via `fn` into a scratch canvas, recolour every opaque pixel to `color`, blit at (x, y) */
  private tinted(w: number, h: number, x: number, y: number, color: string, fn: (c: CanvasRenderingContext2D) => void): void {
    if (!this.tintCanvas) this.tintCanvas = document.createElement('canvas');
    const c = this.tintCanvas;
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
    const cx = c.getContext('2d')!;
    cx.clearRect(0, 0, c.width, c.height);
    cx.globalCompositeOperation = 'source-over';
    fn(cx);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color; cx.fillRect(0, 0, w, h);
    this.ctx.drawImage(c, 0, 0, w, h, Math.round(x), Math.round(y), w, h);
  }

  textTinted(text: string, x: number, y: number, color: string): void {
    const w = this.font.width(text) + 1;
    this.tinted(w, 9, x, y, color, (c) => this.font.draw(c, text, 0, 0, 'white'));
  }

  /** big timer digits in an arbitrary colour (the sheet only has blue) */
  drawBigTinted(text: string, x: number, y: number, color: string): void {
    const w = this.font.bigWidth(text) + 2;
    this.tinted(w, 16, x, y, color, (c) => this.font.drawBig(c, text, 0, 0));
  }

  /** arcade 2-player HUD: P1 blue on the left, P2 red on the right, each with SCORE + timer */
  drawHud2P(p1: { score: string; time: string }, p2: { score: string; time: string }): void {
    const ctx = this.ctx;
    const blue = '#5a7cff', red = '#ff5a5a';
    this.textTinted('SCORE', 8, 4, blue);
    this.textTinted(p1.score, 8, 14, blue);
    const w1 = this.font.bigWidth(p1.time);
    ctx.fillStyle = '#7d7d7d'; ctx.fillRect(84, 5, w1 + 6, 18);
    this.drawBigTinted(p1.time, 87, 7, blue);
    const w2 = this.font.bigWidth(p2.time);
    ctx.fillStyle = '#7d7d7d'; ctx.fillRect(this.viewW - 90 - w2, 5, w2 + 6, 18);
    this.drawBigTinted(p2.time, this.viewW - 87 - w2, 7, red);
    this.textTinted('SCORE', this.viewW - 8 - this.font.width('SCORE'), 4, red);
    this.textTinted(p2.score, this.viewW - 8 - this.font.width(p2.score), 14, red);
  }

  /** black banner box with text lines (used for TIME TO FINISH / TIME BONUS) */
  drawBox(x: number, y: number, w: number, h: number): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(x, y, w, h);
  }

  text(text: string, x: number, y: number, variant: FontVariant = 'white', scale = 1): void {
    this.font.draw(this.ctx, text, x, y, variant, scale);
  }

  textC(text: string, cx: number, y: number, variant: FontVariant = 'white', scale = 1): void {
    this.font.drawCentered(this.ctx, text, cx, y, variant, scale);
  }

  /** right-aligned text ending at x */
  textR(text: string, xRight: number, y: number, variant: FontVariant = 'white'): void {
    this.font.draw(this.ctx, text, xRight - this.font.width(text), y, variant);
  }

  logo(cx: number, y: number): void {
    const f = FRAMES.objects.logo[0];
    drawFrame(this.ctx, this.assets.sheets.objects, f, Math.round(cx - f.w / 2), y);
  }

  present(): void {
    this.screenCtx.imageSmoothingEnabled = false;
    this.screenCtx.drawImage(this.off, 0, 0, this.viewW, this.viewH, 0, 0, this.canvas.width, this.canvas.height);
  }

  drawLitGoal(overlay: HTMLImageElement, stageId: number): void {
    const bbox = GOAL_OVERLAY_BBOX[stageId];
    if (!bbox) return;
    const sx = bbox.x0 - this.cam.x;
    const sy = bbox.y0 - this.cam.y;
    this.ctx.drawImage(overlay, Math.round(sx), Math.round(sy));
  }

  /** Draw a full-screen image centered with letterbox/pillarbox to preserve aspect ratio. */
  drawFullScreenImage(img: HTMLImageElement): { rx: number; ry: number; rw: number; rh: number; scale: number } {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = Math.min(cw / img.width, ch / img.height);
    const rw = Math.round(img.width * scale);
    const rh = Math.round(img.height * scale);
    const rx = Math.round((cw - rw) / 2);
    const ry = Math.round((ch - rh) / 2);

    this.screenCtx.fillStyle = '#000000';
    this.screenCtx.fillRect(0, 0, cw, ch);
    this.screenCtx.imageSmoothingEnabled = false;
    this.screenCtx.drawImage(img, 0, 0, img.width, img.height, rx, ry, rw, rh);
    return { rx, ry, rw, rh, scale };
  }
}

export const GOAL_OVERLAY_BBOX: Record<number, { x0: number; y0: number }> = {
  1: { x0: 18, y0: 485 },
  2: { x0: 105, y0: 1065 },
  3: { x0: 187, y0: 1005 },
  4: { x0: 43, y0: 942 },
  5: { x0: 105, y0: 32 },
  6: { x0: 111, y0: 676 },
};

