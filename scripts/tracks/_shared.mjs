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
