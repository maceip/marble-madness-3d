import { Assets } from './engine/assets';
import { Renderer } from './render/renderer';
import { Input } from './engine/input';
import { Sound } from './engine/audio';
import { Game } from './game/game';
import { Trackball3DView } from './render/trackball3d';

declare global {
  interface Window { game?: Game }
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

  let last = performance.now();
  const tbContainer = document.getElementById('trackball-container');
  const twitterBtn = document.getElementById('twitter-btn');
  const twitterHandle = document.getElementById('twitter-handle');
  if (twitterHandle && (window as any).__MM__?.user) {
    twitterHandle.textContent = (window as any).__MM__.user;
  }

  const loop = (now: number) => {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // RAF's first timestamp can precede performance.now()
    last = now;
    game.update(dt);
    game.render();
    if (tbContainer) {
      const isRace = game.screen === 'race' || game.screen === 'intro' || game.screen === 'timebonus';
      tbContainer.style.display = isRace ? 'flex' : 'none';
    }
    if (twitterBtn) {
      const isRace = game.screen === 'race' || game.screen === 'intro' || game.screen === 'timebonus';
      twitterBtn.style.display = isRace ? 'none' : 'flex';
    }
    trackballView?.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', () => { void boot(); });
