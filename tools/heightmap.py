#!/usr/bin/env python3
"""Derive a collision height map for a stage directly from the arcade art.

  python3 tools/heightmap.py <stage> [--debug]

Pipeline
  1. classify pixels: flat floor / sloped floor / wall / other using per-stage palettes
     (levels/hm/stage<N>.json)
  2. connected components of flat and of sloped floor (holes filled) -> "components"
  3. measure vertical wall runs between floors (a wall of L px means the floor above
     is exactly L px higher than the floor below it)
  4. solve flat component heights from the anchor(s) + wall relations (BFS, median vote)
  5. fit an affine height z = a + b*x + c*y (map pixels) for each sloped component from
     its contacts with flats and its own wall relations
  6. write www/assets/stages/stage<N>.labels.png (component id per pixel, 8-bit) and
     stage<N>.comps.json; with --debug also artifacts/levels/stage<N>_hm.png

The JSON config supports manual fixes: anchors, fill / cut rectangles, slope overrides,
and `merge` pairs. See levels/hm/README.md.
"""
from __future__ import annotations
import argparse, json, os, sys, colorsys
from collections import defaultdict
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def mask_of(a, colors, tol=8):
    m = np.zeros(a.shape[:2], bool)
    for c in colors:
        m |= (np.abs(a - np.array(c)).sum(2) <= tol)
    return m


def rect_mask(shape, r):
    m = np.zeros(shape, bool)
    m[r['y0']:r['y1'], r['x0']:r['x1']] = True
    return m


def label_class(mask, min_area):
    """8-connected components after a 1px closing (bridges thin grid/shadow lines)."""
    closed = ndimage.binary_closing(mask, structure=np.ones((3, 3)))
    closed |= mask
    lab, n = ndimage.label(closed, structure=np.ones((3, 3)))
    out = np.zeros_like(lab)
    sizes = ndimage.sum(np.ones_like(lab), lab, index=range(1, n + 1))
    order = sorted(range(1, n + 1), key=lambda i: sizes[i - 1])  # small first so fills never swallow islands
    k = 0
    for i in order:
        if sizes[i - 1] < min_area:
            continue
        cm = ndimage.binary_fill_holes(lab == i)
        k += 1
        out[cm & (out == 0)] = k
    return out, k


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', type=int)
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    n = args.stage
    cfg = json.load(open(os.path.join(ROOT, 'levels', 'hm', f'stage{n}.json')))
    img = Image.open(os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{n}.png')).convert('RGB')
    a = np.asarray(img).astype(int)
    H, W = a.shape[:2]

    flat = mask_of(a, cfg['flat'])
    slope = mask_of(a, cfg.get('slope', []))
    wall = mask_of(a, cfg['wall'])
    for r in cfg.get('cut', []):
        rm = rect_mask((H, W), r)
        flat &= ~rm; slope &= ~rm
    for poly in cfg.get('cutPoly', []):
        pm = Image.new('L', (W, H), 0); ImageDraw.Draw(pm).polygon([tuple(p) for p in poly], fill=1)
        pmask = np.asarray(pm).astype(bool)
        flat &= ~pmask; slope &= ~pmask
    for r in cfg.get('cutSlope', []):
        rm = rect_mask((H, W), r)
        slope &= ~rm
    for r in cfg.get('toSlope', []):
        rm = rect_mask((H, W), r)
        slope |= (flat & rm); flat &= ~rm
    for r in cfg.get('toFlat', []):
        rm = rect_mask((H, W), r)
        flat |= (slope & rm); slope &= ~rm

    min_area = cfg.get('minArea', 24)
    grid = mask_of(a, cfg.get('grid', []))
    cr = cfg.get('closeRadius', 0)
    if cr:
        # morphological closing bridges thin decorations painted over floors (rails, gate posts,
        # small shadows) without merging floors across real walls (>= 2*cr+2 px)
        se = np.ones((2 * cr + 1, 2 * cr + 1), bool)
        closed = ndimage.binary_closing(flat | slope, structure=se)
        added = closed & ~(flat | slope) & ~wall
        flat |= added
        print(f'closeRadius {cr}: added {int(added.sum())} decoration px to floor')
    if cfg.get('stripeFilter'):
        # light separator lines between wall stripes share floor colours: drop floor pixels
        # that have wall pixels within 2 px on both left and right
        wl = np.zeros_like(wall); wr = np.zeros_like(wall)
        for d in (1, 2):
            wl[:, d:] |= wall[:, :-d]; wr[:, :-d] |= wall[:, d:]
        stripes = (flat | slope) & wl & wr
        flat &= ~stripes; slope &= ~stripes
        print(f'stripeFilter removed {int(stripes.sum())} px')
    if cfg.get('diag'):
        floor_all = flat | slope
        hist = {}
        for x in range(0, W, 2):
            col_floor = floor_all[:, x]; pos = np.where(grid[:, x] & col_floor)[0]
            if len(pos) < 2: continue
            starts = pos[np.r_[True, np.diff(pos) > 1]]
            for i in range(len(starts) - 1):
                d = int(starts[i + 1] - starts[i])
                if col_floor[starts[i]:starts[i + 1] + 1].all() and d <= 24:
                    hist[d] = hist.get(d, 0) + 1
        print('grid-line spacing histogram (flat floors should peak at 4):', dict(sorted(hist.items())))
    if cfg.get('autoSlope'):
        # tiles on a ramp are stretched/compressed vertically: dark grid lines along a column are
        # ~4 px apart on flat floor, >=6 (or <=2) on ramps. Mark such floor pixels as slope.
        floor_all = flat | slope
        auto = np.zeros_like(flat)
        flat_ok = set(cfg.get('flatSpacing', [3, 4, 5, 8]))
        for x in range(W):
            col_floor = floor_all[:, x]
            col_line = grid[:, x] & col_floor
            pos = np.where(col_line)[0]
            if len(pos) < 2:
                continue
            starts = pos[np.r_[True, np.diff(pos) > 1]]
            for i in range(len(starts) - 1):
                y0, y1 = starts[i], starts[i + 1]
                d = y1 - y0
                # the run between two lines must be floor throughout (no wall/void in between)
                if not col_floor[y0:y1 + 1].all():
                    continue
                if d not in flat_ok:
                    auto[y0:y1 + 1, x] = True
        # majority filter in 5x5 windows to remove speckle, then adopt
        auto = ndimage.uniform_filter(auto.astype(float), size=5) > 0.5
        slope = slope | (auto & floor_all)
        flat = flat & ~slope
    # grid lines inside slope bands share the flat palette: let slopes swallow nearby line pixels
    slope_grow = ndimage.binary_dilation(slope, iterations=cfg.get('slopeGrow', 2))
    slope = slope | (grid & slope_grow)
    flat = flat & ~slope
    lab_f, nf = label_class(flat, min_area)
    lab_s, ns = label_class(slope, min_area)
    # unified labels: flats 1..nf, slopes nf+1..nf+ns
    labels = lab_f.copy()
    labels[lab_s > 0] = lab_s[lab_s > 0] + nf
    kind = {i: 'flat' for i in range(1, nf + 1)}
    kind.update({nf + j: 'slope' for j in range(1, ns + 1)})

    # manual splits: pixels of a component below a row become a new component
    for sp in cfg.get('split', []):
        cid = int(labels[sp['at'][1], sp['at'][0]])
        if cid == 0:
            print('split: reference pixel has no component', sp); continue
        newid = max(kind) + 1
        m = (labels == cid)
        rows = np.arange(H)[:, None]
        sel = m & (rows > sp['yMax'])
        labels[sel] = newid
        kind[newid] = kind[cid]
        print(f"split: comp #{cid} -> rows > {sp['yMax']} become #{newid} ({int(sel.sum())} px)")
    # manual fills: paint a rectangle with the component found at a reference pixel
    for r in cfg.get('fill', []):
        cid = int(labels[r['comp'][1], r['comp'][0]])
        if cid == 0:
            print('fill: reference pixel has no component', r); continue
        rm = rect_mask((H, W), r)
        labels[rm & (labels == 0)] = cid
    # manual merges
    for pair in cfg.get('merge', []):
        c1 = int(labels[pair[0][1], pair[0][0]]); c2 = int(labels[pair[1][1], pair[1][0]])
        if c1 and c2 and c1 != c2:
            labels[labels == c2] = c1
    floor_any = labels > 0

    # ---- wall relations ----------------------------------------------------
    rel_votes = defaultdict(list)   # (above, below) -> [L]
    slope_samples = defaultdict(list)  # slope comp -> [(x, y, z_expr)] where z_expr = ('rel', other_comp, L, sign) or ('eq', other_comp)
    for x in range(W):
        col = floor_any[:, x]
        y = 0
        while y < H:
            if col[y]:
                y += 1; continue
            y0 = y
            while y < H and not col[y]:
                y += 1
            if y0 == 0 or y >= H:
                continue
            L = y - y0
            if L < cfg.get('minWall', 8):
                continue
            seg_w = wall[y0:y, x].sum()
            if seg_w < L * 0.3:
                continue  # gap / void, no relation
            ca = int(labels[y0 - 1, x]); cb = int(labels[y, x])
            if ca == 0 or cb == 0 or ca == cb:
                continue
            rel_votes[(ca, cb)].append((L, x, y0))
    # ---- contacts between slopes and flats --------------------------------
    contacts = defaultdict(list)  # (slope, flat) -> [(x, y)] pixels on the slope adjacent to the flat
    for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
        sh = np.roll(np.roll(labels, dy, axis=0), dx, axis=1)
        m = (labels > 0) & (sh > 0) & (labels != sh)
        ys, xs = np.where(m)
        for yy, xx in zip(ys, xs):
            c1 = int(labels[yy, xx]); c2 = int(sh[yy, xx])
            if kind[c1] == 'slope' and kind[c2] == 'flat':
                contacts[(c1, c2)].append((xx, yy))
            elif kind[c1] == 'flat' and kind[c2] == 'flat':
                # touching flats -> equal height relation (rare; grid lines usually merge them)
                rel_votes[(c1, c2)].append((0, xx, yy))

    # ---- slope grade from tile foreshortening -------------------------------
    # along a column, dark grid-line pixels repeat every (4 - gS) px; flat floors -> 4 px
    line_dark = mask_of(a, cfg.get('grid', []))
    slope_gs = {}
    for cid, kd in kind.items():
        if kd != 'slope':
            continue
        m = labels == cid
        ys, xs = np.where(m)
        if len(xs) < 40:
            continue
        gaps = []
        for x in np.unique(xs):
            col_idx = ys[xs == x]
            y0, y1 = col_idx.min(), col_idx.max()
            if y1 - y0 < 8:
                continue
            seg = line_dark[y0:y1 + 1, x]
            pos = np.where(seg)[0]
            if len(pos) < 2:
                continue
            # collapse runs of consecutive dark pixels to their first pixel
            starts = pos[np.r_[True, np.diff(pos) > 1]]
            g = np.diff(starts)
            gaps.extend(int(v) for v in g if 2 <= v <= 24)
        if len(gaps) >= 6:
            spacing = float(np.median(gaps))
            slope_gs[cid] = round(4.0 - spacing, 2)

    # ---- solve flat heights -------------------------------------------------
    z = {}
    for anc in cfg['anchors']:
        cid = int(labels[anc['y'], anc['x']])
        if cid == 0:
            print(f"anchor at {anc['x']},{anc['y']} is not on a floor!"); continue
        if kind[cid] != 'flat':
            print(f"anchor at {anc['x']},{anc['y']} is on SLOPE comp #{cid}; anchors must be on flat comps"); continue
        z[cid] = float(anc['z'])
        print(f"anchor -> comp #{cid} z={anc['z']}")
    # relations between flats only, with median L
    rel = {}
    for (ca, cb), votes in rel_votes.items():
        if kind[ca] != 'flat' or kind[cb] != 'flat':
            continue
        Ls = sorted(v[0] for v in votes)
        rel[(ca, cb)] = (Ls[len(Ls) // 2], len(Ls))
    # manual relations
    for r in cfg.get('relations', []):
        ca = int(labels[r['above'][1], r['above'][0]]); cb = int(labels[r['below'][1], r['below'][0]])
        rel[(ca, cb)] = (r['L'], 999)
    small = {c for c in kind if kind[c] == 'flat' and (labels == c).sum() < cfg.get('trustArea', 250)}
    def solve_lsq(rel, z_anchor):
        ids = sorted(c for c, k in kind.items() if k == 'flat' and c not in small)
        idx = {c: i for i, c in enumerate(ids)}
        rows, rhs, wts = [], [], []
        for (ca, cb), (L, cnt) in rel.items():
            if ca not in idx or cb not in idx:
                continue
            r = np.zeros(len(ids)); r[idx[ca]] = 1; r[idx[cb]] = -1
            rows.append(r); rhs.append(L); wts.append(np.sqrt(min(cnt, 60)))
        for c, zz in z_anchor.items():
            if c not in idx: continue
            r = np.zeros(len(ids)); r[idx[c]] = 1
            rows.append(r); rhs.append(zz); wts.append(50.0)
        if not rows:
            return {}, {}
        A = np.array(rows) * np.array(wts)[:, None]
        b = np.array(rhs, float) * np.array(wts)
        # connectivity: only comps reachable from an anchor are determined
        reach = set(z_anchor)
        changed = True
        while changed:
            changed = False
            for (ca, cb) in rel:
                if (ca in reach) != (cb in reach) and ca in idx and cb in idx:
                    reach |= {ca, cb}; changed = True
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
        zz = {c: float(sol[idx[c]]) for c in ids if c in reach}
        res = {}
        for (ca, cb), (L, cnt) in rel.items():
            if ca in zz and cb in zz:
                res[(ca, cb)] = (zz[ca] - zz[cb]) - L
        return zz, res

    dropped = []
    while True:
        z_solved, res = solve_lsq(rel, z)
        if not res:
            break
        worst = max(res.items(), key=lambda kv: abs(kv[1]))
        if abs(worst[1]) <= 2.5:
            break
        dropped.append((worst[0], rel[worst[0]], worst[1]))
        del rel[worst[0]]
    for (pair, (L, cnt), r) in dropped:
        ys, xs = np.where(labels == pair[0]); ys2, xs2 = np.where(labels == pair[1])
        print(f"dropped relation {pair[0]}(at {int(xs.mean())},{int(ys.mean())}) above {pair[1]}(at {int(xs2.mean())},{int(ys2.mean())}) L={L} n={cnt} residual {r:+.1f}")
    z.update({c: round(v) for c, v in z_solved.items()})
    # small comps: take the relation with most votes to a solved comp
    for c in small:
        if c in z: continue
        best = None
        for (ca, cb), (L, cnt) in rel.items():
            if ca == c and cb in z and (best is None or cnt > best[0]): best = (cnt, z[cb] + L)
            if cb == c and ca in z and (best is None or cnt > best[0]): best = (cnt, z[ca] - L)
        if best: z[c] = round(best[1])
    conflicts = []

    # propagate through slopes whose grade is known from foreshortening (gD assumed 0):
    # z_slope(x,y) = z_ref + gS * (S - S_ref) with S = (y + z)/4 -> solve for z at a pixel
    def slope_z_at(gS, z_ref, y_ref, y):
        # S_ref = (y_ref + z_ref)/4 ; z = z_ref + gS*((y+z)/4 - S_ref) -> z(1 - gS/4) = z_ref + gS*((y/4) - S_ref)
        S_ref = (y_ref + z_ref) / 4.0
        return (z_ref + gS * (y / 4.0 - S_ref)) / (1 - gS / 4.0)
    manual_g = {int(labels[o['at'][1], o['at'][0]]): o['gS'] for o in cfg.get('slopeGrade', [])}
    slope_gs.update(manual_g)
    progress = True
    while progress:
        progress = False
        for cid in [c for c, k in kind.items() if k == 'slope']:
            if cid not in slope_gs:
                continue
            gS = slope_gs[cid]
            refs = [(cf, pix) for (cs, cf), pix in contacts.items() if cs == cid and cf in z]
            if not refs:
                continue
            cf0, pix0 = refs[0]
            # reference: mean contact pixel with the known flat
            y_ref = float(np.mean([p[1] for p in pix0])); z_ref = z[cf0]
            for (cs, cf), pix in contacts.items():
                if cs != cid or cf in z:
                    continue
                yb = float(np.mean([p[1] for p in pix]))
                z[cf] = round(slope_z_at(gS, z_ref, y_ref, yb))
                progress = True
        # re-run wall relation BFS with the new knowledge
        for (ca, cb), (L, cnt) in rel.items():
            if ca in z and cb not in z:
                z[cb] = z[ca] - L; progress = True
            elif cb in z and ca not in z:
                z[ca] = z[cb] + L; progress = True

    seen = set()
    for c in conflicts:
        if c[:2] in seen: continue
        seen.add(c[:2])
        ys, xs = np.where(labels == c[0]); ys2, xs2 = np.where(labels == c[1])
        print(f"conflict: comp {c[0]} (at {int(xs.mean())},{int(ys.mean())}) above {c[1]} (at {int(xs2.mean())},{int(ys2.mean())}): wall says {c[2]} (n={c[3]}) but solved diff {c[4]:.1f}")
    unknown_flats = [c for c in kind if kind[c] == 'flat' and c not in z]

    # ---- slopes: affine fit -------------------------------------------------
    comps = []
    slope_params = {}
    for cid, kd in kind.items():
        if kd != 'slope':
            continue
        pts = []
        for (cs, cf), pix in contacts.items():
            if cs != cid or cf not in z:
                continue
            for (xx, yy) in pix:
                pts.append((xx, yy, z[cf]))
        for (ca, cb), votes in rel_votes.items():
            if ca == cid and cb in z:
                for (L, xx, yy) in votes:
                    pts.append((xx, yy - 1, z[cb] + L))
            if cb == cid and ca in z:
                for (L, xx, yy) in votes:
                    pts.append((xx, yy + L, z[ca] - L))
        params = None
        for o in cfg.get('slopes', []):
            if int(labels[o['at'][1], o['at'][0]]) == cid:
                params = (o['a'], o['b'], o['c']); break
        distinct_z = len(set(round(p[2]) for p in pts))
        if params is None and cid in slope_gs and distinct_z < 2 and pts:
            gS = slope_gs[cid]
            y_ref = float(np.mean([p[1] for p in pts])); z_ref = float(np.mean([p[2] for p in pts]))
            # z = a + c*y with c = gS/(4 - gS) ; a chosen so that z(y_ref) = z_ref
            c_ = gS / (4.0 - gS)
            params = (z_ref - c_ * y_ref, 0.0, c_)
        if params is None and len(pts) >= 3 and distinct_z >= 2:
            P = np.array(pts, float)
            # fit z = a + b x + c y ; regularize toward small b (most ramps descend along y)
            A = np.c_[np.ones(len(P)), P[:, 0], P[:, 1]]
            lam = 1e-3
            AtA = A.T @ A + lam * np.diag([0, 1, 1])
            sol = np.linalg.solve(AtA, A.T @ P[:, 2])
            params = tuple(float(v) for v in sol)
            # sanity: a ramp cannot be steeper than vertical in this projection (c > -1)
            if params[2] <= -0.95:
                params = (params[0], params[1], -0.9)
        if params is None:
            params = (float(np.mean([p[2] for p in pts])) if pts else 0.0, 0.0, 0.0)
            print(f'slope comp {cid}: insufficient contacts ({len(pts)}), grade {slope_gs.get(cid)}, using flat z={params[0]:.1f}')
        slope_params[cid] = params

    def comp_at(x, y, radius=6):
        cid = int(labels[y, x])
        if cid:
            return cid
        best, bd = 0, 1e9
        for yy in range(max(0, y - radius), min(H, y + radius + 1)):
            for xx in range(max(0, x - radius), min(W, x + radius + 1)):
                c = int(labels[yy, xx])
                if c and (xx - x) ** 2 + (yy - y) ** 2 < bd:
                    best, bd = c, (xx - x) ** 2 + (yy - y) ** 2
        return best

    # ---- manual overrides (win over the automatic solve) -------------------
    overridden = set()
    pieces_override = {}
    centroids = {}
    for cid in list(kind):
        m = labels == cid
        if m.any():
            ys_, xs_ = np.where(m); centroids[cid] = (int(xs_.mean()), int(ys_.mean()))
    expanded = []
    for o in cfg.get('heights', []):
        if 'rect' in o:
            x0, y0, x1, y1 = o['rect']
            for cid, (cx, cy) in centroids.items():
                if x0 <= cx <= x1 and y0 <= cy <= y1:
                    e = dict(o); e['at'] = [cx, cy]; e['_rect'] = True; expanded.append(e)
        else:
            expanded.append(o)
    for o in expanded:
        cid = comp_at(o['at'][0], o['at'][1])
        if cid == 0:
            print(f"heights: pixel {o['at']} is not near a floor component"); continue
        exact = int(labels[o['at'][1], o['at'][0]]) == cid
        if not o.get('_rect') and (not exact or (labels == cid).sum() > 5000):
            ys_, xs_ = np.where(labels == cid)
            print(f"heights: {o['at']} -> comp #{cid} {kind[cid]} area {len(xs_)} centroid ({int(xs_.mean())},{int(ys_.mean())}){'' if exact else '  (NEAREST, check!)'}")
        overridden.add(cid)
        if 'pieces' in o:
            # piecewise by map y: each piece {yMax?, z} or {yMax?, pts}
            pcs = []
            for pc in o['pieces']:
                if 'z' in pc:
                    pcs.append({'yMax': pc.get('yMax', 1e9), 'a': float(pc['z']), 'b': 0.0, 'c': 0.0})
                else:
                    P = np.array(pc['pts'], float)
                    (x0, y0, z0), (x1, y1, z1) = P[0], P[1]
                    dx, dy = x1 - x0, y1 - y0
                    if abs(dy) > abs(dx) * 0.2:
                        c_ = (z1 - z0) / dy; b_ = 0.0
                    else:
                        b_ = (z1 - z0) / dx; c_ = 0.0
                    pcs.append({'yMax': pc.get('yMax', 1e9), 'a': float(z0 - b_ * x0 - c_ * y0), 'b': float(b_), 'c': float(c_)})
            pieces_override[cid] = pcs
            kind[cid] = 'slope'; slope_params[cid] = (pcs[0]['a'], pcs[0]['b'], pcs[0]['c']); z.pop(cid, None)
            continue
        if 'z' in o:
            if kind[cid] == 'slope':
                slope_params[cid] = (float(o['z']), 0.0, 0.0)
            else:
                z[cid] = float(o['z'])
        elif 'pts' in o:
            P = np.array(o['pts'], float)
            if len(P) >= 3:
                A = np.c_[np.ones(len(P)), P[:, 0], P[:, 1]]
                sol, *_ = np.linalg.lstsq(A, P[:, 2], rcond=None)
                params = tuple(float(v) for v in sol)
            else:
                # two points: plane through both with no sideways (D) tilt.
                # In map space a no-D-tilt plane is z = a + b x + c y with b = c/2 * ... simplest: fit along the segment
                (x0, y0, z0), (x1, y1, z1) = P[0], P[1]
                dx, dy = x1 - x0, y1 - y0
                if abs(dy) > abs(dx) * 0.2:
                    c_ = (z1 - z0) / dy; b_ = 0.0
                else:
                    b_ = (z1 - z0) / dx; c_ = 0.0
                params = (z0 - b_ * x0 - c_ * y0, b_, c_)
            if kind[cid] == 'slope':
                slope_params[cid] = params
            else:
                # a flat comp declared sloped: convert it
                kind[cid] = 'slope'; slope_params[cid] = params; z.pop(cid, None)

    # ---- report --------------------------------------------------------------
    print('\ncomponents (id kind centroid area height | wall relations above/below):')
    rows = []
    for cid, kd in kind.items():
        m = labels == cid
        if not m.any():
            continue
        ys, xs = np.where(m)
        cx, cy = int(xs.mean()), int(ys.mean())
        if kd == 'flat':
            hz = f"z={z[cid]:.0f}" if cid in z else 'z=?'
        else:
            a_, b_, c_ = slope_params.get(cid, (0, 0, 0))
            hz = f"slope z@c={a_ + b_ * cx + c_ * cy:.0f} b={b_:.2f} c={c_:.2f} g={slope_gs.get(cid, '?')}"
        rels = []
        for (ca, cb), votes in rel_votes.items():
            if ca == cid: rels.append(f"above {cb} L{sorted(v[0] for v in votes)[len(votes)//2]} n{len(votes)}")
            if cb == cid: rels.append(f"below {ca} L{sorted(v[0] for v in votes)[len(votes)//2]} n{len(votes)}")
        bb = f"[{xs.min()}-{xs.max()},{ys.min()}-{ys.max()}]"
        rows.append((cy, f"  #{cid:3d} {kd:5s} ({cx:3d},{cy:3d}) {bb:18s} a{int(m.sum()):6d} {hz}{' *' if cid in overridden else ''} | {'; '.join(rels)}"))
    for _, line in sorted(rows):
        print(line)

    for cid, kd in sorted(kind.items()):
        m = labels == cid
        if not m.any():
            continue
        ys, xs = np.where(m)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
        if kd == 'flat':
            zz = z.get(cid)
            comps.append({'id': cid, 'kind': kd, 'a': zz if zz is not None else None, 'b': 0.0, 'c': 0.0, 'area': int(m.sum()), 'bbox': bbox})
        else:
            a_, b_, c_ = slope_params[cid]
            entry = {'id': cid, 'kind': kd, 'a': a_, 'b': b_, 'c': c_, 'area': int(m.sum()), 'bbox': bbox}
            if cid in pieces_override:
                entry['pieces'] = pieces_override[cid]
            comps.append(entry)

    known = [c for c in comps if c['a'] is not None]
    print(f"stage {n}: {nf} flat + {ns} slope components; {len(unknown_flats)} flats unsolved: {unknown_flats[:30]}")
    for c in unknown_flats[:30]:
        ys, xs = np.where(labels == c)
        if len(xs):
            print(f"   unsolved flat {c}: area {len(xs)} around ({int(xs.mean())},{int(ys.mean())})")

    out_dir = os.path.join(ROOT, 'www', 'assets', 'stages')
    lab_img = Image.fromarray(labels.astype(np.uint8), 'L')
    lab_img.save(os.path.join(out_dir, f'stage{n}.labels.png'))
    with open(os.path.join(out_dir, f'stage{n}.comps.json'), 'w') as f:
        json.dump({'width': W, 'height': H, 'components': known}, f)
    print('wrote labels + comps ->', out_dir)

    if args.debug:
        S = 4
        big = img.resize((W * S, H * S), Image.NEAREST).convert('RGBA')
        ov = Image.new('RGBA', big.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        zs = sorted(c['a'] for c in known if c['kind'] == 'flat')
        zmin, zmax = (zs[0], zs[-1]) if zs else (0, 1)
        col_img = np.zeros((H, W, 4), np.uint8)
        for c in comps:
            m = labels == c['id']
            if c['a'] is None:
                rgb = (255, 0, 255)
            else:
                zc = c['a'] if c['kind'] == 'flat' else c['a'] + c['b'] * (c['bbox'][0] + c['bbox'][2]) / 2 + c['c'] * (c['bbox'][1] + c['bbox'][3]) / 2
                t = 0 if zmax == zmin else min(1, max(0, (zc - zmin) / (zmax - zmin)))
                r, g, b = colorsys.hsv_to_rgb(0.7 * (1 - t), 1, 1)
                rgb = (int(r * 255), int(g * 255), int(b * 255))
            col_img[m] = (*rgb, 110 if c['kind'] == 'flat' else 160)
        ov_small = Image.fromarray(col_img, 'RGBA').resize((W * S, H * S), Image.NEAREST)
        ov = Image.alpha_composite(ov, ov_small)
        d = ImageDraw.Draw(ov)
        for c in comps:
            m = labels == c['id']
            ys, xs = np.where(m)
            cx, cy = xs.mean() * S, ys.mean() * S
            if c['a'] is None:
                txt = f"#{c['id']} ?"
            elif c['kind'] == 'flat':
                txt = f"#{c['id']} z{c['a']:.0f}"
            else:
                zc = c['a'] + c['b'] * cx / S + c['c'] * cy / S
                txt = f"#{c['id']} s z{zc:.0f} b{c['b']:.2f} c{c['c']:.2f} g{slope_gs.get(c['id'], '?')}"
            d.text((cx - 12, cy - 5), txt, fill=(255, 255, 255, 255))
            d.text((cx - 11, cy - 4), txt, fill=(0, 0, 0, 255))
        out = Image.alpha_composite(big, ov)
        os.makedirs(os.path.join(ROOT, 'artifacts', 'levels'), exist_ok=True)
        step = 200
        k = 0
        for y0 in range(0, H, step):
            crop = out.crop((0, y0 * S, W * S, min(H, y0 + step + 10) * S))
            op = os.path.join(ROOT, 'artifacts', 'levels', f'stage{n}_hm_{k}.png')
            crop.save(op); k += 1
        print(f'debug overlays -> artifacts/levels/stage{n}_hm_0..{k-1}.png')


if __name__ == '__main__':
    main()
