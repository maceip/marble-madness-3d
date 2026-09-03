/**
 * Viewport form-factor. Phone portrait / phone landscape / desktop already had implicit
 * geometry in screens.ts; unfolded foldables (Pixel Fold, Pixel 9 Pro Fold inner) are
 * nearly square 7–8" CSS (~680–1100 on both axes) and were falling into the desktop
 * centered-column path, leaving large side gutters.
 *
 * Canonical CSS targets:
 *   Pixel 9 Pro Fold inner portrait  790 × 844   (2076×2152 @ 2.625)
 *   Pixel Fold inner landscape       883 × 736   (2208×1840 @ 2.5)
 *   Pixel Fold inner portrait        736 × 883
 */
export type FormFactor = 'phone' | 'phone-land' | 'fold' | 'desktop';

export function formFactor(cw: number, ch: number): FormFactor {
  const short = Math.min(cw, ch);
  const long = Math.max(cw, ch);
  const aspect = cw / Math.max(1, ch);
  if (short >= 680 && long <= 1100 && aspect >= 0.72 && aspect <= 1.40) return 'fold';
  if (ch > cw * 1.15) return 'phone';
  if (cw >= 600 && ch <= 500) return 'phone-land';
  return 'desktop';
}

export function isFold(cw: number, ch: number): boolean {
  return formFactor(cw, ch) === 'fold';
}

/** Edge-to-edge content inset for unfolded foldables. ~2% — no desktop column. */
export function foldInset(cw: number): number {
  return Math.max(10, Math.round(cw * 0.02));
}
