/**
 * Zero-dependency telemetry. Events go out with navigator.sendBeacon (queued off the main thread, survives
 * page unload) to our own server, which only accepts them from an established page session. Inside the
 * Android host, crash traces and the one-time install proof are pulled over the JavaScript bridge and posted
 * with the page's own cookies, so nothing is ever sent from an unauthenticated native HTTP client and nothing
 * can be triggered by crawlers, which never have window.NativeBridge.
 */

export type Platform = 'web' | 'pwa' | 'android_apk';

interface Bridge {
  consumePendingCrash?(): string | null;
  signInstallChallenge?(nonce: string): string | null;
  deviceInfo?(): string;
}

export function platform(): Platform {
  if ((window as unknown as { NativeBridge?: unknown }).NativeBridge) return 'android_apk';
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa';
  return 'web';
}

export function trackEvent(event: string, metadata: Record<string, unknown> = {}): void {
  const payload = JSON.stringify({ event, metadata, platform: platform(), ts: Date.now() });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/telemetry/event', new Blob([payload], { type: 'application/json' }))) return;
  } catch { /* fall through */ }
  fetch('/api/telemetry/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true, credentials: 'include' }).catch(() => {});
}

/** window.onerror / unhandledrejection → js_error events (at most 5 per page to stay quiet in a crash loop) */
export function trackErrors(): void {
  let budget = 5;
  const send = (message: string, location: string, stack: string | null) => {
    if (budget-- <= 0) return;
    trackEvent('js_error', { message: String(message).slice(0, 300), location: location.slice(0, 200), stack: stack ? String(stack).slice(0, 1500) : null });
  };
  window.addEventListener('error', (e) => send(e.message, `${e.filename}:${e.lineno}:${e.colno}`, e.error?.stack ?? null));
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    send(r?.message ?? String(r), 'promise', r?.stack ?? null);
  });
}

/** Android host only: flush a parked crash and answer the install challenge, both over the page's session */
export function flushNativeTelemetry(bridge: Bridge, installNonce: string | undefined): void {
  try {
    const crash = bridge.consumePendingCrash?.();
    if (crash) {
      fetch('/api/telemetry/crash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: crash, credentials: 'include' }).catch(() => {});
    }
  } catch { /* bridge gone */ }
  try {
    if (installNonce && bridge.signInstallChallenge) {
      const proof = bridge.signInstallChallenge(installNonce);       // null after the first answer on this device
      if (proof) {
        fetch('/api/telemetry/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: proof, credentials: 'include' }).catch(() => {});
      }
    }
  } catch { /* bridge gone */ }
}
