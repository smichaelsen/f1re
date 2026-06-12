#!/usr/bin/env python3
"""Turn a traced map loop (output of trace-overlay.py) into track control points.

Pipeline (the one that built Montmeló):
1. Orient the loop clockwise on screen (y-down) — real-world driving direction
   for most circuits.
2. Rotate so index 0 is the point nearest --start-px (finish line), and flip if
   needed so travel at the start heads in -x (west).
3. Douglas-Peucker simplify (--eps, image px): straights collapse to collinear
   endpoints (kills pixel-noise wobble), corners keep traced density.
4. Subdivide segments longer than --max-seg px so interior straight points stay
   collinear under the Catmull-Rom spline.
5. Convert to world coordinates: world = (px - image_center) * --scale.
6. Relax control points against the *sampled spline* until every spline
   triple's circumradius >= --min-radius (world units). Required because the
   asphalt offset polygons self-intersect when centerline curvature radius
   drops below the track half-width.

Usage:
  python3 scripts/trace-overlay.py map.png > trace.json
  python3 scripts/trace-to-controls.py trace.json --image-size 1920x1035 \
      --start-px 1377,732 --scale 2.2 --eps 2 --min-radius 78 > controls.json
"""
import argparse
import json
import math
import sys

ap = argparse.ArgumentParser()
ap.add_argument("trace", help="JSON file from trace-overlay.py")
ap.add_argument("--image-size", required=True, help="WxH of the map image, e.g. 1920x1035")
ap.add_argument("--start-px", required=True, help="image px of start/finish, e.g. 1377,732")
ap.add_argument("--scale", type=float, required=True, help="world units per image px")
ap.add_argument("--eps", type=float, default=2.0, help="Douglas-Peucker epsilon in image px")
ap.add_argument("--max-seg", type=float, default=120.0, help="subdivide segments longer than this (px)")
ap.add_argument("--min-radius", type=float, default=78.0, help="min spline circumradius in world units (> track half-width)")
ap.add_argument("--samples", type=int, default=3, help="catmullRomLoop samples per segment used by the track module")
args = ap.parse_args()

W, H = (float(v) for v in args.image_size.split("x"))
sx, sy = (float(v) for v in args.start_px.split(","))
pts = [tuple(p) for p in json.load(open(args.trace))]

# 1. clockwise on screen: shoelace with y-down is positive for clockwise
s = sum((pts[(i + 1) % len(pts)][0] - p[0]) * (pts[(i + 1) % len(pts)][1] + p[1]) for i, p in enumerate(pts))
if s < 0:
    pts = pts[::-1]

# 2. rotate to start, travel -x
si = min(range(len(pts)), key=lambda i: (pts[i][0] - sx) ** 2 + (pts[i][1] - sy) ** 2)
pts = pts[si:] + pts[:si]
if pts[5][0] > pts[0][0]:
    pts = [pts[0]] + pts[1:][::-1]


# 3. Douglas-Peucker; closed loop handled as two halves (anchors mid-section)
def dp(points, eps):
    if len(points) < 3:
        return points
    ax, ay = points[0]
    bx, by = points[-1]
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1
    imax, dmax = 0, -1
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = abs(dx * (ay - py) - dy * (ax - px)) / L
        if d > dmax:
            dmax, imax = d, i
    if dmax > eps:
        return dp(points[: imax + 1], eps)[:-1] + dp(points[imax:], eps)
    return [points[0], points[-1]]


h = len(pts) // 2
simp = dp(pts[: h + 1], args.eps)[:-1] + dp(pts[h:] + [pts[0]], args.eps)[:-1]
print(f"after DP: {len(simp)} pts", file=sys.stderr)

# 4. subdivide long segments
out = []
for i, p in enumerate(simp):
    q = simp[(i + 1) % len(simp)]
    out.append(p)
    seg = math.hypot(q[0] - p[0], q[1] - p[1])
    k = int(seg // args.max_seg)
    for j in range(1, k + 1):
        t = j / (k + 1)
        out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
print(f"after subdivide: {len(out)} pts", file=sys.stderr)

# 5. to world
ctrl = [((x - W / 2) * args.scale, (y - H / 2) * args.scale) for x, y in out]


# 6. relax against the sampled spline (mirror of catmullRomLoop in _shared.mjs)
def catmull_rom_loop(control, samples):
    n = len(control)
    res = []
    dist = lambda a, b: math.sqrt(math.hypot(b[0] - a[0], b[1] - a[1]))
    for i in range(n):
        p0, p1, p2, p3 = control[(i - 1) % n], control[i], control[(i + 1) % n], control[(i + 2) % n]
        t0 = 0.0
        t1 = t0 + dist(p0, p1)
        t2 = t1 + dist(p1, p2)
        t3 = t2 + dist(p2, p3)
        for s in range(samples):
            u = t1 + (t2 - t1) * s / samples

            def lerp(pa, pb, ta, tb):
                return (
                    ((tb - u) * pa[0] + (u - ta) * pb[0]) / (tb - ta),
                    ((tb - u) * pa[1] + (u - ta) * pb[1]) / (tb - ta),
                )

            a1 = lerp(p0, p1, t0, t1)
            a2 = lerp(p1, p2, t1, t2)
            a3 = lerp(p2, p3, t2, t3)
            b1 = lerp(a1, a2, t0, t2)
            b2 = lerp(a2, a3, t1, t3)
            res.append(lerp(b1, b2, t1, t2))
    return res


def circumradius(a, b, c):
    ab = math.hypot(b[0] - a[0], b[1] - a[1])
    bc = math.hypot(c[0] - b[0], c[1] - b[1])
    ac = math.hypot(c[0] - a[0], c[1] - a[1])
    area = abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
    return float("inf") if area < 1e-9 else ab * bc * ac / (4 * area)


n = len(ctrl)
worst = float("inf")
for it in range(600):
    spline = catmull_rom_loop(ctrl, args.samples)
    m = len(spline)
    bad = set()
    worst = float("inf")
    for i in range(m):
        r = circumradius(spline[(i - 1) % m], spline[i], spline[(i + 1) % m])
        worst = min(worst, r)
        if r < args.min_radius:
            ci = i // args.samples
            bad.update([(ci - 1) % n, ci, (ci + 1) % n])
    if not bad:
        print(f"relaxation converged after {it} iterations, spline min radius {worst:.1f}", file=sys.stderr)
        break
    new = list(ctrl)
    for i in bad:
        a, c = ctrl[(i - 1) % n], ctrl[(i + 1) % n]
        w = 0.2
        new[i] = (ctrl[i][0] * (1 - w) + (a[0] + c[0]) / 2 * w, ctrl[i][1] * (1 - w) + (a[1] + c[1]) / 2 * w)
    ctrl = new
else:
    print(f"WARNING: relaxation did not converge, spline min radius {worst:.1f}", file=sys.stderr)

print(json.dumps([{"x": round(x, 1), "y": round(y, 1)} for x, y in ctrl]))
