#!/usr/bin/env python3
"""Stage 1 (Practice) height corrections on top of the labeler output.

Run after tools/labels_to_comps.py + tools/fit_slopes.py. Idempotent: components are found by a seed
pixel, not by id, so a re-labelled map keeps the fixes. Every value below was read off the art
(vertical face heights = z difference) rather than repainted:

  * plateau bits around the chute-mouth rails were painted 70 but are the 100 plateau
    (the rails stand on them; the 24 px faces below them drop to the 70 side areas)
  * tent-block top is 24 px above the plateau (tall faces), not level with it
  * tent side platforms are below the plateau (the funnel faces above them are 25-54 px), not level
  * the red/white bonus pads were painted as wall: they are floor on the 70 side areas

  python3 tools/patch_stage1.py
"""
from __future__ import annotations
import json, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB = os.path.join(ROOT, 'www', 'assets', 'stages', 'stage1.labels.png')
CMP = os.path.join(ROOT, 'www', 'assets', 'stages', 'stage1.comps.json')

# seed pixel -> corrected flat height
HEIGHTS = {
    (106, 301): 100,   # left of the chute mouth, above the left rail
    (39, 313): 100,    # left rail bits
    (75, 335): 100,
    (236, 296): 100,   # right of the chute mouth
    (225, 312): 100,   # right rail bits
    (160, 170): 112,   # cube steps in front of the tent block (10 px faces -> just too tall to climb)
    (30, 252): 70,     # left tent platform
    (217, 254): 70,    # right tent platform
    (127, 469): 40,    # slice of the goal corridor under the chute tongue, painted 70
}
# tent block top outline (map px): its side faces are 48-50 px over the 100 plateau. The labeler painted it
# as part of the slope band behind it, so the floor pixels inside become their own flat component.
BLOCK_TOP = [(137, 100), (95, 142), (137, 158), (180, 142)]
BLOCK_Z = 148
# the chute is an S-shaped half-pipe: no plane fits it. Centreline (map px) with heights, mouth -> exit tongue.
# Its white exit arm was painted as part of the 40 corridor (comp under CHUTE_EXIT_SEED); the 39 px face the art
# draws under the tongue says the tongue sits ~80 and the marble hops down onto the corridor.
CHUTE_SEED = (168, 340)
CHUTE_EXIT_SEED = (160, 440)
CHUTE_EXIT_MAX_Y = 455
# centreline of the labelled floor (row spans of the chute label): mouth, upper arm straight down at x~170,
# the bend opening left, the narrow neck at (129,410), the lower arm running down-right to the exit lip
# z: the funnel is the plateau's 100; the exit pixels touch the ledge's with no face between them, so the
# chute comes out level with the ledge (LEDGE_Z), which then drops ~26 onto the 40 corridor.
CHUTE = [(170, 296, 100), (170, 340, 95), (170, 380, 89), (140, 392, 85), (118, 398, 83), (129, 410, 79),
         (128, 420, 76), (145, 432, 72), (168, 442, 68), (188, 450, 66)]
# the S-bend's neck: the pipe's far wall hides the floor, so the labeler could only paint a 1-6 px sliver.
# Paint the hidden floor as chute along the centreline (over void / wall pixels only, never other floors).
NECK = [(150, 390), (120, 398), (128, 410), (128, 420), (145, 432), (165, 440)]
NECK_HALF_W = 8
# the orange striped triangle on the plateau's right edge: painted wall, but per pixel column it sits between
# two z=100 floors (plateau above, funnel below), which the wall builder reads as a 40 px rail. The plateau
# flows into the funnel there, so its wall pixels become funnel (chute) floor. Box: x0, y0, x1, y1
FUNNEL_FACE_BOX = (158, 218, 246, 294)
# the chute dumps onto a ledge (painted as corridor) that drops over the black ~26 px face onto the 40 corridor.
# Corridor-labelled pixels in this box become a flat ledge at LEDGE_Z; the face then reads as a cliff.
LEDGE_BOX = (144, 447, 202, 478)
LEDGE_Z = 66   # the black face below it is 24-28 px tall
# flat decals painted as wall: (x0, y0, x1, y1) boxes whose wall pixels become the enclosing floor
# (bonus pads, the two red arrows on the plateau, the GOAL sign)
PADS = [(214, 384, 258, 410), (8, 428, 54, 456), (210, 474, 256, 500),
        (18, 166, 92, 216), (184, 166, 262, 216), (14, 472, 118, 546)]
# unpainted pockets (drop shadows) fully enclosed by paint and smaller than this are floor, not pits
SHADOW_MAX_PX = 800


def main() -> None:
    lab = np.array(Image.open(LAB).convert('L'))
    doc = json.load(open(CMP))
    comps = {c['id']: c for c in doc['components']}
    changed = 0
    for (x, y), z in HEIGHTS.items():
        cid = int(lab[y, x])
        c = comps.get(cid)
        if not c or c['kind'] == 'wall':
            print(f'  seed ({x},{y}) is {"void" if not c else c["kind"]}, skipped')
            continue
        if c['kind'] != 'flat' or abs(c['a'] - z) > 0.01:
            print(f'  comp {cid} ({x},{y}) {c["kind"]} z {c["a"]:.0f} -> flat {z}')
            c['kind'] = 'flat'; c['a'] = float(z); c['b'] = 0.0; c['c'] = 0.0
            changed += 1
    wall_ids = {i for i, c in comps.items() if c['kind'] == 'wall'}

    # tent block top: floor pixels inside the outline become one flat component at BLOCK_Z
    from PIL import ImageDraw
    poly = Image.new('L', (lab.shape[1], lab.shape[0]), 0)
    ImageDraw.Draw(poly).polygon(BLOCK_TOP, fill=1)
    inside = np.array(poly).astype(bool)
    bid = next((i for i, c in comps.items() if c.get('name') == 'block_top'), None)
    if bid is None:
        bid = max(comps) + 1
        comps[bid] = {'id': bid, 'kind': 'flat', 'a': float(BLOCK_Z), 'b': 0.0, 'c': 0.0, 'area': 0, 'bbox': [0, 0, 0, 0], 'name': 'block_top'}
        doc['components'].append(comps[bid])
    m = inside & (lab != 0) & (lab != bid) & ~np.isin(lab, list(wall_ids))
    if m.any():
        print(f'  block top: {int(m.sum())} px -> comp {bid} z {BLOCK_Z}')
        lab[m] = bid
        changed += 1
    ys, xs = np.where(lab == bid)
    if len(xs):
        comps[bid]['bbox'] = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]

    # chute: one path component over the labeler's chute plus the white exit arm
    chute_id = int(lab[CHUTE_SEED[1], CHUTE_SEED[0]])
    exit_id = int(lab[CHUTE_EXIT_SEED[1], CHUTE_EXIT_SEED[0]])
    if chute_id and chute_id not in wall_ids:
        c = comps[chute_id]
        if exit_id and exit_id != chute_id and exit_id not in wall_ids:
            ys = np.arange(lab.shape[0])[:, None]
            m = (lab == exit_id) & (ys < CHUTE_EXIT_MAX_Y)
            if m.any():
                print(f'  chute exit arm: {int(m.sum())} px of comp {exit_id} -> chute {chute_id}')
                lab[m] = chute_id
                changed += 1
        # hidden floor through the neck
        H, W = lab.shape
        yy, xx = np.mgrid[0:H, 0:W]
        near = np.zeros_like(lab, dtype=bool)
        for (x0, y0), (x1, y1) in zip(NECK, NECK[1:]):
            dx, dy = x1 - x0, y1 - y0
            L2 = float(dx * dx + dy * dy) or 1.0
            t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / L2, 0.0, 1.0)
            d2 = (xx - (x0 + t * dx)) ** 2 + (yy - (y0 + t * dy)) ** 2
            near |= d2 <= NECK_HALF_W ** 2
        wall_mask = np.isin(lab, list(wall_ids))
        m = near & ((lab == 0) | wall_mask)
        if m.any():
            print(f'  chute neck: {int(m.sum())} hidden floor px -> chute {chute_id}')
            lab[m] = chute_id
            changed += 1
        # the plateau-to-funnel face: wall pixels in the box whose column touches the chute below become funnel
        bx0, by0, bx1, by1 = FUNNEL_FACE_BOX
        box = np.zeros_like(lab, dtype=bool); box[by0:by1, bx0:bx1] = True
        m = box & wall_mask
        if m.any():
            # only wall pixels with chute floor below them in the same column (inside the box): the face,
            # not the red rail along the funnel's right edge
            keep = np.zeros_like(m)
            for x in range(bx0, bx1):
                ys = np.where(m[:, x])[0]
                if not len(ys): continue
                chute_ys = np.where(lab[by0:by1, x] == chute_id)[0] + by0
                if not len(chute_ys): continue
                keep[ys[ys < chute_ys.max()], x] = True
            if keep.any():
                print(f'  funnel face: {int(keep.sum())} wall px -> chute {chute_id}')
                lab[keep] = chute_id
                changed += 1
        # exit ledge
        lx0, ly0, lx1, ly1 = LEDGE_BOX
        ledge = next((c for c in doc['components'] if c.get('name') == 'exit_ledge'), None)
        if ledge is None:
            nid = max(comps) + 1
            ledge = {'id': nid, 'kind': 'flat', 'a': float(LEDGE_Z), 'b': 0.0, 'c': 0.0, 'area': 0,
                     'bbox': [lx0, ly0, lx1, ly1], 'name': 'exit_ledge', 'z_hi': LEDGE_Z, 'z_lo': LEDGE_Z}
            doc['components'].append(ledge); comps[nid] = ledge
            print(f'  new comp {nid} exit_ledge z {LEDGE_Z}')
            changed += 1
        box = np.zeros_like(lab, dtype=bool); box[ly0:ly1, lx0:lx1] = True
        floor_ids = {i for i, c in comps.items() if c['kind'] != 'wall' and i not in (chute_id, ledge['id'])}
        m = box & np.isin(lab, list(floor_ids))
        if m.any():
            print(f'  exit ledge: {int(m.sum())} corridor px -> ledge {ledge["id"]}')
            lab[m] = ledge['id']
            changed += 1
        ledge['area'] = int((lab == ledge['id']).sum())
        path = [{'x': x, 'y': y, 'z': z} for (x, y, z) in CHUTE]
        if c.get('kind') != 'path' or c.get('path') != path:
            print(f'  chute comp {chute_id}: {c["kind"]} -> path with {len(path)} vertices')
            c['kind'] = 'path'; c['path'] = path; c['a'] = float(CHUTE[0][2]); c['b'] = 0.0; c['c'] = 0.0
            c.pop('pieces', None)
            changed += 1

    # drop shadows: small unpainted pockets enclosed by paint become the floor around them
    from scipy import ndimage
    holes = ndimage.binary_fill_holes(lab != 0) & (lab == 0)
    hl, n = ndimage.label(holes)
    filled = 0
    if n:
        floor_mask = (lab != 0) & ~np.isin(lab, list(wall_ids))
        idx = ndimage.distance_transform_edt(~floor_mask, return_indices=True)[1]
        nearest = lab[idx[0], idx[1]]
        for k in range(1, n + 1):
            pk = hl == k
            if pk.sum() > SHADOW_MAX_PX:
                continue
            lab[pk] = nearest[pk]
            filled += int(pk.sum())
    if filled:
        print(f'  shadows: {filled} px of enclosed unpainted pockets -> surrounding floor')
        changed += 1

    for (x0, y0, x1, y1) in PADS:
        box = lab[y0:y1, x0:x1]
        floor_ids = [int(v) for v in np.unique(box) if v and int(v) not in wall_ids]
        if not floor_ids:
            continue
        host = max(floor_ids, key=lambda i: int((box == i).sum()))
        m = np.isin(box, list(wall_ids))
        if m.any():
            print(f'  pad box {(x0, y0, x1, y1)}: {int(m.sum())} wall px -> floor {host}')
            box[m] = host
            changed += 1
    for c in comps.values():
        m = lab == c['id']
        c['area'] = int(m.sum())
    Image.fromarray(lab, 'L').save(LAB)
    json.dump(doc, open(CMP, 'w'))
    print(f'stage 1 patched ({changed} changes)')


if __name__ == '__main__':
    main()
