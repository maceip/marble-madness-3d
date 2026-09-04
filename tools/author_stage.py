#!/usr/bin/env python3
"""Author stage collision heights from a small spec instead of painting them.

The CV prefilter / labeler already say which pixels are FLOOR, WALL (cliff faces, rails, posts) and
VOID. What they cannot know is the height of each floor pixel. This tool takes that classification
and a spec (tools/stage_specs/stageN.json) of

  seeds:  [{ "name", "x", "y", "z" }]                 flat floors: one point somewhere on the floor
  paths:  [{ "name", "pts": [[x, y, z], ...] }]        ramps / chutes: centreline with heights
  floor:  [[x0, y0, x1, y1], ...] | polygons           force pixels to floor (decals painted as wall)
  wall:   [...]                                        force pixels to wall
  void:   [...]                                        force pixels to void
  anchors: { "name": z }                               (optional) override a seed's z after solving

Every floor pixel joins the seed / path it is geodesically closest to (BFS across floor pixels, so
a face or a void gap separates floors even when they touch on screen). A path gives z by projecting
the pixel onto its centreline (the engine's `path` kind), so a two-point path is a straight ramp.

Floor pixels not claimed by an explicit element get their height from the checkerboard itself
(tools/checker_heights.py): the pattern's vertical phase is z mod 8, unwrapped from a few anchors.

  checker: { "template": [x0,y0,x1,y1], "refZ": z, "anchors": [[x,y,z], ...] }
  seeds without "flat": true are anchors; seeds with "flat": true are explicit flat elements

It then measures the vertical faces between neighbouring elements (a WALL run in one column with
floor above and floor below: run length = height difference) and prints spec-vs-measured so the
heights can be checked against the art instead of guessed.

  python3 tools/author_stage.py 2            # write stage2.labels.png + stage2.comps.json
  python3 tools/author_stage.py 2 --check    # only report
  python3 tools/author_stage.py 2 --viz      # also write /tmp/author_s2.png (elements over the art)
"""
from __future__ import annotations
import argparse, json, os, sys
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGES = os.path.join(ROOT, 'www', 'assets', 'stages')
SPECS = os.path.join(ROOT, 'tools', 'stage_specs')

FLOOR, WALL, VOID = 1, 2, 0


def load(n: int):
    lab = np.asarray(Image.open(os.path.join(STAGES, f'stage{n}.labels.png')).convert('RGBA'))[..., 0].copy()
    comps = json.load(open(os.path.join(STAGES, f'stage{n}.comps.json')))
    art = Image.open(os.path.join(STAGES, f'stage{n}.png')).convert('RGB')
    return lab, comps, art


def classify(lab: np.ndarray, comps: dict) -> np.ndarray:
    kind = np.zeros(lab.shape, np.uint8)
    for c in comps['components']:
        kind[lab == c['id']] = WALL if c['kind'] == 'wall' else FLOOR
    return kind


def poly_mask(shape, poly) -> np.ndarray:
    """poly: [x0,y0,x1,y1] box or [[x,y],...] polygon."""
    im = Image.new('L', (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(im)
    if len(poly) == 4 and all(isinstance(v, (int, float)) for v in poly):
        d.rectangle([poly[0], poly[1], poly[2], poly[3]], fill=1)
    else:
        d.polygon([tuple(p) for p in poly], fill=1)
    return np.asarray(im).astype(bool)


def _disc(r: int) -> np.ndarray:
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return (yy * yy + xx * xx) <= r * r


def raster_polyline(pts, shape) -> list[tuple[int, int]]:
    im = Image.new('L', (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(im)
    for a, b in zip(pts, pts[1:]):
        d.line([(a[0], a[1]), (b[0], b[1])], fill=1, width=3)
    if len(pts) == 1:
        d.point((pts[0][0], pts[0][1]), fill=1)
    ys, xs = np.nonzero(np.asarray(im))
    return list(zip(ys.tolist(), xs.tolist()))


def path_z(pts, x, y) -> float:
    best, z = float('inf'), pts[0][2]
    for p, q in zip(pts, pts[1:]):
        dx, dy = q[0] - p[0], q[1] - p[1]
        L2 = dx * dx + dy * dy or 1
        t = max(0.0, min(1.0, ((x - p[0]) * dx + (y - p[1]) * dy) / L2))
        ex, ey = p[0] + dx * t - x, p[1] + dy * t - y
        d = ex * ex + ey * ey
        if d < best:
            best, z = d, p[2] + (q[2] - p[2]) * t
    return z


def assign(kind: np.ndarray, elements: list[dict]) -> np.ndarray:
    """Multi-source BFS over floor pixels. Returns element index per pixel (-1 = unassigned floor)."""
    H, W = kind.shape
    owner = np.full((H, W), -1, np.int32)
    q = deque()
    for i, e in enumerate(elements):
        if e['kind'] == 'path':
            srcs = raster_polyline(e['pts'], kind.shape)
        else:
            # snap each seed point to the nearest floor pixel (seeds are read off the art by eye)
            srcs = []
            for sx, sy in e['pts']:
                best = None
                for r in range(0, 9):
                    for dy in range(-r, r + 1):
                        for dx in range(-r, r + 1):
                            if max(abs(dy), abs(dx)) != r:
                                continue
                            yy, xx = sy + dy, sx + dx
                            if 0 <= yy < H and 0 <= xx < W and kind[yy, xx] == FLOOR:
                                best = (yy, xx)
                                break
                        if best:
                            break
                    if best:
                        break
                if not best:
                    print(f"  ! seed {e['name']} at ({sx},{sy}) has no floor pixel within 8 px")
                else:
                    if best != (sy, sx):
                        print(f"  seed {e['name']} snapped ({sx},{sy}) -> ({best[1]},{best[0]})")
                    srcs.append(best)
        for y, x in srcs:
            if 0 <= y < H and 0 <= x < W and kind[y, x] == FLOOR and owner[y, x] < 0:
                owner[y, x] = i
                q.append((y, x))
    while q:
        y, x = q.popleft()
        o = owner[y, x]
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and kind[yy, xx] == FLOOR and owner[yy, xx] < 0:
                owner[yy, xx] = o
                q.append((yy, xx))
    return owner


def heights(kind, owner, elements) -> np.ndarray:
    H, W = kind.shape
    z = np.full((H, W), np.nan, np.float32)
    for i, e in enumerate(elements):
        m = owner == i
        if e['kind'] == 'path':
            ys, xs = np.nonzero(m)
            for y, x in zip(ys, xs):
                z[y, x] = path_z(e['pts'], x, y)
        else:
            z[m] = e['z']
    return z


def measure_faces(kind, owner, z, elements):
    """For each column: WALL run with floor above and floor below -> (upper elem, lower elem, run, z_above - z_below)."""
    H, W = kind.shape
    pairs: dict[tuple[int, int], list[tuple[int, float]]] = {}
    for x in range(W):
        y = 0
        while y < H:
            if kind[y, x] != WALL:
                y += 1
                continue
            y0 = y
            while y < H and kind[y, x] == WALL:
                y += 1
            y1 = y
            if y0 - 1 < 0 or y1 >= H or kind[y0 - 1, x] != FLOOR or kind[y1, x] != FLOOR:
                continue
            a, b = owner[y0 - 1, x], owner[y1, x]
            if a < 0 or b < 0 or y1 - y0 > 80:      # a tall run is a cliff into the void with some unrelated floor drawn below it
                continue
            pairs.setdefault((a, b), []).append((y1 - y0, float(z[y0 - 1, x] - z[y1, x]), x, y0))
    rows = []
    for (a, b), v in pairs.items():
        if len(v) < 6:
            continue
        runs = np.array([r for r, _, _, _ in v], float)
        dz = np.array([d for _, d, _, _ in v], float)
        xs = [x for _, _, x, _ in v]
        ys = [y for _, _, _, y in v]
        where = f'x{min(xs)}-{max(xs)} y{min(ys)}-{max(ys)}'
        rows.append((len(v), elements[a]['name'], elements[b]['name'], float(np.median(runs)), float(np.percentile(runs, 25)), float(np.percentile(runs, 75)), float(np.median(dz)), where))
    rows.sort(key=lambda r: -r[0])
    return rows


def load_classification(n: int, spec: dict, source: str | None):
    """FLOOR / WALL / VOID per pixel from a pristine copy of the painted labels (never from this tool's output)."""
    lab, comps, art = load(n)
    src_lab = os.path.join(SPECS, f'stage{n}.src.labels.png')
    src_comps = os.path.join(SPECS, f'stage{n}.src.comps.json')
    if source:
        lab = np.asarray(Image.open(source).convert('RGBA'))[..., 0].copy()
    elif os.path.exists(src_lab):
        lab = np.asarray(Image.open(src_lab).convert('RGBA'))[..., 0].copy()
        comps = json.load(open(src_comps))
    else:
        import shutil
        os.makedirs(SPECS, exist_ok=True)
        shutil.copy(os.path.join(STAGES, f'stage{n}.labels.png'), src_lab)
        shutil.copy(os.path.join(STAGES, f'stage{n}.comps.json'), src_comps)
        print(f'  kept pristine classification in {os.path.relpath(src_lab, ROOT)}')
    if spec.get('kindFrom'):
        l8 = np.asarray(Image.open(os.path.join(ROOT, spec['kindFrom'])).convert('L'))
        kind = np.where(l8 >= 3, FLOOR, np.where(l8 == 2, WALL, VOID)).astype(np.uint8)
    else:
        kind = classify(lab, comps)
    # floorColor: [{ "box": [x0,y0,x1,y1], "color": [r,g,b], "tol": 60 }] -> pixels of about that colour inside the
    # box (plus the tile seams between them) are floor: a white ramp / a coloured floor the prefilter never labelled
    rgb = np.asarray(art).astype(np.int32)
    from scipy import ndimage as _nd
    for fc in spec.get('floorColor', []):
        x0, y0, x1, y1 = fc['box']
        m = np.abs(rgb - np.array(fc['color'], np.int32)).sum(-1) <= int(fc.get('tol', 60))
        box = np.zeros(kind.shape, bool); box[y0:y1, x0:x1] = True
        m &= box
        m = _nd.binary_closing(m, structure=np.ones((5, 5), bool)) & box
        m = _nd.binary_fill_holes(m)
        m &= ~_nd.binary_dilation(kind == WALL, iterations=1) | (kind == VOID)
        kind[m & (kind != FLOOR)] = FLOOR
        print(f"  floorColor {fc['color']} in {fc['box']}: {int(m.sum())} px floor")
    for poly in spec.get('floor', []):
        kind[poly_mask(kind.shape, poly)] = FLOOR
    # solid paths: a painted ribbon (wavy chute, checkered strip) is floor across its whole width w, dark squares
    # and outline included, so the marble is not funnelled onto the bright squares only
    for p in spec.get('paths', []):
        if not p.get('solid'):
            continue
        r = max(1, int(round(p.get('w', 14) / 2)))
        m = np.zeros(kind.shape, bool)
        for y, x in raster_polyline([[float(a), float(b), float(c)] for a, b, c in p['pts']], kind.shape):
            if 0 <= y < kind.shape[0] and 0 <= x < kind.shape[1]:
                m[y, x] = True
        m = _nd.binary_dilation(m, structure=_disc(r))
        kind[m] = FLOOR
        print(f"  solid path {p['name']}: {int(m.sum())} px floor within {r} px of the centreline")
    for poly in spec.get('wall', []):
        kind[poly_mask(kind.shape, poly)] = WALL
    for poly in spec.get('void', []):
        kind[poly_mask(kind.shape, poly)] = VOID
    # shadows painted black inside a floor (pit bottoms, the dark side of a block): black pixels inside these
    # boxes that do not touch the box border are floor, not the abyss
    from scipy import ndimage
    for poly in spec.get('holes', []):
        box = poly_mask(kind.shape, poly)
        v = (kind == VOID) & box
        lb, nl = ndimage.label(v)
        edge = box & ~ndimage.binary_erosion(box)
        touching = set(np.unique(lb[edge & v]).tolist()) - {0}
        for i in range(1, nl + 1):
            if i not in touching:
                kind[lb == i] = FLOOR
    # slivers: a floor strip under 3 px wide squeezed between wall pixels is a block's vertical edge highlight
    # (grey, so the prefilter took it for floor), not a place to stand; make it wall so nothing can wander in
    if spec.get('despeckle', True):
        fl = kind == FLOOR
        opened = ndimage.binary_opening(fl, structure=np.ones((3, 3), bool))
        sliver = fl & ~opened & ndimage.binary_dilation(kind == WALL, structure=np.ones((3, 3), bool))
        kind[sliver] = WALL
        print(f'  despeckle: {int(sliver.sum())} sliver floor px -> wall')
    return kind, art


def build_elements(spec: dict):
    """Explicit overrides: `paths` (ramps / chutes with a centreline) and seeds marked "flat": true."""
    elements = []
    for s in spec.get('seeds', []):
        if not s.get('flat'):
            continue
        pts = [[int(a), int(b)] for a, b in s['pts']] if 'pts' in s else [[int(s['x']), int(s['y'])]]
        elements.append({'kind': 'flat', 'name': s['name'], 'pts': pts, 'x': pts[0][0], 'y': pts[0][1], 'z': float(s['z']), 'w': s.get('w'), 'color': s.get('color'), 'tol': s.get('tol', 90)})
    for p in spec.get('paths', []):
        elements.append({'kind': 'path', 'name': p['name'], 'pts': [[float(a), float(b), float(c)] for a, b, c in p['pts']], 'w': p.get('w', 30), 'open': bool(p.get('open', False))})
    return elements


def assign_limited(kind: np.ndarray, elements: list[dict], art=None) -> np.ndarray:
    """Like assign(), but an element only claims floor pixels within its half-width `w` (geodesic) when set,
    and an element with `color` only claims pixels of about that colour (a teal / white / glass surface)."""
    H, W = kind.shape
    rgb = np.asarray(art).astype(np.int32) if art is not None else None
    passable = []
    for e in elements:
        if e.get('color') is not None and rgb is not None:
            c = np.array(e['color'], np.int32)
            passable.append(np.abs(rgb - c).sum(-1) <= int(e.get('tol', 90)))
        else:
            passable.append(None)
    owner = np.full((H, W), -1, np.int32)
    dist = np.full((H, W), 1e9, np.float32)
    q = deque()
    for i, e in enumerate(elements):
        if e['kind'] == 'path':
            # a centreline read off the art by eye wanders onto the painted tile seams / rails: snap every
            # rasterised point to the nearest floor pixel within 4 px so a thin ribbon still gets its sources
            srcs = []
            for y, x in raster_polyline(e['pts'], kind.shape):
                if not (0 <= y < H and 0 <= x < W):
                    continue
                if kind[y, x] == FLOOR:
                    srcs.append((y, x))
                    continue
                best = None
                for r in range(1, 5):
                    for dy in range(-r, r + 1):
                        for dx in range(-r, r + 1):
                            if max(abs(dy), abs(dx)) != r:
                                continue
                            yy, xx = y + dy, x + dx
                            if 0 <= yy < H and 0 <= xx < W and kind[yy, xx] == FLOOR:
                                best = (yy, xx)
                                break
                        if best:
                            break
                    if best:
                        break
                if best:
                    srcs.append(best)
        else:
            srcs = []
            for sx, sy in e['pts']:
                best = None
                for r in range(0, 9):
                    for dy in range(-r, r + 1):
                        for dx in range(-r, r + 1):
                            if max(abs(dy), abs(dx)) != r:
                                continue
                            yy, xx = sy + dy, sx + dx
                            if 0 <= yy < H and 0 <= xx < W and kind[yy, xx] == FLOOR:
                                best = (yy, xx)
                                break
                        if best:
                            break
                    if best:
                        break
                if not best:
                    print(f"  ! seed {e['name']} at ({sx},{sy}) has no floor pixel within 8 px")
                else:
                    srcs.append(best)
        for y, x in srcs:
            if 0 <= y < H and 0 <= x < W and kind[y, x] == FLOOR and owner[y, x] < 0:
                owner[y, x] = i
                dist[y, x] = 0
                q.append((y, x))
    while q:
        y, x = q.popleft()
        o = owner[y, x]
        lim = elements[o].get('w')
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and kind[yy, xx] == FLOOR and owner[yy, xx] < 0:
                nd = dist[y, x] + 1
                if lim is not None and nd > lim:
                    continue
                if passable[o] is not None and not passable[o][yy, xx]:
                    continue
                owner[yy, xx] = o
                dist[yy, xx] = nd
                q.append((yy, xx))
    return owner


def raster_heights(art, kind, owner, spec, anchors, viz_path=None):
    """Height of every floor pixel not owned by an explicit element, from the checkerboard phase."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import checker_heights as ch
    ck = spec['checker']
    gray = np.asarray(art.convert('L')).astype(np.float64)
    floor = (kind == FLOOR)
    T = ch.make_template(gray, ck['template'], int(ck['refZ']))
    d, conf = ch.phase_map(gray, floor, T, int(ck['refZ']), radius=int(ck.get('radius', 4)))
    raster = floor & (owner < 0)
    z = ch.unwrap(d, conf, raster, anchors, int(ck['refZ']), min_conf=float(ck.get('minConf', 0.08)), max_step=int(ck.get('maxStep', 2)))
    reached = int((~np.isnan(z) & raster).sum())
    print(f'  checker: {reached}/{int(raster.sum())} raster floor px unwrapped from {len(anchors)} anchor(s); '
          f'{int((raster & (conf < float(ck.get("minConf", 0.08)))).sum())} low-confidence px filled from neighbours')
    z = ch.fill_and_smooth(z, raster, iters=int(ck.get('smooth', 2)))
    if viz_path:
        pal = np.array([[255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [160, 0, 255], [255, 0, 255]])
        vis = (np.asarray(art) * 0.35).astype(np.uint8)
        m = d >= 0
        vis[m] = (vis[m] * 0.3 + pal[d[m]] * 0.7).astype(np.uint8)
        low = m & (conf < float(ck.get('minConf', 0.08)))
        vis[low] = (vis[low] * 0.5 + 128 * 0.5).astype(np.uint8)
        Image.fromarray(vis).save(viz_path)
    return z


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', type=int)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--viz', action='store_true')
    ap.add_argument('--source', help='labels png to classify from (default: the pristine copy next to the spec)')
    args = ap.parse_args()
    n = args.stage
    spec = json.load(open(os.path.join(SPECS, f'stage{n}.json')))
    kind, art = load_classification(n, spec, args.source)
    H, W = kind.shape

    elements = build_elements(spec)
    owner = assign_limited(kind, elements, art) if elements else np.full((H, W), -1, np.int32)
    z = np.full((H, W), np.nan, np.float32)
    for i, e in enumerate(elements):
        m = owner == i
        if e['kind'] == 'path':
            ys, xs = np.nonzero(m)
            for y, x in zip(ys, xs):
                z[y, x] = path_z(e['pts'], x, y)
        else:
            z[m] = e['z']

    names = [e['name'] for e in elements]
    if 'checker' in spec:
        anchors = [(int(a[0]), int(a[1]), float(a[2])) for a in spec['checker'].get('anchors', [])]
        zr = raster_heights(art, kind, owner, spec, anchors, viz_path=f'/tmp/phase_s{n}.png' if args.viz else None)
        raster = (kind == FLOOR) & (owner < 0)
        z = np.where(raster, zr, z)
        # non-flat seeds are checks: what did the checker say there?
        for s in spec.get('seeds', []):
            if s.get('flat'):
                continue
            pts = s['pts'] if 'pts' in s else [[s['x'], s['y']]]
            got = [zr[int(y), int(x)] for x, y in pts if 0 <= int(y) < H and 0 <= int(x) < W]
            got = [g for g in got if not np.isnan(g)]
            msg = ' '.join(f'{g:.0f}' for g in got) if got else 'n/a'
            flag = '' if got and all(abs(g - s['z']) <= 4 for g in got) else '   <-- check'
            print(f"  check {s['name']:18s} spec z{s['z']:<4} checker: {msg}{flag}")
        owner = np.where(raster & ~np.isnan(z), len(elements), owner)
        names.append('checker')
    unassigned = (kind == FLOOR) & (owner < 0)
    if unassigned.any():
        from scipy import ndimage
        lb, nl = ndimage.label(unassigned)
        sizes = ndimage.sum(np.ones_like(lb), lb, index=range(1, nl + 1))
        print(f'  {int(unassigned.sum())} floor px in {nl} island(s) got no height -> void:')
        for i in np.argsort(-sizes)[:20]:
            ys, xs = np.nonzero(lb == i + 1)
            print(f'    {int(sizes[i]):6d} px  bbox x{xs.min()}-{xs.max()} y{ys.min()}-{ys.max()}  centre ({int(xs.mean())},{int(ys.mean())})')
        kind[unassigned] = VOID

    # faces: measured run vs height difference of the floors above / below
    fake = [{'name': nm} for nm in names]
    print('faces (n, upper -> lower, run px median [q25,q75], dz from heights):')
    for nrow, a, b, med, q1, q3, dz, where in measure_faces(kind, owner, z, fake):
        flag = '' if abs(med - dz) <= 4 else '   <-- mismatch'
        print(f'  {nrow:5d}  {a:>12s} -> {b:<12s} run {med:5.1f} [{q1:.0f},{q3:.0f}]  dz {dz:6.1f}  @{where}{flag}')
    for i, nm in enumerate(names):
        m = owner == i
        if m.any():
            print(f'  #{i + 1:3d} {nm:18s} {int(m.sum()):6d} px  z {np.nanmin(z[m]):.0f}..{np.nanmax(z[m]):.0f}')

    if args.viz:
        # heights as a colour ramp over the art, walls magenta
        vis = np.asarray(art).copy()
        fl = (kind == FLOOR) & ~np.isnan(z)
        lo, hi = np.nanmin(z[fl]), np.nanmax(z[fl])
        t = (z - lo) / max(1, hi - lo)
        col = np.stack([255 * (1 - t), 255 * t, np.full_like(t, 90)], -1)
        vis[fl] = (vis[fl] * 0.3 + col[fl] * 0.7).astype(np.uint8)
        vis[kind == WALL] = (vis[kind == WALL] * 0.5 + np.array([255, 0, 255]) * 0.5).astype(np.uint8)
        im = Image.fromarray(vis)
        d = ImageDraw.Draw(im)
        for e in elements:
            if e['kind'] == 'path':
                d.line([(p[0], p[1]) for p in e['pts']], fill=(255, 255, 0), width=1)
        # contour labels every 16 px on a coarse grid
        for y in range(8, H, 24):
            for x in range(8, W, 32):
                if fl[y, x]:
                    d.text((x, y), str(int(round(z[y, x]))), fill=(255, 255, 255))
        im.save(f'/tmp/author_s{n}.png')
        print(f'  wrote /tmp/author_s{n}.png (+ /tmp/phase_s{n}.png)')

    if args.check:
        return

    # ---- write labels + comps ---------------------------------------------------------------------
    # R = component id; G,B = height * 16 (16-bit) for every floor pixel, read by the `raster` component
    out = np.zeros((H, W, 3), np.uint8)
    out_comps = []
    for i, e in enumerate(elements):
        cid = i + 2
        m = owner == i
        if not m.any():
            continue
        out[..., 0][m] = cid
        ys, xs = np.nonzero(m)
        c = {'id': cid, 'kind': e['kind'], 'a': 0.0, 'b': 0.0, 'c': 0.0, 'area': int(m.sum()), 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], 'name': e['name']}
        if e['kind'] == 'path':
            c['path'] = [{'x': p[0], 'y': p[1], 'z': p[2]} for p in e['pts']]
            c['a'] = e['pts'][0][2]
            if e.get('open'):
                c['open'] = True   # open ramp: the engine adds no half-pipe lip along its edges
        else:
            c['a'] = e['z']
        out_comps.append(c)
    rm = owner == len(elements)
    if rm.any():
        out[..., 0][rm] = 1
        ys, xs = np.nonzero(rm)
        out_comps.insert(0, {'id': 1, 'kind': 'raster', 'a': float(np.nanmedian(z[rm])), 'b': 0.0, 'c': 0.0, 'area': int(rm.sum()), 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], 'name': 'checker'})
    fl = (kind == FLOOR) & ~np.isnan(z)
    q = np.clip(np.round(z * 16), 0, 65535).astype(np.uint16)
    out[..., 1][fl] = (q[fl] >> 8).astype(np.uint8)
    out[..., 2][fl] = (q[fl] & 255).astype(np.uint8)
    wall_id = 254
    wm = kind == WALL
    out[..., 0][wm] = wall_id
    ys, xs = np.nonzero(wm)
    out_comps.append({'id': wall_id, 'kind': 'wall', 'a': 0.0, 'b': 0.0, 'c': 0.0, 'area': int(wm.sum()), 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], 'name': 'walls'})
    Image.fromarray(out, 'RGB').save(os.path.join(STAGES, f'stage{n}.labels.png'))
    json.dump({'width': W, 'height': H, 'components': out_comps}, open(os.path.join(STAGES, f'stage{n}.comps.json'), 'w'), indent=1)
    print(f'  wrote stage{n}.labels.png + stage{n}.comps.json ({len(out_comps)} components)')


if __name__ == '__main__':
    main()
