#!/usr/bin/env python3
"""Fit sloped collision planes on painted floor masks (no new height painting).

For each named corridor, take the connected floor that touches the top of the
box and fit z = a + b x + c y from the two terrace heights already in the
labels, using Marigold only to confirm the art is sloped (not a cliff).

  python3 tools/fit_slopes.py 1 --marigold artifacts/marigold/output/depth_npy/stage1_depth.npy
"""
from __future__ import annotations
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Practice: one plane per corridor, along the painted path (not the whole AABB).
PRACTICE_BANDS = {
    'hills':         dict(x0=60, x1=230, y0=0, y1=70, z_hi=130, z_lo=130, optional=True),
    'side_ramps':    dict(x0=0, x1=289, y0=85, y1=145, z_hi=130, z_lo=100),
    'chute':         dict(x0=108, x1=228, y0=268, y1=455, z_hi=100, z_lo=40),
    'goal_corridor': dict(x0=8, x1=160, y0=448, y1=572, z_hi=42, z_lo=36, optional=True),
}


def load_stage(n: int):
    lab = np.asarray(Image.open(os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{n}.labels.png')).convert('L'))
    comps = json.load(open(os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{n}.comps.json')))
    art = np.asarray(Image.open(os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{n}.png')).convert('RGB'))
    return lab, comps, art


def floor_kind(lab, comps):
    kind = np.zeros(lab.shape, np.uint8)
    zflat = np.full(lab.shape, np.nan, np.float32)
    by = {c['id']: c for c in comps['components']}
    H, W = lab.shape
    for y in range(H):
        for x in range(W):
            c = by.get(int(lab[y, x]))
            if not c:
                continue
            if c['kind'] == 'wall':
                kind[y, x] = 2
            else:
                kind[y, x] = 1
                zflat[y, x] = c['a']
    return kind, zflat, by


def path_in_box(floor, box):
    """Largest floor component that touches the top edge of the box."""
    H, W = floor.shape
    x0, x1 = max(0, box['x0']), min(W, box['x1'] + 1)
    y0, y1 = max(0, box['y0']), min(H, box['y1'] + 1)
    roi = np.zeros_like(floor)
    roi[y0:y1, x0:x1] = floor[y0:y1, x0:x1]
    lab, n = ndimage.label(roi)
    if n == 0:
        return roi
    top = lab[y0, x0:x1]
    touch = {int(v) for v in top if v}
    if not touch:
        # fall back to the biggest blob in the box
        sizes = ndimage.sum(roi, lab, range(1, n + 1))
        touch = {int(np.argmax(sizes) + 1)}
    keep = np.isin(lab, list(touch))
    return keep


def fit_plane(xs, ys, zs):
    A = np.column_stack([np.ones(len(xs)), xs.astype(np.float64), ys.astype(np.float64)])
    coef, *_ = np.linalg.lstsq(A, zs.astype(np.float64), rcond=None)
    return float(coef[0]), float(coef[1]), float(coef[2])


def spectral(t):
    t = np.clip(t, 0, 1)
    r = np.clip(1.5 - 4 * np.abs(t - 0.75), 0, 1)
    g = np.clip(1.5 - 4 * np.abs(t - 0.5), 0, 1)
    b = np.clip(1.5 - 4 * np.abs(t - 0.25), 0, 1)
    return np.stack([r, g, b], 2)


def fit_stage(n, marigold_path):
    lab, comps, art = load_stage(n)
    H, W = lab.shape
    kind, zflat, by = floor_kind(lab, comps)
    floor = kind == 1
    mg = None
    if marigold_path and os.path.exists(marigold_path):
        mg = np.load(marigold_path).astype(np.float32)
        if mg.shape != (H, W):
            raise SystemExit(f'marigold {mg.shape} != {lab.shape}')

    bands = PRACTICE_BANDS if n == 1 else {}
    slope_masks = []
    for name, box in bands.items():
        if box['z_hi'] <= box['z_lo'] + 2:
            continue  # truly flat terrace — leave it
        pix = path_in_box(floor, box)
        if pix.sum() < 80:
            print(f'skip {name}: path too small ({int(pix.sum())} px)')
            continue
        ys, xs = np.where(pix)
        # Pin z to the two painted terrace heights along map-down. Marigold
        # flags that the art is sloped; it does not replace arcade z.
        t = (ys - ys.min()) / max(1, int(ys.max() - ys.min()))
        zt = box['z_hi'] + t * (box['z_lo'] - box['z_hi'])
        # overweight the first/last rows so the plane actually hits both pads
        w = np.ones(len(zt))
        w[t < 0.12] = 8
        w[t > 0.88] = 8
        A = np.column_stack([np.ones(len(xs)), xs.astype(np.float64), ys.astype(np.float64)])
        Aw = A * w[:, None]
        coef, *_ = np.linalg.lstsq(Aw, zt.astype(np.float64) * w, rcond=None)
        a, b, c = float(coef[0]), float(coef[1]), float(coef[2])
        slope_masks.append((name, pix, a, b, c, box))
        pred = a + b * xs + c * ys
        print(f'  fit {name}: a={a:.2f} b={b:.4f} c={c:.4f} pred {pred.min():.1f}..{pred.max():.1f} over {int(pix.sum())} px')

    # Rebuild comps: walls unchanged; floors minus slope pixels stay flat; slopes added
    next_id = 1
    lab_out = np.zeros_like(lab)
    new = []
    claimed = np.zeros_like(floor)
    for name, pix, a, b, c, box in slope_masks:
        lab_out[pix] = next_id
        claimed |= pix
        ys, xs = np.where(pix)
        new.append({
            'id': next_id, 'kind': 'slope', 'a': a, 'b': b, 'c': c,
            'area': int(pix.sum()),
            'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
            'name': name, 'z_hi': box['z_hi'], 'z_lo': box['z_lo'],
        })
        next_id += 1

    leftover = floor & ~claimed
    for zval in sorted({float(v) for v in np.unique(np.round(zflat[leftover], 1))} if leftover.any() else []):
        blob = leftover & (np.abs(zflat - zval) < 0.6)
        labb, nb = ndimage.label(blob)
        for k in range(1, nb + 1):
            pix = labb == k
            if pix.sum() < 16:
                continue
            ys, xs = np.where(pix)
            lab_out[pix] = next_id
            new.append({
                'id': next_id, 'kind': 'flat', 'a': zval, 'b': 0.0, 'c': 0.0,
                'area': int(pix.sum()),
                'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
            })
            next_id += 1

    for c in comps['components']:
        if c['kind'] != 'wall':
            continue
        pix = lab == c['id']
        lab_out[pix] = next_id
        c2 = dict(c)
        c2['id'] = next_id
        new.append(c2)
        next_id += 1

    out = {'width': W, 'height': H, 'components': new}
    Image.fromarray(lab_out, 'L').save(os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{n}.labels.png'))
    json.dump(out, open(os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{n}.comps.json'), 'w'))
    return lab_out, out, art, kind, slope_masks


def z_of(lab, comps):
    z = np.full(lab.shape, np.nan, np.float32)
    by = {c['id']: c for c in comps['components']}
    H, W = lab.shape
    k = np.zeros((H, W), np.uint8)
    for y in range(H):
        for x in range(W):
            c = by.get(int(lab[y, x]))
            if not c or c['kind'] == 'wall':
                if c:
                    k[y, x] = 2
                continue
            k[y, x] = 1
            z[y, x] = c['a'] + c['b'] * x + c['c'] * y
    return z, k


def write_overlay(n, art, z, kind, bands, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    finite = np.isfinite(z) & (kind == 1)
    if finite.any():
        lo, hi = np.nanpercentile(z[finite], 2), np.nanpercentile(z[finite], 98)
        t = (z - lo) / max(1e-6, hi - lo)
        col = (spectral(np.where(finite, t, 0)) * 255).astype(np.uint8)
    else:
        col = np.zeros((*z.shape, 3), np.uint8)
    col[kind != 1] = 0
    Image.fromarray(col).save(os.path.join(out_dir, f'stage{n}_z.png'))
    mix = (art.astype(np.float32) * 0.4 + col.astype(np.float32) * 0.6).astype(np.uint8)
    mix[kind != 1] = art[kind != 1]
    im = Image.fromarray(mix)
    dr = ImageDraw.Draw(im)
    for name, b in bands.items():
        dr.rectangle([b['x0'], b['y0'], b['x1'], b['y1']], outline=(255, 255, 0))
        dr.text((b['x0'] + 2, b['y0'] + 2), name, fill=(255, 255, 0))
    im.save(os.path.join(out_dir, f'stage{n}_overlay.png'))


def check_bands(z, kind, bands, slope_masks):
    fails = 0
    by_name = {name: pix for name, pix, *_ in slope_masks}
    for name, b in bands.items():
        pix = by_name.get(name)
        if pix is None:
            if b.get('optional') or b['z_hi'] <= b['z_lo'] + 2:
                print(f'PASS  {name}: flat terrace (no slope needed)')
                continue
            print(f'FAIL  {name}: no slope mask')
            fails += 1
            continue
        ys, xs = np.where(pix)
        pred = z[ys, xs]
        # walk down the page: median z per 8 px of y
        order = np.argsort(ys)
        ys, pred = ys[order], pred[order]
        bins = []
        y0 = ys[0]
        while y0 <= ys[-1]:
            m = (ys >= y0) & (ys < y0 + 8)
            if m.any():
                bins.append(float(np.median(pred[m])))
            y0 += 8
        if len(bins) < 3:
            print(f'FAIL  {name}: short path')
            fails += 1
            continue
        arr = np.array(bins)
        jumps = float(np.max(np.abs(np.diff(arr))))
        span = float(arr[0] - arr[-1])
        need = max(6.0, (b['z_hi'] - b['z_lo']) * 0.7)
        ok = jumps <= 8.0 and (span >= need or b.get('optional'))
        print(f'{"PASS" if ok else "FAIL"}  {name}: {arr[0]:.1f} → {arr[-1]:.1f} maxjump={jumps:.2f} span={span:.1f}')
        if not ok:
            fails += 1
    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', type=int)
    ap.add_argument('--marigold', default='')
    args = ap.parse_args()
    mg = args.marigold or os.path.join(ROOT, 'artifacts', 'marigold', 'output', 'depth_npy', f'stage{args.stage}_depth.npy')
    lab, comps, art, kind0, slope_masks = fit_stage(args.stage, mg if os.path.exists(mg) else None)
    z, kind = z_of(lab, comps)
    print(f'stage {args.stage}: {sum(1 for c in comps["components"] if c["kind"]=="slope")} slopes, '
          f'{sum(1 for c in comps["components"] if c["kind"]=="flat")} flats')
    out_dir = os.path.join(ROOT, 'artifacts', 'marigold', 'collision_z')
    bands = PRACTICE_BANDS if args.stage == 1 else {}
    write_overlay(args.stage, art, z, kind, bands, out_dir)
    print('wrote', os.path.join(out_dir, f'stage{args.stage}_overlay.png'))
    fails = check_bands(z, kind, bands, slope_masks) if bands else 0
    if fails:
        print(f'{fails} corridor(s) not a continuous downhill band.')
        sys.exit(2)


if __name__ == '__main__':
    main()
