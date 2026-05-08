import { catmullRomLoop } from "./_shared.mjs";

/**
 * Champions' Wall — Montreal-shaped loop, scaled up so there's room for the
 * proper corners (Lance Stroll hairpin, Wall of Champions kink, Senna corner,
 * Family Grandstand chicane, 31 chicane) instead of one smooth blob.
 *
 * Coordinates designed for image scale 4 (image is 1500×937 native, rendered
 * 6000×3748 in world). Track spans roughly (-2800..2400, -1600..1120) — a
 * ~5200×2700 footprint, ~2× the previous version.
 *
 * Driving direction: counter-clockwise on the image.
 *
 * Topology constraint: approach to the hairpin runs *west* of the loop, exit
 * comes south-east onto main straight. If approach + exit run parallel at
 * similar y they merge into each other under the spline → centerline figure-8.
 */
function championsWallControlPoints() {
  // Coordinates traced from the reference brown centerline against the
  // overlay. Image is 1500×937 native rendered at scale 4 centered on the
  // origin, so image px (a, b) maps to world ((a − 750) × 4, (b − 468.5) × 4).
  // Order is CCW driving direction.
  return [
    { x: 1725,  y: 279, label: "CHECKER" },
    { x: 2120,  y: 426 },
    { x: 2300,  y: 576, label: "T1" },
    { x: 2520,  y: 426 },
    { x: 2680,  y: 556, label: "T2" },
    { x: 2500,  y: 860 },
    { x: 1910,  y: 1195, label: "T3" },
    { x: 1700,  y: 996, label: "T4" },
    { x: 1090,   y: 1146, label: "T5" },
    { x: 550,   y: 960, label: "T6" },
    { x: 400,   y: 1200, label: "T7" },
    { x: -480,  y: 930 },
    { x: -1080, y: 660, label: "T8" },
    { x: -1100, y: 304, label: "T9" },
    { x: -1820, y: -164 },
    { x: -2580, y: -404, label: "T10 entry" },
    { x: -2640, y: -604, label: "T10" },
    { x: -2460, y: -684, label: "T10 exit" },
    { x: -2040, y: -580, label: "T11" },
    { x: -1260,  y: -504, label: "T12" },
    { x: 680,   y: -154, label: "T13" },
    { x: 710,  y: 86, label: "WoC" },
  ];
}

function championsWallCenterline() {
  // Higher samples per segment so corner detail stays smooth at scale.
  return catmullRomLoop(championsWallControlPoints(), 10);
}

export default {
  file: "champions-wall.json",
  data: {
    version: 2,
    name: "Champions' Wall",
    description: "Montreal-shaped: hairpin, diagonal back-straight, river-side chicanes",
    width: 140,
    checkpoints: 12,
    // Control point #10 is the checker; with 10 samples per segment
    // that's index 100 in the spline output.
    startIndex: 0,
    runoff: {
      outside: { surface: "grass", width: 90 },
      inside:  { surface: "grass", width: 50 },
    },
    patches: [],
    // Two DRS zones fed by a single detection point at the back-straight approach.
    // Control-point → centerline mapping: 10 samples/segment, so control idx N is centerline
    // idx N*10. Detection halfway between T9 (control 13 → 130) and T10 (control 16 → 160) at
    // idx 145. Zone 1: from T12 (control 19 → 190) to shortly before T13 (idx 198). Zone 2:
    // halfway between WoC (control 21 → 210) and the checker (centerline 0, wraps; halfway =
    // 215) to shortly before T1 (control 2 → 20, idx 17). One detection feeds both zones (Spa-
    // style); eligibility persists across both until the next lap's detection cross at idx 145.
    drs: {
      detections: [145],
      zones: [
        { startIndex: 190, endIndex: 198 },
        { startIndex: 215, endIndex: 17 },
      ],
    },
    racingLineOverrides: {
      // T12 (control idx 19) → T13 (control idx 20) → WoC (control idx 21):
      // natural min-curvature pins the inside edge (≈+46) through approach +
      // apex, leaving no buffer to the kerb/grass on the inside. Hints widen
      // the entire window: centerline through approach, apex sits ~+22, exit
      // smoothed toward the outside swing the solver already wants.
      hints: [
        { index: 195, offset: -5, strength: 0.7 },
        { index: 198, offset: 4,  strength: 0.7 },
        { index: 199, offset: 12, strength: 0.8 },
        { index: 200, offset: 12, strength: 0.85 },
        { index: 201, offset: 14, strength: 0.8 },
        { index: 203, offset: 8,  strength: 0.6 },
      ],
    },
    referenceOverlay: {
      image: "inspect-overlays/champions-wall.png",
      x: 0,
      y: 0,
      scale: 5,
      alpha: 0.4,
    },
    controlPoints: championsWallControlPoints(),
    centerline: championsWallCenterline(),
  },
};
