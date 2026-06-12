#!/usr/bin/env python3
"""One-off helper: trace the colored racing line out of a circuit map PNG.

Extracts pixels matching the sector-line colors, keeps the largest connected
component, clusters them into small grid cells, orders the cell centroids by
nearest-neighbor walk, and prints an ordered loop of image-pixel coordinates.
"""
import sys
import json
from PIL import Image

path = sys.argv[1]
img = Image.open(path).convert("RGB")
W, H = img.size
px = img.load()

def is_track(r, g, b):
    # sector red (#e0383f-ish): strong red, low green/blue
    if r > 170 and g < 110 and b < 110 and abs(g - b) < 60:
        return True
    # sector cyan (#3bbece-ish): green+blue high, red low
    if r < 130 and g > 150 and b > 160:
        return True
    # sector yellow (#f0c93c-ish): red+green high, blue low
    if r > 190 and g > 160 and b < 120:
        return True
    return False

mask = set()
for y in range(H):
    for x in range(W):
        r, g, b = px[x, y]
        if is_track(r, g, b):
            mask.add((x, y))
print(f"mask pixels: {len(mask)}", file=sys.stderr)

# connected components (8-connectivity, BFS); keep all big ones — the loop is
# split by finish-line marks / DRS overlays. Drop small blobs (legend swatches).
seen = set()
best = []
for p in mask:
    if p in seen:
        continue
    comp = []
    stack = [p]
    seen.add(p)
    while stack:
        cx, cy = stack.pop()
        comp.append((cx, cy))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                q = (cx + dx, cy + dy)
                if q in mask and q not in seen:
                    seen.add(q)
                    stack.append(q)
    if len(comp) >= 400:
        ys = [c[1] for c in comp]
        if min(ys) > 0.88 * H:
            continue  # legend row at the bottom
        best.extend(comp)
print(f"kept component pixels: {len(best)}", file=sys.stderr)

# cluster into grid cells (cell size ~ line thickness) -> centroids
CELL = 7
cells = {}
for x, y in best:
    key = (x // CELL, y // CELL)
    cells.setdefault(key, []).append((x, y))
cents = []
for pts in cells.values():
    cents.append((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
print(f"centroids: {len(cents)}", file=sys.stderr)

# nearest-neighbor walk from leftmost centroid
cur = min(cents, key=lambda p: p[0])
remaining = set(range(len(cents)))
idx = {i: c for i, c in enumerate(cents)}
start_i = cents.index(cur)
order = [start_i]
remaining.discard(start_i)
while remaining:
    cx, cy = idx[order[-1]]
    bi, bd = None, None
    for i in remaining:
        x, y = idx[i]
        d = (x - cx) ** 2 + (y - cy) ** 2
        if bd is None or d < bd:
            bd, bi = d, i
    if bd > 60 ** 2:
        break  # huge gap — stop instead of jumping across the map
    order.append(bi)
    remaining.discard(bi)
print(f"walked: {len(order)} (left over: {len(remaining)})", file=sys.stderr)

loop = [idx[i] for i in order]

# light smoothing (moving average, window 5, closed loop)
n = len(loop)
sm = []
for i in range(n):
    xs = sum(loop[(i + k) % n][0] for k in range(-2, 3)) / 5
    ys = sum(loop[(i + k) % n][1] for k in range(-2, 3)) / 5
    sm.append((round(xs, 1), round(ys, 1)))

print(json.dumps(sm))
