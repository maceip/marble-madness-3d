/**
 * Input: physical arcade Trackball (3D on-screen touch/mouse drag, pointer lock),
 * keyboard (arrows / WASD) injecting trackball torque, and programmatic AI input.
 */
import { Trackball } from './trackball';

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
  readonly trackball: Trackball;

  private keys = new Set<string>();
  private pressedQueue: string[] = [];
  private anyPress = false;
  private pointerLocked = false;
  private mouseDown = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Trackball touch tracking
  private activeTouchId: number | null = null;
  private lastTouchX = 0;
  private lastTouchY = 0;

  // Programmatic AI override
  private ai: { ax: number; ay: number; until: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private trackballCanvas?: HTMLCanvasElement | null,
  ) {
    this.trackball = new Trackball();
    this.setupKeyboard();
    this.setupGameCanvasMouse();
    if (this.trackballCanvas) {
      this.setupTrackballTouch(this.trackballCanvas);
    }
  }

  private setupKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (KEY_DIRS[e.code] || e.code === 'Space') e.preventDefault(); return; }
      this.keys.add(e.code);
      this.pressedQueue.push(e.code);
      this.anyPress = true;
      if (KEY_DIRS[e.code] || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private setupGameCanvasMouse(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true;
      this.anyPress = true;
      this.pressedQueue.push('Mouse');
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.trackball.startDrag();
      e.preventDefault();
    });

    window.addEventListener('mouseup', () => {
      if (this.mouseDown) {
        this.mouseDown = false;
        this.trackball.endDrag();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.trackball.dragDelta(e.movementX * 1.2, e.movementY * 1.2);
        return;
      }
      if (!this.mouseDown) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.trackball.dragDelta(dx * 1.4, dy * 1.4);
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  private setupTrackballTouch(tb: HTMLCanvasElement): void {
    // Pointer Events for modern browsers / touch screens
    tb.addEventListener('pointerdown', (e) => {
      tb.setPointerCapture(e.pointerId);
      this.activeTouchId = e.pointerId;
      this.lastTouchX = e.clientX;
      this.lastTouchY = e.clientY;
      this.anyPress = true;
      this.pressedQueue.push('Touch');
      this.trackball.startDrag();
      e.preventDefault();
    });

    tb.addEventListener('pointermove', (e) => {
      if (this.activeTouchId !== e.pointerId) return;
      const dx = e.clientX - this.lastTouchX;
      const dy = e.clientY - this.lastTouchY;
      this.lastTouchX = e.clientX;
      this.lastTouchY = e.clientY;
      this.trackball.dragDelta(dx * 1.6, dy * 1.6);
      e.preventDefault();
    });

    const endPointer = (e: PointerEvent) => {
      if (this.activeTouchId === e.pointerId) {
        this.activeTouchId = null;
        this.trackball.endDrag();
      }
    };
    tb.addEventListener('pointerup', endPointer);
    tb.addEventListener('pointercancel', endPointer);

    // Fallback touch events for older webkit
    tb.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
      this.anyPress = true;
      this.pressedQueue.push('Touch');
      this.trackball.startDrag();
      e.preventDefault();
    }, { passive: false });

    tb.addEventListener('touchmove', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - this.lastTouchX;
      const dy = t.clientY - this.lastTouchY;
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
      this.trackball.dragDelta(dx * 1.6, dy * 1.6);
      e.preventDefault();
    }, { passive: false });

    const endTouch = () => {
      this.trackball.endDrag();
    };
    tb.addEventListener('touchend', endTouch);
    tb.addEventListener('touchcancel', endTouch);
  }

  /** consume queued key presses (for menus) */
  takePresses(): string[] { const q = this.pressedQueue; this.pressedQueue = []; return q; }
  consumeAnyPress(): boolean { const a = this.anyPress; this.anyPress = false; return a; }
  isDown(code: string): boolean { return this.keys.has(code); }

  setAI(ax: number, ay: number, durationMs: number): void {
    const m = Math.hypot(ax, ay);
    if (m > 1) { ax /= m; ay /= m; }
    this.ai = { ax, ay, until: performance.now() + durationMs };
    // Also spin the trackball so visual 3D ball reflects AI steering
    this.trackball.spin(ax, ay, m * 50);
  }
  clearAI(): void { this.ai = null; }

  /** Steering sample for this frame in screen space (before control-type mapping). */
  sample(dt: number): Steer {
    // Keyboard inputs inject physical torque into trackball
    let kx = 0, ky = 0;
    for (const [code, d] of Object.entries(KEY_DIRS)) {
      if (this.keys.has(code)) { kx += d[0]; ky += d[1]; }
    }
    if (kx || ky) {
      const km = Math.hypot(kx, ky);
      this.trackball.spin(kx / km, ky / km, 45);
    }

    // Programmatic AI override (e.g. from test harnesses)
    if (this.ai) {
      if (performance.now() < this.ai.until) {
        this.trackball.update(dt);
        return this.mapControl({ ax: this.ai.ax, ay: this.ai.ay });
      }
      this.ai = null;
    }

    // Advance physical trackball simulation
    this.trackball.update(dt);

    const s = this.trackball.getSteer();
    return this.mapControl(s);
  }

  private mapControl(s: Steer): Steer {
    if (this.controlType === 'screen') return s;
    // 45°: rotate stick by -45° so cardinal presses follow the isometric axes
    const c = Math.SQRT1_2;
    return { ax: (s.ax - s.ay) * c, ay: (s.ax + s.ay) * c };
  }
}
