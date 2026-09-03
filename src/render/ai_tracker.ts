/**
 * A Scanner Darkly Rotoscoped AI Marble Tracker Overlay
 *
 * Implements an interpolated rotoscoping aesthetic (Bob Sabiston / Richard Linklater style):
 * - Jittering vector contour ink lines with organic line-width modulation
 * - Posterized high-contrast cel fills (neon cyan, electric amber, deep shadow ink)
 * - Fluid spring-damped tracking with velocity anticipation
 * - Corner peeking and viewport boundary clamping with directional pointing chevrons
 * - Live neural telemetry HUD badges
 */

export interface TrackerTarget {
  id: string;
  name: string;
  role: string;
  screenX: number;
  screenY: number;
  worldZ: number;
  vx: number;
  vy: number;
  visible: boolean;
}

interface JitterSeed {
  dx: number;
  dy: number;
  width: number;
}

export class AITrackerOverlay {
  private smoothX = 0;
  private smoothY = 0;
  private initialized = false;
  private lastTime = 0;
  private jitterFrame = 0;
  private jitterSeeds: JitterSeed[] = [];

  constructor() {
    this.refreshJitter();
  }

  private refreshJitter(): void {
    this.jitterSeeds = [];
    for (let i = 0; i < 32; i++) {
      this.jitterSeeds.push({
        dx: (Math.random() - 0.5) * 2.6,
        dy: (Math.random() - 0.5) * 2.6,
        width: 1.2 + Math.random() * 1.8,
      });
    }
  }

  /**
   * Draw a rotoscoped cel-ink stroke with organic micro-jitter (A Scanner Darkly style)
   */
  private rotoscopeLine(
    ctx: CanvasRenderingContext2D,
    x0: number, y0: number,
    x1: number, y1: number,
    color: string,
    inkColor = "#05070d",
    seedOffset = 0,
  ): void {
    const s1 = this.jitterSeeds[(seedOffset) % this.jitterSeeds.length];
    const s2 = this.jitterSeeds[(seedOffset + 5) % this.jitterSeeds.length];

    const jx0 = x0 + s1.dx;
    const jy0 = y0 + s1.dy;
    const jx1 = x1 + s2.dx;
    const jy1 = y1 + s2.dy;

    // 1. Heavy black outer contour ink
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = s1.width + 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(jx0, jy0);
    ctx.lineTo(jx1, jy1);
    ctx.stroke();

    // 2. Inner vibrant cel-shaded color core
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s1.width * 0.85);
    ctx.beginPath();
    ctx.moveTo(jx0, jy0);
    ctx.lineTo(jx1, jy1);
    ctx.stroke();
  }

  /**
   * Draw a rotoscoped cel polygon with jittered outline and posterized fill
   */
  private rotoscopePoly(
    ctx: CanvasRenderingContext2D,
    pts: Array<[number, number]>,
    fillColor: string,
    strokeColor: string,
    seedOffset = 0,
  ): void {
    if (pts.length < 3) return;

    ctx.save();
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const s = this.jitterSeeds[(seedOffset + i * 3) % this.jitterSeeds.length];
      const jx = x + s.dx;
      const jy = y + s.dy;
      if (i === 0) ctx.moveTo(jx, jy);
      else ctx.lineTo(jx, jy);
    });
    ctx.closePath();

    // Cel fill
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Heavy ink border
    ctx.strokeStyle = "#05070d";
    ctx.lineWidth = 3.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Inner vibrant contour line
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Update and render the high-performance AI tracker overlay
   */
  render(
    ctx: CanvasRenderingContext2D,
    target: TrackerTarget,
    viewW: number,
    viewH: number,
    time: number,
  ): void {
    // Rotoscope frame jitter runs at ~12-15 fps (classic hand-animated cel rate)
    const currentFrame = Math.floor(time * 14);
    if (currentFrame !== this.jitterFrame) {
      this.jitterFrame = currentFrame;
      this.refreshJitter();
    }

    const targetX = target.screenX;
    const targetY = target.screenY;

    // Initialize position smoothly
    if (!this.initialized) {
      this.smoothX = targetX;
      this.smoothY = targetY;
      this.initialized = true;
    }

    // Critically damped spring lerp tracking with velocity anticipation
    const dt = Math.min(0.05, Math.max(0.001, time - this.lastTime));
    this.lastTime = time;

    const leadFactor = 0.12;
    const anticipatedX = targetX + target.vx * leadFactor;
    const anticipatedY = targetY + target.vy * leadFactor;

    const lerpSpeed = Math.min(1, dt * 14);
    this.smoothX += (anticipatedX - this.smoothX) * lerpSpeed;
    this.smoothY += (anticipatedY - this.smoothY) * lerpSpeed;

    const mx = this.smoothX;
    const my = this.smoothY;

    // Viewport bounds with padding
    const minX = 75;
    const maxX = viewW - 75;
    const minY = 55;
    // Reserve clearance above the bottom-right virtual trackball
    const isNearTrackball = mx > viewW - 170;
    const maxY = isNearTrackball ? viewH - 165 : viewH - 55;

    const isOffscreen = mx < minX || mx > maxX || my < minY || my > (viewH - 55);
    const clampedX = Math.max(minX, Math.min(maxX, mx));
    const clampedY = Math.max(minY, Math.min(maxY, my));

    // Corner / edge peeking logic:
    // If the marble rolls near or outside the screen, anchor the badge at the edge
    // and draw an animated pointing chevron back to the hidden position.
    const tagX = clampedX;
    const tagY = isOffscreen ? clampedY : clampedY - 46;

    ctx.save();

    // 1. Scramble-Suit Reticle Around Marble (when on-screen)
    if (!isOffscreen && target.visible) {
      const radius = 18;
      const cornerLen = 7;
      const pulse = Math.sin(time * 6) * 1.5;
      const r = radius + pulse;

      const brackets = [
        [[targetX - r, targetY - r + cornerLen], [targetX - r, targetY - r], [targetX - r + cornerLen, targetY - r]],
        [[targetX + r - cornerLen, targetY - r], [targetX + r, targetY - r], [targetX + r, targetY - r + cornerLen]],
        [[targetX + r, targetY + r - cornerLen], [targetX + r, targetY + r], [targetX - r + cornerLen, targetY + r]],
        [[targetX - r + cornerLen, targetY + r], [targetX - r, targetY + r], [targetX - r, targetY + r - cornerLen]],
      ];

      brackets.forEach((poly, idx) => {
        this.rotoscopeLine(ctx, poly[0][0], poly[0][1], poly[1][0], poly[1][1], "#00f3ff", "#040914", idx * 2);
        this.rotoscopeLine(ctx, poly[1][0], poly[1][1], poly[2][0], poly[2][1], "#00f3ff", "#040914", idx * 2 + 1);
      });

      this.rotoscopeLine(ctx, targetX - 3, targetY, targetX + 3, targetY, "#ff007f", "#000", 10);
      this.rotoscopeLine(ctx, targetX, targetY - 3, targetX, targetY + 3, "#ff007f", "#000", 12);
    }

    // 2. Fluid Leader Line (linking badge to marble or offscreen location)
    const targetAnchorX = targetX;
    const targetAnchorY = isOffscreen ? targetY : targetY - 18;
    const badgeAnchorX = tagX;
    const badgeAnchorY = isOffscreen ? tagY : tagY + 16;

    ctx.setLineDash([4, 3]);
    this.rotoscopeLine(ctx, badgeAnchorX, badgeAnchorY, targetAnchorX, targetAnchorY, isOffscreen ? "#ff9900" : "#00e5ff", "#05070d", 7);
    ctx.setLineDash([]);

    // 3. Corner Peeking Chevron (when marble is occluded / off-screen)
    if (isOffscreen) {
      const dx = targetX - tagX;
      const dy = targetY - tagY;
      const angle = Math.atan2(dy, dx);
      const arrowDist = 32 + (Math.sin(time * 10) * 3);
      const ax = tagX + Math.cos(angle) * arrowDist;
      const ay = tagY + Math.sin(angle) * arrowDist;

      const arrowHeadLen = 10;
      const p1x = ax - Math.cos(angle - 0.5) * arrowHeadLen;
      const p1y = ay - Math.sin(angle - 0.5) * arrowHeadLen;
      const p2x = ax - Math.cos(angle + 0.5) * arrowHeadLen;
      const p2y = ay - Math.sin(angle + 0.5) * arrowHeadLen;

      this.rotoscopePoly(ctx, [[ax, ay], [p1x, p1y], [tagX + Math.cos(angle) * 18, tagY + Math.sin(angle) * 18], [p2x, p2y]], "rgba(255, 140, 0, 0.88)", "#ffe019", 15);
    }

    // 4. "A Scanner Darkly" Rotoscoped HUD Badge
    const badgeW = 94;
    const badgeH = 34;
    const bx = tagX - badgeW / 2;
    const by = tagY - badgeH / 2;

    const bevel = 6;
    const badgePts = [
      [bx + bevel, by],
      [bx + badgeW - bevel, by],
      [bx + badgeW, by + bevel],
      [bx + badgeW, by + badgeH - bevel],
      [bx + badgeW - bevel, by + badgeH],
      [bx + bevel, by + badgeH],
      [bx, by + badgeH - bevel],
      [bx, by + bevel],
    ];

    const bgFill = isOffscreen ? "rgba(35, 18, 5, 0.92)" : "rgba(7, 15, 28, 0.92)";
    const coreColor = isOffscreen ? "#ffaa00" : "#00f3ff";
    this.rotoscopePoly(ctx, badgePts, bgFill, coreColor, 3);

    const scanlineY = by + ((time * 40) % (badgeH - 4));
    ctx.fillStyle = isOffscreen ? "rgba(255, 180, 0, 0.18)" : "rgba(0, 243, 255, 0.18)";
    ctx.fillRect(bx + 4, scanlineY, badgeW - 8, 3);

    // 5. Stylized Typography & Telemetry Readout
    const pillW = 26;
    const pillH = 14;
    const pillX = bx + 6;
    const pillY = by + 6;
    this.rotoscopePoly(
      ctx,
      [[pillX, pillY], [pillX + pillW, pillY], [pillX + pillW, pillY + pillH], [pillX, pillY + pillH]],
      isOffscreen ? "#e65100" : "#0052cc",
      "#ffffff",
      8,
    );

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("AI", pillX + pillW / 2, pillY + pillH / 2 + 0.5);

    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = isOffscreen ? "#ffcc00" : "#79a8ff";
    const mainTitle = isOffscreen ? "PEEKING" : "CODEX AI";
    ctx.fillText(mainTitle, bx + 36, by + 13);

    ctx.font = "bold 8px monospace";
    ctx.fillStyle = "#cfd2ff";
    const speedVal = Math.round(Math.hypot(target.vx, target.vy));
    const subText = isOffscreen ? ("OFFSCREEN " + Math.round(Math.hypot(targetX - tagX, targetY - tagY)) + "px") : ("TRACK 60Hz  SPD:" + speedVal);
    ctx.fillText(subText, bx + 8, by + 27);

    const pulseDot = Math.floor(time * 8) % 2 === 0;
    ctx.fillStyle = pulseDot ? "#50fa7b" : "#ff5555";
    ctx.fillRect(bx + badgeW - 10, by + 8, 4, 4);

    ctx.restore();
  }
}
