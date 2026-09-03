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

  // Desktop left-click + scroll wheel aim vector
  private leftMouseDown = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private aimVector: { dx: number; dy: number } = { dx: 0, dy: 1 };
  private clicksQueue: { x: number; y: number }[] = [];

  takeClicks(): { x: number; y: number }[] {
    const res = this.clicksQueue;
    this.clicksQueue = [];
    return res;
  }

  private setupGameCanvasMouse(): void {
    let canvasTouchId: number | null = null;
    let canvasLastTouchX = 0, canvasLastTouchY = 0, canvasLastTouchTime = 0;
    let canvasTouchMoved = false;

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.changedTouches.length === 0) return;
      const t = e.changedTouches[0];
      canvasTouchId = t.identifier;
      canvasLastTouchX = t.clientX;
      canvasLastTouchY = t.clientY;
      canvasLastTouchTime = performance.now();
      canvasTouchMoved = false;
      this.anyPress = true;
      this.pressedQueue.push('Touch');
      this.trackball.startDrag();
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === canvasTouchId) {
          const dx = t.clientX - canvasLastTouchX;
          const dy = t.clientY - canvasLastTouchY;
          if (Math.hypot(dx, dy) > 3) canvasTouchMoved = true;
          const now = performance.now();
          const dt = Math.max(0.008, Math.min(0.05, (now - canvasLastTouchTime) / 1000));
          canvasLastTouchX = t.clientX;
          canvasLastTouchY = t.clientY;
          canvasLastTouchTime = now;
          this.trackball.dragDelta(dx * 1.25, dy * 1.25, dt);
          break;
        }
      }
    }, { passive: true });

    const endCanvasTouch = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === canvasTouchId) {
          canvasTouchId = null;
          this.trackball.endDrag();
          // If the player simply tapped without dragging, record as a menu click
          if (!canvasTouchMoved) {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            this.clicksQueue.push({
              x: (t.clientX - rect.left) * scaleX,
              y: (t.clientY - rect.top) * scaleY,
            });
          }
          break;
        }
      }
    };
    this.canvas.addEventListener('touchend', endCanvasTouch, { passive: true });
    this.canvas.addEventListener('touchcancel', endCanvasTouch, { passive: true });

    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      this.clicksQueue.push({
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      });
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.leftMouseDown = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
      }
      this.mouseDown = true;
      this.anyPress = true;
      this.pressedQueue.push('Mouse');
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.trackball.startDrag();
      e.preventDefault();
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.leftMouseDown = false;
      }
      if (this.mouseDown) {
        this.mouseDown = false;
        this.trackball.endDrag();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.trackball.dragDelta(e.movementX * 0.5, e.movementY * 0.5);
        const len = Math.hypot(e.movementX, e.movementY);
        if (len > 1) {
          this.aimVector = { dx: e.movementX / len, dy: e.movementY / len };
        }
        return;
      }
      if (!this.mouseDown) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      // When left-click is held, moving the mouse steers the roll direction vector
      if (this.leftMouseDown) {
        const ddx = e.clientX - this.dragStartX;
        const ddy = e.clientY - this.dragStartY;
        const len = Math.hypot(ddx, ddy);
        if (len > 8) {
          this.aimVector = { dx: ddx / len, dy: ddy / len };
        }
      } else {
        this.trackball.dragDelta(dx * 0.5, dy * 0.5);
      }
    });

    // Scroll wheel rolling: wheel is the accelerator; holding left click + moving mouse sets direction
    window.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY;
      if (Math.abs(delta) < 0.2) return;

      const sign = Math.sign(delta);
      // Normalize wheel delta across browsers / trackpads (lines vs pixels)
      // 1 notch delivers a measured physical push (intensity ~ 3 to 6 out of 100), not an instant warp to 100% speed!
      const rawDelta = (e.deltaMode === 1 ? delta * 18 : (e.deltaMode === 2 ? delta * 80 : delta));
      const stepIntensity = Math.min(20, Math.abs(rawDelta) / 28 * 4.0);

      // Scroll forward/down pushes in aim direction; scroll backward reverses/brakes
      const dirX = this.aimVector.dx * sign;
      const dirY = this.aimVector.dy * sign;
      this.trackball.spin(dirX, dirY, stepIntensity);
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  private setupTrackballTouch(tb: HTMLCanvasElement): void {
    // Pointer Events for modern browsers / touch screens
    let lastTbTouchTime = performance.now();

    tb.addEventListener('pointerdown', (e) => {
      tb.setPointerCapture(e.pointerId);
      this.activeTouchId = e.pointerId;
      this.lastTouchX = e.clientX;
      this.lastTouchY = e.clientY;
      lastTbTouchTime = performance.now();
      this.anyPress = true;
      this.pressedQueue.push('Touch');
      this.trackball.startDrag();
      e.preventDefault();
    });

    tb.addEventListener('pointermove', (e) => {
      if (this.activeTouchId !== e.pointerId) return;
      const dx = e.clientX - this.lastTouchX;
      const dy = e.clientY - this.lastTouchY;
      const now = performance.now();
      const dt = Math.max(0.008, Math.min(0.05, (now - lastTbTouchTime) / 1000));
      this.lastTouchX = e.clientX;
      this.lastTouchY = e.clientY;
      lastTbTouchTime = now;
      this.trackball.dragDelta(dx * 1.5, dy * 1.5, dt);
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
      lastTbTouchTime = performance.now();
      this.anyPress = true;
      this.pressedQueue.push('Touch');
      this.trackball.startDrag();
      e.preventDefault();
    }, { passive: false });

    tb.addEventListener('touchmove', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - this.lastTouchX;
      const dy = t.clientY - this.lastTouchY;
      const now = performance.now();
      const dt = Math.max(0.008, Math.min(0.05, (now - lastTbTouchTime) / 1000));
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
      lastTbTouchTime = now;
      this.trackball.dragDelta(dx * 1.5, dy * 1.5, dt);
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
