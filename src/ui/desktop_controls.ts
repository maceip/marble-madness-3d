import type { Game } from '../game/game';
import type { BitmapFont } from '../engine/font';
import { pxFill } from './pixel';

const SEEN_KEY = 'mm_desktop_trackball_tutorial_v1';

function isDesktopPointer(): boolean {
  return navigator.maxTouchPoints === 0
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches
    && !(window as unknown as { NativeBridge?: unknown }).NativeBridge;
}

/** One-time, first-race explanation for the intentionally unusual mouse-wheel trackball controls. */
export function desktopControlsTutorial(game: Game, font: BitmapFont): { maybeShow(): void; visible(): boolean } {
  const host = document.getElementById('desktop-controls-help') as HTMLElement | null;
  const dismiss = document.getElementById('desktop-controls-dismiss') as HTMLButtonElement | null;
  let open = false;

  const close = () => {
    if (!host || !open) return;
    localStorage.setItem(SEEN_KEY, '1');
    host.hidden = true;
    open = false;
    game.paused = false;
    game.sound.sfx('item');
  };

  if (host && dismiss) {
    pxFill(document.getElementById('desktop-controls-title'), font, 'HOW TO ROLL', 'orange', 2);
    pxFill(document.getElementById('desktop-controls-lead'), font, 'YOUR MOUSE IS THE TRACKBALL', 'cyan', 1);
    pxFill(document.getElementById('desktop-controls-step1'), font, '1  HOLD LEFT CLICK + DRAG TO AIM', 'white', 1);
    pxFill(document.getElementById('desktop-controls-step2'), font, '2  WHEEL DOWN ROLLS THAT WAY', 'white', 1);
    pxFill(document.getElementById('desktop-controls-step3'), font, '3  WHEEL UP REVERSES / BRAKES', 'white', 1);
    pxFill(document.getElementById('desktop-controls-alt'), font, 'OR DRAG THE BLUE BALL DIRECTLY', 'lavender', 1);
    pxFill(dismiss, font, 'GOT IT - START RACE', 'blue', 1);
    dismiss.addEventListener('click', close);
    host.addEventListener('wheel', (event) => { event.preventDefault(); event.stopPropagation(); }, { passive: false });
    window.addEventListener('keydown', (event) => {
      if (!open || (event.code !== 'Enter' && event.code !== 'Space' && event.code !== 'Escape')) return;
      event.preventDefault(); event.stopImmediatePropagation(); close();
    }, true);
  }

  return {
    maybeShow() {
      if (!host || !dismiss || open || game.isAgentPage || game.screen !== 'intro') return;
      if (!isDesktopPointer() || localStorage.getItem(SEEN_KEY) === '1') return;
      game.paused = true;
      game.input.trackball.wx = 0; game.input.trackball.wy = 0;
      host.hidden = false;
      open = true;
      dismiss.focus({ preventScroll: true });
    },
    visible: () => open,
  };
}
