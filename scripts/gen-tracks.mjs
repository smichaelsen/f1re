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

  // T1+T2 Variante del Rettifilo (left-right flick): (-300, 500) → (-560, 500)
  chicane(-300, 500, -560, 500, -30, 12);

  // Connector to T3 (Curva Grande entry): (-560, 500) → (-880, 500)
  line(-560, 500, -880, 500, 14);

  // T3 (Curva Grande): right-hand 90° turn, center (-880, 380), r=120, θ π/2 → π
  arc(-880, 380, 120, Math.PI / 2, Math.PI, 18);

  // Up left side (Sector 2): (-1000, 380) → (-1000, -100)
  line(-1000, 380, -1000, -100, 20);

  // T4+T5 Variante della Roggia (right-left wiggle): (-1000, -100) → (-1000, -250)
  chicane(-1000, -100, -1000, -250, 30, 8);

  // Continue up to Lesmo: (-1000, -250) → (-1000, -440)
  line(-1000, -250, -1000, -440, 8);

  // T6 Lesmo 1: right-hand 90° turn, center (-880, -440), r=120, θ π → 3π/2
  arc(-880, -440, 120, Math.PI, 1.5 * Math.PI, 18);

  // Short between Lesmos: (-880, -560) → (-720, -560)
  line(-880, -560, -720, -560, 6);

  // T7 Lesmo 2: right-hand 45° turn, center (-720, -480), r=80, θ 3π/2 → 7π/4
  arc(-720, -480, 80, 1.5 * Math.PI, 1.75 * Math.PI, 10);

  // Long diagonal back-straight (DRS Zone 1): from T7 exit toward Ascari
  line(-663.4, -536.6, -50, 100, 36);

  // Variante Ascari (T8+T9+T10) chicane: (-50, 100) → (300, 250) with wiggle
  chicane(-50, 100, 300, 250, 30, 16);

  // Sector 3 straight: (300, 250) → (1000, 250)
  line(300, 250, 1000, 250, 28);

  // Parabolica (T11): 180° right-hand sweep, center (1000, 375), r=125, θ 3π/2 → 5π/2
  arc(1000, 375, 125, 1.5 * Math.PI, 2.5 * Math.PI, 36);

  return pts;
}

const tracks = [
  {
    file: "oval.json",
    data: {
      version: 1,
      name: "Oval",
      description: "sweeping bends",
      width: 150,
      checkpoints: 8,
      startIndex: 0,
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
      version: 1,
      name: "Temple of Speed",
      description: "chicanes & flat-out straights",
      width: 130,
      checkpoints: 12,
      startIndex: 26,
      centerline: templeOfSpeedCenterline(),
    },
  },
];

for (const t of tracks) {
  const path = join(outDir, t.file);
  writeFileSync(path, JSON.stringify(t.data, null, 2));
  console.log(`wrote ${path} (${t.data.centerline.length} points)`);
}
