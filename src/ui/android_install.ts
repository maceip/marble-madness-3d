import type { BitmapFont } from '../engine/font';
import { pxFill, uiScale } from './pixel';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=build.secure.marbles';
const DISMISSED_KEY = 'mm_android_app_prompt_dismissed';

type PromptAction = 'shown' | 'open_play_store' | 'dismissed';

interface UserAgentDataLike {
  platform?: string;
}

function isAndroidBrowser(): boolean {
  const nav = navigator as Navigator & { userAgentData?: UserAgentDataLike; standalone?: boolean };
  const android = nav.userAgentData?.platform === 'Android' || /Android/i.test(nav.userAgent);
  const nativeHost = Boolean((window as unknown as { NativeBridge?: unknown }).NativeBridge)
    || new URLSearchParams(location.search).get('platform') === 'android_apk';
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
  return android && !nativeHost && !installed;
}

/** Show once per tab/session on the Android website, using the menu's real bitmap glyph atlas. */
export function showAndroidInstallPrompt(font: BitmapFont, onAction?: (action: PromptAction) => void): void {
  if (!isAndroidBrowser() || sessionStorage.getItem(DISMISSED_KEY) === '1') return;
  const host = document.getElementById('android-app-prompt');
  const open = document.getElementById('android-app-open') as HTMLAnchorElement | null;
  const dismiss = document.getElementById('android-app-dismiss') as HTMLButtonElement | null;
  if (!host || !open || !dismiss) return;

  const scale = Math.max(1, Math.min(2, uiScale()));
  pxFill(document.getElementById('android-app-title'), font, 'GET THE ANDROID APP', 'orange', scale);
  pxFill(document.getElementById('android-app-subtitle'), font, 'NATIVE HAPTICS + FULL SCREEN', 'cyan', 1);
  pxFill(open, font, 'GOOGLE PLAY', 'blue', scale);
  pxFill(dismiss, font, 'NOT NOW', 'white', scale);
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
