import { GameManager } from './game/state.js';

declare global {
  interface Window {
    game?: GameManager;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('[Marble Madness] Starting game engine...');
  const game = new GameManager();
  window.game = game;

  let lastTime = performance.now();

  function loop(now: number) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    game.update(dt);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
});
