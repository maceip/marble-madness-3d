/**
 * Device-class detection for capability gating. Chrome's built-in model (Prompt API / LanguageModel) only ships in
 * desktop Chrome, so the "DON'T HAVE CODEX?" teaser, the local-model provider picker and the Chrome AI probe must never
 * surface on a phone, a tablet, or inside the Android APK — even when a mouse is attached and `(pointer: fine)` matches.
 */

interface UserAgentDataLike { mobile?: boolean; platform?: string }

export function isMobileDevice(): boolean {
  const nav = navigator as Navigator & { userAgentData?: UserAgentDataLike };
  const ua = nav.userAgent || '';
  const uad = nav.userAgentData;
  if (uad?.mobile === true || uad?.platform === 'Android') return true;
  if (/Android|iPhone|iPad|iPod|IEMobile|Windows Phone/i.test(ua)) return true;
  // iPadOS 13+ presents a desktop Safari UA; the touch digitizer gives it away (macOS always reports 0 touch points)
  if (/Macintosh/.test(ua) && nav.maxTouchPoints > 0) return true;
  // the Android APK's WebView host (bridge object, or the platform tag it appends to the URL)
  if ((window as unknown as { NativeBridge?: unknown }).NativeBridge) return true;
  if (new URLSearchParams(location.search).get('platform') === 'android_apk') return true;
  return false;
}

/** True only where Chrome AI can actually run: a non-mobile device driving a fine pointer (desktop browser). */
export function chromeAiSurface(): boolean {
  return !isMobileDevice() && matchMedia('(pointer: fine)').matches;
}
