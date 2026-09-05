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

    // Low-profile tag (MANDATORY_CONFORMANCE/AI_CALLOUT_REDO.png): a two-glyph pill with a small pointer that hugs
    // the marble - above it by default, on its upper shoulder when the ball is near the top edge. No ring, no glow,
    // no leader line. Off screen, the pill clamps to the edge and the label gains a chevron toward the ball.
    const label = offscreen ? (targetX > viewW ? 'AI>' : targetX < 0 ? '<AI' : 'AI') : 'AI';
    const w = font.width(label) + 8, h = 12;            // 24x12 in the 288x240 space
    const ballR = 7, gap = 4;                            // marble radius; pointer height between pill and ball
    const cx = offscreen ? Math.max(w / 2 + 2, Math.min(viewW - w / 2 - 2, this.x)) : this.x;
    const cy = offscreen ? Math.max(h / 2 + 2, Math.min(viewH - h / 2 - 2, this.y)) : this.y;
    let side: 'above' | 'right' | 'left' | 'none' = offscreen ? 'none' : 'above';
    if (side === 'above' && cy - ballR - gap - h < 2) side = cx + ballR + gap + w > viewW - 2 ? 'left' : 'right';
    let tagX = cx, tagY = cy - ballR - gap - h / 2;
    if (side === 'right') { tagX = cx + ballR + gap + w / 2 - 2; tagY = cy - ballR + 1; }
    if (side === 'left') { tagX = cx - ballR - gap - w / 2 + 2; tagY = cy - ballR + 1; }
    if (side === 'none') { tagX = cx; tagY = cy; }
    tagX = Math.max(w / 2 + 1, Math.min(viewW - w / 2 - 1, tagX));
    tagY = Math.max(h / 2 + 1, Math.min(viewH - h / 2 - 1, tagY));

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'square';

    const x = Math.round(tagX - w / 2), y = Math.round(tagY - h / 2);
    const ink = offscreen ? '#ffd634' : '#5af4ff', fill = offscreen ? '#5e2900' : '#07304a';
    const pointer = () => {
      if (side === 'none') return;
      ctx.beginPath();
      if (side === 'above') { ctx.moveTo(tagX - 3, y + h); ctx.lineTo(tagX + 3, y + h); ctx.lineTo(tagX, y + h + gap); }
      else if (side === 'right') { ctx.moveTo(x + 1, y + h - 3); ctx.lineTo(x + 6, y + h); ctx.lineTo(x - 2, y + h + gap - 1); }
      else { ctx.moveTo(x + w - 1, y + h - 3); ctx.lineTo(x + w - 6, y + h); ctx.lineTo(x + w + 2, y + h + gap - 1); }
      ctx.closePath();
    };
    const pill = () => { ctx.beginPath(); ctx.roundRect(x, y, w, h, 2); };
    // dark outline under everything so the tag reads on the light checker floors, then the cyan pill + pointer
    ctx.strokeStyle = '#030611'; ctx.lineWidth = 3;
    pill(); ctx.stroke(); pointer(); ctx.stroke();
    pointer(); ctx.fillStyle = ink; ctx.fill();
    pill(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke();
    font.drawCentered(ctx, label, tagX, y + 2, offscreen ? 'orange' : 'cyan');

    ctx.restore();
    return { targetX, targetY, tagX, tagY, offscreen };
  }
}
