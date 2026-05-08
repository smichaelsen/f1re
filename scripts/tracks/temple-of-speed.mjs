import { arcOutsidePatch, round } from "./_shared.mjs";

function templeOfSpeedPatches() {
  const ASPHALT = 65;
  const RUNOFF_OUT = 80;
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

export default {
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
};
