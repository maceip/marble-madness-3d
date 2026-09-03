#!/usr/bin/env python3
"""Fit component heights to the faces the art actually draws.

The labeler paints floor / wall / void and a rough terrace value per floor component. Terrace values
are guesses; the picture is not: wherever a vertical face (wall pixels) separates two floors in a
pixel column, the face height in pixels IS the height difference between those floors. This tool
collects those faces, aggregates them per (upper, lower) component pair and solves all component
heights by weighted least squares:

    z_upper(x, y_top-1) - z_lower(x, y_bottom) = face height       (weight ~ n faces)
    z_c = anchor                                                    (start floor, hard)
    z_c = labeler value                                             (weak prior)

Flat components have one unknown (a); slope components keep their fitted gradient (b, c) and get a
free offset. Faces whose height varies a lot along the pair (a wall under a sloping edge, or a face
partly hidden behind something) are dropped.

    python3 tools/solve_heights.py <stage> [--apply] [--anchor ID=Z ...] [--min-n 6]
"""
from __future__ import annotations
import argparse, json, os
from collections import defaultdict
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', type=int)
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--anchor', action='append', default=[], help='ID=Z hard height (default: the component with the largest z stays)')
    ap.add_argument('--min-n', type=int, default=6)
    ap.add_argument('--max-spread', type=float, default=8, help='drop pairs whose face height IQR exceeds this')
    ap.add_argument('--prior', type=float, default=0.02, help='weight of the labeler value')
    a = ap.parse_args()

    lab_path = os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{a.stage}.labels.png')
    cmp_path = os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{a.stage}.comps.json')
    lab = np.array(Image.open(lab_path).convert('L'))
    doc = json.load(open(cmp_path))
    comps = {c['id']: c for c in doc['components']}
    H, W = lab.shape
    wall = np.zeros(256, bool)
    for i, c in comps.items():
        wall[i] = c['kind'] == 'wall'

    def z_of(c, x, y):
        return c['a'] + c['b'] * x + c['c'] * y

    # collect faces
    pairs: dict[tuple[int, int], list[tuple[int, int, int]]] = defaultdict(list)   # (x, y_top, run)
    for x in range(W):
        y = 0
        while y < H:
            if not wall[lab[y, x]]:
                y += 1; continue
            y0 = y
            while y < H and wall[lab[y, x]]:
                y += 1
            up = int(lab[y0 - 1, x]) if y0 > 0 else 0
            dn = int(lab[y, x]) if y < H else 0
            if up and dn and up != dn and not wall[up] and not wall[dn]:
                pairs[(up, dn)].append((x, y0, y - y0))

    floors = [i for i, c in comps.items() if c['kind'] != 'wall']
    idx = {cid: k for k, cid in enumerate(floors)}
    rows, rhs, wts = [], [], []
    used = []
    for (up, dn), v in pairs.items():
        if len(v) < a.min_n:
            continue
        runs = np.array([r[2] for r in v], float)
        q1, q3 = np.percentile(runs, [25, 75])
        if q3 - q1 > a.max_spread:
            print(f'  skip {up}->{dn}: n={len(v)} face {np.median(runs):.0f} spread {q3 - q1:.0f}')
            continue
        # faces already in the labels (planes' own difference at the face pixels)
        cu, cd = comps[up], comps[dn]
        # residual constraint: a_u - a_d = run - (b_u x + c_u (y0-1)) + (b_d x + c_d y1)
        for (x, y0, run) in v:
            row = np.zeros(len(floors)); row[idx[up]] = 1; row[idx[dn]] = -1
            r = run - (cu['b'] * x + cu['c'] * (y0 - 1)) + (cd['b'] * x + cd['c'] * (y0 + run))
            rows.append(row); rhs.append(r); wts.append(1.0 / np.sqrt(len(v)))
        used.append((up, dn, len(v), float(np.median(runs))))
    # priors
    for cid in floors:
        row = np.zeros(len(floors)); row[idx[cid]] = 1
        rows.append(row); rhs.append(comps[cid]['a']); wts.append(a.prior)
    # anchors
    anchors = {}
    for s in a.anchor:
        k, v = s.split('='); anchors[int(k)] = float(v)
    if not anchors:
        top = max(floors, key=lambda i: comps[i]['a'] + (comps[i]['c'] * comps[i]['bbox'][1] if comps[i]['kind'] == 'slope' else 0))
        anchors[top] = comps[top]['a']
    for cid, zv in anchors.items():
        row = np.zeros(len(floors)); row[idx[cid]] = 1
        rows.append(row); rhs.append(zv); wts.append(50.0)
    A = np.array(rows) * np.array(wts)[:, None]
    bvec = np.array(rhs) * np.array(wts)
    sol, *_ = np.linalg.lstsq(A, bvec, rcond=None)

    print(f'stage {a.stage}: {len(used)} face constraints, anchors {anchors}')
    for (up, dn, n, med) in sorted(used, key=lambda t: -t[2]):
        zu, zd = sol[idx[up]], sol[idx[dn]]
        print(f'  {up:>3}->{dn:<3} n={n:<4} face {med:5.1f}   fitted a: {zu:6.1f} - {zd:6.1f} = {zu - zd:5.1f}')
    print('component heights (a):')
    changed = 0
    for cid in floors:
        c = comps[cid]
        new = float(sol[idx[cid]])
        flag = ' *' if abs(new - c['a']) > 3 else ''
        print(f'  {cid:>3} {c["kind"]:5} area {c.get("area", 0):6} label {c["a"]:6.1f} -> {new:6.1f}{flag} {c.get("name", "")}')
        if a.apply and abs(new - c['a']) > 0.5:
            c['a'] = round(new, 2); changed += 1
    if a.apply:
        json.dump(doc, open(cmp_path, 'w'))
        print(f'applied ({changed} components changed)')


if __name__ == '__main__':
    main()
