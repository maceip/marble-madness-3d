import type { BitmapFont } from '../engine/font';
import { pxFill, uiScale } from './pixel';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=build.secure.marbles';
const DISMISSED_KEY = 'mm_android_app_prompt_dismissed';

type PromptAction = 'shown' | 'open_play_store' | 'dismissed';

interface UserAgentDataLike {
  platform?: string;
}

function androidInstallContext(): { eligible: boolean; standalone: boolean } {
  const nav = navigator as Navigator & { userAgentData?: UserAgentDataLike; standalone?: boolean };
  const android = nav.userAgentData?.platform === 'Android' || /Android/i.test(nav.userAgent);
  const nativeHost = Boolean((window as unknown as { NativeBridge?: unknown }).NativeBridge)
    || new URLSearchParams(location.search).get('platform') === 'android_apk';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
  return { eligible: android && !nativeHost, standalone };
}

/** Show once per tab/session on the Android website, using the menu's real bitmap glyph atlas. */
export function showAndroidInstallPrompt(font: BitmapFont, onAction?: (action: PromptAction) => void): void {
  const context = androidInstallContext();
  if (!context.eligible || sessionStorage.getItem(DISMISSED_KEY) === '1') return;
  const host = document.getElementById('android-app-prompt');
  const open = document.getElementById('android-app-open') as HTMLAnchorElement | null;
  const dismiss = document.getElementById('android-app-dismiss') as HTMLButtonElement | null;
  if (!host || !open || !dismiss) return;

  const scale = Math.max(1, Math.min(2, uiScale()));
  pxFill(document.getElementById('android-app-title'), font, 'GET ANDROID APP', 'orange', scale);
  pxFill(document.getElementById('android-app-haptics'), font, 'RICH HAPTICS', 'cyan', 1);
  pxFill(document.getElementById('android-app-size'), font, 'TINY BINARY', 'white', 1);
  pxFill(document.getElementById('android-app-ads'), font, 'NO ADS', 'orange', 1);
  const pwaNote = document.getElementById('android-app-pwa-note');
  const pwaText = context.standalone ? 'REMOVE THIS PWA AFTER INSTALL' : 'PWA INSTALLED? DELETE IT AFTER INSTALL';
  if (pwaNote) pwaNote.setAttribute('aria-label', context.standalone
    ? 'Remove this installed PWA after installing the Android app'
    : 'If the PWA is installed, delete it after installing the Android app');
  pxFill(pwaNote, font, pwaText, 'lavender', 1);
  pxFill(open, font, 'INSTALL', 'blue', scale);
  pxFill(dismiss, font, 'X', 'white', 1);
  open.href = PLAY_STORE_URL;

  window.setTimeout(() => {
    host.hidden = false;
    onAction?.('shown');
  }, 500);

  open.addEventListener('click', () => onAction?.('open_play_store'), { once: true });
  dismiss.addEventListener('click', () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    host.hidden = true;
    onAction?.('dismissed');
  }, { once: true });
}
