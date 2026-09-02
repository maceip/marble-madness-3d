/**
 * Bitmap Font Renderer for Master System / Arcade 8x8 font sheet
 */

export class RetroFontRenderer {
  private img: HTMLImageElement | null = null;
  private isLoaded = false;

  // Character mapping inside font_sheet.png
  // 149x212 sheet: 8x8 character tiles with black shadow
  private charMap: Record<string, [number, number]> = {};

  constructor() {
    this.initCharMap();
    this.loadSheet();
  }

  private initCharMap(): void {
    // Top section: row 0 is numbers, row 1 is A-M, row 2 is N-Z, row 3 is punctuation
    const rows = [
      "0123456789",
      "ABCDEFGHIJKLM",
      "NOPQRSTUVWXYZ",
      ".,!?:'-/ "
    ];

    rows.forEach((row, rowIndex) => {
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        this.charMap[ch] = [c * 8, rowIndex * 8];
      }
    });
  }

  private loadSheet(): void {
    this.img = new Image();
    this.img.src = '/sprites/font_sheet.png';
    this.img.onload = () => {
      this.isLoaded = true;
    };
  }

  public drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    scale = 2,
  ): void {
    if (!this.isLoaded || !this.img) return;

    const upper = text.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      const ch = upper[i];
      const coords = this.charMap[ch] || this.charMap[' '];
      if (coords) {
        ctx.drawImage(
          this.img,
          coords[0],
          coords[1],
          8,
          8,
          x + i * 8 * scale,
          y,
          8 * scale,
          8 * scale,
        );
      }
    }
  }
}

export const retroFont = new RetroFontRenderer();
