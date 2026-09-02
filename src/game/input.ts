/**
 * Keyboard, mouse-drag, virtual joystick, and calibrated device tilt.
 *
 * The original rotameter was unusable: hardcoded rest pose, no screen-
 * orientation compensation, no smoothing, and iOS permission never gated
 * behind a user gesture. Calibrate on Play, map tilt into screen space,
 * then into the isometric world basis.
 */

export interface InputState {
  /** Isometric steering vector in world space: x (-1..1), z (-1..1) */
  steerX: number;
  steerZ: number;
  /** Brake active (spacebar or mobile brake button) */
  brake: boolean;
  /** Magnitude 0..1 */
  intensity: number;
  /** Tilt angle in degrees for UI rotameter display */
  tiltDeg: number;
  /** Raw screen joystick offset [-1..1, -1..1] */
  joyOffset: [number, number];
  tiltActive: boolean;
  tiltCalibrated: boolean;
}

function screenAngle(): number {
  const so = (screen as Screen & { orientation?: { angle?: number } }).orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const wo = (window as Window & { orientation?: number }).orientation;
  return typeof wo === 'number' ? wo : 0;
}

function radialDeadzone(x: number, y: number, dz: number): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const scale = ((m - dz) / (1 - dz)) / m;
  return { x: x * scale, y: y * scale };
}

function curve(v: number, p = 1.35): number {
  const s = Math.sign(v);
  return s * Math.pow(Math.abs(v), p);
}

export class InputManager {
  private keys = new Set<string>();
  private isMouseDown = false;
  private mouseStart: [number, number] = [0, 0];
  private mouseCurrent: [number, number] = [0, 0];

  private joyActive = false;
  private joyCenter: [number, number] = [0, 0];
  private joyKnob: [number, number] = [0, 0];

  private hasOrientation = false;
  private tiltEnabled = false;
  private calibrated = false;
  private restX = 0;
  private restY = 0;
  private rawX = 0;
  private rawY = 0;
  private filtX = 0;
  private filtY = 0;
  private permissionGranted = false;

  public onRestart?: () => void;
  public onToggleMenu?: () => void;
  public onToggleCamera?: () => void;
  public onToggleMute?: () => void;

  private joyEl: HTMLElement | null = null;
  private knobEl: HTMLElement | null = null;
  private brakeEl: HTMLElement | null = null;
  private brakePressed = false;

  constructor() {
    this.joyEl = document.getElementById('joy');
    this.knobEl = this.joyEl?.querySelector('.knob') as HTMLElement | null;
    this.brakeEl = document.getElementById('brake');

    this.bindKeyboard();
    this.bindMouse();
    this.bindTouch();
    this.bindOrientation();
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.code === 'KeyR' && this.onRestart) this.onRestart();
      if (e.code === 'Escape' && this.onToggleMenu) this.onToggleMenu();
      if (e.code === 'KeyC' && this.onToggleCamera) this.onToggleCamera();
      if (e.code === 'KeyM' && this.onToggleMute) this.onToggleMute();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  private bindMouse(): void {
    const canvas = document.getElementById('gl');
    if (!canvas) return;

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.isMouseDown = true;
      this.mouseStart = [e.clientX, e.clientY];
      this.mouseCurrent = [e.clientX, e.clientY];
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isMouseDown) return;
      this.mouseCurrent = [e.clientX, e.clientY];
    });

    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });
  }

  private bindTouch(): void {
    if (this.brakeEl) {
      this.brakeEl.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.brakePressed = true;
      });
      this.brakeEl.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.brakePressed = false;
      });
    }

    if (this.joyEl) {
      this.joyEl.classList.add('on');

      this.joyEl.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = this.joyEl!.getBoundingClientRect();
        this.joyCenter = [rect.left + rect.width / 2, rect.top + rect.height / 2];
        this.joyActive = true;
        this.updateJoyTouch(touch.clientX, touch.clientY);
      });

      window.addEventListener('touchmove', (e) => {
        if (!this.joyActive) return;
        const touch = e.touches[0];
        this.updateJoyTouch(touch.clientX, touch.clientY);
      });

      const endJoy = () => {
        this.joyActive = false;
        this.joyKnob = [0, 0];
        if (this.knobEl) {
          this.knobEl.style.transform = `translate3d(0px, 0px, 0px)`;
        }
      };

      window.addEventListener('touchend', endJoy);
      window.addEventListener('touchcancel', endJoy);
    }
  }

  private updateJoyTouch(clientX: number, clientY: number): void {
    const maxR = 48;
    const dx = clientX - this.joyCenter[0];
    const dy = clientY - this.joyCenter[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampedDist = Math.min(dist, maxR);
    const angle = Math.atan2(dy, dx);

    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;
    this.joyKnob = [kx / maxR, ky / maxR];

    if (this.knobEl) {
      this.knobEl.style.transform = `translate3d(${kx}px, ${ky}px, 0px)`;
    }
  }

  public async requestDeviceOrientationPermission(): Promise<boolean> {
    const dEvent = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    const mEvent = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    try {
      if (typeof mEvent?.requestPermission === 'function') {
        const res = await mEvent.requestPermission();
        if (res !== 'granted') {
          this.permissionGranted = false;
          return false;
        }
      }
      if (typeof dEvent?.requestPermission === 'function') {
        const res = await dEvent.requestPermission();
        this.permissionGranted = res === 'granted';
        if (this.permissionGranted) this.enableTilt();
        return this.permissionGranted;
      }
      this.permissionGranted = true;
      this.enableTilt();
      return true;
    } catch {
      this.permissionGranted = false;
      return false;
    }
  }

  public enableTilt(): void {
    this.tiltEnabled = true;
  }

  public calibrateNow(): void {
    this.restX = this.rawX;
    this.restY = this.rawY;
    this.filtX = 0;
    this.filtY = 0;
    this.calibrated = true;
  }

  private bindOrientation(): void {
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma === null || e.beta === null) return;
      this.hasOrientation = true;
      let x = e.gamma;
      let y = e.beta;
      const ori = screenAngle();
      if (ori === 90) {
        const t = x;
        x = y;
        y = -t;
      } else if (ori === -90 || ori === 270) {
        const t = x;
        x = -y;
        y = t;
      } else if (ori === 180) {
        x = -x;
        y = -y;
      }
      this.rawX = x;
      this.rawY = y;
    });

    window.addEventListener('devicemotion', (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null) return;
      this.hasOrientation = true;
      if (this.rawX === 0 && this.rawY === 0) {
        let sx = a.x;
        let sy = a.y;
        const ori = screenAngle();
        if (ori === 90) {
          sx = a.y ?? 0;
          sy = -(a.x ?? 0);
        } else if (ori === -90 || ori === 270) {
          sx = -(a.y ?? 0);
          sy = a.x ?? 0;
        } else if (ori === 180) {
          sx = -(a.x ?? 0);
          sy = -(a.y ?? 0);
        }
        this.rawX = (sx / 9.81) * 50;
        this.rawY = (sy / 9.81) * 50;
      }
    });
  }

  public getSample(dt = 1 / 60): InputState {
    let screenX = 0;
    let screenY = 0;
    const brake = this.keys.has('Space') || this.brakePressed;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) screenY -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) screenY += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) screenX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) screenX += 1;

    const kLen = Math.sqrt(screenX * screenX + screenY * screenY);
    if (kLen > 0) {
      screenX /= kLen;
      screenY /= kLen;
    }

    if (this.isMouseDown) {
      const dx = this.mouseCurrent[0] - this.mouseStart[0];
      const dy = this.mouseCurrent[1] - this.mouseStart[1];
      const maxDrag = 80;
      const mLen = Math.sqrt(dx * dx + dy * dy);
      if (mLen > 5) {
        const factor = Math.min(1, mLen / maxDrag);
        screenX = (dx / mLen) * factor;
        screenY = (dy / mLen) * factor;
      }
    }

    if (this.joyActive) {
      screenX = this.joyKnob[0];
      screenY = this.joyKnob[1];
    }

    let tiltDeg = 0;
    let usingTilt = false;
    const keyboardOrPointer = kLen > 0 || this.isMouseDown || this.joyActive;

    if (this.tiltEnabled && this.hasOrientation && !keyboardOrPointer) {
      const maxAngle = 32;
      const dx = this.rawX - this.restX;
      const dy = this.rawY - this.restY;
      const alpha = 1 - Math.exp(-dt / 0.07);
      this.filtX += (dx - this.filtX) * alpha;
      this.filtY += (dy - this.filtY) * alpha;

      let nx = this.filtX / maxAngle;
      let ny = this.filtY / maxAngle;
      nx = Math.max(-1, Math.min(1, nx));
      ny = Math.max(-1, Math.min(1, ny));

      const dz = radialDeadzone(nx, ny, 0.14);
      nx = curve(dz.x);
      ny = curve(dz.y);

      if (this.calibrated && (Math.abs(nx) > 0.001 || Math.abs(ny) > 0.001)) {
        screenX = nx;
        screenY = ny;
        usingTilt = true;
      }
      tiltDeg = this.filtX;

      if (this.joyEl && !this.joyActive) {
        this.joyEl.classList.toggle('tilt', usingTilt);
        if (this.knobEl) {
          const kx = nx * 36;
          const ky = ny * 36;
          this.knobEl.style.transform = `translate3d(${kx}px, ${ky}px, 0px)`;
        }
      }
    } else if (this.joyEl && !this.joyActive) {
      this.joyEl.classList.remove('tilt');
    }

    // Screen (X right, Y down) → isometric world (+X down-right, +Z down-left)
    const steerX = (screenX + screenY) * 0.70710678;
    const steerZ = (-screenX + screenY) * 0.70710678;
    const intensity = Math.min(1, Math.sqrt(screenX * screenX + screenY * screenY));

    return {
      steerX,
      steerZ,
      brake,
      intensity,
      tiltDeg,
      joyOffset: [screenX, screenY],
      tiltActive: usingTilt,
      tiltCalibrated: this.calibrated,
    };
  }
}
