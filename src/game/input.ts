/**
 * Input controller supporting Keyboard, Mouse drag, Mobile Virtual Joystick,
 * and Mobile DeviceOrientation (Accelerometer / Rotameter).
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
  private accelX = 0; // gamma (-90..90)
  private accelY = 0; // beta (-180..180)
  private baseGamma = 0;
  private baseBeta = 35; // natural holding angle

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

  public requestDeviceOrientationPermission(): Promise<boolean> {
    const dEvent = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof dEvent?.requestPermission === 'function') {
      return dEvent.requestPermission()
        .then((res) => res === 'granted')
        .catch(() => false);
    }
    return Promise.resolve(true);
  }

  private bindOrientation(): void {
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma !== null && e.beta !== null) {
        this.hasOrientation = true;
        this.accelX = e.gamma; // tilt left/right (-90..90)
        this.accelY = e.beta;  // tilt front/back (-180..180)
      }
    });
  }

  public getSample(): InputState {
    let screenX = 0;
    let screenY = 0;
    let brake = this.keys.has('Space') || this.brakePressed;

    // Keyboard (WASD & Arrows)
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) screenY -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) screenY += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) screenX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) screenX += 1;

    // Normalize keyboard vector
    const kLen = Math.sqrt(screenX * screenX + screenY * screenY);
    if (kLen > 0) {
      screenX /= kLen;
      screenY /= kLen;
    }

    // Mouse drag steering
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

    // Touch Virtual Joystick
    if (this.joyActive) {
      screenX = this.joyKnob[0];
      screenY = this.joyKnob[1];
    }

    // Mobile Accelerometer (Rotameter)
    let tiltDeg = 0;
    if (this.hasOrientation && !this.isMouseDown && !this.joyActive && kLen === 0) {
      const dGamma = this.accelX - this.baseGamma;
      const dBeta = this.accelY - this.baseBeta;
      const maxAngle = 25; // degrees for full throttle

      const normX = Math.max(-1, Math.min(1, dGamma / maxAngle));
      const normY = Math.max(-1, Math.min(1, dBeta / maxAngle));

      const oLen = Math.sqrt(normX * normX + normY * normY);
      if (oLen > 0.08) {
        screenX = normX;
        screenY = normY;
      }
      tiltDeg = dGamma;

      if (this.joyEl && !this.joyActive) {
        this.joyEl.classList.add('tilt');
        if (this.knobEl) {
          const kx = normX * 36;
          const ky = normY * 36;
          this.knobEl.style.transform = `translate3d(${kx}px, ${ky}px, 0px)`;
        }
      }
    } else if (this.joyEl && !this.joyActive) {
      this.joyEl.classList.remove('tilt');
    }

    // Transform screen coordinates (X: right, Y: down) into Isometric World Coordinates (+X down-right, +Z down-left)
    // 45-degree isometric projection transformation:
    // worldX = (screenX + screenY) * 0.7071
    // worldZ = (-screenX + screenY) * 0.7071
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
    };
  }
}
