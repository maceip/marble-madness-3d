import type { BitmapFont, FontVariant } from '../engine/font';

/** Menu palette from the conformance wireframes. The atlas only carries white/cyan/orange/lavender/blue glyphs, so these
 *  are applied as a tint over the white glyphs (every glyph is a single flat colour, so the recolour is lossless). */
export const UI = {
  blue: '#46a0ff',      // headings: HIGH ROLLERS, PLAYER 1, CONNECT YOUR AGENT, WAITING FOR AGENT
  frame: '#32a0f4',     // panel borders / rules
  gold: '#ffc008',      // leaderboard header + ranks, RUB, splash PRESS START
  yellow: '#ffee33',    // menu PRESS START, the typed name, COPY PROMPT, YES
  cyan: '#00ffff',      // URL, END, the top roller
  white: '#ffffff',
} as const;
export type UiColor = (typeof UI)[keyof typeof UI] | string;

/** Paint one bitmap-font string (media/art/Font.png / sprites/font.png) onto a crisp canvas.
 *  `tint` recolours the glyphs to any CSS colour (drawn from the white variant). */
export function pxCanvas(font: BitmapFont, text: string, variant: FontVariant = 'white', scale = 2, spacing = 0, tint?: string): HTMLCanvasElement {
  const w = Math.max(1, font.width(text, spacing) * scale);
  const h = font.meta.cell * scale;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  font.draw(ctx, text, 0, 0, tint ? 'white' : variant, scale, spacing);
  if (tint) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  c.style.imageRendering = 'pixelated';
  c.setAttribute('aria-hidden', 'true');
  return c;
}

export function pxFill(el: HTMLElement | null, font: BitmapFont, text: string, variant: FontVariant = 'white', scale = 2, spacing = 0, tint?: string): void {
  if (!el) return;
  el.replaceChildren(pxCanvas(font, text, variant, scale, spacing, tint));
}

/** Tinted convenience wrappers (see UI). */
export function pxTint(font: BitmapFont, text: string, color: string, scale = 2, spacing = 0): HTMLCanvasElement {
  return pxCanvas(font, text, 'white', scale, spacing, color);
}
export function pxFillTint(el: HTMLElement | null, font: BitmapFont, text: string, color: string, scale = 2, spacing = 0): void {
  if (!el) return;
  el.replaceChildren(pxTint(font, text, color, scale, spacing));
}

/** Words of `text` as separate glyph canvases inside a flex-wrap row, so long headings wrap by word on narrow screens. */
export function pxWords(el: HTMLElement | null, font: BitmapFont, text: string, color: string, scale = 2): void {
  if (!el) return;
  el.replaceChildren();
  for (const word of text.split(' ')) {
    const w = document.createElement('span');
    w.className = 'ui-word';
    w.appendChild(pxTint(font, word, color, scale));
    el.appendChild(w);
  }
}

/** One glyph per child, flex-spaced across the full width ("W E B M C P …"). */
export function pxSpread(el: HTMLElement | null, font: BitmapFont, text: string, variant: FontVariant = 'white', scale = 2): void {
  if (!el) return;
  el.replaceChildren();
  const chars = [...text.toUpperCase()];
  for (const ch of chars) {
    const slot = document.createElement('span');
    slot.className = ch === ' ' ? 'ui-spread-gap' : 'ui-spread-letter';
    if (ch !== ' ') slot.appendChild(pxCanvas(font, ch, variant, scale));
    el.appendChild(slot);
  }
}

export function uiScale(): number {
  const w = window.innerWidth, h = window.innerHeight;
  const short = Math.min(w, h);
  // media/art/Font.png is an 8 px arcade font. A 2x default made every phone menu read
  // like a desktop layout squeezed into 400 CSS pixels. Keep body/menu copy at
  // the source atlas' native 1x size on phones; individual hero labels opt into
  // 2x where the reference composition calls for it.
  if (short < 520) return 1;
  if (w >= 1200 && h >= 700) return 3;
  if (short >= 700) return 3;
  return 2;
}

export function flashPress(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.add('pressed');
  window.setTimeout(() => el.classList.remove('pressed'), 140);
}

export function colorVariant(color: string): FontVariant {
  const c = color.toLowerCase();
  if (/ffba3b|ffe019|ffd23f|ff8/.test(c)) return 'orange';
  if (/79a8ff|33e0|4be3|61af|33ff|1d9b/.test(c)) return 'cyan';
  if (/b7a7|8e96|656b|9aa0|c5cb|lavender/.test(c)) return 'lavender';
  if (/#00c|#248|#3a4/.test(c)) return 'blue';
  return 'white';
}
