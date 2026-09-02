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

  if (new URLSearchParams(window.location.search).has('harness')) {
    (window as unknown as {
      __marbleHarness?: {
        snapshot: () => object;
        start: () => void;
        selectStage: (stage: number) => void;
        showEndgame: () => void;
        getStats: () => object;
        triggerDeath: () => void;
        triggerZeroTilt: () => void;
        cycleSpectator: (dir: number) => void;
        respawnFromSpectator: () => void;
        addMockRemotePlayer: (player: Record<string, unknown>) => void;
        setMarblePos: (x: number, y: number, z: number) => void;
        warpToStage: (stage: number) => void;
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
        lives: game.lives,
        timeLeft: game.timeLeft,
        spectating: game.state === 'SPECTATING',
        spectatedId: (game as unknown as { spectatedPlayerId: string | null }).spectatedPlayerId,
      }),
      start: () => game.startGameDirect(),
      selectStage: (stage: number) => game.setupStage(stage - 1, false),
      showEndgame: () => game.hud.showMenu(8, game.currentStageIndex + 1, true, game.score),
      getStats: () => ({
        instancedMeshCount: game.renderer.instancedTerrainMeshes.length,
        instancedTotalInstances: game.renderer.instancedTerrainMeshes.reduce((acc, m) => acc + m.count, 0),
        hasMinimapOffscreenCache: Boolean(game.hud.cachedMinimapCanvas),
        minimapCanvasWidth: (document.getElementById('minimap') as HTMLCanvasElement)?.width,
        minimapCanvasHeight: (document.getElementById('minimap') as HTMLCanvasElement)?.height,
        particlePoolCount: (game.renderer as unknown as { particlePool: unknown[] }).particlePool.length,
        activeParticles: (game.renderer as unknown as { particlePool: Array<{ active: boolean }> }).particlePool.filter((p) => p.active).length,
        hasSilhouette: Boolean((game.renderer as unknown as { marbleSilhouetteMesh: unknown }).marbleSilhouetteMesh),
        remotePlayerCount: game.multiplayer.remotePlayers.size,
        radarMarkersCount: document.getElementById('mp-radar')?.children.length || 0,
        spectatorOverlayVisible: !document.getElementById('spectator-overlay')?.classList.contains('hidden'),
        spectatorTargetText: document.getElementById('spectator-target-name')?.textContent || '',
      }),
      triggerDeath: () => {
        game.state = 'PLAYING';
        game.lives = 1;
        game.score = 0;
        (game as unknown as { handleDeath: (reason: string) => void }).handleDeath('fall');
      },
      triggerZeroTilt: () => {
        document.getElementById('btn-zero-tilt')?.click();
      },
      cycleSpectator: (dir: number) => game.cycleSpectator(dir),
      respawnFromSpectator: () => game.respawnFromSpectator(),
      addMockRemotePlayer: (p: Record<string, unknown>) => {
        (game.multiplayer as unknown as { addOrUpdateRemotePlayer: (player: Record<string, unknown>) => void }).addOrUpdateRemotePlayer(p);
      },
      setMarblePos: (x: number, y: number, z: number) => {
        game.physics.marble.x = x;
        game.physics.marble.y = y;
        game.physics.marble.z = z;
        game.physics.marble.vx = 0;
        game.physics.marble.vy = 0;
        game.physics.marble.vz = 0;
      },
      warpToStage: (stage: number) => {
        game.setupStage(stage - 1, true);
      },
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
