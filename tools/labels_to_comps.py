#!/usr/bin/env python3
"""Turn a hand-painted label map from tools/labeler.html into runtime collision.

Input : <base>.labels8.png  (pixel value = layer index+1, 0 = unpainted) + <base>.labels.json (layers + heights)
Output: www/assets/stages/stage<N>.labels.png  (8-bit component id per pixel)
        www/assets/stages/stage<N>.comps.json   (affine z = a + b*x + c*y per component)

Each painted region of one height becomes flat components at that z. 'void' and 'wall' layers do not
become walkable floor. Then run tools/fit_slopes.py to turn terrace boundaries + Marigold slope
into kind:'slope' planes (do not repaint heights). Deterministic, pixel-exact, no resize.

  python3 tools/labels_to_comps.py <base> <stageN>
    e.g. python3 tools/labels_to_comps.py stage_1 1
"""
from __future__ import annotations
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: labels_to_comps.py <base-name-of-exported-files> <stage-number>"); sys.exit(2)
    base, stage = sys.argv[1], int(sys.argv[2])
    # find the exported files (look next to cwd, ~/Downloads, and the repo root)
    def find(name):
        for d in ('.', os.path.expanduser('~/Downloads'), ROOT):
            p = os.path.join(d, name)
            if os.path.exists(p): return p
        raise FileNotFoundError(name)
    idx = np.asarray(Image.open(find(base + '.labels8.png')).convert('RGB'))[..., 0].astype(int)
    man = json.load(open(find(base + '.labels.json')))
    H, W = idx.shape
    layers = {l['index']: l for l in man['layers']}

    # group painted pixels by HEIGHT (many layers can share a z). Close gridline/checker gaps so the individual
    # painted tiles merge into whole platforms instead of fragmenting into hundreds of 1-tile components.
    CLOSE = int(os.environ.get("MM_CLOSE", "3"))       # px to bridge between painted tiles of the same height
    # 1. Identify void, walls, and floor seeds
    void_layers = [l['index'] for l in man['layers'] if l['kind'] == 'void']
    void_mask = np.isin(idx, void_layers)
    wall_layers = [l['index'] for l in man['layers'] if l['kind'] == 'wall']
    wall_mask = np.isin(idx, wall_layers)
    floor_layers = [l['index'] for l in man['layers'] if l['kind'] in ('floor', 'ramp')]

    # Outer space is black in stage art
    img_path = find(f'Stage {stage}.png') if os.path.exists(find(f'Stage {stage}.png')) else None
    if img_path:
        img_arr = np.array(Image.open(img_path))
        is_black = (img_arr[..., :3].max(axis=2) <= 5) if img_arr.ndim == 3 else (img_arr <= 5)
        true_void = void_mask | is_black
    else:
        true_void = void_mask

    # Build initial floor height map from user seeds
    z_map = np.full((H, W), -999.0)
    for li in floor_layers:
        z_map[idx == li] = float(layers[li]['z'])

    # Propagate user elevation seeds to unpainted playable floor tiles
    known_floor = (z_map > -500)
    if known_floor.any():
        from scipy.ndimage import distance_transform_edt
        indices = distance_transform_edt(~known_floor, return_indices=True)[1]
        z_propagated = z_map[indices[0], indices[1]]
    else:
        z_propagated = np.full((H, W), 100.0)

    final_floor = (~true_void) & (~wall_mask)
    final_z = np.where(final_floor, z_propagated, -999.0)

    comps = []
    labels = np.zeros((H, W), np.uint8)
    cid = 1
    st = ndimage.generate_binary_structure(2, 2)

    # 1. Floors: descending by elevation so upper platforms claim their footprint before lower ground
    for z in sorted(np.unique(final_z[final_floor]), reverse=True):
        mask = final_floor & (final_z == z)
        if not mask.any():
            continue
        merged = ndimage.binary_closing(mask, structure=st, iterations=2)
        merged = ndimage.binary_fill_holes(merged)
        lab, n = ndimage.label(merged)
        for k in range(1, n + 1):
            blob = (lab == k) & (labels == 0) & (~wall_mask)
            area = int(blob.sum())
            if area < 16:
                continue
            if cid > 245:
                print(f"warning: stage {stage} reached cid {cid}, capping"); break
            labels[blob] = cid
            ys, xs = np.where(blob)
            comps.append({
                'id': cid, 'kind': 'flat', 'a': float(z), 'b': 0.0, 'c': 0.0,
                'area': area, 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
            })
            cid += 1

    # 2. Walls: assign physical elevation from adjacent floor, group by elevation
    z_map = np.full((H, W), -999.0)
    for c in comps:
        z_map[labels == c['id']] = c['a']

    z_dilated = ndimage.maximum_filter(z_map, size=7)
    wall_z = np.where(wall_mask, z_dilated, -999.0)
    assigned = wall_z[wall_mask & (wall_z > -500)]
    default_z = float(np.median(assigned)) if len(assigned) > 0 else 100.0
    wall_z[wall_mask & (wall_z < -500)] = default_z

    for z in sorted(np.unique(wall_z[wall_mask]), reverse=True):
        mask = wall_mask & (wall_z == z) & (labels == 0)
        if not mask.any():
            continue
        area = int(mask.sum())
        labels[mask] = cid
        ys, xs = np.where(mask)
        comps.append({
            'id': cid, 'kind': 'wall', 'a': float(z), 'b': 0.0, 'c': 0.0, 'wallH': 24,
            'area': area, 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
        })
        cid += 1

    out_dir = os.path.join(ROOT, 'www', 'assets', 'stages')
    os.makedirs(out_dir, exist_ok=True)
    Image.fromarray(labels, 'L').save(os.path.join(out_dir, f'stage{stage}.labels.png'))
    json.dump({'width': W, 'height': H, 'components': comps}, open(os.path.join(out_dir, f'stage{stage}.comps.json'), 'w'))

    floor_comps = [c for c in comps if c['kind'] == 'flat']
    wall_comps = [c for c in comps if c['kind'] == 'wall']
    print(f"stage {stage}: {len(floor_comps)} floors, {len(wall_comps)} wall groups ({len(comps)} total comps) from {base}")
    print(f"  Wall pixels active: {sum(c['area'] for c in wall_comps):,} px | Floor pixels: {sum(c['area'] for c in floor_comps):,} px")


if __name__ == '__main__':
    main()
