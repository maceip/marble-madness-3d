import { Assets } from './engine/assets';
import { Renderer } from './render/renderer';
import { Input } from './engine/input';
import { Sound } from './engine/audio';
import { Game } from './game/game';
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
  const unlock = () => { sound.init(); };
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

  const tbContainer = document.getElementById('trackball-container');
  const authDock = document.getElementById('auth-dock');
  const twitterHandle = document.getElementById('twitter-handle');
  const twitterBtn = document.getElementById('twitter-btn');
  const applyUser = (handle: string, provider = 'twitter') => {
    (window as any).__MM__ = { ...((window as any).__MM__ || {}), user: handle };
    game.playerName = handle;
    const el = document.getElementById(provider === 'github' ? 'github-handle' : 'twitter-handle');
    if (el) el.textContent = handle;
    document.getElementById(provider === 'github' ? 'github-btn' : 'twitter-btn')?.classList.add('active');
  };
  const user = (window as any).__MM__?.user;
  if (user) {
    if (twitterHandle) twitterHandle.textContent = user;
    twitterBtn?.classList.add('active');
  }

  // ---- Android host (tiny-apk-haptics): window.NativeBridge is injected by the WebView -------------------
  const nb = (window as any).NativeBridge as {
    onWebReady?(): void; launchAuth?(url: string): string; takeAuthResult?(): string | null;
  } | undefined;
  if (nb) {
    // the login must run in the system browser (providers block embedded logins; the user's existing
    // session makes it one tap). The host opens a pre-warmed Chrome Custom Tab and gets the result back
    // through marbles://oauth-callback; we tag the request with a nonce so we only accept our own result.
    for (const [id, provider] of [['twitter-btn', 'twitter'], ['github-btn', 'github']] as const) {
      document.getElementById(id)?.addEventListener('click', (e) => {
        if (!nb.launchAuth) return;
        e.preventDefault();
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('mm_auth_nonce', nonce);
        const err = nb.launchAuth(`${location.origin}/auth/${provider}?app=${nonce}`);
        if (err) console.warn('[auth] could not open browser:', err);
      });
    }
    // in-app polish: no long-press copy/share bars, haptic the instant a dock button is touched
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const id of ['twitter-btn', 'github-btn']) {
      document.getElementById(id)?.addEventListener('pointerdown', () => { try { (nb as any).hapticClick?.(); } catch { /* bridge gone */ } }, { passive: true });
    }
    // Custom Tab lifecycle from the host (1 started, 2 finished, 3 failed, 4 aborted, 5 shown, 6 hidden)
    (window as any).onAuthTabEvent = (event: number) => {
      if (event === 6 && localStorage.getItem('mm_auth_nonce')) console.info('[auth] login tab hidden; waiting for the redirect or the user to retry');
    };
    (window as any).onAuthComplete = () => {
      const raw = nb.takeAuthResult?.();
      if (!raw) return;
      try {
        const r = JSON.parse(raw) as { user?: string; provider?: string; state?: string; error?: string };
        if (r.state !== localStorage.getItem('mm_auth_nonce')) { console.warn('[auth] result rejected: nonce mismatch'); return; }
        localStorage.removeItem('mm_auth_nonce');
        if (r.error || !r.user) { console.warn('[auth] login failed:', r.error); return; }
        // same display cookie the web flow sets, so the server injects __MM__.user next time too
        document.cookie = `mm_user=${encodeURIComponent(r.user)}; Path=/; Max-Age=2592000; SameSite=Lax`;
        applyUser(r.user, r.provider || 'twitter');
        input.trackball.vibrate(8);
      } catch (err) { console.warn('[auth] bad result', err); }
    };
    (window as any).onAuthComplete();        // cold start straight from the redirect
    nb.onWebReady?.();                       // the host may lift its native title overlay now
  }

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // RAF's first timestamp can precede performance.now()
    last = now;
    game.update(dt);
    game.render();
    if (tbContainer) {
      const isRace = game.screen === 'race' || game.screen === 'intro' || game.screen === 'timebonus';
      tbContainer.style.display = isRace ? 'flex' : 'none';
    }
    if (authDock) {
      const isRace = game.screen === 'race' || game.screen === 'intro' || game.screen === 'timebonus';
      authDock.style.display = isRace ? 'none' : 'flex';
    }
    trackballView?.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', () => { void boot(); });
