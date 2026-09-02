import { GameManager } from './game/state.js';

window.addEventListener('DOMContentLoaded', () => {
  console.log('[Marble Madness] Starting game engine...');
  const game = new GameManager();

  if (new URLSearchParams(window.location.search).has('harness')) {
    (window as unknown as {
      __marbleHarness?: {
        snapshot: () => object;
        start: () => void;
        selectStage: (stage: number) => void;
        showEndgame: () => void;
      };
    }).__marbleHarness = {
      snapshot: () => ({
        state: game.state,
        stage: game.currentStageIndex + 1,
        x: game.physics.marble.x,
        y: game.physics.marble.y,
        z: game.physics.marble.z,
        vx: game.physics.marble.vx,
        vy: game.physics.marble.vy,
        vz: game.physics.marble.vz,
        speed: game.physics.marble.speed,
        grounded: game.physics.marble.grounded,
        dead: game.physics.marble.dead,
        timeLeft: game.timeLeft,
      }),
      start: () => game.startGameDirect(),
      selectStage: (stage: number) => game.setupStage(stage - 1, false),
      showEndgame: () => game.hud.showMenu(8, game.currentStageIndex + 1, true, game.score),
    };
  }

  let lastTime = performance.now();

  function loop(now: number) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    game.update(dt);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
});
