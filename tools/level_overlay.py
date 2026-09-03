#!/usr/bin/env python3
"""Level authoring aid.

  python3 tools/level_overlay.py <stage> [--grid Z] [--y0 A --y1 B] [--scale 4] [--fit] [--labels]

Renders www/assets/stages/stage<N>.png scaled up with the authored surfaces from
artifacts/levels/stage<N>.json drawn as translucent diamonds (id labels), zones,
hazards, checkpoints and the start point. `--grid Z` additionally draws the iso
tile grid at height Z with (u,v) labels every 2 tiles so coordinates can be read
off the picture. `--fit` reports, for every surface, the fraction of its
projected area that lands on floor-coloured pixels and the best z within ±8 px.
Output: artifacts/levels/stage<N>_overlay.png (cropped to y0..y1 if given).
"""
from __future__ import annotations
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HW, HH = 8, 4

# floor colours per stage (rgb tuples)
GRAYS = [(169, 169, 169), (135, 135, 135), (186, 186, 186), (220, 220, 220), (110, 110, 110), (67, 67, 67), (47, 47, 47), (237, 237, 237), (254, 254, 254)]
FLOOR = {
    1: GRAYS + [(203, 54, 54)],
    2: GRAYS,
    3: [(203, 176, 135), (169, 146, 112), (84, 73, 56), (118, 102, 79), (50, 44, 33), (142, 121, 91), (254, 237, 220), (55, 110, 86)],
    4: GRAYS,
    5: GRAYS,
    6: GRAYS + [(203, 135, 0), (254, 152, 118), (0, 186, 254), (0, 135, 186)],
}


def to_map(u, v, z):
    return (u - v) * HW, (u + v) * HH - z


def height_on(s, u, v):
    if s.get('sd'):
        S, D = u + v, u - v
        return s['z0'] + s['gu'] * (S - s['u0']) + s['gv'] * (D - s['v0'])
    return s['z0'] + s['gu'] * (u - s['u0']) + s['gv'] * (v - s['v0'])


def corners(s):
    if s.get('sd'):
        c = lambda S, D: ((S + D) / 2, (S - D) / 2)
        return [c(s['u0'], s['v0']), c(s['u1'], s['v0']), c(s['u1'], s['v1']), c(s['u0'], s['v1'])]
    return [(s['u0'], s['v0']), (s['u1'], s['v0']), (s['u1'], s['v1']), (s['u0'], s['v1'])]


def poly(s):
    return [to_map(u, v, height_on(s, u, v)) for u, v in corners(s)]


WALL = {
    1: [(169, 50, 0), (254, 237, 0), (237, 118, 0)],
    2: [(0, 40, 67), (0, 186, 254), (0, 90, 135), (67, 50, 186)],
    3: [(16, 16, 16), (13, 13, 13), (12, 11, 10), (16, 14, 11)],
    4: [(118, 33, 16), (254, 67, 50), (152, 101, 0), (220, 135, 0), (254, 186, 0), (186, 50, 33)],
    5: [(152, 118, 0), (254, 220, 0), (203, 169, 0), (152, 67, 0)],
    6: [(135, 0, 0), (254, 0, 0), (186, 0, 0)],
}


def wall_mask(img: Image.Image, stage: int):
    a = np.asarray(img.convert('RGB')).astype(int)
    m = np.zeros(a.shape[:2], bool)
    for c in WALL[stage]:
        m |= (np.abs(a - np.array(c)).sum(2) <= 8)
    return m


def wall_runs(img, stage, step=8):
    """For every `step`-th column, find non-floor runs bounded by floor above & below.
    Returns list of (x, y_top, length, kind) where kind is 'wall' or 'gap'."""
    fm = floor_mask(img, stage); wm = wall_mask(img, stage)
    H, W = fm.shape
    out = []
    for x in range(step // 2, W, step):
        col = fm[:, x]
        y = 0
        while y < H:
            if col[y]:
                y += 1; continue
            y0 = y
            while y < H and not col[y]:
                y += 1
            if y0 > 0 and y < H:
                seg_w = wm[y0:y, x].sum()
                kind = 'wall' if seg_w >= (y - y0) * 0.3 else 'gap'
                out.append((x, y0, y - y0, kind))
    return out


def floor_mask(img: Image.Image, stage: int):
    a = np.asarray(img.convert('RGB')).astype(int)
    m = np.zeros(a.shape[:2], bool)
    for c in FLOOR[stage]:
        m |= (np.abs(a - np.array(c)).sum(2) <= 8)
    return m


def poly_mask(shape, pts):
    im = Image.new('L', (shape[1], shape[0]), 0)
    ImageDraw.Draw(im).polygon([(x, y) for x, y in pts], fill=1)
    return np.asarray(im).astype(bool)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', type=int)
    ap.add_argument('--grid', type=float, default=None)
    ap.add_argument('--y0', type=int, default=0)
    ap.add_argument('--y1', type=int, default=None)
    ap.add_argument('--scale', type=int, default=4)
    ap.add_argument('--fit', action='store_true')
    ap.add_argument('--labels', action='store_true', default=True)
    ap.add_argument('--nosurf', action='store_true')
    ap.add_argument('--out', default=None)
    ap.add_argument('--walls', action='store_true')
    ap.add_argument('--ruler', action='store_true')
    a = ap.parse_args()

    img = Image.open(os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{a.stage}.png')).convert('RGB')
    W, H = img.size
    jpath = os.path.join(ROOT, 'artifacts', 'levels', f'stage{a.stage}.json')
    lvl = json.load(open(jpath)) if os.path.exists(jpath) else None

    S = a.scale
    y1 = a.y1 if a.y1 is not None else H
    big = img.resize((W * S, H * S), Image.NEAREST).convert('RGBA')
    ov = Image.new('RGBA', big.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)

    def P(x, y):
        return (x * S, y * S)

    if a.grid is not None:
        z = a.grid
        # iterate over tile corners covering the image
        smax = (H + z) / HH + 4
        for su in range(-40, int(smax) + 40):
            for sv in range(-40, int(smax) + 40):
                x, y = to_map(su, sv, z)
                if x < -16 or x > W + 16 or y < a.y0 - 16 or y > y1 + 16:
                    continue
                # draw tile diamond edges (u..u+1 at v, and v..v+1 at u)
                x2, y2 = to_map(su + 1, sv, z)
                x3, y3 = to_map(su, sv + 1, z)
                d.line([P(x, y), P(x2, y2)], fill=(0, 255, 255, 90), width=1)
                d.line([P(x, y), P(x3, y3)], fill=(0, 255, 255, 90), width=1)
                if su % 2 == 0 and sv % 2 == 0:
                    d.text((x * S + 2, y * S + 1), f"{su},{sv}", fill=(255, 255, 0, 230))

    if lvl and not a.nosurf:
        colors = [(255, 0, 0), (0, 200, 0), (0, 120, 255), (255, 0, 255), (255, 160, 0), (0, 220, 220)]
        for i, s in enumerate(lvl['surfaces']):
            pts = poly(s)
            col = colors[i % len(colors)]
            d.polygon([P(x, y) for x, y in pts], fill=col + (70,), outline=col + (255,))
            cx = sum(p[0] for p in pts) / 4; cy = sum(p[1] for p in pts) / 4
            lab = f"{s['id']}" + (f":{s['name']}" if s.get('name') else '') + f" z{s['z0']:g}"
            if s['gu'] or s['gv']:
                lab += f" g{s['gu']:g},{s['gv']:g}"
            d.text((cx * S - 10, cy * S - 4), lab, fill=(255, 255, 255, 255))
        for zn in lvl['zones']:
            z = zn.get('zMin', 0) if zn.get('zMin') is not None else 0
            pts = [to_map(zn['u0'], zn['v0'], z), to_map(zn['u1'], zn['v0'], z), to_map(zn['u1'], zn['v1'], z), to_map(zn['u0'], zn['v1'], z)]
            d.polygon([P(x, y) for x, y in pts], outline=(255, 255, 0, 255))
            d.text(P(pts[0][0], pts[0][1]), f"{zn['kind']} {zn.get('value', '')}", fill=(255, 255, 0, 255))
        for i, cp in enumerate(lvl['checkpoints']):
            x, y = to_map(cp['u'], cp['v'], 0)
            d.ellipse([x * S - 6, y * S - 6, x * S + 6, y * S + 6], outline=(255, 255, 255, 255), width=2)
            d.text((x * S + 8, y * S - 6), f"cp{i}", fill=(255, 255, 255, 255))
        st = lvl['start']
        x, y = to_map(st['u'], st['v'], st.get('z') or 0)
        d.ellipse([x * S - 8, y * S - 8, x * S + 8, y * S + 8], outline=(0, 255, 0, 255), width=3)
        for hz in lvl['hazards']:
            x, y = to_map(hz['u'], hz['v'], 0)
            d.rectangle([x * S - 6, y * S - 6, x * S + 6, y * S + 6], outline=(255, 128, 0, 255), width=2)
            d.text((x * S + 8, y * S - 6), hz['kind'], fill=(255, 128, 0, 255))
        for pp in lvl['pipes']:
            pts = [to_map(pp['u0'], pp['v0'], pp.get('zMin') or 0), to_map(pp['u1'], pp['v0'], pp.get('zMin') or 0), to_map(pp['u1'], pp['v1'], pp.get('zMin') or 0), to_map(pp['u0'], pp['v1'], pp.get('zMin') or 0)]
            d.polygon([P(x, y) for x, y in pts], outline=(255, 0, 255, 255))
            ex, ey = to_map(pp['exit']['u'], pp['exit']['v'], 0)
            d.text((ex * S, ey * S), 'pipe exit', fill=(255, 0, 255, 255))

    if a.ruler:
        for x in range(0, W, 8):
            col = (255, 255, 0, 200) if x % 32 == 0 else (255, 255, 0, 70)
            d.line([P(x, a.y0), P(x, y1)], fill=col, width=1)
            if x % 32 == 0:
                for yy in range(a.y0, y1, 64):
                    d.text((x * S + 2, yy * S + 2), str(x), fill=(255, 255, 255, 255))
        for y in range(0, H, 8):
            if y < a.y0 or y > y1:
                continue
            col = (0, 255, 255, 200) if y % 32 == 0 else (0, 255, 255, 70)
            d.line([P(0, y), P(W, y)], fill=col, width=1)
            if y % 32 == 0:
                for xx in range(0, W, 64):
                    d.text((xx * S + 2, y * S + 2), str(y), fill=(255, 255, 255, 255))

    if a.walls:
        for (x, y0, L, kind) in wall_runs(img, a.stage):
            if y0 + L < a.y0 or y0 > y1 or L < 3:
                continue
            col = (255, 255, 255, 255) if kind == 'wall' else (255, 80, 80, 255)
            d.line([P(x, y0), P(x, y0 + L)], fill=col, width=1)
            d.text((x * S + 2, (y0 + L / 2) * S - 5), str(L), fill=col)

    out = Image.alpha_composite(big, ov)
    out = out.crop((0, a.y0 * S, W * S, y1 * S))
    op = a.out or os.path.join(ROOT, 'artifacts', 'levels', f'stage{a.stage}_overlay.png')
    os.makedirs(os.path.dirname(op), exist_ok=True)
    out.save(op)
    print('wrote', op, out.size)

    if a.fit and lvl:
        fm = floor_mask(img, a.stage)
        print('surface fit (fraction of projected area on floor colours):')
        for s in lvl['surfaces']:
            base = poly_mask(fm.shape, poly(s))
            n = base.sum()
            frac = (fm & base).sum() / max(1, n)
            best = (frac, 0)
            for dz in range(-8, 9):
                s2 = dict(s); s2['z0'] = s['z0'] + dz
                m2 = poly_mask(fm.shape, poly(s2))
                f2 = (fm & m2).sum() / max(1, m2.sum())
                if f2 > best[0] + 0.02:
                    best = (f2, dz)
            flag = '' if frac > 0.85 else ('  <-- check' if frac > 0.6 else '  <-- BAD')
            print(f"  #{s['id']:3d} {s.get('name', ''):14s} z{s['z0']:6.1f} area {n:6d} floor {frac:5.2f} best dz {best[1]:+d} ({best[0]:.2f}){flag}")


if __name__ == '__main__':
    main()
