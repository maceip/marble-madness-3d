/**
 * 3D WebGL Bowling-Ball Trackball Renderer.
 * Renders a glossy, opaque, swirly reactive-resin bowling ball inside a recessed
 * arcade socket bezel. Rotates in true 3D according to Trackball's rotation matrix.
 */
import { Trackball } from '../engine/trackball';

const VS_SOURCE = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FS_SOURCE = `
precision mediump float;
varying vec2 v_uv;

uniform mat3 u_rot;
uniform vec3 u_colorBase;
uniform vec3 u_colorWave;
uniform vec3 u_colorPearl;
uniform float u_time;

void main() {
  vec2 uv = v_uv; // -1.0 to 1.0
  float r = length(uv);

  if (r > 1.0) {
    discard;
  }

  // --- Bezel / Socket Ring (0.85 to 1.0) ---
  if (r > 0.85) {
    float bezelT = (r - 0.85) / 0.15;
    // Metallic gunmetal gradient with bevel highlights
    vec3 bezelDark = vec3(0.08, 0.09, 0.12);
    vec3 bezelMid = vec3(0.18, 0.20, 0.25);
    vec3 bezelRim = vec3(0.35, 0.38, 0.45);
    
    // Top-left light direction on the bezel
    float angleLight = clamp(dot(normalize(uv), normalize(vec2(-0.7, -0.7))), 0.0, 1.0);
    vec3 bCol = mix(bezelDark, bezelMid, smoothstep(0.0, 0.7, bezelT));
    bCol = mix(bCol, bezelRim, smoothstep(0.7, 1.0, bezelT) * (0.3 + 0.7 * angleLight));
    
    // Inner socket groove shadow
    bCol *= smoothstep(0.85, 0.88, r);
    gl_FragColor = vec4(bCol, 1.0);
    return;
  }

  // --- 3D Spherical Bowling Ball (r <= 0.85) ---
  float ballR = r / 0.85;
  float z = sqrt(max(0.0, 1.0 - ballR * ballR));
  vec3 N = vec3(uv.x / 0.85, uv.y / 0.85, z);

  // Rotate surface point in 3D using Trackball's orientation matrix
  vec3 P = u_rot * N;

  // Ultra-fast analytical 3D resin swirl (locked 60 FPS on mobile GPUs)
  float w1 = sin(P.x * 3.2 + sin(P.y * 4.2 + P.z * 2.8) * 1.7);
  float w2 = cos(P.z * 3.6 + sin(P.x * 2.9 + P.y * 3.1) * 1.5);
  float wavePattern = smoothstep(-0.45, 0.55, w1 * 0.6 + w2 * 0.4);
  float pearlVein = smoothstep(0.72, 0.96, sin(P.y * 5.5 + P.x * 4.8 + w1 * 2.2));

  // Resin color blend
  vec3 resinColor = mix(u_colorBase, u_colorWave, wavePattern);
  resinColor = mix(resinColor, u_colorPearl, pearlVein * 0.75);

  // --- 3D Lighting ---
  // Fixed overhead key light (from top-left)
  vec3 L = normalize(vec3(-0.45, -0.65, 0.75));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);

  float diff = max(dot(N, L), 0.0);
  // High-gloss bowling ball clear-coat specular reflection
  float spec = pow(max(dot(N, H), 0.0), 40.0);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  // Ambient lighting & fill
  vec3 ambient = u_colorBase * 0.35;
  vec3 litColor = ambient + resinColor * (0.3 + 0.7 * diff);
  litColor += vec3(1.0, 1.0, 1.0) * spec * 0.9;
  litColor += u_colorWave * fresnel * 0.35;

  // Socket drop shadow cast onto the ball edge
  float socketShadow = smoothstep(0.85, 0.72, r);
  litColor *= mix(0.35, 1.0, socketShadow);

  gl_FragColor = vec4(litColor, 1.0);
}
`;

export class Trackball3DView {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uRotLoc: WebGLUniformLocation | null = null;
  private uBaseLoc: WebGLUniformLocation | null = null;
  private uWaveLoc: WebGLUniformLocation | null = null;
  private uPearlLoc: WebGLUniformLocation | null = null;
  private posBuf: WebGLBuffer | null = null;
  private is2dFallback = false;

  // Colors
  colorBase = [0.03, 0.12, 0.38]; // Deep sapphire
  colorWave = [0.12, 0.65, 0.95]; // Vibrant cyan
  colorPearl = [0.88, 0.94, 1.0]; // Cloudy pearlescent

  constructor(readonly canvas: HTMLCanvasElement, readonly trackball: Trackball) {
    this.initGL();
  }

  setPlayerTheme(playerIndex: 1 | 2): void {
    if (playerIndex === 1) {
      // Blue Arcade
      this.colorBase = [0.03, 0.12, 0.38];
      this.colorWave = [0.12, 0.65, 0.95];
      this.colorPearl = [0.88, 0.94, 1.0];
    } else {
      // Red Arcade
      this.colorBase = [0.38, 0.04, 0.08];
      this.colorWave = [0.95, 0.32, 0.10];
      this.colorPearl = [1.0, 0.90, 0.72];
    }
  }

  private initGL(): void {
    try {
      this.gl = this.canvas.getContext('webgl', { alpha: true, antialias: true }) ||
                (this.canvas.getContext('experimental-webgl', { alpha: true, antialias: true }) as WebGLRenderingContext | null);
    } catch {
      this.gl = null;
    }

    if (!this.gl) {
      this.is2dFallback = true;
      return;
    }

    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
    if (!vs || !fs) {
      this.is2dFallback = true;
      return;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[trackball3d] shader link failed', gl.getProgramInfoLog(prog));
      this.is2dFallback = true;
      return;
    }

    this.program = prog;
    this.uRotLoc = gl.getUniformLocation(prog, 'u_rot');
    this.uBaseLoc = gl.getUniformLocation(prog, 'u_colorBase');
    this.uWaveLoc = gl.getUniformLocation(prog, 'u_colorWave');
    this.uPearlLoc = gl.getUniformLocation(prog, 'u_colorPearl');

    // Fullscreen quad [-1, -1] to [1, 1]
    const quad = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  }

  private compileShader(type: number, src: string): WebGLShader | null {
    const gl = this.gl!;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[trackball3d] shader compile error:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  render(): void {
    if (this.is2dFallback || !this.gl || !this.program) {
      this.render2DFallback();
      return;
    }

    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    // Bind uniforms
    if (this.uRotLoc) gl.uniformMatrix3fv(this.uRotLoc, false, this.trackball.rot);
    if (this.uBaseLoc) gl.uniform3fv(this.uBaseLoc, this.colorBase);
    if (this.uWaveLoc) gl.uniform3fv(this.uWaveLoc, this.colorWave);
    if (this.uPearlLoc) gl.uniform3fv(this.uPearlLoc, this.colorPearl);

    // Quad attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private render2DFallback(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const w = this.canvas.width, h = this.canvas.height;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.42;

    ctx.clearRect(0, 0, w, h);

    // Socket
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = '#14161f';
    ctx.fill();
    ctx.strokeStyle = '#323648';
    ctx.lineWidth = 4;
    ctx.stroke();

    // 2D shaded ball
    const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, `rgb(${this.colorWave.map((c) => Math.round(c * 255)).join(',')})`);
    grad.addColorStop(1, `rgb(${this.colorBase.map((c) => Math.round(c * 255)).join(',')})`);

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
}
