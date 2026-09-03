#!/usr/bin/env python3
"""Turn a hand-painted label map from tools/labeler.html into runtime collision.

Input : <base>.labels8.png  (pixel value = layer index+1, 0 = unpainted) + <base>.labels.json (layers + heights)
Output: www/assets/stages/stage<N>.labels.png  (8-bit component id per pixel)
        www/assets/stages/stage<N>.comps.json   (affine z = a + b*x + c*y per component)

Each painted region of one height becomes flat components at that z. 'ramp' layers are left flat at their z for a
first pass (paint ramps as short stepped bands, or we add gradient solving later). 'void' and 'wall' layers do not
become walkable floor components. Deterministic, pixel-exact, no resize.

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

    comps = []
    labels = np.zeros((H, W), np.uint8)
    cid = 1
    for li, layer in sorted(layers.items()):
        if layer['kind'] not in ('floor', 'ramp'):
            continue                                  # walls / void are not walkable floor
        mask = (idx == li)
        if not mask.any():
            continue
        # split disconnected painted blobs of the same height into separate components
        lab, n = ndimage.label(mask)
        for k in range(1, n + 1):
            blob = (lab == k)
            area = int(blob.sum())
            if area < 12:
                continue
            if cid > 255:
                print("warning: >255 components, truncating"); break
            labels[blob] = cid
            ys, xs = np.where(blob)
            comps.append({
                'id': cid, 'kind': 'flat', 'a': float(layer['z']), 'b': 0.0, 'c': 0.0,
                'area': area, 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
            })
            cid += 1

    out_dir = os.path.join(ROOT, 'www', 'assets', 'stages')
    os.makedirs(out_dir, exist_ok=True)
    Image.fromarray(labels, 'L').save(os.path.join(out_dir, f'stage{stage}.labels.png'))
    json.dump({'width': W, 'height': H, 'components': comps}, open(os.path.join(out_dir, f'stage{stage}.comps.json'), 'w'))
    print(f"stage {stage}: {len(comps)} components from {base}; wrote labels.png + comps.json ({W}x{H})")
    zs = sorted({c['a'] for c in comps})
    print("heights present:", zs)


if __name__ == '__main__':
    main()
