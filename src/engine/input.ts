/**
 * Input: keyboard (arrows / WASD), mouse as trackball (drag or pointer-lock movement),
 * touch virtual joystick, and programmatic AI input (WebMCP / remote).
 */
export type ControlType = 'screen' | 'iso45';

export interface Steer { ax: number; ay: number }

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

export class Input {
  controlType: ControlType = 'screen';
  private keys = new Set<string>();
  private pressedQueue: string[] = [];
  private mouseDown = false;
  private mouseVec: Steer = { ax: 0, ay: 0 };
  private mouseDecay = 0;
  private touchOrigin: { x: number; y: number } | null = null;
  private touchVec: Steer = { ax: 0, ay: 0 };
  private ai: { ax: number; ay: number; until: number } | null = null;
  private anyPress = false;
  private pointerLocked = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (KEY_DIRS[e.code] || e.code === 'Space') e.preventDefault(); return; }
      this.keys.add(e.code);
      this.pressedQueue.push(e.code);
      this.anyPress = true;
      if (KEY_DIRS[e.code] || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true; this.anyPress = true; this.pressedQueue.push('Mouse');
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => { this.mouseDown = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseDown && !this.pointerLocked) return;
      // trackball: mouse motion becomes steering impulse that decays quickly
      const k = 0.06;
      this.mouseVec.ax = clamp(this.mouseVec.ax + e.movementX * k, -1, 1);
      this.mouseVec.ay = clamp(this.mouseVec.ay + e.movementY * k, -1, 1);
      this.mouseDecay = 0.14;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });

    canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.touchOrigin = { x: t.clientX, y: t.clientY };
      this.anyPress = true; this.pressedQueue.push('Touch');
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (!this.touchOrigin) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this.touchOrigin.x, dy = t.clientY - this.touchOrigin.y;
      const max = 70;
      const m = Math.min(1, Math.hypot(dx, dy) / max);
      const a = Math.atan2(dy, dx);
      this.touchVec = { ax: Math.cos(a) * m, ay: Math.sin(a) * m };
      e.preventDefault();
    }, { passive: false });
    const endTouch = () => { this.touchOrigin = null; this.touchVec = { ax: 0, ay: 0 }; };
    canvas.addEventListener('touchend', endTouch);
    canvas.addEventListener('touchcancel', endTouch);
  }

  /** consume queued key presses (for menus) */
  takePresses(): string[] { const q = this.pressedQueue; this.pressedQueue = []; return q; }
  consumeAnyPress(): boolean { const a = this.anyPress; this.anyPress = false; return a; }
  isDown(code: string): boolean { return this.keys.has(code); }

  setAI(ax: number, ay: number, durationMs: number): void {
    const m = Math.hypot(ax, ay);
    if (m > 1) { ax /= m; ay /= m; }
    this.ai = { ax, ay, until: performance.now() + durationMs };
  }
  clearAI(): void { this.ai = null; }

  /** Steering sample for this frame in screen space (before control-type mapping). */
  sample(dt: number): Steer {
    if (this.ai) {
      if (performance.now() < this.ai.until) return this.mapControl({ ax: this.ai.ax, ay: this.ai.ay });
      this.ai = null;
    }
    let ax = 0, ay = 0;
    for (const [code, d] of Object.entries(KEY_DIRS)) {
      if (this.keys.has(code)) { ax += d[0]; ay += d[1]; }
    }
    if (ax || ay) {
      const m = Math.hypot(ax, ay);
      return this.mapControl({ ax: ax / m, ay: ay / m });
    }
    if (this.mouseDecay > 0) {
      this.mouseDecay -= dt;
      const v = { ...this.mouseVec };
      const f = Math.exp(-dt * 9);
      this.mouseVec.ax *= f; this.mouseVec.ay *= f;
      return this.mapControl(v);
    }
    if (this.touchOrigin) return this.mapControl(this.touchVec);
    return { ax: 0, ay: 0 };
  }

  private mapControl(s: Steer): Steer {
    if (this.controlType === 'screen') return s;
    // 45°: rotate stick by -45° so cardinal presses follow the isometric axes
    const c = Math.SQRT1_2;
    return { ax: (s.ax - s.ay) * c, ay: (s.ax + s.ay) * c };
  }
}

function clamp(x: number, a: number, b: number): number { return Math.max(a, Math.min(b, x)); }
