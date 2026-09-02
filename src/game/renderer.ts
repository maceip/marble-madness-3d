import * as THREE from 'three';
import { RETRO_OBJECT_SPRITES } from './retro-assets.js';
import { STEP_H, type BuiltLevel } from '../data/build.js';
import type { HazardInstance } from './hazards.js';
import type { MarbleState } from './physics.js';
import type { RemotePlayer } from './multiplayer.js';
import { CAM_BACK, CAM_TILT, CAM_YAW, FOV, MABLE_R } from '../lib/constants.js';

/** top, side, dark — per-course surface colours matching the arcade maps */
type FaceTriple = [number, number, number];
type StagePalette = Record<string, FaceTriple>;

const PALETTE_BASE: StagePalette = {
  path: [0x5a6a88, 0x2a3448, 0x1a2030],
  wall: [0x3a4460, 0x222838, 0x141820],
  sand: [0xcca854, 0x8a6a30, 0x5a4418],
  water: [0x2288dd, 0x186090, 0x0e3048],
  snow: [0xe6f2ff, 0xa8c4d8, 0x6a8498],
  glass: [0x44ffee, 0x2aa090, 0x185860],
  holo: [0xff3b99, 0x882050, 0x4a1028],
  metal: [0x99aab8, 0x5a6874, 0x3a444c],
  tree: [0x288448, 0x1a5a30, 0x0e3018],
  rock: [0x545860, 0x3a3c42, 0x222428],
  cloud: [0xeffcff, 0xb8c8d8, 0x788898],
};

const STAGE_PALETTES: Record<number, StagePalette> = {
  1: {
    ...PALETTE_BASE,
    path: [0xd4568a, 0x7a2450, 0x4a1830],
    wall: [0x5a3040, 0x3a1c28, 0x241018],
    tree: [0x2f8a48, 0x1a5a30, 0x0e3018],
    rock: [0x6a6e78, 0x444850, 0x2a2c32],
  },
  2: {
    ...PALETTE_BASE,
    path: [0xc8e4f8, 0x6a98b8, 0x3a6080],
    snow: [0xeef6ff, 0xa8c8e0, 0x6888a0],
    metal: [0xb8d0e0, 0x6a88a0, 0x3a5060],
    wall: [0xd8eef8, 0x88b0c8, 0x486878],
    water: [0x3aa0dd, 0x186890, 0x0c3048],
  },
  3: {
    ...PALETTE_BASE,
    path: [0x5478b0, 0x2c4870, 0x162438],
    wall: [0x283854, 0x162030, 0x0a1018],
    glass: [0x50f0e0, 0x249080, 0x124840],
    rock: [0x405470, 0x243244, 0x121a24],
    water: [0x162848, 0x0c1628, 0x060c14],
  },
  4: {
    ...PALETTE_BASE,
    path: [0xdca44a, 0x94682a, 0x543814],
    sand: [0xf2d27a, 0xb89848, 0x745820],
    rock: [0xa07844, 0x6c4c28, 0x3e2814],
    wall: [0x1a1a20, 0x0e0e12, 0x06060a],
    metal: [0x282830, 0x16161c, 0x0a0a0e],
    tree: [0x247c38, 0x144c20, 0x0a2810],
    water: [0x20a8d8, 0x10688c, 0x083448],
    glass: [0xf0cc40, 0xa88420, 0x584010],
  },
  5: {
    ...PALETTE_BASE,
    path: [0x7a48a8, 0x3a2060, 0x1a1030],
    wall: [0x2a1438, 0x180a24, 0x0c0614],
    glass: [0x66ffe8, 0x2aa090, 0x185860],
    holo: [0xff55cc, 0x882050, 0x4a1028],
    water: [0x33ee66, 0x148838, 0x0a4020],
  },
  6: {
    ...PALETTE_BASE,
    path: [0xd4a05a, 0x8a6030, 0x4a3018],
    sand: [0xe8c878, 0xa08040, 0x604818],
    metal: [0xc4a070, 0x7a6038, 0x3a2c18],
    wall: [0x8a5a30, 0x5a3818, 0x2a1c0c],
  },
  7: {
    ...PALETTE_BASE,
    path: [0x8a6a58, 0x5a4030, 0x2a2018],
    metal: [0xb8c0c8, 0x5a6068, 0x2a3038],
    wall: [0x3a2a28, 0x241818, 0x140c0c],
    sand: [0x6a5040, 0x443028, 0x241818],
  },
  8: {
    ...PALETTE_BASE,
    path: [0x4a5aa8, 0x243068, 0x101838],
    cloud: [0xd0e8ff, 0x88a8c8, 0x486888],
    glass: [0x88ffff, 0x2aa0c0, 0x145060],
    holo: [0xff66ee, 0x882060, 0x401030],
    sand: [0x8898c8, 0x4a5878, 0x283048],
  },
};

function stagePalette(stageId: number): StagePalette {
  return STAGE_PALETTES[stageId] ?? PALETTE_BASE;
}

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

interface RemotePlayerMesh {
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  label: THREE.Sprite;
}

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private environmentGroup = new THREE.Group();
  private terrainGroup = new THREE.Group();
  private hazardsGroup = new THREE.Group();
  private remotePlayersGroup = new THREE.Group();
  private particlesGroup = new THREE.Group();

  private marbleMesh: THREE.Mesh;
  private marbleSprite: THREE.Sprite;
  private marbleSpriteFrames: THREE.Texture[];
  private marbleShadow: THREE.Mesh;
  private localLabelSprite: THREE.Sprite;

  private hazardMeshes = new Map<HazardInstance, THREE.Object3D>();
  private remotePlayerMeshes = new Map<string, RemotePlayerMesh>();
  private particles: Particle[] = [];

  // Optimized shared assets for high player count (100+ marbles)
  private sharedSphereGeom = new THREE.SphereGeometry(MABLE_R, 24, 18);
  private sharedShadowGeom = (() => {
    const g = new THREE.PlaneGeometry(MABLE_R * 2.2, MABLE_R * 2.2);
    g.rotateX(-Math.PI / 2);
    return g;
  })();
  private sharedShadowMat: THREE.MeshBasicMaterial | null = null;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private goalPointLight: THREE.PointLight;

  private waterMeshes: THREE.Mesh[] = [];
  private animatedProps: THREE.Object3D[] = [];
  private totalTime = 0;
  private shakeAmount = 0;
  private camFollowX = 0;
  private camFollowY = 0;
  private camFollowZ = 0;
  private camInitialized = false;
  private textureCache = new Map<string, THREE.CanvasTexture>();
  private pixelTextureCache = new Map<string, THREE.Texture>();

  constructor() {
    this.canvas = document.getElementById('gl') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d14);
    this.scene.fog = new THREE.FogExp2(0x0b0d14, 0.012);

    this.camera = new THREE.PerspectiveCamera(
      FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      600,
    );

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambient);

    this.hemiLight = new THREE.HemisphereLight(0xddeeff, 0x111122, 0.6);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sunLight.position.set(35, 75, 45);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 200;
    this.sunLight.shadow.camera.left = -50;
    this.sunLight.shadow.camera.right = 50;
    this.sunLight.shadow.camera.top = 50;
    this.sunLight.shadow.camera.bottom = -50;
    this.scene.add(this.sunLight);

    this.goalPointLight = new THREE.PointLight(0x33e0ff, 2.5, 18);
    this.scene.add(this.goalPointLight);

    // Groups
    this.scene.add(this.environmentGroup);
    this.scene.add(this.terrainGroup);
    this.scene.add(this.hazardsGroup);
    this.scene.add(this.remotePlayersGroup);
    this.scene.add(this.particlesGroup);

    // Local Marble
    this.marbleMesh = this.createMarbleMesh('#ff3b5c', '#33e0ff');
    this.marbleSpriteFrames = [28, 29, 30].map((frame) => this.loadPixelTexture(`/sprites/retro-marble/blue-${frame}.png`));
    this.marbleSprite = this.createPixelSprite(this.marbleSpriteFrames[0], 0.74);
    this.marbleShadow = this.createShadowMesh();
    this.localLabelSprite = this.createPlayerLabel('YOU (P1)', '#ffd23f');
    this.localLabelSprite.position.set(0, 0.75, 0);

    this.scene.add(this.marbleMesh);
    this.scene.add(this.marbleSprite);
    this.scene.add(this.marbleShadow);
    this.scene.add(this.localLabelSprite);

    window.addEventListener('resize', () => this.onResize());
  }

  public setLocalPlayerInfo(name: string, color: string): void {
    this.scene.remove(this.marbleMesh);
    this.scene.remove(this.localLabelSprite);

    this.marbleMesh = this.createMarbleMesh(color, '#ffffff');
    this.localLabelSprite = this.createPlayerLabel(`${name} (YOU)`, '#ffd23f');

    this.scene.add(this.marbleMesh);
    this.scene.add(this.localLabelSprite);
  }

  private loadPixelTexture(path: string): THREE.Texture {
    const cached = this.pixelTextureCache.get(path);
    if (cached) return cached;
    const texture = new THREE.TextureLoader().load(path, () => {
      texture.userData.loaded = true;
      for (const callback of texture.userData.readyCallbacks ?? []) callback();
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.userData.loaded = false;
    texture.userData.readyCallbacks = [];
    this.pixelTextureCache.set(path, texture);
    return texture;
  }

  private createPixelSprite(texture: THREE.Texture, height: number): THREE.Sprite {
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.02 });
    const sprite = new THREE.Sprite(material);
    sprite.visible = Boolean(texture.userData.loaded);
    texture.userData.readyCallbacks.push(() => { sprite.visible = true; });
    const image = texture.image as HTMLImageElement | undefined;
    const applyScale = () => sprite.scale.set(height * ((image?.naturalWidth || 1) / (image?.naturalHeight || 1)), height, 1);
    if (image?.complete) applyScale(); else image?.addEventListener('load', applyScale, { once: true });
    applyScale();
    return sprite;
  }

  private createMarbleTexture(primaryColor: string, accentColor: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // 1. High-gloss pearlescent base
    const grad = ctx.createLinearGradient(0, 0, 512, 256);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, '#edf3fa');
    grad.addColorStop(0.7, '#c8d4e8');
    grad.addColorStop(1, '#a6b8d4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // 2. Bold spiral racing bands (Arcade classic swirl)
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.bezierCurveTo(128, 80, 384, 10, 512, 60);
    ctx.lineTo(512, 130);
    ctx.bezierCurveTo(384, 80, 128, 150, 0, 110);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.moveTo(0, 160);
    ctx.bezierCurveTo(128, 200, 384, 140, 512, 190);
    ctx.lineTo(512, 240);
    ctx.bezierCurveTo(384, 190, 128, 250, 0, 220);
    ctx.closePath();
    ctx.fill();

    // 3. Crisp accent highlight stripe
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(0, 75);
    ctx.bezierCurveTo(128, 115, 384, 45, 512, 95);
    ctx.lineTo(512, 110);
    ctx.bezierCurveTo(384, 60, 128, 130, 0, 90);
    ctx.closePath();
    ctx.fill();

    // 4. Center emblem circle with specular rim
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(256, 128, 44, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.arc(256, 128, 36, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MM', 256, 128);

    // 5. Specular highlight sheen
    const specGrad = ctx.createLinearGradient(0, 0, 512, 0);
    specGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
    specGrad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    specGrad.addColorStop(1, 'rgba(255,255,255,0.3)');
    ctx.fillStyle = specGrad;
    ctx.fillRect(0, 0, 512, 256);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private createMarbleMesh(primaryColor = '#ff3b5c', accentColor = '#33e0ff'): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      map: this.createMarbleTexture(primaryColor, accentColor),
      roughness: 0.12,
      metalness: 0.45,
    });
    const mesh = new THREE.Mesh(this.sharedSphereGeom, mat);
    mesh.castShadow = true;
    return mesh;
  }

  private createShadowMesh(): THREE.Mesh {
    if (!this.sharedShadowMat) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(0,0,0,0.65)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);

      const tex = new THREE.CanvasTexture(canvas);
      this.sharedShadowMat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
      });
    }
    return new THREE.Mesh(this.sharedShadowGeom, this.sharedShadowMat);
  }

  private createPlayerLabel(text: string, color = '#33e0ff'): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    // Rounded tag background
    ctx.fillStyle = 'rgba(11, 14, 24, 0.82)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 48, 12);
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.font = 'bold 22px ui-monospace, SFMono-Regular, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.4, 0.35, 1.0);
    return sprite;
  }

  // =========================================================================
  // 3D ENVIRONMENT, SKYBOX & THEMATIC LEVEL SCENERY
  // =========================================================================

  public buildLevelMesh(level: BuiltLevel): void {
    // Clear old terrain and environment
    while (this.terrainGroup.children.length > 0) {
      this.terrainGroup.remove(this.terrainGroup.children[0]);
    }
    while (this.environmentGroup.children.length > 0) {
      this.environmentGroup.remove(this.environmentGroup.children[0]);
    }
    this.waterMeshes = [];
    this.animatedProps = [];

    const stageId = level.def.id;
    this.setupThemedEnvironment(stageId, level.def.name);

    // Material palette for surfaces
    const materials = this.createSurfaceMaterials(stageId);

    const { W, H, cells } = level.layout;
    const boxGeom = new THREE.BoxGeometry(1, 1, 1);

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const cell = cells[r * W + c];
        if (!cell || cell.surf === 'void') continue;

        const mat = materials[cell.surf] || materials.path;
        const columnHeight = cell.H * STEP_H;

        if (columnHeight > 0) {
          if (cell.fall !== 'none') {
            // Render smooth sloped wedge ramp for sloped tiles
            const wedge = this.createRampMesh(cell.fall, columnHeight, mat);
            wedge.position.set(c + 0.5, 0, r + 0.5);
            wedge.receiveShadow = true;
            this.terrainGroup.add(wedge);
          } else {
            // Standard column block with beveled appearance
            const block = new THREE.Mesh(boxGeom, mat);
            block.position.set(c + 0.5, columnHeight / 2, r + 0.5);
            block.scale.set(0.98, columnHeight, 0.98);
            block.receiveShadow = true;
            this.terrainGroup.add(block);
          }
        }

        // Add 3D scenery props per surface
        if (cell.surf === 'tree') {
          const treeGroup = stageId === 4 ? this.createPalmTreeProp() : this.createTreeProp();
          treeGroup.position.set(c + 0.5, columnHeight, r + 0.5);
          this.terrainGroup.add(treeGroup);
        } else if (cell.surf === 'rock') {
          let rockProp: THREE.Object3D;
          if (stageId === 4) {
            rockProp = c % 2 === 0 ? this.createPyramidObstacleProp() : this.createRockProp();
          } else if (stageId === 3) {
            rockProp = this.createReliefMuralProp();
          } else {
            rockProp = this.createRockProp();
          }
          rockProp.position.set(c + 0.5, columnHeight, r + 0.5);
          this.terrainGroup.add(rockProp);
        } else if (cell.surf === 'wall' && stageId === 4 && (c === 5 || c === 11)) {
          const obelisk = this.createObeliskProp();
          obelisk.position.set(c + 0.5, columnHeight, r + 0.5);
          this.terrainGroup.add(obelisk);
        } else if (cell.surf === 'wall' && stageId === 3 && (c === 6 || c === 14)) {
          const starProp = this.createStarProp();
          starProp.position.set(c + 0.5, columnHeight + 0.6, r + 0.5);
          this.terrainGroup.add(starProp);
        } else if (cell.surf === 'water') {
          const waterGeom = new THREE.PlaneGeometry(1, 1, 4, 4);
          waterGeom.rotateX(-Math.PI / 2);
          const waterMesh = new THREE.Mesh(waterGeom, materials.water);
          waterMesh.position.set(c + 0.5, columnHeight + 0.05, r + 0.5);
          this.waterMeshes.push(waterMesh);
          this.terrainGroup.add(waterMesh);
        }
      }
    }
  }

  private createRampMesh(fall: string, height: number, mat: THREE.Material): THREE.Mesh {
    // Custom wedge geometry for sloped ramps
    const geom = new THREE.BufferGeometry();
    const h1 = height;
    const h0 = Math.max(0.1, height - STEP_H);

    // Positions for a 1x1 cell wedge
    // Corners: 0:(-0.5, -0.5), 1:(0.5, -0.5), 2:(0.5, 0.5), 3:(-0.5, 0.5)
    let y00 = h1, y10 = h1, y11 = h1, y01 = h1;

    switch (fall) {
      case 'E':
        y10 = h0; y11 = h0;
        break;
      case 'W':
        y00 = h0; y01 = h0;
        break;
      case 'S':
        y01 = h0; y11 = h0;
        break;
      case 'N':
        y00 = h0; y10 = h0;
        break;
      case 'SE':
        y11 = h0;
        break;
      case 'SW':
        y01 = h0;
        break;
      default:
        break;
    }

    const vertices = new Float32Array([
      // Top sloped quad (2 triangles)
      -0.49, y00, -0.49,
       0.49, y10, -0.49,
       0.49, y11,  0.49,

      -0.49, y00, -0.49,
       0.49, y11,  0.49,
      -0.49, y01,  0.49,

      // Base & sides (down to ground 0)
      -0.49, 0, -0.49,   0.49, 0, -0.49,   0.49, y10, -0.49,
      -0.49, 0, -0.49,   0.49, y10, -0.49,  -0.49, y00, -0.49,

       0.49, 0, -0.49,   0.49, 0,  0.49,   0.49, y11,  0.49,
       0.49, 0, -0.49,   0.49, y11,  0.49,   0.49, y10, -0.49,

       0.49, 0,  0.49,  -0.49, 0,  0.49,  -0.49, y01,  0.49,
       0.49, 0,  0.49,  -0.49, y01,  0.49,   0.49, y11,  0.49,

      -0.49, 0,  0.49,  -0.49, 0, -0.49,  -0.49, y00, -0.49,
      -0.49, 0,  0.49,  -0.49, y00, -0.49,  -0.49, y01,  0.49,
    ]);

    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.computeVertexNormals();

    return new THREE.Mesh(geom, mat);
  }

  private setupThemedEnvironment(stageId: number, stageName: string): void {
    // Thematic sky, fog and 3D background props
    let fogColor = 0x0b0d14;
    let skyColorTop = 0x142036;
    let skyColorBottom = 0x060810;

    switch (stageId) {
      case 1: // Pink Gardens
        fogColor = 0x0c1c14;
        skyColorTop = 0x224838;
        skyColorBottom = 0x0a1610;
        this.sunLight.color.setHex(0xfff4dd);
        this.hemiLight.color.setHex(0x88eebb);
        this.hemiLight.groundColor.setHex(0x112211);
        this.buildForestBackdrop();
        break;

      case 2: // Arctic Adventure
        fogColor = 0x0c182a;
        skyColorTop = 0x284878;
        skyColorBottom = 0x0c1828;
        this.sunLight.color.setHex(0xddeeff);
        this.hemiLight.color.setHex(0xccf0ff);
        this.hemiLight.groundColor.setHex(0x102030);
        this.buildArcticBackdrop();
        break;

      case 3: // Astral Spire (Image #1)
        fogColor = 0x0e1428;
        skyColorTop = 0x1e3260;
        skyColorBottom = 0x080c1a;
        this.sunLight.color.setHex(0xffea9f);
        this.hemiLight.color.setHex(0x90c0ff);
        this.hemiLight.groundColor.setHex(0x141e32);
        this.buildCelestialBackdrop();
        break;

      case 4: // Pyramid Oasis (Image #2)
        fogColor = 0x2a1a0c;
        skyColorTop = 0x643c18;
        skyColorBottom = 0x1c1006;
        this.sunLight.color.setHex(0xfff0cc);
        this.hemiLight.color.setHex(0xffd488);
        this.hemiLight.groundColor.setHex(0x381e08);
        this.buildEgyptianBackdrop();
        break;

      case 5: // Edgy Maze
        fogColor = 0x140a24;
        skyColorTop = 0x3b1566;
        skyColorBottom = 0x0d0618;
        this.sunLight.color.setHex(0xff55aa);
        this.hemiLight.color.setHex(0x33e0ff);
        this.hemiLight.groundColor.setHex(0x220044);
        this.buildCyberGridBackdrop();
        break;

      case 6: // Dusty Trail
        fogColor = 0x24140a;
        skyColorTop = 0x5a2d12;
        skyColorBottom = 0x180c04;
        this.sunLight.color.setHex(0xffdd99);
        this.hemiLight.color.setHex(0xffbb77);
        this.hemiLight.groundColor.setHex(0x331100);
        this.buildDesertBackdrop();
        break;

      case 7: // Drillin' Rye
        fogColor = 0x180c10;
        skyColorTop = 0x3d141e;
        skyColorBottom = 0x10080a;
        this.sunLight.color.setHex(0xff8844);
        this.hemiLight.color.setHex(0xff5533);
        this.hemiLight.groundColor.setHex(0x220808);
        this.buildMineCavernBackdrop();
        break;

      case 8: // Space Dementia
        fogColor = 0x040614;
        skyColorTop = 0x121438;
        skyColorBottom = 0x020308;
        this.sunLight.color.setHex(0xbbddff);
        this.hemiLight.color.setHex(0x88aaff);
        this.hemiLight.groundColor.setHex(0x080a1c);
        this.buildCosmicSpaceBackdrop();
        break;
    }

    this.scene.background = new THREE.Color(skyColorBottom);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.011);

    // Large panoramic curved backdrop sky dome
    const skyDomeGeom = new THREE.SphereGeometry(260, 32, 24);
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 512;
    skyCanvas.height = 256;
    const sctx = skyCanvas.getContext('2d')!;
    const skyGrad = sctx.createLinearGradient(0, 0, 0, 256);
    skyGrad.addColorStop(0, `#${skyColorTop.toString(16).padStart(6, '0')}`);
    skyGrad.addColorStop(0.65, `#${fogColor.toString(16).padStart(6, '0')}`);
    skyGrad.addColorStop(1, `#${skyColorBottom.toString(16).padStart(6, '0')}`);
    sctx.fillStyle = skyGrad;
    sctx.fillRect(0, 0, 512, 256);

    const skyTex = new THREE.CanvasTexture(skyCanvas);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTex,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const skyDome = new THREE.Mesh(skyDomeGeom, skyMat);
    this.environmentGroup.add(skyDome);
  }

  private buildForestBackdrop(): void {
    // Distant mountain ranges and pine forests
    const mtnMat = new THREE.MeshStandardMaterial({ color: 0x14281c, roughness: 0.9 });
    for (let i = 0; i < 16; i++) {
      const radius = 6 + Math.random() * 8;
      const height = 15 + Math.random() * 20;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 6), mtnMat);
      const angle = (i / 16) * Math.PI * 2;
      cone.position.set(Math.cos(angle) * 75, height / 2 - 10, Math.sin(angle) * 75);
      this.environmentGroup.add(cone);
    }
  }

  private buildArcticBackdrop(): void {
    // Glacial icebergs
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0x88ccee,
      roughness: 0.1,
      metalness: 0.2,
    });
    for (let i = 0; i < 14; i++) {
      const w = 8 + Math.random() * 12;
      const h = 16 + Math.random() * 22;
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(w, 0), iceMat);
      mesh.scale.set(1, h / w, 1);
      const angle = (i / 14) * Math.PI * 2;
      mesh.position.set(Math.cos(angle) * 80, h / 2 - 8, Math.sin(angle) * 80);
      this.environmentGroup.add(mesh);
    }
  }

  private buildCelestialBackdrop(): void {
    // 3D Starlight Tower Citadel backdrop with pillars and constellations
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x24385c,
      roughness: 0.6,
      metalness: 0.3,
    });
    for (let i = 0; i < 16; i++) {
      const radius = 3 + Math.random() * 3;
      const height = 30 + Math.random() * 40;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.2, height, 8), towerMat);
      const angle = (i / 16) * Math.PI * 2;
      cyl.position.set(Math.cos(angle) * 85, height / 2 - 15, Math.sin(angle) * 85);
      this.environmentGroup.add(cyl);
    }

    // Distant floating gold star clusters
    const starMat = new THREE.MeshStandardMaterial({
      color: 0xffd23f,
      emissive: 0x886600,
      metalness: 0.8,
      roughness: 0.2,
    });
    for (let i = 0; i < 18; i++) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(2 + Math.random() * 2, 0), starMat);
      star.position.set(-80 + Math.random() * 160, 20 + Math.random() * 40, -60 + Math.random() * 80);
      this.animatedProps.push(star);
      this.environmentGroup.add(star);
    }
  }

  private buildEgyptianBackdrop(): void {
    // Giant Great Pyramid backdrop with dark cavern entrance
    const pyrMat = new THREE.MeshStandardMaterial({
      color: 0xa87848,
      roughness: 0.9,
    });
    const greatPyr = new THREE.Mesh(new THREE.ConeGeometry(55, 45, 4), pyrMat);
    greatPyr.rotateY(Math.PI / 4);
    greatPyr.position.set(20, 18, -75);
    this.environmentGroup.add(greatPyr);

    // Cavern tomb entrance
    const archMat = new THREE.MeshBasicMaterial({ color: 0x0a0604 });
    const arch = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 2), archMat);
    arch.position.set(20, 4, -48);
    this.environmentGroup.add(arch);

    // Distant secondary pyramids & dunes
    const sidePyr1 = new THREE.Mesh(new THREE.ConeGeometry(30, 25, 4), pyrMat);
    sidePyr1.rotateY(Math.PI / 4);
    sidePyr1.position.set(-65, 8, -60);
    this.environmentGroup.add(sidePyr1);

    const sidePyr2 = new THREE.Mesh(new THREE.ConeGeometry(24, 20, 4), pyrMat);
    sidePyr2.rotateY(Math.PI / 4);
    sidePyr2.position.set(75, 6, -50);
    this.environmentGroup.add(sidePyr2);
  }

  private buildCyberGridBackdrop(): void {
    // Neon wireframe grid floor
    const grid = new THREE.GridHelper(160, 40, 0x33e0ff, 0xff3b5c);
    grid.position.set(10, -5, 10);
    this.environmentGroup.add(grid);

    // Floating neon polyhedra
    const polyMat = new THREE.MeshBasicMaterial({
      color: 0xff3b5c,
      wireframe: true,
    });
    for (let i = 0; i < 8; i++) {
      const octa = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + Math.random() * 4, 0), polyMat);
      octa.position.set(-30 + i * 10, 15 + Math.random() * 15, -40 + Math.random() * 20);
      this.animatedProps.push(octa);
      this.environmentGroup.add(octa);
    }
  }

  private buildDesertBackdrop(): void {
    // Sandstone mesa pillars
    const mesaMat = new THREE.MeshStandardMaterial({ color: 0x884422, roughness: 0.95 });
    for (let i = 0; i < 12; i++) {
      const r = 5 + Math.random() * 7;
      const h = 20 + Math.random() * 30;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, h, 7), mesaMat);
      const angle = (i / 12) * Math.PI * 2;
      cyl.position.set(Math.cos(angle) * 70, h / 2 - 10, Math.sin(angle) * 70);
      this.environmentGroup.add(cyl);
    }
  }

  private buildMineCavernBackdrop(): void {
    // Cavern rocky stalactites
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a1a1f, roughness: 0.9 });
    for (let i = 0; i < 15; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 25, 6), rockMat);
      cone.rotateX(Math.PI);
      cone.position.set(-40 + i * 6, 28, -30 + Math.random() * 60);
      this.environmentGroup.add(cone);
    }
  }

  private buildCosmicSpaceBackdrop(): void {
    // 3D Starfield
    const starGeom = new THREE.BufferGeometry();
    const starCount = 1500;
    const starPositions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 400;
      starPositions[i + 1] = (Math.random() - 0.5) * 400;
      starPositions[i + 2] = (Math.random() - 0.5) * 400;
    }

    starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, transparent: true });
    const stars = new THREE.Points(starGeom, starMat);
    this.environmentGroup.add(stars);

    // Planetary rings in background
    const ringGeom = new THREE.RingGeometry(50, 75, 48);
    ringGeom.rotateX(Math.PI / 2.8);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x6688cc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    ringMesh.position.set(30, 20, -100);
    this.environmentGroup.add(ringMesh);
  }

  private getArcadeTileTexture(
    type: string,
    c1: number,
    c2: number,
    c3: number,
  ): THREE.CanvasTexture {
    const key = `${type}_${c1}_${c2}_${c3}`;
    if (this.textureCache.has(key)) return this.textureCache.get(key)!;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const hex1 = '#' + c1.toString(16).padStart(6, '0');
    const hex2 = '#' + c2.toString(16).padStart(6, '0');
    const hex3 = '#' + c3.toString(16).padStart(6, '0');

    switch (type) {
      case 'path': {
        // 2x2 Arcade isometric checkerboard with beveled borders
        ctx.fillStyle = hex1;
        ctx.fillRect(0, 0, 128, 128);

        ctx.fillStyle = hex2;
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillRect(64, 64, 64, 64);

        // Bevel highlights & shadow lines
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, 60, 60);
        ctx.strokeRect(66, 66, 60, 60);

        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, 128, 128);
        ctx.beginPath();
        ctx.moveTo(64, 0); ctx.lineTo(64, 128);
        ctx.moveTo(0, 64); ctx.lineTo(128, 64);
        ctx.stroke();
        break;
      }
      case 'snow': {
        // Ice crystal lattice with specular shine
        ctx.fillStyle = hex1;
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = hex2;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc((i % 2) * 64 + 32, Math.floor(i / 2) * 64 + 32, 22, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 3;
        ctx.strokeRect(1, 1, 126, 126);
        break;
      }
      case 'metal': {
        // Brushed metallic panels with industrial corner rivets
        ctx.fillStyle = hex1;
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = hex2;
        ctx.fillRect(4, 4, 120, 120);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (const [rx, ry] of [[12, 12], [116, 12], [12, 116], [116, 116]]) {
          ctx.beginPath();
          ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'sand': {
        // Desert ripple grains
        ctx.fillStyle = hex1;
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = hex2;
        for (let y = 0; y < 128; y += 16) {
          ctx.fillRect(0, y, 128, 4);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(0, 0, 128, 128);
        break;
      }
      case 'wall': {
        // Arcade tiered block facets
        ctx.fillStyle = hex1;
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = hex2;
        ctx.fillRect(0, 64, 128, 64);
        ctx.strokeStyle = hex3;
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, 124, 124);
        break;
      }
      default: {
        ctx.fillStyle = hex1;
        ctx.fillRect(0, 0, 128, 128);
        ctx.strokeStyle = hex2;
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, 126, 126);
        break;
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this.textureCache.set(key, tex);
    return tex;
  }

  private createSurfaceMaterials(stageId: number): Record<string, THREE.Material> {
    const pal = stagePalette(stageId);

    const pathTex = this.getArcadeTileTexture('path', pal.path[0], pal.path[1], pal.path[2]);
    const wallTex = this.getArcadeTileTexture('wall', pal.wall[0], pal.wall[1], pal.wall[2]);
    const sandTex = this.getArcadeTileTexture('sand', pal.sand[0], pal.sand[1], pal.sand[2]);
    const snowTex = this.getArcadeTileTexture('snow', pal.snow[0], pal.snow[1], pal.snow[2]);
    const metalTex = this.getArcadeTileTexture('metal', pal.metal[0], pal.metal[1], pal.metal[2]);

    return {
      path: new THREE.MeshStandardMaterial({
        map: pathTex,
        roughness: 0.28,
        metalness: 0.15,
      }),
      wall: new THREE.MeshStandardMaterial({
        map: wallTex,
        roughness: 0.6,
      }),
      sand: new THREE.MeshStandardMaterial({
        map: sandTex,
        roughness: 0.95,
      }),
      water: new THREE.MeshStandardMaterial({
        color: pal.water[0],
        roughness: 0.04,
        metalness: 0.1,
        transparent: true,
        opacity: 0.82,
      }),
      snow: new THREE.MeshStandardMaterial({
        map: snowTex,
        roughness: 0.08,
        metalness: 0.25,
      }),
      glass: new THREE.MeshStandardMaterial({
        color: pal.glass[0],
        transparent: true,
        opacity: 0.72,
        roughness: 0.06,
        metalness: 0.4,
      }),
      holo: new THREE.MeshStandardMaterial({
        color: pal.holo[0],
        wireframe: true,
        emissive: pal.holo[0],
      }),
      metal: new THREE.MeshStandardMaterial({
        map: metalTex,
        metalness: 0.85,
        roughness: 0.18,
      }),
      tree: new THREE.MeshStandardMaterial({ color: pal.tree[0], roughness: 0.75 }),
      rock: new THREE.MeshStandardMaterial({ color: pal.rock[0], roughness: 0.85 }),
      cloud: new THREE.MeshStandardMaterial({ color: pal.cloud[0], roughness: 0.4, transparent: true, opacity: 0.88 }),
    };
  }

  private createTreeProp(): THREE.Group {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a3d28 }),
    );
    trunk.position.y = 0.25;
    group.add(trunk);

    const foliage = new THREE.Mesh(
      new THREE.ConeGeometry(0.48, 1.1, 7),
      new THREE.MeshStandardMaterial({ color: 0x247c42, roughness: 0.8 }),
    );
    foliage.position.y = 0.8;
    foliage.castShadow = true;
    group.add(foliage);
    return group;
  }

  private createRockProp(): THREE.Mesh {
    const geom = new THREE.DodecahedronGeometry(0.35, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x585c66, roughness: 0.85 });
    const rock = new THREE.Mesh(geom, mat);
    rock.position.y = 0.35;
    rock.castShadow = true;
    return rock;
  }

  private createPalmTreeProp(): THREE.Group {
    const group = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4e32, roughness: 0.9 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.2, 7), trunkMat);
    trunk.position.y = 0.6;
    trunk.rotation.z = 0.08;
    group.add(trunk);

    const frondMat = new THREE.MeshStandardMaterial({
      color: 0x228838,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 6; i++) {
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.25), frondMat);
      const angle = (i / 6) * Math.PI * 2;
      frond.position.set(Math.cos(angle) * 0.35, 1.25, Math.sin(angle) * 0.35);
      frond.rotation.y = angle;
      frond.rotation.x = 0.45;
      group.add(frond);
    }
    return group;
  }

  private createObeliskProp(): THREE.Group {
    const group = new THREE.Group();
    const obeliskMat = new THREE.MeshStandardMaterial({
      color: 0x141418,
      roughness: 0.15,
      metalness: 0.7,
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.8, 4), obeliskMat);
    shaft.position.y = 0.9;
    shaft.rotation.y = Math.PI / 4;
    group.add(shaft);

    const capMat = new THREE.MeshStandardMaterial({
      color: 0xffd23f,
      emissive: 0xaa8800,
      metalness: 0.8,
      roughness: 0.2,
    });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.45, 4), capMat);
    cap.position.y = 1.95;
    cap.rotation.y = Math.PI / 4;
    group.add(cap);

    return group;
  }

  private createPyramidObstacleProp(): THREE.Mesh {
    const geom = new THREE.ConeGeometry(0.65, 0.9, 4);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc89858,
      roughness: 0.85,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = 0.45;
    mesh.rotation.y = Math.PI / 4;
    mesh.castShadow = true;
    return mesh;
  }

  private createReliefMuralProp(): THREE.Group {
    const group = new THREE.Group();
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x3d5070,
      roughness: 0.7,
    });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.9, 0.3), slabMat);
    slab.position.y = 0.45;
    slab.castShadow = true;
    group.add(slab);

    const faceMat = new THREE.MeshStandardMaterial({
      color: 0x7090c0,
      roughness: 0.5,
    });
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), faceMat);
    face.scale.set(1, 1.3, 0.4);
    face.position.set(0, 0.48, 0.16);
    group.add(face);

    return group;
  }

  private createStarProp(): THREE.Mesh {
    const geom = new THREE.OctahedronGeometry(0.35, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd23f,
      emissive: 0xaa7700,
      metalness: 0.7,
      roughness: 0.2,
    });
    const star = new THREE.Mesh(geom, mat);
    star.position.y = 0.35;
    this.animatedProps.push(star);
    return star;
  }

  // =========================================================================
  // HAZARDS & ENTITIES
  // =========================================================================

  public syncHazards(hazards: HazardInstance[]): void {
    while (this.hazardsGroup.children.length > 0) {
      this.hazardsGroup.remove(this.hazardsGroup.children[0]);
    }
    this.hazardMeshes.clear();

    for (const h of hazards) {
      const obj = this.createHazardObject(h);
      this.hazardsGroup.add(obj);
      this.hazardMeshes.set(h, obj);
    }
  }

  private createHazardObject(h: HazardInstance): THREE.Object3D {
    const group = new THREE.Group();

    switch (h.def.kind) {
      case 'blade': {
        const discGeom = new THREE.CylinderGeometry(0.45, 0.45, 0.05, 16);
        const discMat = new THREE.MeshStandardMaterial({
          color: 0xdd2233,
          metalness: 0.9,
          roughness: 0.1,
        });
        const disc = new THREE.Mesh(discGeom, discMat);
        disc.rotateZ(Math.PI / 2);
        group.add(disc);
        break;
      }

      case 'bat': {
        const bodyGeom = new THREE.SphereGeometry(0.2, 8, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x221133 });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        group.add(body);

        const wingGeom = new THREE.PlaneGeometry(0.5, 0.25);
        const wingMat = new THREE.MeshStandardMaterial({ color: 0x442255, side: THREE.DoubleSide });
        const leftWing = new THREE.Mesh(wingGeom, wingMat);
        leftWing.position.set(-0.3, 0, 0);
        leftWing.name = 'wingL';
        const rightWing = new THREE.Mesh(wingGeom, wingMat);
        rightWing.position.set(0.3, 0, 0);
        rightWing.name = 'wingR';
        group.add(leftWing, rightWing);
        break;
      }

      case 'bomber': {
        const bodyGeom = new THREE.ConeGeometry(0.35, 0.9, 8);
        bodyGeom.rotateX(Math.PI / 2);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1188bb, metalness: 0.5 });
        const ship = new THREE.Mesh(bodyGeom, bodyMat);
        group.add(ship);
        break;
      }

      case 'snake': {
        for (let i = 0; i < 4; i++) {
          const segGeom = new THREE.SphereGeometry(0.22 - i * 0.03, 8, 8);
          const segMat = new THREE.MeshStandardMaterial({ color: i === 0 ? 0x22cc44 : 0x118822 });
          const seg = new THREE.Mesh(segGeom, segMat);
          seg.position.set(0, 0, i * 0.25);
          group.add(seg);
        }
        break;
      }

      case 'item': {
        const octaGeom = new THREE.OctahedronGeometry(0.24);
        const octaMat = new THREE.MeshStandardMaterial({
          color: 0xffd23f,
          emissive: 0x886600,
          metalness: 0.6,
          roughness: 0.2,
        });
        const crystal = new THREE.Mesh(octaGeom, octaMat);
        group.add(crystal);
        break;
      }

      case 'checkpoint': {
        const ringGeom = new THREE.TorusGeometry(0.4, 0.06, 8, 16);
        const ringMat = new THREE.MeshStandardMaterial({
          color: 0x33e0ff,
          emissive: 0x117799,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotateX(Math.PI / 2);
        group.add(ring);
        break;
      }

      case 'goal': {
        const archGeom = new THREE.TorusGeometry(0.65, 0.08, 12, 24);
        const archMat = new THREE.MeshStandardMaterial({
          color: 0xff3b5c,
          emissive: 0x881122,
        });
        const arch = new THREE.Mesh(archGeom, archMat);
        arch.rotateX(Math.PI / 2);
        group.add(arch);
        this.goalPointLight.position.set(h.x, h.y + 0.5, h.z);
        break;
      }

      case 'steelie': {
        // High-gloss obsidian black sphere with gold specular sheen
        const steelieMat = new THREE.MeshStandardMaterial({
          color: 0x111115,
          roughness: 0.08,
          metalness: 0.95,
        });
        const ball = new THREE.Mesh(this.sharedSphereGeom, steelieMat);
        ball.castShadow = true;
        ball.name = 'steelieBall';
        group.add(ball);

        // Core gold reflection spot
        const dotGeom = new THREE.SphereGeometry(0.04, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
        const dot = new THREE.Mesh(dotGeom, dotMat);
        dot.position.set(0, MABLE_R * 0.7, MABLE_R * 0.7);
        ball.add(dot);
        break;
      }

      case 'muncher': {
        // Green tubular body hidden in hole
        const baseGeom = new THREE.CylinderGeometry(0.24, 0.28, 0.35, 12);
        const skinMat = new THREE.MeshStandardMaterial({ color: 0x1faa38, roughness: 0.6 });
        const body = new THREE.Mesh(baseGeom, skinMat);
        body.position.y = 0.17;
        body.name = 'muncherBody';
        group.add(body);

        // Upper Jaw with white fangs
        const jawGeom = new THREE.BoxGeometry(0.32, 0.14, 0.3);
        const jawTop = new THREE.Mesh(jawGeom, skinMat);
        jawTop.position.set(0, 0.38, 0.08);
        jawTop.name = 'jawTop';

        // White teeth
        const toothGeom = new THREE.ConeGeometry(0.04, 0.08, 4);
        const toothMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        for (let t = -0.1; t <= 0.1; t += 0.08) {
          const tooth = new THREE.Mesh(toothGeom, toothMat);
          tooth.rotation.x = Math.PI;
          tooth.position.set(t, -0.07, 0.12);
          jawTop.add(tooth);
        }
        group.add(jawTop);

        // Lower Jaw
        const jawBottom = new THREE.Mesh(jawGeom, skinMat);
        jawBottom.position.set(0, 0.24, 0.08);
        jawBottom.name = 'jawBottom';
        for (let t = -0.1; t <= 0.1; t += 0.08) {
          const tooth = new THREE.Mesh(toothGeom, toothMat);
          tooth.position.set(t, 0.07, 0.12);
          jawBottom.add(tooth);
        }
        group.add(jawBottom);
        break;
      }

      case 'acid': {
        const poolGeom = new THREE.CylinderGeometry(0.48, 0.48, 0.04, 16);
        const poolMat = new THREE.MeshStandardMaterial({
          color: 0x22ee44,
          emissive: 0x118822,
          transparent: true,
          opacity: 0.85,
          roughness: 0.1,
        });
        const pool = new THREE.Mesh(poolGeom, poolMat);
        pool.name = 'acidPool';
        group.add(pool);
        break;
      }

      case 'springboard': {
        const padGeom = new THREE.BoxGeometry(0.7, 0.1, 0.7);
        const padMat = new THREE.MeshStandardMaterial({ color: 0xff8800 });
        const pad = new THREE.Mesh(padGeom, padMat);
        group.add(pad);
        break;
      }
    }

    const spritePath = RETRO_OBJECT_SPRITES[h.def.kind];
    if (spritePath) {
      const sprite = this.createPixelSprite(this.loadPixelTexture(spritePath), h.def.kind === 'goal' || h.def.kind === 'checkpoint' ? 1.15 : 0.72);
      sprite.position.y = h.def.kind === 'goal' || h.def.kind === 'checkpoint' ? 0.55 : 0.38;
      sprite.name = 'originalExtractedSprite';
      group.add(sprite);
    }

    return group;
  }

  // =========================================================================
  // MULTIPLAYER REMOTE PLAYERS
  // =========================================================================

  public syncRemotePlayers(players: RemotePlayer[], currentStage: number): void {
    const activeIds = new Set<string>();

    for (const p of players) {
      if (p.stage !== currentStage) continue;
      activeIds.add(p.id);

      let rpm = this.remotePlayerMeshes.get(p.id);
      if (!rpm) {
        const mesh = this.createMarbleMesh(p.color, '#ffffff');
        const shadow = this.createShadowMesh();
        const label = this.createPlayerLabel(`${p.name} [${p.score}]`, p.color);

        this.remotePlayersGroup.add(mesh);
        this.remotePlayersGroup.add(shadow);
        this.remotePlayersGroup.add(label);

        rpm = { mesh, shadow, label };
        this.remotePlayerMeshes.set(p.id, rpm);
      }

      // Update position
      rpm.mesh.position.set(p.x, p.y, p.z);
      rpm.mesh.rotation.x = p.rotX;
      rpm.mesh.rotation.z = p.rotZ;

      rpm.shadow.position.set(p.x, Math.max(0, p.y - MABLE_R + 0.01), p.z);
      rpm.label.position.set(p.x, p.y + 0.65, p.z);
    }

    // Clean up disconnected or different stage players
    for (const [id, rpm] of this.remotePlayerMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.remotePlayersGroup.remove(rpm.mesh);
        this.remotePlayersGroup.remove(rpm.shadow);
        this.remotePlayersGroup.remove(rpm.label);
        this.remotePlayerMeshes.delete(id);
      }
    }
  }

  // =========================================================================
  // PARTICLES & SPECIAL EFFECTS
  // =========================================================================

  public emitShatterParticles(pos: [number, number, number]): void {
    const shardGeom = new THREE.TetrahedronGeometry(0.08);
    const shardMat = new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.2 });

    for (let i = 0; i < 22; i++) {
      const mesh = new THREE.Mesh(shardGeom, shardMat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      this.particlesGroup.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = 0.06 + Math.random() * 0.16;
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * speed,
        vy: 0.09 + Math.random() * 0.16,
        vz: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.9 + Math.random() * 0.4,
      });
    }
  }

  public emitBumpSparks(pos: [number, number, number]): void {
    const sparkGeom = new THREE.OctahedronGeometry(0.06);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });

    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(sparkGeom, sparkMat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      this.particlesGroup.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = 0.08 + Math.random() * 0.18;
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * speed,
        vy: 0.05 + Math.random() * 0.14,
        vz: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.3,
      });
    }
  }

  public emitSkidMarks(pos: [number, number, number], intensity = 1.0): void {
    const dustGeom = new THREE.TetrahedronGeometry(0.04);
    const dustMat = new THREE.MeshBasicMaterial({
      color: 0xe0e8f0,
      transparent: true,
      opacity: 0.6 * Math.min(1, intensity),
    });

    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(dustGeom, dustMat);
      mesh.position.set(
        pos[0] + (Math.random() - 0.5) * 0.1,
        pos[1] - MABLE_R + 0.02,
        pos[2] + (Math.random() - 0.5) * 0.1,
      );
      this.particlesGroup.add(mesh);

      this.particles.push({
        mesh,
        vx: (Math.random() - 0.5) * 0.04,
        vy: 0.02 + Math.random() * 0.04,
        vz: (Math.random() - 0.5) * 0.04,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.2,
      });
    }
  }

  public triggerScreenShake(amount = 0.3): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  // =========================================================================
  // MAIN RENDER LOOP
  // =========================================================================

  public render(
    marble: MarbleState,
    hazards: HazardInstance[],
    remotePlayers: RemotePlayer[],
    stageId: number,
    dt: number,
  ): void {
    this.totalTime += dt;

    // 1. Update local marble position & true 3D rolling orientation
    this.marbleMesh.position.set(marble.x, marble.y, marble.z);
    this.marbleSprite.position.set(marble.x, marble.y + 0.08, marble.z);
    const marbleFrame = Math.floor(this.totalTime * (4 + marble.speed * 32)) % this.marbleSpriteFrames.length;
    (this.marbleSprite.material as THREE.SpriteMaterial).map = this.marbleSpriteFrames[marbleFrame];
    if (marble.quat) {
      this.marbleMesh.quaternion.set(marble.quat[0], marble.quat[1], marble.quat[2], marble.quat[3]);
    } else {
      this.marbleMesh.rotation.x = marble.rotX;
      this.marbleMesh.rotation.z = marble.rotZ;
    }

    this.marbleShadow.position.set(marble.x, Math.max(0, marble.y - MABLE_R + 0.01), marble.z);
    this.localLabelSprite.position.set(marble.x, marble.y + 0.65, marble.z);

    // Speed particles trail when going fast
    if (marble.speed > 0.22 && marble.grounded) {
      this.emitSkidMarks([marble.x, marble.y, marble.z], marble.speed / 0.32);
    }

    // 2. Sync multiplayer remote players
    this.syncRemotePlayers(remotePlayers, stageId);

    // 3. Update hazards animations
    for (const h of hazards) {
      const obj = this.hazardMeshes.get(h);
      if (!obj) continue;

      obj.visible = h.active;
      obj.position.set(h.x, h.y, h.z);

      if (h.def.kind === 'blade') {
        obj.rotation.y = h.rotation * 4;
      } else if (h.def.kind === 'item') {
        obj.rotation.y = h.rotation * 2;
        obj.position.y += Math.sin(h.animTime * 4) * 0.08;
      } else if (h.def.kind === 'bat') {
        const wingL = obj.getObjectByName('wingL');
        const wingR = obj.getObjectByName('wingR');
        if (wingL) wingL.rotation.z = Math.sin(h.animTime * 18) * 0.6;
        if (wingR) wingR.rotation.z = -Math.sin(h.animTime * 18) * 0.6;
      } else if (h.def.kind === 'muncher') {
        // Pop-up emergence from floor and snapping jaws
        const emerged = h.emerged ?? 0;
        obj.position.y = h.y + (emerged - 1.0) * 0.35;
        const jawTop = obj.getObjectByName('jawTop');
        const jawBottom = obj.getObjectByName('jawBottom');
        const jawAngle = (h.jawOpen ?? 0) * 0.65;
        if (jawTop) jawTop.rotation.x = -jawAngle;
        if (jawBottom) jawBottom.rotation.x = jawAngle;
      } else if (h.def.kind === 'steelie') {
        // Roll Steelie black marble
        const ball = obj.getObjectByName('steelieBall');
        if (ball) {
          ball.rotation.x += (h.vz ?? 0) * 2.8;
          ball.rotation.z -= (h.vx ?? 0) * 2.8;
        }
      } else if (h.def.kind === 'acid') {
        const pool = obj.getObjectByName('acidPool');
        if (pool) {
          const s = 1.0 + Math.sin(this.totalTime * 6) * 0.05;
          pool.scale.set(s, 1, s);
        }
      }
    }

    // 4. Animate background props
    for (const prop of this.animatedProps) {
      prop.rotation.y += dt * 0.5;
      prop.rotation.x += dt * 0.3;
    }

    // 5. Animate water waves
    for (const w of this.waterMeshes) {
      w.position.y += Math.sin(this.totalTime * 4) * 0.002;
    }

    // 6. Update particles
    for (const p of this.particles) {
      p.life += dt;
      p.vy -= 0.007;
      p.mesh.position.x += p.vx;
      p.mesh.position.y += p.vy;
      p.mesh.position.z += p.vz;
      p.mesh.rotation.x += 0.1;
      p.mesh.rotation.y += 0.1;
      const scale = Math.max(0.01, 1 - p.life / p.maxLife);
      p.mesh.scale.set(scale, scale, scale);
    }
    this.particles = this.particles.filter((p) => {
      if (p.life >= p.maxLife) {
        this.particlesGroup.remove(p.mesh);
        return false;
      }
      return true;
    });

    // 7. Smooth Isometric follow camera with lead-ahead & screen shake
    if (!this.camInitialized) {
      this.camFollowX = marble.x;
      this.camFollowY = marble.y;
      this.camFollowZ = marble.z;
      this.camInitialized = true;
    } else {
      // Smooth tracking spring-damper
      const leadX = marble.x + marble.vx * 12;
      const leadY = marble.y;
      const leadZ = marble.z + marble.vz * 12;
      this.camFollowX += (leadX - this.camFollowX) * Math.min(1, dt * 8);
      this.camFollowY += (leadY - this.camFollowY) * Math.min(1, dt * 6);
      this.camFollowZ += (leadZ - this.camFollowZ) * Math.min(1, dt * 8);
    }

    // Screen Shake Offset
    let shakeX = 0;
    let shakeY = 0;
    let shakeZ = 0;
    if (this.shakeAmount > 0.001) {
      shakeX = (Math.random() - 0.5) * this.shakeAmount;
      shakeY = (Math.random() - 0.5) * this.shakeAmount;
      shakeZ = (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount *= 0.88;
    }

    const radTilt = (CAM_TILT * Math.PI) / 180;
    const radYaw = (CAM_YAW * Math.PI) / 180;

    const camDist = CAM_BACK * 0.38;
    const camX = this.camFollowX + Math.sin(radYaw) * Math.cos(radTilt) * camDist + shakeX;
    const camY = this.camFollowY + Math.sin(radTilt) * camDist + 3.8 + shakeY;
    const camZ = this.camFollowZ + Math.cos(radYaw) * Math.cos(radTilt) * camDist + shakeZ;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.camFollowX + 1.2, this.camFollowY + 0.5, this.camFollowZ + 1.2);

    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}
