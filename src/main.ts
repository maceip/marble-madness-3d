import { Assets } from './engine/assets';
import { Renderer } from './render/renderer';
import { Input } from './engine/input';
import { Sound } from './engine/audio';
import { Game } from './game/game';
import { trackEvent, trackErrors, flushNativeTelemetry } from './engine/telemetry';
import { mmTrace, mmTraceInit } from './engine/trace';
import { Trackball3DView } from './render/trackball3d';
import { agentConsole } from './ui/agent_console';
import { desktopControlsTutorial } from './ui/desktop_controls';
import { showAndroidInstallPrompt } from './ui/android_install';

import * as levelEngine from './engine/level';
import * as physicsEngine from './engine/physics';
import * as constants from './engine/constants';
import * as iso from './engine/iso';
import { STAGES } from './levels';

declare const __MM_DEBUG__: boolean;

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

// Fetch the latest worker on every app load/foreground. Its network-first
// policy prevents a reused image URL from pinning an older deploy in browsers.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((registration) => {
      void registration.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    })
    .catch((error) => console.warn('[marbles] service worker registration failed', error));
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
  // Agent pages (including the hidden Chrome-AI player iframe) must never create a second
  // audible mix. Keep this session-only: setMuted() would persist into the human page's settings.
  if (game.isAgentPage) sound.muted = true;
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
    const saved = localStorage.getItem('mm_haptics');
    if (saved !== null) input.trackball.enableHaptics = saved === '1';
    vh.checked = input.trackball.enableHaptics;
    const caps = input.trackball.hapticCapabilities();
    vh.title = caps.supported ? 'Haptics available on this device' : 'No browser or controller haptic actuator detected';
    vh.onchange = () => {
      input.trackball.enableHaptics = vh.checked;
      localStorage.setItem('mm_haptics', vh.checked ? '1' : '0');
      if (vh.checked) input.trackball.vibrate(18);
      else input.trackball.cancelContactHaptics();
    };
  }

  // keep the phone awake during a race (Safari 16.4+ / iOS; no-ops on unsupported browsers)
  let wake: WakeLockSentinel | null = null;
  const syncWake = async () => {
    const racing = game.screen === 'race' || game.screen === 'intro';
    if (!racing) {
      try { await wake?.release(); } catch { /* ignore */ }
      wake = null;
      return;
    }
    if (wake || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } catch { /* battery saver / unsupported */ }
  };

  // first gesture unlocks WebAudio + the reused HTMLAudio BGM element (iOS will not start a later Audio())
  sound.onInit = (s) => { input.trackball.audio = s.trackballAudio; };
  const unlock = () => { sound.init(); if (sound.trackballAudio) input.trackball.audio = sound.trackballAudio; };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
  canvas.addEventListener('mousedown', unlock, { once: true });
  canvas.addEventListener('touchstart', unlock, { once: true });
  if (trackballCanvas) {
    trackballCanvas.addEventListener('mousedown', unlock, { once: true });
    trackballCanvas.addEventListener('touchstart', unlock, { once: true });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sound.resume(); void syncWake(); } });
  window.addEventListener('pageshow', () => sound.resume());
  document.addEventListener('gesturestart', (e) => e.preventDefault());   // iOS pinch-zoom, even with user-scalable=no

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
  void game.chromeAgent.probe();

  const agentUi = agentConsole(game, assets.font);
  const desktopHelp = desktopControlsTutorial(game, assets.font);

  showAndroidInstallPrompt(assets.font, (action) => {
    trackEvent('android_install_prompt', { action });
  });

  for (const id of ['privacy-link', 'support-link']) {
    document.getElementById(id)?.addEventListener('click', (event) => {
      const anchor = event.currentTarget as HTMLAnchorElement;
      const bridge = (window as any).NativeBridge as { openExternal?(url: string): string } | undefined;
      if (!bridge?.openExternal) return;
      event.preventDefault();
      bridge.openExternal(new URL(anchor.href, location.href).href);
    });
  }

  // ---- Back / swipe navigation --------------------------------------------------------------------------
  // A browser back-press or an Android edge-swipe must NEVER silently exit the app. We trap it: back goes to the
  // previous screen; at the root (title) we show an exit-confirm modal. The APK routes its back button/swipe to
  // window.mmOnBack() (see MainActivity.onBackPressed), and only NativeBridge.exitApp() actually closes the app.
  const parentScreen = (s: string): string | null => {
    switch (s) {
      case 'menu': return 'title';
      case 'name': return 'menu';
      case 'control': return 'name';
      case 'connect': return 'name';
      case 'gameover': case 'congrats': case 'rematch': return 'title';
      case 'intro': case 'race': case 'timebonus': return 'title';   // back abandons the race to the leaderboard
      default: return null;                                          // title / boot -> root
    }
  };
  let exitModal: HTMLElement | null = null;
  const modalOpen = () => !!exitModal && exitModal.style.display !== 'none';
  const showExitConfirm = () => {
    if (exitModal) { exitModal.style.display = 'flex'; return; }
    const m = document.createElement('div');
    m.id = 'exit-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);font-family:"Courier New",monospace';
    const box = document.createElement('div');
    box.style.cssText = 'background:#0a0c16;border:3px solid #9aa0ff;border-radius:10px;padding:22px 24px;text-align:center;color:#cfd2ff;max-width:82vw';
    const h = document.createElement('div'); h.textContent = 'EXIT MARBLE MADNESS?';
    h.style.cssText = 'font-size:18px;font-weight:900;color:#ffe019;margin-bottom:18px;letter-spacing:1px';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:12px;justify-content:center';
    const mk = (label: string, bg: string, fg: string) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `flex:1;min-width:110px;padding:14px 18px;font:inherit;font-weight:bold;font-size:16px;border:3px solid #e8ea9a;border-radius:8px;background:${bg};color:${fg};cursor:pointer`; return b; };
    const cancel = mk('CANCEL', '#26304f', '#cfd2ff');
    const exit = mk('EXIT', '#b7b95c', '#111');
    cancel.addEventListener('click', () => { m.style.display = 'none'; game.sound.sfx('tick', 0.5); });
    exit.addEventListener('click', () => {
      const bridge = (window as any).NativeBridge as { exitApp?(): void } | undefined;
      if (bridge?.exitApp) { bridge.exitApp(); return; }
      window.removeEventListener('popstate', onBack);     // web: stop trapping and actually leave
      history.back();
    });
    row.appendChild(cancel); row.appendChild(exit); box.appendChild(h); box.appendChild(row); m.appendChild(box);
    document.body.appendChild(m); exitModal = m;
    game.sound.sfx('item');
  };
  const rearm = () => { try { history.pushState({ mm: 1 }, ''); } catch { /* ignore */ } };
  const onBack = () => {
    if (!game || typeof game.go !== 'function') { rearm(); return; }
    if (modalOpen()) { rearm(); return; }                 // choose in the modal, not with another back
    if (game.isAgentPage) { rearm(); return; }            // the agent's embedded browser: back is a no-op
    const parent = parentScreen(game.screen);
    if (parent && parent !== game.screen) { game.go(parent as never); game.sound.sfx('tick', 0.5); rearm(); return; }
    showExitConfirm(); rearm();
  };
  (window as any).mmOnBack = onBack;                       // the APK calls this from onBackPressed
  rearm();
  window.addEventListener('popstate', onBack);

  // Debug driver: the same control surface Codex uses over WebMCP, callable from JS/devtools. Lets a headless
  // browser (or the console) drive deterministically. game.webmcp.callTool is exactly what the agent calls.
  // Compiled out of shipped builds (build.mjs define __MM_DEBUG__; MM_DEBUG=1 or --watch turns it on).
  if (__MM_DEBUG__) (window as any).mmDebug = {
    call: (name: string, args: Record<string, unknown> = {}) => (window as any).webmcp.callTool(name, args),
    state: () => (window as any).webmcp.callTool('get_game_state', {}),
    steer: (dir: string | number, impulse = 0.7) => {
      const D: Record<string, [number, number]> = {
        N: [0, -1], NE: [0.707, -0.707], E: [1, 0], SE: [0.707, 0.707],
        S: [0, 1], SW: [-0.707, 0.707], W: [-1, 0], NW: [-0.707, -0.707],
        UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0],
      };
      const key = String(dir).toUpperCase();
      const d = D[key];
      const deg = Number(dir);
      const dx = d ? d[0] : (Number.isFinite(deg) ? Math.cos(deg * Math.PI / 180) : 0);
      const dy = d ? d[1] : (Number.isFinite(deg) ? Math.sin(deg * Math.PI / 180) : 1);
      return (window as any).webmcp.callTool('spin_trackball', { dx, dy, speed: impulse * 80 });
    },
    spin: (dx: number, dy: number, speed = 60) => (window as any).webmcp.callTool('spin_trackball', { dx, dy, speed }),
    /** grab the ball: kill the trackball's angular momentum (what a player does while the marble is carried by a slide / pipe) */
    /** set the race clock (seconds left) */
    clock: (sec: number) => { (game as any).timeLeft = sec; return sec; },
    grab: () => { const tb = (game as any).input.trackball; tb.wx = 0; tb.wy = 0; return true; },
    brake: () => ({ ok: false, warning: 'No brakes on the cabinet. Counter-spin the trackball (reverse dx/dy) to slow down.' }),
    marble: () => { const m = game.marble; return { u: +m.u.toFixed(2), v: +m.v.toFixed(2), z: +m.z.toFixed(0), sx: Math.round((m.u - m.v) * 8), sy: Math.round((m.u + m.v) * 4 - m.z), grounded: m.grounded, phase: m.phase, dizzy: +m.dizzyT.toFixed(2), slide: !!m.slide, inPipe: !!m.inPipe, sup: m.support ? m.support.s.name : null, vu: +m.vu.toFixed(2), vv: +m.vv.toFixed(2), deaths: game.deaths, stage: game.stageIdx + 1, screen: game.screen, goal: game.goalReached }; },
    screen: () => game.screen,
    // setup helpers WebMCP does not expose (menu-free): jump into a 1P race, or a specific stage
    race: (stageIdx = 0) => { game.sound.init?.(); game.newGame(stageIdx); return 'loading stage ' + (stageIdx + 1); },
    go: (screen: string) => { game.go(screen as never); return game.screen; },
    setMode: (m: string) => { game.mode = m as never; return game.mode; },
    teleport: (mx: number, my: number) => { const pk = game.pickAtPixel(mx, my)[0]; if (!pk) return null; game.marble.place(pk.u, pk.v, pk.z); game.marble.vu = 0; game.marble.vv = 0; return { u: +pk.u.toFixed(2), v: +pk.v.toFixed(2), z: Math.round(pk.z), name: pk.name }; },
    /** what floor is drawn at a map pixel: [{u,v,z,name}] front-most first (no side effects) */
    pick: (mx: number, my: number) => game.pickAtPixel(mx, my).map((p) => ({ u: +p.u.toFixed(2), v: +p.v.toFixed(2), z: Math.round(p.z), name: p.name })),
    tp: (u: number, v: number, z: number) => { game.marble.place(u, v, z); game.marble.vu = 0; game.marble.vv = 0; return (window as any).mmDebug.marble(); },
    surfaces: () => game.stage.surfaces.map((s) => ({ n: s.name, k: s.kind, z0: Math.round(s.z0) })),
    // ---- instrumentation: what the physics saw and why ------------------------------------------------
    /** drain the physics trace: block / airborne / land / dizzy / die / stall / step events + 4 Hz samples */
    trace: () => game.marble.takeTrace(),
    /** the heightfield cell under the marble (or under map pixel mx,my / world u,v) */
    probe: (a?: number, b?: number, world = false) => {
      const hm = game.stage.heightmap; if (!hm) return null;
      let u = game.marble.u, v = game.marble.v;
      if (a !== undefined && b !== undefined) {
        if (world) { u = a; v = b; } else { const p = hm.pickPixel(a, b); if (!p) return { px: [a, b], floor: null }; u = p.u; v = p.v; }
      }
      const m = game.marble;
      return { u: +u.toFixed(2), v: +v.toFixed(2), ...hm.cellInfo(u, v), blocks: hm.blockReason(u, v, m.z) || null, support: (() => { const s = levelEngine.supportAt(game.stage, u, v, m.z); return s ? { z: +s.z.toFixed(1), s: s.s.name } : null; })() };
    },
    /** ASCII grid of floors / obstacles around the marble at its height (## = blocks it, .. = void) */
    around: (r = 6, step = 2) => { const hm = game.stage.heightmap, m = game.marble; return hm ? hm.around(m.u, m.v, m.z, r, step) : 'no heightfield'; },
    /** hazards off: collision test runs are not about steelies */
    hazards: (on: boolean) => { if (!on) game.hazards = []; return game.hazards.length; },
    /** one-line status */
    status: () => { const m = game.marble; const d = (window as any).mmDebug.marble(); return `${d.screen} t=${game.raceTime.toFixed(1)} px(${d.sx},${d.sy}) z${d.z} v(${m.vu.toFixed(1)},${m.vv.toFixed(1)}) ${m.grounded ? 'ground' : 'AIR'} on ${d.sup} ${m.dizzyT > 0 ? 'DIZZY ' : ''}${m.phase !== 'alive' ? m.phase.toUpperCase() + ':' + m.deathKind + ' ' : ''}deaths=${d.deaths} cp=${game.checkpointIdx} block=${m.lastBlock || '-'}`; },
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
      void syncWake();
    }
    desktopHelp.maybeShow();
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
    agentUi.tick();
    if (tbContainer) {
      const isRace = game.screen === 'race' || game.screen === 'intro' || game.screen === 'timebonus';
      tbContainer.style.display = agentUi.active || isRace ? 'flex' : 'none';
    }
    trackballView?.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', () => { void boot(); });
