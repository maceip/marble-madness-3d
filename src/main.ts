import { Assets } from './engine/assets';
import { Renderer } from './render/renderer';
import { Input } from './engine/input';
import { Sound } from './engine/audio';
import { Game } from './game/game';
import { trackEvent, trackErrors, flushNativeTelemetry } from './engine/telemetry';
import { mmTrace, mmTraceInit } from './engine/trace';
import { Trackball3DView } from './render/trackball3d';

import * as levelEngine from './engine/level';
import * as physicsEngine from './engine/physics';
import * as constants from './engine/constants';
import * as iso from './engine/iso';
import { STAGES } from './levels';

declare global {
  interface Window {
    game?: Game;
    MarbleEngine?: {
      level: typeof levelEngine;
      physics: typeof physicsEngine;
      constants: typeof constants;
      iso: typeof iso;
      STAGES: typeof STAGES;
    };
  }
}

async function boot(): Promise<void> {
  mmTraceInit();
  // The server injects window.__MM__ (lobby id, agent-page flag, public origin, login, install nonce). If a CSP blocked
  // that inline script, the same JSON is in <meta name="mm-config">; without it a /<lobby> URL degrades to 1-player.
  if (!(window as any).__MM__) {
    const meta = document.querySelector('meta[name="mm-config"]');
    if (meta) { try { (window as any).__MM__ = JSON.parse(meta.getAttribute('content') || ''); } catch { /* ignore */ } }
  }
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const trackballCanvas = document.getElementById('trackball') as HTMLCanvasElement | null;
  const assets = new Assets();
  const sctx = canvas.getContext('2d')!;
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, canvas.width, canvas.height);
  await assets.load();
  const renderer = new Renderer(canvas, assets);
  const input = new Input(canvas, trackballCanvas);
  const sound = new Sound();
  const game = new Game(assets, renderer, input, sound);
  window.game = game;
  window.MarbleEngine = {
    level: levelEngine,
    physics: physicsEngine,
    constants,
    iso,
    STAGES,
  };

  let trackballView: Trackball3DView | null = null;
  if (trackballCanvas) {
    trackballView = new Trackball3DView(trackballCanvas, input.trackball);
  }

  // volume sliders & haptic toggle
  const vm = document.getElementById('vol-music') as HTMLInputElement | null;
  const vs = document.getElementById('vol-sfx') as HTMLInputElement | null;
  const vh = document.getElementById('opt-haptics') as HTMLInputElement | null;
  if (vm) { vm.value = String(sound.musicVolume); vm.oninput = () => sound.setMusicVolume(+vm.value); }
  if (vs) { vs.value = String(sound.sfxVolume); vs.oninput = () => sound.setSfxVolume(+vs.value); }
  if (vh) {
    vh.checked = input.trackball.enableHaptics;
    vh.onchange = () => { input.trackball.enableHaptics = vh.checked; };
  }

  // first gesture unlocks audio
  sound.onInit = (s) => { input.trackball.audio = s.trackballAudio; };
  const unlock = () => { sound.init(); if (sound.trackballAudio) input.trackball.audio = sound.trackballAudio; };
  window.addEventListener('keydown', unlock, { once: true });
  canvas.addEventListener('mousedown', unlock, { once: true });
  canvas.addEventListener('touchstart', unlock, { once: true });
  if (trackballCanvas) {
    trackballCanvas.addEventListener('mousedown', unlock, { once: true });
    trackballCanvas.addEventListener('touchstart', unlock, { once: true });
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F1') { e.preventDefault(); game.toggleDebug(); }
    if (e.code === 'F2') { e.preventDefault(); game.copyReport(); }
  });
  canvas.addEventListener('click', (e) => {
    if (!game.debug || (game.screen !== 'race' && game.screen !== 'intro')) return;
    const rect = canvas.getBoundingClientRect();
    game.debugClick((e.clientX - rect.left) / renderer.scale, (e.clientY - rect.top) / renderer.scale);
  });

  await game.start();

  // Debug driver: the same control surface Codex uses over WebMCP, callable from JS/devtools. Lets a headless
  // browser (or the console) drive deterministically. game.webmcp.callTool is exactly what the agent calls.
  (window as any).mmDebug = {
    call: (name: string, args: Record<string, unknown> = {}) => (window as any).webmcp.callTool(name, args),
    state: () => (window as any).webmcp.callTool('get_game_state', {}),
    steer: (dir: string | number, impulse = 0.7) => (window as any).webmcp.callTool('steer_trackball', { direction: dir, impulse }),
    spin: (dx: number, dy: number, speed = 60) => (window as any).webmcp.callTool('spin_trackball', { dx, dy, speed }),
    brake: (factor = 0.5) => (window as any).webmcp.callTool('apply_brake', { factor }),
    marble: () => { const m = game.marble; return { u: +m.u.toFixed(2), v: +m.v.toFixed(2), z: +m.z.toFixed(0), sx: Math.round((m.u - m.v) * 8), sy: Math.round((m.u + m.v) * 4 - m.z), grounded: m.grounded, phase: m.phase, sup: m.support ? m.support.s.name : null, deaths: game.deaths, stage: game.stageIdx + 1, screen: game.screen, goal: game.goalReached }; },
    screen: () => game.screen,
    // setup helpers WebMCP does not expose (menu-free): jump into a 1P race, or a specific stage
    race: (stageIdx = 0) => { game.sound.init?.(); game.newGame(stageIdx); return 'loading stage ' + (stageIdx + 1); },
    go: (screen: string) => { game.go(screen as never); return game.screen; },
    setMode: (m: string) => { game.mode = m as never; return game.mode; },
    teleport: (mx: number, my: number) => { const pk = game.pickAtPixel(mx, my)[0]; if (!pk) return null; game.marble.place(pk.u, pk.v, pk.z); game.marble.vu = 0; game.marble.vv = 0; return { u: +pk.u.toFixed(2), v: +pk.v.toFixed(2), z: Math.round(pk.z), name: pk.name }; },
    tp: (u: number, v: number, z: number) => { game.marble.place(u, v, z); game.marble.vu = 0; game.marble.vv = 0; return (window as any).mmDebug.marble(); },
    surfaces: () => game.stage.surfaces.map((s) => ({ n: s.name, k: s.kind, z0: Math.round(s.z0) })),
  };

  // ---- telemetry (see engine/telemetry.ts): one start event, key screen changes, deaths, login, JS errors
  trackErrors();
  const q = new URLSearchParams(location.search);
  trackEvent('app_start', { install: q.get('install') === '1', tagged: q.get('platform') || null });
  let lastScreen = game.screen, lastDeaths = game.deaths;
  const trackScreen = () => {
    if (game.screen !== lastScreen) {
      const from = lastScreen; lastScreen = game.screen;
      if (game.screen === 'race' && from === 'intro') trackEvent('race_start', { stage: game.stageIdx + 1, mode: game.mode });
      else if (from === 'race' && (game.screen === 'timebonus' || game.screen === 'gameover' || game.screen === 'congrats')) trackEvent('race_end', { stage: game.stageIdx + 1, result: game.screen, score: game.score, deaths: game.deaths });
      else if (game.screen === 'gameover' || game.screen === 'congrats') trackEvent(game.screen, { stage: game.stageIdx + 1, score: game.score });
    }
    if (game.deaths !== lastDeaths) { lastDeaths = game.deaths; trackEvent('death', { stage: game.stageIdx + 1 }); }
  };

  const tbContainer = document.getElementById('trackball-container');
  const applyUser = (handle: string, provider = 'twitter') => {
    (window as any).__MM__ = { ...((window as any).__MM__ || {}), user: handle };
    game.playerName = handle;
    game.screens.onAuthSuccess(handle);
  };
  const user = (window as any).__MM__?.user;
  if (user) {
    game.playerName = user;
  }

  // Global triggerAuth callable from in-game canvas pickname screen
  (window as any).triggerAuth = (provider: 'github' | 'twitter') => {
    game.screens.setAuthPending(provider);
    const nb = (window as any).NativeBridge as { launchAuth?(url: string): string } | undefined;
    if (nb && nb.launchAuth) {
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('mm_auth_nonce', nonce);
      const err = nb.launchAuth(`${location.origin}/auth/${provider}?app=${nonce}`);
      if (err) {
        console.warn('[auth] could not open browser:', err);
        game.screens.clearAuthPending();
      }
    } else {
      window.location.href = `/auth/${provider}`;
    }
  };

  // ---- Android host (tiny-apk-haptics): window.NativeBridge is injected by the WebView -------------------
  const nb = (window as any).NativeBridge as {
    onWebReady?(): void; launchAuth?(url: string): string; takeAuthResult?(): string | null;
  } | undefined;
  if (nb) {
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    // Custom Tab lifecycle from the host (1 started, 2 finished, 3 failed, 4 aborted, 5 shown, 6 hidden)
    (window as any).onAuthTabEvent = (event: number) => {
      if (event === 6) {
        if (localStorage.getItem('mm_auth_nonce')) {
          console.info('[auth] login tab hidden; waiting for redirect or cancel timeout');
          game.screens.startAuthCancelTimer(2.0);
        } else {
          game.screens.clearAuthPending();
        }
      }
    };
    (window as any).onAuthComplete = () => {
      const raw = nb.takeAuthResult?.();
      if (!raw) return;
      try {
        const r = JSON.parse(raw) as { user?: string; provider?: string; state?: string; error?: string };
        if (r.state !== localStorage.getItem('mm_auth_nonce')) {
          console.warn('[auth] result rejected: nonce mismatch. got:', r.state, 'expected:', localStorage.getItem('mm_auth_nonce'));
          return;
        }
        localStorage.removeItem('mm_auth_nonce');
        if (r.error || !r.user) {
          console.warn('[auth] login failed:', r.error);
          game.screens.clearAuthPending();
          return;
        }
        // same display cookie the web flow sets, so the server injects __MM__.user next time too
        document.cookie = `mm_user=${encodeURIComponent(r.user)}; Path=/; Max-Age=2592000; SameSite=Lax`;
        applyUser(r.user, r.provider || 'twitter');
        input.trackball.vibrate(8);
        trackEvent('login', { provider: r.provider || 'twitter' });
      } catch (err) {
        console.warn('[auth] bad result', err);
        game.screens.clearAuthPending();
      }
    };
    (window as any).onAuthComplete();        // cold start straight from the redirect
    nb.onWebReady?.();                       // the host may lift its native title overlay now
    flushNativeTelemetry(nb as any, (window as any).__MM__?.nonce);   // parked crash + one-time install proof
  }

  // Simulation clock. The game must keep real time even when this page is not painting: an agent's embedded
  // browser may paint only on demand and a hidden tab stops requestAnimationFrame entirely, which used to leave
  // the AI marble frozen while the human raced on. Physics steps from wall-clock time from whichever source fires
  // first — rAF, a 60 Hz interval, or a lobby tick (WebSocket messages are never throttled) — in 1/60 s slices,
  // catching up at most a quarter second after a stall. Rendering stays on rAF.
  let last = performance.now();
  const pump = (now: number) => {
    let elapsed = Math.max(0, (now - last) / 1000);
    last = now;
    if (elapsed > 0.25) elapsed = 0.25;
    while (elapsed > 1e-4) { const dt = Math.min(1 / 60, elapsed); game.update(dt); elapsed -= dt; }
    trackScreen();
  };
  setInterval(() => { const now = performance.now(); if (now - last > 30) pump(now); }, 16);
  game.net.onTick = () => { const now = performance.now(); if (now - last > 30) pump(now); };
  const loop = (now: number) => {
    pump(now);
    game.render();
    if (tbContainer) {
      const isRace = game.screen === 'race' || game.screen === 'intro' || game.screen === 'timebonus';
      tbContainer.style.display = isRace ? 'flex' : 'none';
    }
    trackballView?.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', () => { void boot(); });
