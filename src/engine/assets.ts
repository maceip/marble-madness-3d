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
  /** NES-style animated assets (animated_assets/) */
  p1roll: HTMLImageElement;
  p2roll: HTMLImageElement;
  hammerNes: HTMLImageElement;
  vacuumL: HTMLImageElement;
  vacuumR: HTMLImageElement;
  birdL: HTMLImageElement;
  birdR: HTMLImageElement;
  flagBlue: HTMLImageElement;
  flagRed: HTMLImageElement;
}

export class Assets {
  sheets!: Sheets;
  font!: BitmapFont;
  stages = new Map<string, HTMLImageElement>();

  async load(onProgress?: (frac: number) => void): Promise<void> {
    const names: (keyof Sheets)[] = ['marble', 'marbleRed', 'worm', 'slime', 'bird', 'hammer', 'vacuum', 'riser', 'objects',
      'p1roll', 'p2roll', 'hammerNes', 'vacuumL', 'vacuumR', 'birdL', 'birdR', 'flagBlue', 'flagRed'];
    const files: Record<keyof Sheets, string> = {
      marble: 'sprites/marble_effects.png', marbleRed: 'sprites/marble_effects_red.png', worm: 'sprites/worm.png',
      slime: 'sprites/slime.png', bird: 'sprites/bird.png', hammer: 'sprites/hammer.png', vacuum: 'sprites/vacuum.png', riser: 'sprites/riser.png',
      objects: 'sprites/objects.png',
      p1roll: 'sprites/p1roll.png', p2roll: 'sprites/p2roll.png', hammerNes: 'sprites/hammer_nes.png',
      vacuumL: 'sprites/vacuum_l.png', vacuumR: 'sprites/vacuum_r.png', birdL: 'sprites/bird_l.png', birdR: 'sprites/bird_r.png',
      flagBlue: 'sprites/flag_blue.png', flagRed: 'sprites/flag_red.png',
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

    const screenNames = ['title_base', 'title2', 'select_base', 'select', 'player2webmcp_base', 'player2webmcp', 'cursor'];
    await Promise.all(screenNames.map(async (n) => {
      try {
        const im = await loadImage(ASSET_ROOT + `screens/${n}.png`);
        this.screenCache.set(n, im);
      } catch (e) {
        console.warn('Could not preload screen', n, e);
      }
    }));
  }

  async stage(image: string): Promise<HTMLImageElement> {
    let im = this.stages.get(image);
    if (!im) {
      im = await loadImage(ASSET_ROOT + image);
      this.stages.set(image, im);
    }
    return im;
  }

  private goalLitCache = new Map<string, HTMLImageElement>();
  async goalLit(stageId: number, color: 'blue' | 'red' = 'blue'): Promise<HTMLImageElement | null> {
    const key = `stages/goal_${color}_${stageId}.png`;
    let im = this.goalLitCache.get(key);
    if (!im) {
      try {
        im = await loadImage(ASSET_ROOT + key);
        this.goalLitCache.set(key, im);
      } catch {
        return null;
      }
    }
    return im;
  }

  screenCache = new Map<string, HTMLImageElement>();
  async screen(name: string): Promise<HTMLImageElement | null> {
    let im = this.screenCache.get(name);
    if (!im) {
      try {
        im = await loadImage(ASSET_ROOT + `screens/${name}.png`);
        this.screenCache.set(name, im);
      } catch {
        return null;
      }
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
