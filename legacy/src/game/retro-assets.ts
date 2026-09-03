const GLYPH_MIN = 36;
const GLYPH_MAX = 95;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function retroText(text: string, className = ''): string {
  const label = text.toUpperCase();
  const glyphs = [...label].map((char) => {
    if (char === ' ') return '<span class="retro-space" aria-hidden="true"></span>';
    const code = char.charCodeAt(0);
    if (code < GLYPH_MIN || code > GLYPH_MAX) return '';
    return `<img class="retro-glyph" src="/sprites/retro-font/char-${String(code).padStart(3, '0')}.png" alt="" aria-hidden="true">`;
  }).join('');
  return `<span class="retro-text ${className}" aria-label="${escapeAttribute(label)}">${glyphs}</span>`;
}

export function retroLogo(): string {
  const upper = [0, 1, 2, 3, 4, 5, 6]
    .map((id) => `<img src="/sprites/ui/title_${String(id).padStart(3, '0')}_${[16, 17, 28, 164, 28, 17, 16][id]}x30.png" alt="">`)
    .join('');
  const lowerWidths = [120, 40, 38, 42, 48];
  const lower = lowerWidths
    .map((width, index) => `<img src="/sprites/ui/title_${String(index + 7).padStart(3, '0')}_${width}x32.png" alt="">`)
    .join('');
  return `<div class="retro-logo" role="img" aria-label="Marble Madness"><div>${upper}</div><div>${lower}</div></div>`;
}

export function retroSpriteStrip(): string {
  return `<div class="retro-sprite-strip" aria-label="Original extracted game sprites">
    <img src="/sprites/retro-marble/blue-28.png" alt="Blue marble sprite">
    <img src="/sprites/enemies/enemy_000_14x14.png" alt="Steelie sprite">
    <img src="/sprites/enemies/enemy_020_14x14.png" alt="Muncher sprite">
    <img src="/sprites/enemies/enemy_056_32x37.png" alt="Goal sprite">
    <img src="/sprites/enemies/enemy_106_14x12.png" alt="Object sprite">
    <img src="/sprites/retro-marble/red-28.png" alt="Red marble sprite">
  </div>`;
}

export const RETRO_OBJECT_SPRITES: Partial<Record<string, string>> = {
  blade: '/sprites/enemies/enemy_106_14x12.png',
  bat: '/sprites/enemies/enemy_122_12x10.png',
  bomber: '/sprites/enemies/enemy_145_10x7.png',
  snake: '/sprites/enemies/enemy_131_14x9.png',
  item: '/sprites/enemies/enemy_078_12x11.png',
  steelie: '/sprites/enemies/enemy_000_14x14.png',
  muncher: '/sprites/enemies/enemy_020_14x14.png',
  acid: '/sprites/enemies/enemy_035_22x13.png',
  canopy: '/sprites/enemies/enemy_056_32x37.png',
  funnel: '/sprites/enemies/enemy_071_24x22.png',
  tube: '/sprites/enemies/enemy_070_16x22.png',
  spigot: '/sprites/enemies/enemy_069_15x23.png',
  piston: '/sprites/enemies/enemy_068_7x24.png',
};
