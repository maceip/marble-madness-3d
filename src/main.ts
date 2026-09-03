import { Assets } from './engine/assets';
import { Renderer } from './render/renderer';
import { Input } from './engine/input';
import { Sound } from './engine/audio';
import { Game } from './game/game';

declare global {
  interface Window { game?: Game }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const assets = new Assets();
  const sctx = canvas.getContext('2d')!;
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, canvas.width, canvas.height);
  await assets.load();
  const renderer = new Renderer(canvas, assets);
  const input = new Input(canvas);
  const sound = new Sound();
  const game = new Game(assets, renderer, input, sound);
  window.game = game;

  // volume sliders
  const vm = document.getElementById('vol-music') as HTMLInputElement | null;
  const vs = document.getElementById('vol-sfx') as HTMLInputElement | null;
  if (vm) { vm.value = String(sound.musicVolume); vm.oninput = () => sound.setMusicVolume(+vm.value); }
  if (vs) { vs.value = String(sound.sfxVolume); vs.oninput = () => sound.setSfxVolume(+vs.value); }
  // first gesture unlocks audio
  const unlock = () => { sound.init(); };
  window.addEventListener('keydown', unlock, { once: true });
  canvas.addEventListener('mousedown', unlock, { once: true });
  canvas.addEventListener('touchstart', unlock, { once: true });

  await game.start();

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    game.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', () => { void boot(); });
