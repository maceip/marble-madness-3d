import { FRAMES, Frame } from '../data/frames';
import { BitmapFont, FontMeta } from './font';

export const ASSET_ROOT = '/assets/';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export interface Sheets {
  marble: HTMLImageElement;
  marbleRed: HTMLImageElement;
  worm: HTMLImageElement;
  slime: HTMLImageElement;
  bird: HTMLImageElement;
  hammer: HTMLImageElement;
  vacuum: HTMLImageElement;
  riser: HTMLImageElement;
  objects: HTMLImageElement;
}

export class Assets {
  sheets!: Sheets;
  font!: BitmapFont;
  stages = new Map<string, HTMLImageElement>();

  async load(onProgress?: (frac: number) => void): Promise<void> {
    const names: (keyof Sheets)[] = ['marble', 'marbleRed', 'worm', 'slime', 'bird', 'hammer', 'vacuum', 'riser', 'objects'];
    const files: Record<keyof Sheets, string> = {
      marble: 'sprites/marble_effects.png', marbleRed: 'sprites/marble_effects_red.png', worm: 'sprites/worm.png',
      slime: 'sprites/slime.png', bird: 'sprites/bird.png', hammer: 'sprites/hammer.png', vacuum: 'sprites/vacuum.png', riser: 'sprites/riser.png',
      objects: 'sprites/objects.png',
    };
    let done = 0;
    const total = names.length + 2;
    const tick = () => { done++; onProgress?.(done / total); };
    const imgs = await Promise.all(names.map(async (n) => { const im = await loadImage(ASSET_ROOT + files[n]); tick(); return im; }));
    this.sheets = Object.fromEntries(names.map((n, i) => [n, imgs[i]])) as unknown as Sheets;
    const [fontImg, fontMeta] = await Promise.all([
      loadImage(ASSET_ROOT + 'sprites/font.png'),
      fetch(ASSET_ROOT + 'sprites/font.json').then((r) => r.json() as Promise<FontMeta>),
    ]);
    tick(); tick();
    this.font = new BitmapFont(fontImg, fontMeta);
  }

  async stage(image: string): Promise<HTMLImageElement> {
    let im = this.stages.get(image);
    if (!im) {
      im = await loadImage(ASSET_ROOT + image);
      this.stages.set(image, im);
    }
    return im;
  }
}

/** Draw a frame with its pivot at (x, y). */
export function drawFrame(ctx: CanvasRenderingContext2D, img: HTMLImageElement, f: Frame, x: number, y: number, flipX = false): void {
  const dx = Math.round(x - f.px), dy = Math.round(y - f.py);
  if (!flipX) {
    ctx.drawImage(img, f.x, f.y, f.w, f.h, dx, dy, f.w, f.h);
  } else {
    ctx.save();
    ctx.translate(Math.round(x + f.px), dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    ctx.restore();
  }
}

export { FRAMES };
export type { Frame };
