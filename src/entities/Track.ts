import Phaser from "phaser";
import {
  SURFACE_PARAMS,
  type ControlPoint,
  type RacingLineOverrides,
  type RunoffSide,
  type Surface,
  type SurfacePatch,
  type TrackData,
  type TrackPoint,
} from "./TrackData";

export type { ControlPoint, TrackPoint } from "./TrackData";
export type Side = "outside" | "inside";

export interface CheckpointZone {
  x: number;
  y: number;
  angle: number;
  outsideHalf: number;
  insideHalf: number;
  index: number;
  isFinish: boolean;
}

export interface ProbeResult {
  distance: number;
  nx: number;
  ny: number;
  side: Side;
  index: number;
}

const WORLD_GRASS = 0x2a6f2a;
const WALL_COLOR = 0x111111;
const TRACK_EDGE_LINE = 0xffffff;

const RACING_LINE_ITERATIONS = 200;
const RACING_LINE_MARGIN = 24;

export class Track {
  scene: Phaser.Scene;
  name: string;
  description?: string;
  centerline: TrackPoint[];
  controlPoints: ControlPoint[];
  width: number;
  graphics: Phaser.GameObjects.Graphics;
  checkpoints: CheckpointZone[] = [];
  checkpointCount: number;
  startIndex: number;
  startPos: TrackPoint;
  startHeading: number;
  runoff: { outside: RunoffSide; inside: RunoffSide };
  patches: SurfacePatch[];
  outsidePatches: SurfacePatch[] = [];
  insidePatches: SurfacePatch[] = [];
  racingLine: TrackPoint[] = [];
  racingLineOffsets: number[] = [];

  constructor(scene: Phaser.Scene, data: TrackData) {
    this.scene = scene;
    this.name = data.name;
    this.description = data.description;
    this.centerline = data.centerline;
    this.controlPoints = data.controlPoints ?? [];
    this.width = data.width;
    this.checkpointCount = data.checkpoints;
    this.runoff = data.runoff;
    this.patches = data.patches;

    this.startIndex = data.startIndex;
    const first = this.centerline[this.startIndex];
    const second = this.centerline[(this.startIndex + 1) % this.centerline.length];
    this.startPos = { x: first.x, y: first.y };
    this.startHeading = Math.atan2(second.y - first.y, second.x - first.x);

    for (const p of this.patches) {
      const c = polygonCentroid(p.polygon);
      const probe = this.probe(c.x, c.y);
      if (probe.side === "outside") this.outsidePatches.push(p);
      else this.insidePatches.push(p);
    }

    this.computeRacingLine(data.racingLineOverrides);

    this.graphics = scene.add.graphics();
    this.graphics.setDepth(0);
    this.draw();
    this.buildCheckpoints();
  }

  /**
   * Iterative minimum-curvature solver: at each centerline point, store a perpendicular
   * offset that pulls the point onto the chord between its smoothed neighbors. Hints from
   * `racingLineOverrides` act as soft constraints inside the loop.
   */
  private computeRacingLine(overrides?: RacingLineOverrides) {
    const pts = this.centerline;
    const n = pts.length;
    if (n < 3) return;

    const halfWidth = this.width / 2;
    const maxOff = Math.max(0, halfWidth - RACING_LINE_MARGIN);

    const normals: { x: number; y: number }[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      normals[i] = { x: -dy / len, y: dx / len };
    }

    const hintMap = new Map<number, { offset: number; strength: number }>();
    const hints = overrides?.hints ?? [];
    for (const h of hints) {
      const idx = ((h.index % n) + n) % n;
      hintMap.set(idx, { offset: h.offset, strength: h.strength ?? 1 });
    }

    const offsets = new Array<number>(n).fill(0);
    for (const [idx, h] of hintMap) {
      offsets[idx] = clamp(h.offset, -maxOff, maxOff);
    }

    for (let iter = 0; iter < RACING_LINE_ITERATIONS; iter++) {
      for (let i = 0; i < n; i++) {
        const ip = (i - 1 + n) % n;
        const inx = (i + 1) % n;
        const prevX = pts[ip].x + offsets[ip] * normals[ip].x;
        const prevY = pts[ip].y + offsets[ip] * normals[ip].y;
        const nextX = pts[inx].x + offsets[inx] * normals[inx].x;
        const nextY = pts[inx].y + offsets[inx] * normals[inx].y;
        const midX = (prevX + nextX) / 2;
        const midY = (prevY + nextY) / 2;
        let t =
          (midX - pts[i].x) * normals[i].x + (midY - pts[i].y) * normals[i].y;

        const hint = hintMap.get(i);
        if (hint) t = (1 - hint.strength) * t + hint.strength * hint.offset;

        offsets[i] = clamp(t, -maxOff, maxOff);
      }
    }

    this.racingLineOffsets = offsets;
    this.racingLine = offsets.map((off, i) => ({
      x: pts[i].x + off * normals[i].x,
      y: pts[i].y + off * normals[i].y,
    }));
  }

  static fromData(scene: Phaser.Scene, data: TrackData): Track {
    return new Track(scene, data);
  }

  private draw() {
    const g = this.graphics;
    g.clear();

    const asphaltHalf = this.width / 2;
    const kerbStripe = 12;

    g.fillStyle(WORLD_GRASS, 1);
    g.fillRect(-3000, -3000, 6000, 6000);

    this.fillLoop(g, this.offsetLoopVarying("outside"), SURFACE_PARAMS[this.runoff.outside.surface].color);
    for (const p of this.outsidePatches) this.fillPolygon(g, p.polygon, SURFACE_PARAMS[p.surface].color);

    this.fillLoop(g, this.offsetLoop(-asphaltHalf), SURFACE_PARAMS.asphalt.color);

    this.fillLoop(g, this.offsetLoop(asphaltHalf), SURFACE_PARAMS[this.runoff.inside.surface].color);
    for (const p of this.insidePatches) this.fillPolygon(g, p.polygon, SURFACE_PARAMS[p.surface].color);

    this.fillLoop(g, this.offsetLoopVarying("inside"), WORLD_GRASS);

    this.strokeLoop(g, this.offsetLoopVarying("outside"), WALL_COLOR, 4);
    this.strokeLoop(g, this.offsetLoopVarying("inside"), WALL_COLOR, 4);

    this.strokeLoop(g, this.offsetLoop(-asphaltHalf), TRACK_EDGE_LINE, 2);
    this.strokeLoop(g, this.offsetLoop(asphaltHalf), TRACK_EDGE_LINE, 2);

    this.drawApexKerbs(g, asphaltHalf, kerbStripe);

    const dashG = this.scene.add.graphics();
    dashG.setDepth(1);
    dashG.lineStyle(2, 0xffffff, 0.4);
    for (let i = 0; i < this.centerline.length; i += 2) {
      const a = this.centerline[i];
      const b = this.centerline[(i + 1) % this.centerline.length];
      dashG.beginPath();
      dashG.moveTo(a.x, a.y);
      dashG.lineTo(b.x, b.y);
      dashG.strokePath();
    }

    const sf = this.scene.add.graphics();
    sf.setDepth(2);
    sf.translateCanvas(this.startPos.x, this.startPos.y);
    sf.rotateCanvas(this.startHeading);
    const w = this.width;
    const tile = 10;
    for (let i = -w / 2; i < w / 2; i += tile) {
      for (let j = 0; j < 20; j += tile) {
        const black = ((i / tile + j / tile) | 0) % 2 === 0;
        sf.fillStyle(black ? 0x000000 : 0xffffff, 1);
        sf.fillRect(j - 10, i, tile, tile);
      }
    }
  }

  private offsetLoop(offset: number): TrackPoint[] {
    const pts = this.centerline;
    const n = pts.length;
    const out: TrackPoint[] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      out.push({ x: pts[i].x + nx * offset, y: pts[i].y + ny * offset });
    }
    return out;
  }

  /**
   * Builds the polygon along the runoff outer edge for the given side, using the per-point runoff
   * width at each centerline point. `offsetLoop` does the same with a fixed offset; this varies it.
   */
  private offsetLoopVarying(side: Side): TrackPoint[] {
    const pts = this.centerline;
    const n = pts.length;
    const sign = side === "outside" ? -1 : 1;
    const asphaltHalf = this.width / 2;
    const out: TrackPoint[] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * sign;
      const ny = (dx / len) * sign;
      const offset = asphaltHalf + this.widthAt(side, i);
      out.push({ x: pts[i].x + nx * offset, y: pts[i].y + ny * offset });
    }
    return out;
  }

  private widthAt(side: Side, index: number): number {
    const w = side === "outside" ? this.runoff.outside.width : this.runoff.inside.width;
    if (typeof w === "number") return w;
    if (w.length === 0) return 0;
    return w[((index % w.length) + w.length) % w.length];
  }

  private computeCurvatures(): number[] {
    const pts = this.centerline;
    const n = pts.length;
    const k = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const a1 = Math.atan2(b.y - a.y, b.x - a.x);
      const a2 = Math.atan2(c.y - b.y, c.x - b.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      k[i] = d;
    }
    const smooth = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      smooth[i] =
        (k[(i - 2 + n) % n] + k[(i - 1 + n) % n] + k[i] + k[(i + 1) % n] + k[(i + 2) % n]) / 5;
    }
    return smooth;
  }

  private drawApexKerbs(g: Phaser.GameObjects.Graphics, trackHalf: number, stripe: number) {
    // Two candidate kerb strips, one per side of centerline. Per-point sign of curvature
    // picks which side to use, so chicane bends turning either way both get kerbs.
    const sides = {
      pos: { inner: this.offsetLoop(trackHalf), cut: this.offsetLoop(trackHalf - stripe) },
      neg: { inner: this.offsetLoop(-trackHalf), cut: this.offsetLoop(-(trackHalf - stripe)) },
    };
    const curvatures = this.computeCurvatures();
    const n = curvatures.length;

    const sorted = curvatures.map((c) => Math.abs(c)).sort((a, b) => b - a);
    const threshold = sorted[Math.floor(sorted.length * 0.35)];

    let stripeIdx = -1;
    let inApex = false;
    let lastSign = 0;
    for (let i = 0; i < n; i++) {
      const c = curvatures[i];
      const sign = c >= 0 ? 1 : -1;
      const isApex = Math.abs(c) >= threshold;
      if (isApex) {
        if (!inApex || sign !== lastSign) {
          stripeIdx = 0;
          inApex = true;
          lastSign = sign;
        } else {
          stripeIdx++;
        }
        const j = (i + 1) % n;
        const color = stripeIdx % 2 === 0 ? 0xcc1010 : 0xffffff;
        const { inner, cut } = sign > 0 ? sides.pos : sides.neg;
        g.fillStyle(color, 1);
        g.beginPath();
        g.moveTo(cut[i].x, cut[i].y);
        g.lineTo(inner[i].x, inner[i].y);
        g.lineTo(inner[j].x, inner[j].y);
        g.lineTo(cut[j].x, cut[j].y);
        g.closePath();
        g.fillPath();
      } else {
        inApex = false;
      }
    }
  }

  private fillLoop(g: Phaser.GameObjects.Graphics, loop: TrackPoint[], color: number) {
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(loop[0].x, loop[0].y);
    for (let i = 1; i < loop.length; i++) g.lineTo(loop[i].x, loop[i].y);
    g.closePath();
    g.fillPath();
  }

  private strokeLoop(
    g: Phaser.GameObjects.Graphics,
    loop: TrackPoint[],
    color: number,
    thickness: number,
  ) {
    g.lineStyle(thickness, color, 1);
    g.beginPath();
    g.moveTo(loop[0].x, loop[0].y);
    for (let i = 1; i < loop.length; i++) g.lineTo(loop[i].x, loop[i].y);
    g.closePath();
    g.strokePath();
  }

  private fillPolygon(
    g: Phaser.GameObjects.Graphics,
    poly: TrackPoint[],
    color: number,
  ) {
    if (poly.length < 3) return;
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
    g.closePath();
    g.fillPath();
  }

  private buildCheckpoints() {
    const count = this.checkpointCount;
    const n = this.centerline.length;
    for (let i = 0; i < count; i++) {
      const idx = (this.startIndex + Math.floor((i / count) * n)) % n;
      const a = this.centerline[idx];
      const b = this.centerline[(idx + 1) % n];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      this.checkpoints.push({
        x: a.x,
        y: a.y,
        angle: ang,
        outsideHalf: this.wallOffset("outside", idx) + 10,
        insideHalf: this.wallOffset("inside", idx) + 10,
        index: i,
        isFinish: i === 0,
      });
    }
  }

  probe(x: number, y: number): ProbeResult {
    let minD2 = Infinity;
    let bestX = 0;
    let bestY = 0;
    let bestSegDx = 0;
    let bestSegDy = 0;
    let bestAx = 0;
    let bestAy = 0;
    let bestIndex = 0;
    let bestT = 0;
    const pts = this.centerline;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const ddx = x - px;
      const ddy = y - py;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < minD2) {
        minD2 = d2;
        bestX = px;
        bestY = py;
        bestSegDx = dx;
        bestSegDy = dy;
        bestAx = a.x;
        bestAy = a.y;
        bestIndex = i;
        bestT = t;
      }
    }
    const distance = Math.sqrt(minD2);
    const inv = distance > 0.0001 ? 1 / distance : 0;
    const cross = bestSegDx * (y - bestAy) - bestSegDy * (x - bestAx);
    const side: Side = cross > 0 ? "inside" : "outside";
    const index = bestT >= 0.5 ? (bestIndex + 1) % n : bestIndex;
    return { distance, nx: (x - bestX) * inv, ny: (y - bestY) * inv, side, index };
  }

  isOnTrack(x: number, y: number): boolean {
    return this.probe(x, y).distance <= this.width / 2;
  }

  surfaceAt(x: number, y: number): Surface {
    const p = this.probe(x, y);
    if (p.distance <= this.width / 2) return "asphalt";
    const candidates = p.side === "outside" ? this.outsidePatches : this.insidePatches;
    for (const patch of candidates) {
      if (pointInPolygon(x, y, patch.polygon)) return patch.surface;
    }
    return p.side === "outside" ? this.runoff.outside.surface : this.runoff.inside.surface;
  }

  wallOffset(side: Side, index?: number): number {
    const half = this.width / 2;
    if (index !== undefined) return half + this.widthAt(side, index);
    const w = side === "outside" ? this.runoff.outside.width : this.runoff.inside.width;
    return half + (typeof w === "number" ? w : Math.max(0, ...w));
  }

  checkpointHit(cpIndex: number, x: number, y: number): boolean {
    const cp = this.checkpoints[cpIndex];
    const dx = x - cp.x;
    const dy = y - cp.y;
    const cos = Math.cos(-cp.angle);
    const sin = Math.sin(-cp.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if (Math.abs(lx) >= 30) return false;
    return ly >= -cp.outsideHalf && ly <= cp.insideHalf;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function polygonCentroid(poly: TrackPoint[]): TrackPoint {
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / poly.length, y: sy / poly.length };
}

function pointInPolygon(x: number, y: number, poly: TrackPoint[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
