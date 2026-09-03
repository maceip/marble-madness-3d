export type FontVariant = 'white' | 'cyan' | 'orange' | 'lavender' | 'blue';

export interface FontMeta {
  cell: number;
  variants: FontVariant[];
  variantStride: number;
  glyphs: Record<string, [number, number]>;
  bigDigits: Record<string, [number, number, number, number]>;
}

const ALIASES: Record<string, string> = { '←': '←', '©': '©', 'a': 'A' };

export class BitmapFont {
  constructor(readonly img: HTMLImageElement, readonly meta: FontMeta) {}

  /** width of `text` in px at scale 1 */
  width(text: string, spacing = 0): number {
    return text.length * (this.meta.cell + spacing) - spacing;
  }

  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, variant: FontVariant = 'white', scale = 1, spacing = 0): void {
    const vi = Math.max(0, this.meta.variants.indexOf(variant));
    const cell = this.meta.cell;
    const upper = text.toUpperCase();
    let cx = Math.round(x);
    const cy = Math.round(y);
    for (const ch0 of upper) {
      const ch = ALIASES[ch0] ?? ch0;
      const g = this.meta.glyphs[ch];
      if (g) {
        ctx.drawImage(this.img, g[0], g[1] + vi * this.meta.variantStride, cell, cell, cx, cy, cell * scale, cell * scale);
      }
      cx += (cell + spacing) * scale;
    }
  }

  /** centred text */
  drawCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, variant: FontVariant = 'white', scale = 1, spacing = 0): void {
    const w = this.width(text, spacing) * scale;
    this.draw(ctx, text, Math.round(cx - w / 2), y, variant, scale, spacing);
  }

  /** big blue timer digits (14 px) */
  drawBig(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale = 1): number {
    let cx = Math.round(x);
    for (const ch of text) {
      const d = this.meta.bigDigits[ch];
      if (d) {
        ctx.drawImage(this.img, d[0], d[1], d[2], d[3], cx, Math.round(y), d[2] * scale, d[3] * scale);
        cx += (d[2] - 1) * scale;
      } else {
        cx += 8 * scale;
      }
    }
    return cx;
  }

  bigWidth(text: string, scale = 1): number {
    let w = 0;
    for (const ch of text) {
      const d = this.meta.bigDigits[ch];
      w += (d ? d[2] - 1 : 8) * scale;
    }
    return w;
  }
}

/** Format an integer with thousands separators like the NES HUD: 152,730 */
export function fmtScore(n: number): string {
  const v = Math.max(0, Math.floor(n));
  return v < 10 ? `0${v}` : v.toLocaleString('en-US');
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.min(99, Math.floor(sec)));
  return s < 10 ? `0${s}` : String(s);
}
