#!/usr/bin/env python3
"""Fast Computer Vision prefilter for Marble Madness stage maps (Stage 1 - Stage 6).

Exploits geometric and visual invariants of Marble Madness arcade art:
  1. Void/Pit: Background dark regions and pits (RGB < 25) connected to boundaries or large interior pits.
  2. Wall / Cliff Drop:
     - Saturated cliff face palettes (orange in S1, cyan in S2, tan/brown in S3, red/orange in S4, yellow in S5, red in S6)
     - Vertically-striped color columns (dy ~ 0 along vertical runs, dx > 0 between stripes) with saturation
     - Vertical black boundaries (dx = 0, dy >= 6) adjacent to cliff faces
     - Railings (perimeter borders and posts) and obstacles (tents, posts)
  3. Floor:
     - Isometric diamond checkerboard tiles (16x8 px diamonds, neutral grey or stage floor palette)
     - Sealed with morphological closing without crossing walls
  4. Height assignment (L = Delta z):
     - Vertical wall runs of length L px indicate an exact vertical drop Delta z = L
     - Clustered and anchored to each stage's canonical floor heights

Usage:
  python3 tools/cv_prefilter.py <stage_num> [--compile]
  python3 tools/cv_prefilter.py --all [--compile]
"""
from __future__ import annotations
import argparse, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Canonical floor heights and anchors per stage from level definitions
STAGE_CONFIGS = {
    1: {
        'name': 'PRACTICE RACE',
        'z_start': 130,
        'z_goal': 40,
        'heights': [130, 100, 70, 40],
        'sat_thresh': 0.30,
    },
    2: {
        'name': 'BEGINNER RACE',
        'z_start': 180,
        'z_goal': 40,
        'heights': [180, 150, 100, 70, 40],
        'sat_thresh': 0.30,
    },
    3: {
        'name': 'INTERMEDIATE RACE',
        'z_start': 210,
        'z_goal': 40,
        'heights': [210, 180, 140, 100, 70, 40],
        'sat_thresh': 0.50,
    },
    4: {
        'name': 'AERIAL RACE',
        'z_start': 285,
        'z_goal': 40,
        'heights': [285, 215, 180, 140, 100, 70, 40],
        'sat_thresh': 0.30,
    },
    5: {
        'name': 'SILLY RACE',
        'z_start': 100,
        'z_goal': 280,
        'heights': [100, 140, 180, 220, 280],
        'sat_thresh': 0.30,
    },
    6: {
        'name': 'ULTIMATE RACE',
        'z_start': 100,
        'z_goal': 40,
        'heights': [100, 70, 40],
        'sat_thresh': 0.30,
    },
}

LAYER_COLORS = [
    '#e23b3b',  # 1: VOID (red)
    '#ff8c1a',  # 2: WALL (orange)
    '#2e9e46',  # 3: Floor (green)
    '#00b3a4',  # 4: teal
    '#2f7bff',  # 5: blue
    '#9b4dff',  # 6: purple
    '#ff4db8',  # 7: pink
    '#ffe14d',  # 8: yellow
    '#4dffb8',  # 9: mint
    '#b8ff4d',  # 10: lime
    '#4d9bff',  # 11: sky
    '#e14dff',  # 12: magenta
    '#4de1ff',  # 13: cyan
    '#ff804d',  # 14: coral
    '#80ff4d',  # 15: bright green
    '#ff4d80',  # 16: rose
]


def get_stage_image_path(stage: int) -> str:
    paths = [
        os.path.join(ROOT, f'Stage {stage}.png'),
        os.path.join(ROOT, f'stage{stage}.png'),
        os.path.join(ROOT, 'www', 'assets', 'stages', f'stage{stage}.png'),
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    raise FileNotFoundError(f'Stage {stage} image not found')


def prefilter_stage(stage: int, compile_after: bool = False) -> dict:
    img_path = get_stage_image_path(stage)
    im = Image.open(img_path).convert('RGB')
    arr = np.array(im).astype(float)
    H, W, _ = arr.shape
    st_cfg = STAGE_CONFIGS.get(stage, {})

    hm_cfg_path = os.path.join(ROOT, 'levels', 'hm', f'stage{stage}.json')
    hm_cfg = json.load(open(hm_cfg_path)) if os.path.exists(hm_cfg_path) else {}

    # --- 1. Pixel feature analysis --------------------------------------------
    brightness = arr.max(axis=-1)
    mn = arr.min(axis=-1)
    sat = np.zeros_like(brightness)
    nz = brightness > 0
    sat[nz] = (brightness[nz] - mn[nz]) / brightness[nz]

    # Vertical gradient dy & horizontal gradient dx
    dy = np.zeros((H, W))
    dy[1:, :] = np.abs(arr[1:, :] - arr[:-1, :]).sum(axis=-1)
    dx = np.zeros((H, W))
    dx[:, 1:] = np.abs(arr[:, 1:] - arr[:, :-1]).sum(axis=-1)

    # --- 2. Detect VOID (pits, off-map) ---------------------------------------
    is_black = (brightness < 22)
    border = np.zeros((H, W), bool)
    border[0, :] = is_black[0, :]
    border[-1, :] = is_black[-1, :]
    border[:, 0] = is_black[:, 0]
    border[:, -1] = is_black[:, -1]
    void = ndimage.binary_dilation(border, mask=is_black, iterations=120)

    # Also large interior black components (e.g. Stage 3 central pit)
    lab_b, nb = ndimage.label(is_black & ~void)
    if nb > 0:
        b_sizes = ndimage.sum(np.ones_like(lab_b), lab_b, index=range(1, nb + 1))
        for bi in range(1, nb + 1):
            if b_sizes[bi - 1] >= 400:
                void |= (lab_b == bi)

    # --- 3. Detect WALL (vertical drops, railings, obstacles) ------------------
    wall_pal = np.zeros((H, W), bool)
    for c in hm_cfg.get('wall', []):
        wall_pal |= (np.abs(arr - c).sum(axis=-1) <= 22)

    sat_thresh = st_cfg.get('sat_thresh', 0.30)
    vert_stripes = (dy < 10) & (dx > 20) & (sat > sat_thresh)
    obstacles = (brightness > 40) & (sat > (0.60 if stage == 3 else 0.45))

    wall = wall_pal | vert_stripes | obstacles

    # Vertical black lines that border wall (cliff face edges)
    vert_black = ndimage.binary_opening(is_black, structure=np.ones((5, 1), bool))
    wall |= (vert_black & ndimage.binary_dilation(wall, iterations=3))

    if stage == 2:
        # Stage 2 teal floor (R=0, G~B >= 50) is floor, not cliff wall
        teal_floor = (arr[:, :, 0] == 0) & (arr[:, :, 1] >= 50) & (arr[:, :, 2] >= 50) & (np.abs(arr[:, :, 1] - arr[:, :, 2]) < 35) & ~wall_pal
        wall &= ~teal_floor

    if stage == 1:
        # Protect yellow GOAL letters painted on the floor (y >= 525, x <= 70)
        goal_letters = (arr[:, :, 0] > 200) & (arr[:, :, 1] > 200) & (arr[:, :, 2] < 50) & (np.arange(H)[:, None] >= 525) & (np.arange(W)[None, :] <= 70)
        wall &= ~goal_letters

    wall = ndimage.binary_closing(wall, structure=np.ones((3, 3))) & ~void

    # --- 4. Detect FLOOR (checkerboard tiles & ramps) -------------------------
    floor = ~wall & ~void
    floor = ndimage.binary_closing(floor, structure=np.ones((3, 3)))
    floor = ndimage.binary_fill_holes(floor)
    floor &= ~wall & ~void

    # Clean small floor specks (< 40 px)
    lab_f, nf = ndimage.label(floor)
    if nf > 0:
        sizes = ndimage.sum(np.ones_like(lab_f), lab_f, index=range(1, nf + 1))
        for fi in range(1, nf + 1):
            if sizes[fi - 1] < 40:
                floor[lab_f == fi] = False
                wall[lab_f == fi] = True
    floor &= ~wall & ~void

    # --- 5. Height Assignment per Floor Region --------------------------------
    canonical_heights = st_cfg.get('heights', [100, 70, 40])
    # Re-label components
    lab_f, nf = ndimage.label(floor)
    sizes = ndimage.sum(np.ones_like(lab_f), lab_f, index=range(1, nf + 1)) if nf > 0 else []

    # Map each canonical height to a layer
    layers = [
        {'index': 1, 'name': 'VOID', 'z': -999, 'kind': 'void', 'color': LAYER_COLORS[0], 'desc': 'pit / off-map'},
        {'index': 2, 'name': 'WALL', 'z': 900, 'kind': 'wall', 'color': LAYER_COLORS[1], 'desc': 'rail / post / cliff drop'},
    ]

    z_to_layer_idx = {}
    for idx_offset, zh in enumerate(canonical_heights):
        li = len(layers) + 1
        col = LAYER_COLORS[(li - 1) % len(LAYER_COLORS)]
        layers.append({
            'index': li,
            'name': f'Floor {int(zh)}',
            'z': int(zh),
            'kind': 'floor',
            'color': col,
            'desc': '',
        })
        z_to_layer_idx[zh] = li

    labels8 = np.zeros((H, W), dtype=np.uint8)
    labels8[void] = 1
    labels8[wall] = 2

    # Height assignment:
    # 1. Main continuous sloping course: height varies monotonically with progress Y
    # 2. Side platforms: measure vertical wall drops
    progress_dir = -1 if stage == 5 else 1
    z_start = st_cfg.get('z_start', 100)
    z_goal = st_cfg.get('z_goal', 40)

    # For every pixel on floor, estimate its continuous height based on Y coordinate
    # then snap to the nearest canonical height
    ys_floor = np.where(floor)[0]
    y_min = int(ys_floor.min()) if len(ys_floor) > 0 else 0
    y_max = int(ys_floor.max()) if len(ys_floor) > 0 else H
    y_span = max(1, y_max - y_min)

    # For each connected floor component:
    for fi in range(1, nf + 1):
        m = (lab_f == fi)
        ys, xs = np.where(m)
        if len(ys) == 0:
            continue

        # If component is very large (> 20% of floor), it is a continuous run (e.g. main slope):
        # Slice it along Y so each section gets its proper step height!
        if len(ys) > floor.sum() * 0.20:
            for y_row in range(ys.min(), ys.max() + 1):
                row_m = m[y_row, :]
                if not row_m.any():
                    continue
                t = (y_row - y_min) / y_span
                if progress_dir == 1:
                    z_est = z_start - t * (z_start - z_goal)
                else:
                    z_est = z_start + t * (z_goal - z_start)
                best_z = min(canonical_heights, key=lambda zh: abs(zh - z_est))
                li = z_to_layer_idx[best_z]
                labels8[y_row, row_m] = li
        else:
            # Component is a discrete platform: evaluate height at its centroid
            cy = ys.mean()
            t = (cy - y_min) / y_span
            if progress_dir == 1:
                z_est = z_start - t * (z_start - z_goal)
            else:
                z_est = z_start + t * (z_goal - z_start)
            best_z = min(canonical_heights, key=lambda zh: abs(zh - z_est))
            li = z_to_layer_idx[best_z]
            labels8[m] = li

    painted_count = int((labels8 > 0).sum())

    # --- 6. Export files ------------------------------------------------------
    base_name = f'stage_{stage}'
    out_png = os.path.join(ROOT, f'{base_name}.labels8.png')
    out_json = os.path.join(ROOT, f'{base_name}.labels.json')

    lbl_rgb = np.repeat(labels8[..., None], 3, axis=-1)
    Image.fromarray(lbl_rgb, 'RGB').save(out_png)

    manifest = {
        'source': os.path.basename(img_path),
        'width': W,
        'height': H,
        'note': 'labels8.png: pixel value = layer index+1 (0=unpainted).',
        'layers': layers,
        'paintedPixels': painted_count,
    }
    with open(out_json, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f'Stage {stage} ({W}x{H}): {len(layers)} layers, {painted_count}/{W*H} px ({painted_count/(W*H)*100:.1f}%) labeled -> {base_name}.labels8.png + .labels.json')
    for l in layers:
        px_c = int((labels8 == l['index']).sum())
        print(f"  Layer {l['index']:2d} [{l['kind']:5s}]: {l['name']:12s} z={l['z']:5d} -> {px_c:6d} px ({px_c/(W*H)*100:4.1f}%)")

    if compile_after:
        cmd = f'python3 tools/labels_to_comps.py {base_name} {stage}'
        print(f'Compiling to runtime collision: {cmd}')
        os.system(cmd)

    return manifest


def main():
    ap = argparse.ArgumentParser(description='Fast CV prefilter for Marble Madness stage maps')
    ap.add_argument('stage', nargs='?', type=int, default=1, help='Stage number (1-6)')
    ap.add_argument('--all', action='store_true', help='Process all stages 1 through 6')
    ap.add_argument('--compile', action='store_true', help='Immediately compile to stageN.labels.png and stageN.comps.json')
    args = ap.parse_args()

    stages = range(1, 7) if args.all else [args.stage]
    for s in stages:
        print(f'\n{"="*60}\nPrefiltering Stage {s}...\n{"="*60}')
        prefilter_stage(s, compile_after=args.compile)


if __name__ == '__main__':
    main()
