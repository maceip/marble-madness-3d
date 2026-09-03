#!/usr/bin/env python3
"""Prepare runtime assets from the source art in the repo root.

Outputs (all under www/assets/):
  stages/stage{1..6}.png      arcade stage maps (copied verbatim)
  sprites/marble_effects.png  player marble sheet (as provided)
  sprites/marble_effects_red.png  hue-swapped variant for the AI / second marble
  sprites/worm.png, bird.png, slime.png  (as provided)
  sprites/hammer.png, vacuum.png  background-keyed to transparent
  sprites/objects.png         combined object sheet (steelie, hammers, birds...)
  sprites/font.png + font.json  8x8 glyph atlas (5 colour variants) + big timer digits
Re-runnable; idempotent.
"""
from __future__ import annotations
import json, os, shutil, sys
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'www', 'assets')
DL = os.path.expanduser('~/Downloads')


def src(*cands: str) -> str:
    for c in cands:
        p = c if os.path.isabs(c) else os.path.join(ROOT, c)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(cands)


def key_out(im: Image.Image, colors: list[tuple[int, int, int]], tol: int = 6) -> Image.Image:
    a = np.asarray(im.convert('RGBA')).copy()
    rgb = a[..., :3].astype(int)
    mask = np.zeros(a.shape[:2], bool)
    for c in colors:
        mask |= (np.abs(rgb - np.array(c)).sum(2) <= tol)
    a[mask, 3] = 0
    return Image.fromarray(a, 'RGBA')


def hue_swap_blue_to_red(im: Image.Image) -> Image.Image:
    """Map the blue marble palette to a red one (swap R and B channels)."""
    a = np.asarray(im.convert('RGBA')).copy()
    r, g, b = a[..., 0].copy(), a[..., 1].copy(), a[..., 2].copy()
    a[..., 0], a[..., 2] = b, r
    return Image.fromarray(a, 'RGBA')


def build_font(font_path: str) -> tuple[Image.Image, dict]:
    im = Image.open(font_path).convert('RGB')
    a = np.asarray(im).astype(int)
    teal = np.array([0, 91, 91])
    sep = (np.abs(a - teal).sum(2) <= 6)
    rows_sep = sep.all(1)
    cols_sep_all = sep.all(0)

    def runs(mask):
        out, start = [], None
        for i, m in enumerate(mask):
            if not m and start is None:
                start = i
            if m and start is not None:
                out.append((start, i)); start = None
        if start is not None:
            out.append((start, len(mask)))
        return out

    row_bands = runs(rows_sep)
    order = "$%&'()*+,-./0123" "456789:<<=>?@ABC" "DEFGHIJKLMNOPQRS" 'TUVWXYZ!"@[]'
    # row 2 col 7 is a left-arrow glyph and col 12 is (c); we map them to '<' and '@'.
    # Use distinct codes: arrow -> '←', copyright -> '©'
    order = list(order)
    order[16 + 7] = '←'
    order[16 + 12] = '©'
    order[48 + 9] = '©'
    glyphs = {}
    variants = []
    atlas_rows = []
    small_rows = [b for b in row_bands if 7 <= (b[1] - b[0]) <= 9]
    big_rows = [b for b in row_bands if (b[1] - b[0]) > 9]
    assert len(small_rows) >= 20, small_rows
    for vi in range(5):
        vrows = small_rows[vi * 4:(vi + 1) * 4]
        variants.append(vrows)
    # Build atlas: each variant is a 16x4 grid of 8x8 cells -> 128x32, stacked vertically
    atlas = Image.new('RGBA', (160, 32 * 5 + 16), (0, 0, 0, 0))  # 160: room for ten 14 px timer digits
    for vi, vrows in enumerate(variants):
        for ri, (y0, y1) in enumerate(vrows):
            band = sep[y0:y1].all(0)  # columns that are separators within this band
            cbands = runs(band)
            cells = [c for c in cbands if (c[1] - c[0]) >= 7]
            for ci, (x0, x1) in enumerate(cells[:16]):
                cell = im.crop((x0, y0, x0 + 8, y0 + 8)).convert('RGBA')
                ca = np.asarray(cell).copy()
                # key: variant 4 has white bg, others black bg
                bgc = np.array([255, 255, 255]) if vi == 4 else np.array([0, 0, 0])
                m = (np.abs(ca[..., :3].astype(int) - bgc).sum(2) <= 6)
                ca[m, 3] = 0
                cell = Image.fromarray(ca, 'RGBA')
                atlas.paste(cell, (ci * 8, vi * 32 + ri * 8))
                idx = ri * 16 + ci
                if vi == 0 and idx < len(order):
                    glyphs[order[idx]] = [ci * 8, ri * 8]
    # big digits (timer font)
    big = {}
    if big_rows:
        y0, y1 = big_rows[0]
        band = sep[y0:y1].all(0)
        cells = [c for c in runs(band) if (c[1] - c[0]) >= 8]
        bw = max(c[1] - c[0] for c in cells)
        bh = y1 - y0
        for di, (x0, x1) in enumerate(cells[:10]):
            cell = im.crop((x0, y0, x1, y1)).convert('RGBA')
            ca = np.asarray(cell).copy()
            m = (np.abs(ca[..., :3].astype(int) - np.array([255, 255, 255])).sum(2) <= 6)
            ca[m, 3] = 0
            atlas.paste(Image.fromarray(ca, 'RGBA'), (di * bw, 160))
            big[str(di)] = [di * bw, 160, x1 - x0, bh]
    meta = {
        'cell': 8,
        'variants': ['white', 'cyan', 'orange', 'lavender', 'blue'],
        'variantStride': 32,
        'glyphs': glyphs,
        'bigDigits': big,
    }
    return atlas, meta


def main() -> None:
    os.makedirs(os.path.join(OUT, 'stages'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)
    for i in range(1, 7):
        shutil.copyfile(src(f'Stage {i}.png'), os.path.join(OUT, 'stages', f'stage{i}.png'))
    for i in (1, 2):
        p = os.path.join(ROOT, f'bonus_stage{i}.png')
        if os.path.exists(p):
            shutil.copyfile(p, os.path.join(OUT, 'stages', f'bonus{i}.png'))

    eff = Image.open(src('marble_effects.png', os.path.join(DL, 'marble_effects.png'))).convert('RGBA')
    eff.save(os.path.join(OUT, 'sprites', 'marble_effects.png'))
    hue_swap_blue_to_red(eff).save(os.path.join(OUT, 'sprites', 'marble_effects_red.png'))

    shutil.copyfile(src('worm.png', os.path.join(DL, 'worm.png')), os.path.join(OUT, 'sprites', 'worm.png'))
    shutil.copyfile(src('bird.png', os.path.join(DL, 'bird.png')), os.path.join(OUT, 'sprites', 'bird.png'))
    shutil.copyfile(src('slime_on_floor.png', os.path.join(DL, 'slime_on_floor.png')), os.path.join(OUT, 'sprites', 'slime.png'))

    teal = (0, 91, 91)
    blue = (49, 146, 202)
    key_out(Image.open(src('hammer.png')), [teal, blue]).save(os.path.join(OUT, 'sprites', 'hammer.png'))
    key_out(Image.open(src('vaccuum_2.png')), [teal, blue]).save(os.path.join(OUT, 'sprites', 'vacuum.png'))
    Image.open(src('objects_spritesheet.png')).convert('RGBA').save(os.path.join(OUT, 'sprites', 'objects.png'))

    # riser pistons (Master System sheet, tinted yellow like the NES/arcade pads)
    ms = Image.open(src('Enemies & Obstacles.png')).convert('RGBA').crop((0, 128, 26, 154))
    ra = np.asarray(ms).copy().astype(int)
    bgm = np.zeros(ra.shape[:2], bool)
    for c in ((49, 146, 202), (0, 91, 91)):
        bgm |= (np.abs(ra[..., :3] - np.array(c)).sum(2) <= 8)
    ra[bgm, 3] = 0
    Image.fromarray(ra.astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'sprites', 'riser.png'))

    # NES-style animated sprites supplied as GIFs (animated_assets/) -> fixed-cell strips
    from PIL import ImageSequence
    def gif_strip(name, out, pick=None):
        path = os.path.join(ROOT, 'animated_assets', name)
        if not os.path.exists(path):
            return
        im = Image.open(path)
        frames = [fr.convert('RGBA') for fr in ImageSequence.Iterator(im)]
        if pick is not None:
            frames = [f for i, f in enumerate(frames) if pick(i)]
        w, h = frames[0].size
        strip = Image.new('RGBA', (len(frames) * (w + 1), h), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            strip.paste(f, (i * (w + 1), 0), f)
        strip.save(os.path.join(OUT, 'sprites', out))
    gif_strip('Player1Rolling.gif', 'p1roll.png')
    gif_strip('Player2Rolling.gif', 'p2roll.png')
    gif_strip('HammerTrap.gif', 'hammer_nes.png')
    gif_strip('VacuumTrapL.gif', 'vacuum_l.png')
    gif_strip('VacuumTrapR.gif', 'vacuum_r.png')
    gif_strip('BirdL.gif', 'bird_l.png')
    gif_strip('BirdR.gif', 'bird_r.png')
    gif_strip('FinishFlag.gif', 'flag_blue.png', pick=lambda i: i % 2 == 0)
    gif_strip('FinishFlag.gif', 'flag_red.png', pick=lambda i: i % 2 == 1)
    for rail in ('RailingL.png', 'RailingR.png'):
        rp = os.path.join(ROOT, 'animated_assets', rail)
        if os.path.exists(rp):
            Image.open(rp).convert('RGBA').save(os.path.join(OUT, 'sprites', rail.lower()))

    atlas, meta = build_font(src('Font.png'))
    atlas.save(os.path.join(OUT, 'sprites', 'font.png'))
    with open(os.path.join(OUT, 'sprites', 'font.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print('assets prepared ->', OUT)
    print('font glyphs:', len(meta['glyphs']), 'big digits:', len(meta['bigDigits']))


if __name__ == '__main__':
    main()
