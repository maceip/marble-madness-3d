import { BitmapFont } from '../engine/font';

export interface TrackerTarget {
  id: string;
  screenX: number;
  screenY: number;
  vx: number;
  vy: number;
  visible: boolean;
}

export interface TrackerRenderState {
  targetX: number;
  targetY: number;
  tagX: number;
  tagY: number;
  offscreen: boolean;
}

/**
 * A small cel-shaded pointer drawn in the same 288x240 coordinate space as the
 * course. The renderer owns camera projection, letterboxing and foldable
 * placement, so the marker cannot drift away on tall phones or foldables.
 */
export class AITrackerOverlay {
  private x = 0;
  private y = 0;
  private initialized = false;
  private lastTime = 0;

  render(
    ctx: CanvasRenderingContext2D,
    font: BitmapFont,
    target: TrackerTarget,
    viewW: number,
    viewH: number,
    time: number,
  ): TrackerRenderState {
    if (!this.initialized || time <= this.lastTime) {
      this.x = target.screenX;
      this.y = target.screenY;
      this.initialized = true;
    }

    const dt = Math.min(0.05, Math.max(1 / 240, time - this.lastTime));
    this.lastTime = time;
    // A short lead makes direction changes feel immediate without detaching the
    // pointer from the ball. The high spring rate settles in roughly two frames.
    const lead = 0.025;
    const follow = 1 - Math.exp(-32 * dt);
    this.x += (target.screenX + target.vx * lead - this.x) * follow;
    this.y += (target.screenY + target.vy * lead - this.y) * follow;

    const targetX = target.screenX;
    const targetY = target.screenY;
    const offscreen = targetX < -4 || targetX > viewW + 4 || targetY < -4 || targetY > viewH + 4;
    const tagX = Math.max(33, Math.min(viewW - 33, this.x));
    const labelBelow = !offscreen && this.y < 64;
    const tagY = offscreen
      ? Math.max(43, Math.min(viewH - 18, this.y))
      : Math.max(43, Math.min(viewH - 18, this.y + (labelBelow ? 30 : -30)));

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'square';

    if (target.visible && !offscreen) {
      const pulse = 10.5 + Math.sin(time * 9) * 1.2;
      const glow = ctx.createRadialGradient(targetX, targetY, 5, targetX, targetY, 18);
      glow.addColorStop(0, 'rgba(64,240,255,0)');
      glow.addColorStop(0.48, 'rgba(64,240,255,0.10)');
      glow.addColorStop(0.72, 'rgba(32,126,255,0.34)');
      glow.addColorStop(1, 'rgba(32,126,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(targetX - 19, targetY - 19, 38, 38);

      ctx.strokeStyle = '#030611';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(targetX + 1, targetY + 1, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#5af4ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(targetX, targetY, pulse, 0.18, Math.PI * 1.62); ctx.stroke();
      ctx.strokeStyle = '#3478ff';
      ctx.beginPath(); ctx.arc(targetX, targetY, pulse, Math.PI * 1.62, Math.PI * 2.18); ctx.stroke();
    }

    const anchorY = offscreen ? targetY : targetY + (labelBelow ? 11 : -11);
    ctx.strokeStyle = '#030611'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(tagX, tagY + 9); ctx.lineTo(targetX, anchorY); ctx.stroke();
    ctx.strokeStyle = offscreen ? '#ffd634' : '#5af4ff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(tagX, tagY + 9); ctx.lineTo(targetX, anchorY); ctx.stroke();

    const w = 62, h = 18, x = Math.round(tagX - w / 2), y = Math.round(tagY - h / 2);
    const cut = 4;
    const bubble = () => {
      ctx.beginPath();
      ctx.moveTo(x + cut, y); ctx.lineTo(x + w - cut, y); ctx.lineTo(x + w, y + cut);
      ctx.lineTo(x + w, y + h - cut); ctx.lineTo(x + w - cut, y + h);
      ctx.lineTo(x + cut, y + h); ctx.lineTo(x, y + h - cut); ctx.lineTo(x, y + cut); ctx.closePath();
    };
    bubble(); ctx.fillStyle = '#030611'; ctx.fill(); ctx.strokeStyle = '#030611'; ctx.lineWidth = 5; ctx.stroke();
    bubble(); ctx.fillStyle = offscreen ? '#5e2900' : '#07304a'; ctx.fill(); ctx.strokeStyle = offscreen ? '#ffd634' : '#5af4ff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = offscreen ? '#ff8a18' : '#1679d2';
    ctx.fillRect(x + 4, y + 3, w - 8, 2);
    ctx.fillStyle = '#010208';
    ctx.fillRect(x + 4, y + h - 5, w - 8, 2);
    font.drawCentered(ctx, offscreen ? 'AI >' : 'THIS IS AI', tagX, y + 6, offscreen ? 'orange' : 'cyan');

    ctx.restore();
    return { targetX, targetY, tagX, tagY, offscreen };
  }
}
