/** NES Marble Madness ending rain: glossy colored spheres falling in front of the tally. */

const PALETTE = [
  '#e02020', '#ff6a00', '#ffd428', '#7cff2a', '#20d070',
  '#20e0e8', '#3070ff', '#7040ff', '#c040e8', '#ff40a0',
];

export interface RainBall {
  x: number; y: number; vy: number; r: number; c: string;
}

export class MarbleRain {
  balls: RainBall[] = [];
  private w = 1;
  private h = 1;

  reset(w: number, h: number, count = 36): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.balls = [];
    const n = Math.max(22, Math.round(count * Math.min(this.w, this.h) / 640));
    for (let i = 0; i < n; i++) this.balls.push(this.spawn(true));
  }

  private spawn(scatter: boolean): RainBall {
    const r = 7 + Math.random() * 15;
    return {
      x: Math.random() * this.w,
      y: scatter ? Math.random() * this.h : -r - Math.random() * 80,
      vy: 70 + Math.random() * 140,
      r,
      c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    };
  }

  resize(w: number, h: number): void {
    if (Math.abs(w - this.w) < 2 && Math.abs(h - this.h) < 2) return;
    const sx = w / this.w, sy = h / this.h;
    this.w = w; this.h = h;
    for (const b of this.balls) { b.x *= sx; b.y *= sy; }
  }

  update(dt: number, w: number, h: number): void {
    this.resize(w, h);
    if (!this.balls.length) this.reset(w, h);
    for (const b of this.balls) {
      b.y += b.vy * dt;
      if (b.y - b.r > this.h) {
        const n = this.spawn(false);
        b.x = n.x; b.y = n.y; b.vy = n.vy; b.r = n.r; b.c = n.c;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.imageSmoothingEnabled = false;
    for (const b of this.balls) {
      const x = Math.round(b.x), y = Math.round(b.y), r = Math.round(b.r);
      ctx.beginPath();
      ctx.fillStyle = b.c;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.arc(x + r * 0.18, y + r * 0.22, r * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.arc(x - r * 0.32, y - r * 0.34, Math.max(1.5, r * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
