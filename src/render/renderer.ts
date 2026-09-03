import { VIEW_W, VIEW_H } from '../engine/constants';
import { toMap } from '../engine/iso';
import { StageDef } from '../engine/level';
import { Assets, drawFrame, FRAMES, Frame } from '../engine/assets';
import { BitmapFont, FontVariant } from '../engine/font';

export interface Camera { y: number; x: number }

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
    const w = window.innerWidth, h = window.innerHeight;
    const s = Math.max(1, Math.floor(Math.min(w / VIEW_W, h / VIEW_H)));
    this.scale = s;
    this.canvas.width = VIEW_W * s; this.canvas.height = VIEW_H * s;
    this.canvas.style.width = `${VIEW_W * s}px`; this.canvas.style.height = `${VIEW_H * s}px`;
    this.screenCtx.imageSmoothingEnabled = false;
  }

  /** world → view pixel */
  project(u: number, v: number, z: number): { x: number; y: number } {
    const m = toMap(u, v, z);
    return { x: Math.round(m.x - this.cam.x), y: Math.round(m.y - this.cam.y) };
  }

  clear(color = '#000'): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawStage(img: HTMLImageElement, stage: StageDef): void {
    const sx = this.cam.x, sy = this.cam.y;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // clamp source rect to the image
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
    const x1 = Math.min(img.width, sx + VIEW_W), y1 = Math.min(img.height, sy + VIEW_H);
    if (x1 > x0 && y1 > y0) {
      this.ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0 - sx, y0 - sy, x1 - x0, y1 - y0);
    }
    void stage;
  }

  drawSprites(sprites: Sprite[]): void {
    sprites.sort((a, b) => ((a.u + a.v) * 4 + (a.depthBias ?? 0)) - ((b.u + b.v) * 4 + (b.depthBias ?? 0)));
    for (const s of sprites) {
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
    const bx = Math.round(VIEW_W / 2 - tw / 2) - 3;
    ctx.fillStyle = '#7d7d7d';
    ctx.fillRect(bx, 5, tw + 6, 18);
    this.font.drawBig(ctx, timeText, bx + 3, 7);
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
    this.screenCtx.drawImage(this.off, 0, 0, VIEW_W, VIEW_H, 0, 0, VIEW_W * this.scale, VIEW_H * this.scale);
  }
}
