#!/usr/bin/env python3
"""Generate src/data/frames.ts: sprite frame rectangles + pivots for every sheet.

Frames are detected from the sheets' transparency / background colour so the
table always matches the art files that ship in www/assets/sprites.
"""
from __future__ import annotations
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ROOT, 'www', 'assets', 'sprites')


def boxes_from_alpha(path: str, dilate: int = 2, min_px: int = 4):
    a = np.asarray(Image.open(path).convert('RGBA'))
    mask = a[..., 3] > 0
    lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=dilate) if dilate else mask)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        sel = mask[ys, xs]
        ys, xs = ys[sel], xs[sel]
        if len(xs) < min_px:
            continue
        out.append((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    return out, a.shape[1], a.shape[0]


def union(bs):
    return (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))


def frame(b, px, py):
    return {'x': b[0], 'y': b[1], 'w': b[2] - b[0], 'h': b[3] - b[1], 'px': px, 'py': py}


def marble_frames():
    boxes, W, H = boxes_from_alpha(os.path.join(SPR, 'marble_effects.png'), dilate=0, min_px=1)
    # cluster into 40px grid cells: row centre = 29 + 40r, col = floor(xc/40)
    cells: dict[tuple[int, int], list] = {}
    for b in boxes:
        xc = (b[0] + b[2]) / 2
        yc = (b[1] + b[3]) / 2
        r = int(round((yc - 29) / 40))
        c = int(xc // 40)
        cells.setdefault((r, c), []).append(b)

    def cell(r, c):
        if (r, c) not in cells:
            raise KeyError((r, c))
        b = union(cells[(r, c)])
        pivot_x = 40 * c + 13
        pivot_y = 29 + 40 * r
        return frame(b, pivot_x - b[0], pivot_y - b[1])

    out = {
        'roll': [cell(0, c) for c in range(6)],
        'squeeze': [cell(r, c) for r in range(6) for c in (7, 8)],
        'dissolve': [cell(6, c) for c in range(4)],
        'dizzy': [cell(7, c) for c in range(6)],
        'crack': [cell(8, c) for c in range(3)],
        'shards': [cell(8, 3)],
        'pileSparkle': [cell(8, 4), cell(8, 5)],
        'sparkle': [cell(9, 0)],
        'sweep': [cell(9, c) for c in range(1, 7)],
        'pile': [cell(9, 7)] if (9, 7) in cells else [cell(9, 0)],
    }
    return out


def simple_frames(name: str, pivot: str, order: str = 'reading', dilate: int = 2):
    boxes, W, H = boxes_from_alpha(os.path.join(SPR, name), dilate=dilate)
    if order == 'reading':
        boxes.sort(key=lambda b: (round(((b[1] + b[3]) / 2) / 12), b[0]))
    out = []
    for b in boxes:
        w, h = b[2] - b[0], b[3] - b[1]
        if pivot == 'center':
            out.append(frame(b, w // 2, h // 2))
        elif pivot == 'bottom':
            out.append(frame(b, w // 2, h - 2))
    return out


def cell_frames(name: str, pivot: str):
    """Sheets whose cells are laid out left-to-right; split by columns fully transparent."""
    a = np.asarray(Image.open(os.path.join(SPR, name)).convert('RGBA'))
    mask = a[..., 3] > 0
    col_any = mask.any(0)
    out, start = [], None
    for x, m in enumerate(list(col_any) + [False]):
        if m and start is None:
            start = x
        if not m and start is not None:
            sub = mask[:, start:x]
            ys = np.where(sub.any(1))[0]
            b = (start, int(ys.min()), x, int(ys.max()) + 1)
            w, h = b[2] - b[0], b[3] - b[1]
            out.append(frame(b, w // 2, h - 1 if pivot == 'bottom' else h // 2))
            start = None
    return out


def main():
    frames = {
        'marble': marble_frames(),
        'worm': simple_frames('worm.png', 'bottom'),
        'slime': simple_frames('slime.png', 'center'),
        'bird': simple_frames('bird.png', 'center'),
        'hammer': cell_frames('hammer.png', 'bottom'),
        'vacuum': cell_frames('vacuum.png', 'bottom'),
        'riser': [f for f in cell_frames('riser.png', 'bottom') if f['w'] >= 3],
    }
    # objects sheet: steelie (black marble) and logo
    boxes, W, H = boxes_from_alpha(os.path.join(SPR, 'objects.png'), dilate=2)
    boxes.sort(key=lambda b: (b[1] // 8, b[0]))
    logo = boxes[0]
    # steelie = the darkest ~16x16 sprite on the sheet (the black marble)
    arr = np.asarray(Image.open(os.path.join(SPR, 'objects.png')).convert('RGBA')).astype(int)
    def darkness(b):
        sub = arr[b[1]:b[3], b[0]:b[2]]
        vis = sub[..., 3] > 0
        return sub[..., :3][vis].mean() if vis.any() else 999
    cands = [b for b in boxes if 13 <= (b[2] - b[0]) <= 18 and 13 <= (b[3] - b[1]) <= 18]
    steelie = min(cands, key=darkness)
    frames['objects'] = {
        'logo': [frame(logo, 0, 0)],
        'steelie': [frame(steelie, (steelie[2] - steelie[0]) // 2, (steelie[3] - steelie[1]) // 2)],
    }
    ts = ['// AUTO-GENERATED by tools/gen_frames.py — do not edit by hand.',
          'export interface Frame { x: number; y: number; w: number; h: number; px: number; py: number }',
          'export const FRAMES = ' + json.dumps(frames, indent=1) + ' as const;',
          'export type SheetName = keyof typeof FRAMES;', '']
    os.makedirs(os.path.join(ROOT, 'src', 'data'), exist_ok=True)
    with open(os.path.join(ROOT, 'src', 'data', 'frames.ts'), 'w') as f:
        f.write('\n'.join(ts))
    for k, v in frames.items():
        if isinstance(v, dict):
            print(k, {kk: len(vv) for kk, vv in v.items()})
        else:
            print(k, len(v))


if __name__ == '__main__':
    main()
