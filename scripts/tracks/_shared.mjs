export function round(n) {
  return Math.round(n * 100) / 100;
}

export function pushArc(out, cx, cy, r, startAngle, sweep, samples) {
  for (let i = 0; i < samples; i++) {
    const a = startAngle + (i / samples) * sweep;
    out.push({ x: round(cx + Math.cos(a) * r), y: round(cy + Math.sin(a) * r) });
  }
}

/**
 * Centripetal Catmull-Rom closed-loop spline (alpha = 0.5). Centripetal
 * parameterization avoids the cusps and convex-hull overshoot that uniform
 * Catmull-Rom produces at sharp corners — important when the centerline
 * curvature radius must stay above the track half-width to keep the offset
 * polygons non-self-intersecting. Use for irregular real-world tracks.
 */
export function catmullRomLoop(control, samplesPerSegment = 8) {
  const n = control.length;
  const pts = [];
  const dist = (a, b) => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y));
  for (let i = 0; i < n; i++) {
    const p0 = control[(i - 1 + n) % n];
    const p1 = control[i];
    const p2 = control[(i + 1) % n];
    const p3 = control[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + dist(p0, p1);
    const t2 = t1 + dist(p1, p2);
    const t3 = t2 + dist(p2, p3);
    for (let s = 0; s < samplesPerSegment; s++) {
      const u = t1 + ((t2 - t1) * s) / samplesPerSegment;
      const a1x = ((t1 - u) * p0.x + (u - t0) * p1.x) / (t1 - t0);
      const a1y = ((t1 - u) * p0.y + (u - t0) * p1.y) / (t1 - t0);
      const a2x = ((t2 - u) * p1.x + (u - t1) * p2.x) / (t2 - t1);
      const a2y = ((t2 - u) * p1.y + (u - t1) * p2.y) / (t2 - t1);
      const a3x = ((t3 - u) * p2.x + (u - t2) * p3.x) / (t3 - t2);
      const a3y = ((t3 - u) * p2.y + (u - t2) * p3.y) / (t3 - t2);
      const b1x = ((t2 - u) * a1x + (u - t0) * a2x) / (t2 - t0);
      const b1y = ((t2 - u) * a1y + (u - t0) * a2y) / (t2 - t0);
      const b2x = ((t3 - u) * a2x + (u - t1) * a3x) / (t3 - t1);
      const b2y = ((t3 - u) * a2y + (u - t1) * a3y) / (t3 - t1);
      const cx  = ((t2 - u) * b1x + (u - t1) * b2x) / (t2 - t1);
      const cy  = ((t2 - u) * b1y + (u - t1) * b2y) / (t2 - t1);
      pts.push({ x: round(cx), y: round(cy) });
    }
  }
  return pts;
}

/**
 * Heading-aware chain builder. Each call appends segments connected to the
 * previous endpoint. `sweep > 0` is a right turn (clockwise in screen coords
 * with y-down); `sweep < 0` is a left turn.
 */
export function chain() {
  let x = 0, y = 0, h = 0;
  const pts = [];
  const api = {
    start(sx, sy, heading) {
      x = sx; y = sy; h = heading;
      pts.push({ x: round(x), y: round(y) });
      return api;
    },
    line(len, samples = 8) {
      const x0 = x, y0 = y;
      const cx = Math.cos(h), cy = Math.sin(h);
      for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        pts.push({ x: round(x0 + cx * len * t), y: round(y0 + cy * len * t) });
      }
      x = x0 + cx * len;
      y = y0 + cy * len;
      return api;
    },
    arc(radius, sweep, samples = 16) {
      const sign = sweep >= 0 ? 1 : -1;
      const perp = h + sign * Math.PI / 2;
      const cx = x + Math.cos(perp) * radius;
      const cy = y + Math.sin(perp) * radius;
      const startAngle = h - sign * Math.PI / 2;
      for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        const a = startAngle + sweep * t;
        pts.push({ x: round(cx + Math.cos(a) * radius), y: round(cy + Math.sin(a) * radius) });
      }
      x = cx + Math.cos(startAngle + sweep) * radius;
      y = cy + Math.sin(startAngle + sweep) * radius;
      h += sweep;
      return api;
    },
    closeLoop() {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 5) pts.pop();
      return api;
    },
    points() { return pts; },
    state() { return { x, y, h }; },
  };
  return api;
}

export function arcOutsidePatch(cx, cy, r, asphaltHalf, runoff, a0, a1, samples = 16, gap = 3) {
  const inner = r + asphaltHalf + gap;
  const outer = r + asphaltHalf + runoff - gap;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const a = a0 + (a1 - a0) * (i / samples);
    pts.push({ x: round(cx + Math.cos(a) * inner), y: round(cy + Math.sin(a) * inner) });
  }
  for (let i = samples; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / samples);
    pts.push({ x: round(cx + Math.cos(a) * outer), y: round(cy + Math.sin(a) * outer) });
  }
  return pts;
}

export function chicaneApexInsidePatch(ax, ay, bx, by, peakOff, apexT, halfSpanT, asphaltHalf, runoff, samples = 10, gap = 3) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const apexLat = peakOff * Math.sin(apexT * 2 * Math.PI);
  const insideSign = apexLat >= 0 ? -1 : 1;
  const t0 = Math.max(0.001, apexT - halfSpanT);
  const t1 = Math.min(0.999, apexT + halfSpanT);
  const inner = asphaltHalf + gap;
  const outer = asphaltHalf + runoff - gap;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = t0 + (t1 - t0) * (i / samples);
    const along = t * len;
    const lat = peakOff * Math.sin(t * 2 * Math.PI);
    const cxc = ax + ux * along + nx * lat;
    const cyc = ay + uy * along + ny * lat;
    pts.push({ x: round(cxc + insideSign * nx * inner), y: round(cyc + insideSign * ny * inner) });
  }
  for (let i = samples; i >= 0; i--) {
    const t = t0 + (t1 - t0) * (i / samples);
    const along = t * len;
    const lat = peakOff * Math.sin(t * 2 * Math.PI);
    const cxc = ax + ux * along + nx * lat;
    const cyc = ay + uy * along + ny * lat;
    pts.push({ x: round(cxc + insideSign * nx * outer), y: round(cyc + insideSign * ny * outer) });
  }
  return pts;
}

function circumcenter(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null; // collinear — straight, nothing to clamp
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

/**
 * Per-point runoff widths clamped so the runoff outer-edge polygon never
 * self-intersects. Two failure modes are handled:
 *
 * 1. Nearby track sections: for each centerline point, find the closest other
 *    section (cyclic separation > sep points) and limit the runoff to half the
 *    free gap minus a margin — each section claims at most its half, so facing
 *    walls can't cross no matter which sides face each other.
 * 2. Tight corners: offsetting toward the local curvature center folds the
 *    polygon once the offset reaches the curvature radius, so on the concave
 *    side the runoff is limited to radius − half-width − margin.
 *
 * `side` must match the Track offset convention ("outside" | "inside").
 * Smoothed with a moving min then a moving average (window ±2 each); the
 * average can never exceed the local safe share because every moving-min
 * window involved contains it.
 */
export function clampedRunoffWidths(centerline, trackWidth, nominal, side, { sep = 15, margin = 8, floor = 2 } = {}) {
  const n = centerline.length;
  const sign = side === "outside" ? -1 : 1;
  const share = new Array(n);
  for (let i = 0; i < n; i++) {
    let clear = Infinity;
    for (let j = 0; j < n; j++) {
      const s = Math.min((i - j + n) % n, (j - i + n) % n);
      if (s <= sep) continue;
      const d = Math.hypot(centerline[i].x - centerline[j].x, centerline[i].y - centerline[j].y);
      if (d < clear) clear = d;
    }
    share[i] = Math.min(nominal, Math.max(floor, (clear - trackWidth) / 2 - margin));

    const a = centerline[(i - 1 + n) % n];
    const b = centerline[i];
    const c = centerline[(i + 1) % n];
    const cc = circumcenter(a, b, c);
    if (cc) {
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * sign;
      const ny = (dx / len) * sign;
      // only the side facing the curvature center can fold
      if (nx * (cc.x - b.x) + ny * (cc.y - b.y) > 0) {
        const r = Math.hypot(cc.x - b.x, cc.y - b.y);
        share[i] = Math.min(share[i], Math.max(floor, r - trackWidth / 2 - margin));
      }
    }
  }
  const minPass = share.map((_, i) => {
    let m = Infinity;
    for (let k = -2; k <= 2; k++) m = Math.min(m, share[(i + k + n) % n]);
    return m;
  });
  const widths = minPass.map((_, i) => {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += minPass[(i + k + n) % n];
    return s / 5;
  });

  // Fixpoint pass: the analytic clamps work from discrete curvature estimates,
  // which can miss single-vertex microfolds. Build the actual offset polygon,
  // find crossing segments, shrink the involved widths, repeat until clean.
  for (let iter = 0; iter < 100; iter++) {
    const poly = offsetVarying(centerline, trackWidth / 2, widths, sign);
    const hits = polygonSelfIntersections(poly);
    if (hits.length === 0) break;
    for (const [i, j] of hits) {
      for (const k of [i, i + 1, j, j + 1]) {
        const idx = ((k % n) + n) % n;
        widths[idx] = Math.max(floor, widths[idx] * 0.85);
      }
    }
  }
  return widths.map(round);
}

function offsetVarying(centerline, half, widths, sign) {
  const n = centerline.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = centerline[(i - 1 + n) % n];
    const next = centerline[(i + 1) % n];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = half + widths[i];
    out.push({ x: centerline[i].x + (-dy / len) * sign * off, y: centerline[i].y + (dx / len) * sign * off });
  }
  return out;
}

function polygonSelfIntersections(p) {
  const n = p.length;
  const hits = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = p[i], b = p[(i + 1) % n], r = p[j], s = p[(j + 1) % n];
      const d = (b.x - a.x) * (s.y - r.y) - (b.y - a.y) * (s.x - r.x);
      if (!d) continue;
      const t = ((r.x - a.x) * (s.y - r.y) - (r.y - a.y) * (s.x - r.x)) / d;
      const u = ((r.x - a.x) * (b.y - a.y) - (r.y - a.y) * (b.x - a.x)) / d;
      if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) hits.push([i, j]);
    }
  }
  return hits;
}
