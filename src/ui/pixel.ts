import type { BitmapFont, FontVariant } from '../engine/font';

/** Paint one bitmap-font string (media/art/Font.png / sprites/font.png) onto a crisp canvas. */
export function pxCanvas(font: BitmapFont, text: string, variant: FontVariant = 'white', scale = 2, spacing = 0): HTMLCanvasElement {
  const w = Math.max(1, font.width(text, spacing) * scale);
  const h = font.meta.cell * scale;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  font.draw(ctx, text, 0, 0, variant, scale, spacing);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  c.style.imageRendering = 'pixelated';
  c.setAttribute('aria-hidden', 'true');
  return c;
}

export function pxFill(el: HTMLElement | null, font: BitmapFont, text: string, variant: FontVariant = 'white', scale = 2, spacing = 0): void {
  if (!el) return;
  el.replaceChildren(pxCanvas(font, text, variant, scale, spacing));
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
