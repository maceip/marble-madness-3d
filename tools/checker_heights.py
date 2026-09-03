#!/usr/bin/env python3
"""Heights from the checkerboard.

Marble Madness floors are drawn with one isometric checker (16 px wide, 8 px tall diamonds) whose pattern
is a function of WORLD position: a floor at height z draws its pattern shifted up by z pixels. So the
vertical phase of the pattern at a map pixel gives z mod 8, and following that phase across a connected
floor (phase unwrapping) recovers the whole height field up to one anchor per connected floor: flats come
out flat, ramps come out as ramps, a raised rim comes out raised.

  phase_map(art, floor_mask, template_box, ref_z)  -> (d, conf)   d in 0..7 (z = ref_z + d mod 8), NaN/-1 where unknown
  unwrap(d, conf, floor_mask, anchors, ...)         -> z per pixel (NaN where no anchor reaches)
"""
from __future__ import annotations
import heapq
import numpy as np
from scipy import ndimage

PERIOD_X, PERIOD_Y = 16, 8


def make_template(gray: np.ndarray, box, ref_z: int) -> np.ndarray:
    """Mean gray per (x mod 16, (y + ref_z) mod 8) over a clean flat patch of known height."""
    x0, y0, x1, y1 = box
    T = np.zeros((PERIOD_X, PERIOD_Y))
    n = np.zeros((PERIOD_X, PERIOD_Y))
    for y in range(y0, y1):
        for x in range(x0, x1):
            T[x % PERIOD_X, (y + ref_z) % PERIOD_Y] += gray[y, x]
            n[x % PERIOD_X, (y + ref_z) % PERIOD_Y] += 1
    if not (n > 0).all():
        raise SystemExit('checker template box must cover at least 16x8 px')
    return T / n


def phase_map(gray: np.ndarray, floor: np.ndarray, template: np.ndarray, ref_z: int, radius: int = 4):
    """Per pixel: the vertical shift d (0..7) whose predicted pattern correlates best with the local window,
    using a masked normalised correlation over floor pixels (robust to a brighter / darker / tinted checker)."""
    H, W = gray.shape
    yy, xx = np.mgrid[0:H, 0:W]
    m = floor.astype(np.float64)
    size = 2 * radius + 1
    box = lambda a: ndimage.uniform_filter(a, size=size, mode='constant')
    n = box(m)
    g = gray.astype(np.float64) * m
    Eg = box(g) / np.maximum(n, 1e-9)
    Egg = box(g * g) / np.maximum(n, 1e-9)
    Vg = np.maximum(Egg - Eg * Eg, 1e-6)
    corr = np.zeros((PERIOD_Y, H, W))
    for d in range(PERIOD_Y):
        p = template[xx % PERIOD_X, (yy + ref_z + d) % PERIOD_Y] * m
        Ep = box(p) / np.maximum(n, 1e-9)
        Epp = box(p * p) / np.maximum(n, 1e-9)
        Egp = box(g * p) / np.maximum(n, 1e-9)
        Vp = np.maximum(Epp - Ep * Ep, 1e-6)
        corr[d] = (Egp - Eg * Ep) / np.sqrt(Vg * Vp)
    order = np.argsort(-corr, axis=0)
    best = order[0]
    c1 = np.take_along_axis(corr, order[0][None], 0)[0]
    c2 = np.take_along_axis(corr, order[1][None], 0)[0]
    conf = (c1 - c2) * (c1 > 0.3)
    # need enough floor pixels in the window to mean anything
    conf[n * size * size < 0.5 * size * size] = 0
    d = np.where(floor, best, -1).astype(np.int8)
    conf = np.where(floor, conf, 0).astype(np.float32)
    return d, conf


def unwrap(d: np.ndarray, conf: np.ndarray, floor: np.ndarray, anchors, ref_z: int, min_conf: float = 0.08, max_step: int = 2):
    """Quality-guided unwrapping: grow from the anchors, always expanding the most confident frontier pixel,
    z_next = z_cur + wrap8(d_next - (z_cur - ref_z)). Pixels below min_conf are left NaN (filled later)."""
    H, W = d.shape
    z = np.full((H, W), np.nan, np.float32)
    seen = np.zeros((H, W), bool)
    heap = []
    for x, y, az in anchors:
        # snap to the nearest confident floor pixel
        best = None
        for r in range(0, 10):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < H and 0 <= xx < W and floor[yy, xx] and conf[yy, xx] >= min_conf:
                        best = (yy, xx)
                        break
                if best:
                    break
            if best:
                break
        if not best:
            print(f'  ! anchor ({x},{y}) z{az}: no confident checker within 9 px')
            continue
        yy, xx = best
        # the anchor's own phase decides the exact z (anchor z may be off by a couple of px)
        delta = ((int(d[yy, xx]) - (az - ref_z)) % 8)
        if delta > 4:
            delta -= 8
        z[yy, xx] = az + delta
        seen[yy, xx] = True
        heapq.heappush(heap, (-float(conf[yy, xx]), yy, xx))
    while heap:
        _, y, x = heapq.heappop(heap)
        zc = z[y, x]
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if not (0 <= yy < H and 0 <= xx < W) or seen[yy, xx] or not floor[yy, xx] or conf[yy, xx] < min_conf:
                continue
            delta = (int(d[yy, xx]) - int(round(zc - ref_z))) % 8
            if delta > 4:
                delta -= 8
            if abs(delta) > max_step:
                continue          # a 3-4 px jump between neighbours is a texture glitch, not terrain: reach it another way
            z[yy, xx] = zc + delta
            seen[yy, xx] = True
            heapq.heappush(heap, (-float(conf[yy, xx]), yy, xx))
    return z


def fill_and_smooth(z: np.ndarray, floor: np.ndarray, iters: int = 2) -> np.ndarray:
    """Fill floor pixels the unwrap did not reach from their nearest reached pixel (within the floor), then
    median-smooth so flats are exactly flat and ramps are clean planes."""
    H, W = z.shape
    have = ~np.isnan(z) & floor
    need = np.isnan(z) & floor
    if need.any() and have.any():
        # geodesic nearest within floor: BFS from reached pixels
        from collections import deque
        q = deque()
        src = np.full((H, W), -1, np.int64)
        ys, xs = np.nonzero(have)
        for y, x in zip(ys, xs):
            src[y, x] = y * W + x
            q.append((y, x))
        while q:
            y, x = q.popleft()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < H and 0 <= xx < W and floor[yy, xx] and src[yy, xx] < 0:
                    src[yy, xx] = src[y, x]
                    q.append((yy, xx))
        m = need & (src >= 0)
        z = z.copy()
        z[m] = z.flat[src[m]]
    # median smoothing restricted to floor
    out = z.copy()
    for _ in range(iters):
        filled = np.where(floor, out, np.nan)
        # generic_filter with nanmedian is slow; use a 3x3 stack
        stack = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                s = np.full_like(filled, np.nan)
                ys0, ys1 = max(0, -dy), H - max(0, dy)
                xs0, xs1 = max(0, -dx), W - max(0, dx)
                s[ys0:ys1, xs0:xs1] = filled[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx]
                stack.append(s)
        med = np.nanmedian(np.stack(stack), axis=0)
        out = np.where(floor & ~np.isnan(med), med, out)
    return out
