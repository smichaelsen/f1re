import { pushArc, round } from "./_shared.mjs";

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

export default {
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
};
