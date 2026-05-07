import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outDir = join(__dirname, "..", "public", "tracks");
mkdirSync(outDir, { recursive: true });

function ovalCenterline() {
  const points = [];
  const steps = 64;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const wobble = Math.sin(t * 3) * 60;
    points.push({
      x: round(Math.cos(t) * (700 + wobble * 0.2)),
      y: round(Math.sin(t) * (380 + wobble * 0.5)),
    });
  }
  return points;
}

function stadiumCenterline() {
  const halfX = 800;
  const halfY = 280;
  const r = 200;
  const lineSamples = 6;
  const arcSamples = 14;
  const points = [];

  for (let i = 0; i < lineSamples; i++) {
    const u = i / lineSamples;
    const x = -halfX + r + (halfX * 2 - r * 2) * u;
    points.push({ x: round(x), y: -halfY });
  }
  pushArc(points, halfX - r, -halfY + r, r, -Math.PI / 2, Math.PI / 2, arcSamples);
  for (let i = 0; i < lineSamples; i++) {
    const u = i / lineSamples;
    const y = -halfY + r + (halfY * 2 - r * 2) * u;
    points.push({ x: halfX, y: round(y) });
  }
  pushArc(points, halfX - r, halfY - r, r, 0, Math.PI / 2, arcSamples);
  for (let i = 0; i < lineSamples; i++) {
    const u = i / lineSamples;
    const x = halfX - r - (halfX * 2 - r * 2) * u;
    points.push({ x: round(x), y: halfY });
  }
  pushArc(points, -halfX + r, halfY - r, r, Math.PI / 2, Math.PI / 2, arcSamples);
  for (let i = 0; i < lineSamples; i++) {
    const u = i / lineSamples;
    const y = halfY - r - (halfY * 2 - r * 2) * u;
    points.push({ x: -halfX, y: round(y) });
  }
  pushArc(points, -halfX + r, -halfY + r, r, Math.PI, Math.PI / 2, arcSamples);

  return points;
}

function stadiumGravelPatch() {
  // Stadium top-right arc center: (600, -80), arc radius 200, asphalt half-width 70.
  // Gravel band sits in the outer runoff (between asphalt outer edge 270 and outer wall 360).
  const cx = 600;
  const cy = -80;
  const inner = 275;
  const outer = 355;
  const a0 = -Math.PI / 2 + 0.15;
  const a1 = 0 - 0.15;
  const samples = 14;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const a = a0 + (a1 - a0) * t;
    pts.push({ x: round(cx + Math.cos(a) * inner), y: round(cy + Math.sin(a) * inner) });
  }
  for (let i = samples; i >= 0; i--) {
    const t = i / samples;
    const a = a0 + (a1 - a0) * t;
    pts.push({ x: round(cx + Math.cos(a) * outer), y: round(cy + Math.sin(a) * outer) });
  }
  return pts;
}

function pushArc(out, cx, cy, r, startAngle, sweep, samples) {
  for (let i = 0; i < samples; i++) {
    const a = startAngle + (i / samples) * sweep;
    out.push({ x: round(cx + Math.cos(a) * r), y: round(cy + Math.sin(a) * r) });
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function arcOutsidePatch(cx, cy, r, asphaltHalf, runoff, a0, a1, samples = 16, gap = 3) {
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

function chicaneApexInsidePatch(ax, ay, bx, by, peakOff, apexT, halfSpanT, asphaltHalf, runoff, samples = 10, gap = 3) {
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

function templeOfSpeedPatches() {
  const ASPHALT = 65;
  const RUNOFF_OUT = 80;
  const PATCH_WIDTH = 50;
  const patches = [];

  // Outside corner exits — annular gravel on the outer side of fast corners.
  patches.push({
    surface: "gravel",
    polygon: arcOutsidePatch(-1486.40, 640, 360, ASPHALT, RUNOFF_OUT, 0.794 * Math.PI, 0.944 * Math.PI),
  });
  patches.push({
    surface: "gravel",
    polygon: arcOutsidePatch(-1760, -880, 240, ASPHALT, RUNOFF_OUT, 1.35 * Math.PI, 1.5 * Math.PI),
  });
  patches.push({
    surface: "gravel",
    polygon: arcOutsidePatch(2000, 750, 250, ASPHALT, RUNOFF_OUT, 2 * Math.PI - 0.5, 2.5 * Math.PI - 0.15),
  });

  // Variante del Rettifilo — outside-of-arc gravel matching real Monza runoff zones.
  // Arc 1 (T1, 90° right): gravel on the south side of the entry.
  patches.push({
    surface: "gravel",
    polygon: arcOutsidePatch(-660, 904, 96, ASPHALT, RUNOFF_OUT, Math.PI / 2, Math.PI),
  });
  // Arc 2 (T2, 135° sharp left): gravel on the north side — the main escape area.
  patches.push({
    surface: "gravel",
    polygon: arcOutsidePatch(-852, 894, 96, ASPHALT, RUNOFF_OUT, -Math.PI / 8, (-3 * Math.PI) / 4),
  });

  // Roggia and Ascari are now arc-based; their previous sin-wave-shaped chicane patches
  // were removed because they reference a centerline shape that no longer exists.

  return patches;
}

function templeOfSpeedCenterline() {
  const SCALE = 2;
  const pts = [];
  const push = (x, y) => pts.push({ x: round(x * SCALE), y: round(y * SCALE) });

  const line = (ax, ay, bx, by, samples) => {
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  };
  const arc = (cx, cy, r, a0, a1, samples) => {
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      const a = a0 + (a1 - a0) * t;
      push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  };
  const chicane = (ax, ay, bx, by, peakOff, samples) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      const along = t * len;
      const lat = peakOff * Math.sin(t * Math.PI * 2);
      push(ax + ux * along + nx * lat, ay + uy * along + ny * lat);
    }
  };

  // Main straight: (1000, 500) → (-300, 500), heading -x
  line(1000, 500, -300, 500, 52);

  // T1+T2 Variante del Rettifilo — three-arc Monza-style chicane.
  // R1=R2=48 (sharp), L1=5, L2=20, R3=248.55 (smooth exit). Exits at y=500 — lines up with
  // the start-finish straight, so connector + Curva Grande stay at their original positions.
  line(-300, 500, -330, 500, 4);
  arc(-330, 452, 48, Math.PI / 2, Math.PI, 8);
  line(-378, 452, -378, 447, 1);
  arc(-426, 447, 48, 0, (-3 * Math.PI) / 4, 14);
  line(-459.94, 413.06, -474.08, 427.2, 3);
  arc(-649.82, 251.46, 248.55, Math.PI / 4, Math.PI / 2, 10);

  // Connector to T3 (Curva Grande entry) — short straight after Variante exit.
  line(-649.82, 500, -743.20, 500, 5);

  // T3 (Curva Grande): right-hand 80° turn, larger radius. Wider sweeping arc closer to real Monza.
  // a1 = π/2 + 80°, end point (-920.47, 351.26), exit heading ~10° west of north.
  arc(-743.20, 320, 180, Math.PI / 2, Math.PI / 2 + (4 * Math.PI) / 9, 18);

  // Sector 2 back-straight: tilted to match CG exit heading; ends at Roggia entry (-1000, -100).
  line(-920.47, 351.26, -1000, -100, 20);

  // T4+T5 Variante della Roggia — three-arc left-right-left chicane.
  // 30° L → 15u mid → 60° R → 15u mid → 30° L. Returns to same x line; exits at (-1000, -250).
  line(-1000, -100, -1000, -112, 1);
  arc(-1050, -112, 50, 0, -Math.PI / 6, 6);
  line(-1006.70, -137, -1014.20, -149.99, 1);
  arc(-970.90, -174.99, 50, (5 * Math.PI) / 6, (7 * Math.PI) / 6, 8);
  line(-1014.20, -199.99, -1006.70, -212.98, 1);
  arc(-1050, -237.98, 50, Math.PI / 6, 0, 6);
  line(-1000, -237.98, -1000, -250, 1);

  // Continue up to Lesmo: (-1000, -250) → (-1000, -440)
  line(-1000, -250, -1000, -440, 8);

  // T6 Lesmo 1: right-hand 90° turn, center (-880, -440), r=120, θ π → 3π/2
  arc(-880, -440, 120, Math.PI, 1.5 * Math.PI, 18);

  // Short between Lesmos: (-880, -560) → (-720, -560)
  line(-880, -560, -720, -560, 6);

  // T7 Lesmo 2: right-hand 45° turn, slightly tighter than before. Center (-720, -490), r=70.
  arc(-720, -490, 70, 1.5 * Math.PI, 1.75 * Math.PI, 10);

  // Back-straight, part 1 (DRS Zone 1, pre-Serraglio): 250u along 45° SE.
  line(-670.50, -539.50, -493.72, -362.72, 10);

  // Curva del Serraglio: slight 5° left kink at R=400. Heading rotates 45° SE → 40° SE.
  arc(-210.88, -645.56, 400, (3 * Math.PI) / 4, (3 * Math.PI) / 4 - Math.PI / 36, 4);

  // Back-straight, part 2: post-kink diagonal at 40° SE to Ascari entry (55.41, 100).
  line(-468.00, -339.16, 55.41, 100, 28);

  // Variante Ascari (T8+T9+T10) — three-arc left-right-left chicane. Shifted east by 105.41
  // to absorb the back-straight kink. Returns to original line; exits at (405.41, 250).
  const aH = Math.atan2(150, 350);
  line(55.41, 100, 143.91, 137.94, 8);
  arc(163.61, 91.99, 50, Math.PI / 2 + aH, Math.PI / 6 + aH, 8);
  line(193.56, 132.02, 205.57, 123.05, 1);
  arc(235.53, 163.08, 50, (-5 * Math.PI) / 6 + aH, -Math.PI / 6 + aH, 12);
  line(285.15, 157.17, 286.92, 172.05, 1);
  arc(336.56, 166.14, 50, (5 * Math.PI) / 6 + aH, Math.PI / 2 + aH, 8);
  line(316.86, 212.09, 405.41, 250, 8);

  // Sector 3 straight: (405.41, 250) → (1000, 250)
  line(405.41, 250, 1000, 250, 24);

  // Parabolica (T11): 180° right-hand sweep, center (1000, 375), r=125, θ 3π/2 → 5π/2
  arc(1000, 375, 125, 1.5 * Math.PI, 2.5 * Math.PI, 36);

  return pts;
}

const tracks = [
  {
    file: "oval.json",
    data: {
      version: 2,
      name: "Oval",
      description: "sweeping bends",
      width: 150,
      checkpoints: 8,
      startIndex: 0,
      runoff: {
        outside: { surface: "grass", width: 100 },
        inside:  { surface: "grass", width: 60 },
      },
      centerline: ovalCenterline(),
    },
  },
  {
    file: "stadium.json",
    data: {
      version: 2,
      name: "Stadium",
      description: "long straights, 4 corners",
      width: 140,
      checkpoints: 8,
      startIndex: 4,
      runoff: {
        outside: { surface: "grass", width: 90 },
        inside:  { surface: "grass", width: 50 },
      },
      patches: [
        // Gravel trap at outside of top-right hairpin (around point index 16-22).
        {
          surface: "gravel",
          polygon: stadiumGravelPatch(),
        },
      ],
      centerline: stadiumCenterline(),
    },
  },
  {
    file: "temple-of-speed.json",
    data: {
      version: 2,
      name: "Temple of Speed",
      description: "chicanes & flat-out straights",
      width: 130,
      checkpoints: 12,
      startIndex: 26,
      runoff: {
        outside: { surface: "grass", width: 80 },
        inside:  { surface: "grass", width: 30 },
      },
      patches: templeOfSpeedPatches(),
      centerline: templeOfSpeedCenterline(),
    },
  },
];

for (const t of tracks) {
  const path = join(outDir, t.file);
  writeFileSync(path, JSON.stringify(t.data, null, 2));
  console.log(`wrote ${path} (${t.data.centerline.length} points)`);
}
