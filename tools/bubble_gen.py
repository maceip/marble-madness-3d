#!/usr/bin/env python3
"""Pixel speech bubble (from the supplied concept art): 1-cell black outline, 1-cell cyan bevel left/right/bottom,
3-step chamfered corners, tail at the bottom right. Emits 1x PNGs: full reference, 9-slice body, tail; and previews."""
import os, sys, json
from PIL import Image

T = (0, 0, 0, 0); K = (0, 0, 0, 255); W = (255, 255, 255, 255); C = (0, 200, 255, 255)   # cyan sampled from the art
CH = 4            # chamfer steps
TAIL_COLS = 10    # tail sprite width (cells)  incl. bevel
TAIL_ROWS = 8     # rows: 1 (body outline row, opened) + 1 (body bevel row) + 6 below

def body(fill_w, fill_h):
    """Rounded body: cols = 1 cyan + 1 outline + fill_w + 1 outline + 1 cyan; rows = outline + fill_h + outline + cyan."""
    cols, rows = fill_w + 4, fill_h + 3
    px = [[T] * cols for _ in range(rows)]
    top, bot = 0, fill_h + 1              # outline rows
    L, R = 1, cols - 2                    # outline cols
    for y in range(rows):
        for x in range(cols):
            # distance into the chamfer at each corner (0 = on the diagonal)
            d_tl = (x - L) + (y - top); d_tr = (R - x) + (y - top)
            d_bl = (x - L) + (bot - y); d_br = (R - x) + (bot - y)
            inside = L <= x <= R and top <= y <= bot
            if inside and min(d_tl, d_tr, d_bl, d_br) < CH - 1:
                inside = False           # cut corner (outside the outline diagonal)
            if not inside: continue
            edge = x in (L, R) or y in (top, bot) or min(d_tl, d_tr, d_bl, d_br) == CH - 1
            px[y][x] = K if edge else W
    # cyan bevel: every transparent cell that is left/right/below an outline cell (not above)
    out = [row[:] for row in px]
    for y in range(rows):
        for x in range(cols):
            if px[y][x] != T: continue
            nb = []
            if x + 1 < cols: nb.append(px[y][x + 1])
            if x - 1 >= 0: nb.append(px[y][x - 1])
            if y - 1 >= 0: nb.append(px[y - 1][x])
            if y - 1 >= 0 and x - 1 >= 0: nb.append(px[y - 1][x - 1])
            if y - 1 >= 0 and x + 1 < cols: nb.append(px[y - 1][x + 1])
            if K in nb and y > 0: out[y][x] = C
    return out

def tail():
    """Tail sprite, drawn over the body's bottom outline+bevel rows. Row 0 = body outline row (opened), row 1 = body bevel row.
    Left edge: 45 degree staircase down-right; right edge: vertical; tip 2 cells wide."""
    cols, rows = TAIL_COLS, TAIL_ROWS
    px = [[T] * cols for _ in range(rows)]
    right = cols - 3           # vertical outline column
    # rows 0..5 : left outline at x = row, fill to right-1, outline at right; then tip
    for y in range(0, 6):
        lx = y
        px[y][lx] = K
        for x in range(lx + 1, right): px[y][x] = W
        px[y][right] = K
    px[6][6] = K; px[6][7] = K            # tip (row 6)
    # opening: row 0 fill must reach the body interior -> the body outline row is white across the opening
    for x in range(1, right): px[0][x] = W
    px[0][0] = K
    # bevel
    out = [row[:] for row in px]
    for y in range(rows):
        for x in range(cols):
            if px[y][x] != T: continue
            nb = []
            for dy, dx in ((0, 1), (0, -1), (-1, 0), (-1, -1), (-1, 1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < rows and 0 <= xx < cols: nb.append(px[yy][xx])
            if K in nb and y > 0: out[y][x] = C
    # row 0 of the tail replaces the body's outline row: cells outside the opening stay transparent so the body shows
    return out

def to_img(px):
    im = Image.new('RGBA', (len(px[0]), len(px)))
    im.putdata([c for row in px for c in row]); return im

def composite(fill_w, fill_h):
    """Full bubble at 1x for reference/preview: body + tail anchored 7 cells from the right edge."""
    b = to_img(body(fill_w, fill_h)); t = to_img(tail())
    full = Image.new('RGBA', (b.width, b.height + TAIL_ROWS - 2), T)
    full.paste(b, (0, 0))
    tx = b.width - 7 - TAIL_COLS + 1; ty = b.height - 2
    full.alpha_composite(t, (tx, ty))
    return full

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'www', 'assets', 'ui')
    import os; os.makedirs(out, exist_ok=True)
    to_img(body(11, 5)).save(f'{out}/bubble_body.png')       # 9-slice source: 15x8, slices top 3 / right 5 / bottom 4 / left 5
    to_img(tail()).save(f'{out}/bubble_tail.png')             # 10x8
    ref = composite(75, 15); ref.save(f'{out}/bubble_ref.png')  # same proportions as the concept art (79x24 + tail)
    ref.resize((ref.width * 8, ref.height * 8), Image.NEAREST).save(f'{out}/bubble_ref@8x.png')
    small = composite(20, 4); small.resize((small.width * 8, small.height * 8), Image.NEAREST).save(f'{out}/bubble_small@8x.png')
    json.dump({"body": {"image": "bubble_body.png", "size": [15, 8], "slice": {"top": 3, "right": 5, "bottom": 4, "left": 5},
               "padding_cells": {"top": 1, "right": 2, "bottom": 2, "left": 2}},
               "tail": {"image": "bubble_tail.png", "size": [TAIL_COLS, TAIL_ROWS], "anchor": "bottom-right", "right_cells": 7, "overlap_rows": 2},
               "palette": {"outline": "#000000", "fill": "#ffffff", "bevel": "#00c8ff"},
               "note": "1 cell = 1 px; render with image-rendering: pixelated at an integer scale (the concept art used ~4-6 screen px per cell)"},
              open(f'{out}/bubble.json', 'w'), indent=1)
    print('wrote', os.listdir(out))
