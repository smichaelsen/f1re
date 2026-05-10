import type { CarDesign } from "./CarSprite";

export interface TeamPerf {
  // Multipliers on DEFAULT_CAR. All three live in [0.90, 1.10]; the menu maps that range
  // to a 0..1 bar fill. Player gets these exact values; AI stacks a per-instance jitter
  // from the difficulty `perfRange` on top, so a hard-mode AI on a strong team is fastest.
  topSpeed: number;
  accel: number;
  grip: number;
}

export interface Team {
  id: string;
  name: string;
  short: string;
  primary: number;
  secondary: number;
  // Two AI driver names, one per car slot. Each ≤8 characters so HUD/results columns fit.
  drivers: readonly [string, string];
  // Hardcoded skill ∈ [DRIVER_SKILL_MIN, DRIVER_SKILL_MAX] per driver, parallel to `drivers`
  // (index 0 = first driver, index 1 = second). Rolled once with team-quality bias and a
  // "top-3 must come from a top-4 team" constraint, then frozen. Each driver therefore has
  // a stable identity across races: Hunter is always the best, Costa always the worst.
  // RaceScene scales these into the active difficulty's skillRange so the spread within a
  // difficulty preserves driver ranking but also scales with difficulty.
  driverSkills: readonly [number, number];
  // Fixed livery variant. Every car on this team renders with the same secondary-color
  // accent placement so all team cars are visually identical (mirrors how F1 teams ship one
  // livery for both drivers). Replaces the previous per-car random variant.
  variant: CarDesign;
  perf: TeamPerf;
}

// Stats roughly mirror 2026 F1 speculation. Each team is a nod to a real outfit; the
// hierarchy follows that mapping: top tier is Rosso (Ferrari), Silver Star (Mercedes),
// Rampage (Red Bull), Papaya (McLaren); bottom tier is Verde (Aston Martin) and Liberty
// (Cadillac, the new American entry). Each top team gets a distinct signature so picks at
// the top still trade off character — McLaren is the grip king, Ferrari the balanced ace,
// Red Bull the accel master, Mercedes the straight-line specialist. Range is strictly
// [0.90, 1.10] so the menu bar fill is well-defined and no team is unplayable.
export const TEAMS = [
  { id: "rosso",     name: "Scuderia Rosso",     short: "ROS", primary: 0xed1c24, secondary: 0xffd700, drivers: ["BARETTI", "MARCHESI"], driverSkills: [0.81, 0.97], variant: "wingtips", perf: { topSpeed: 1.06, accel: 1.06, grip: 1.06 } },
  { id: "silver",    name: "Silver Star",        short: "SVR", primary: 0xb8b8b8, secondary: 0x00d2be, drivers: ["SCHMIDT", "KAISER"],   driverSkills: [0.86, 0.97], variant: "spine",    perf: { topSpeed: 1.10, accel: 1.04, grip: 1.02 } },
  { id: "rampage",   name: "Rampage Racing",     short: "RAM", primary: 0x1e3a8a, secondary: 0xffd200, drivers: ["HUNTER", "KANE"],      driverSkills: [0.99, 0.82], variant: "sidepods", perf: { topSpeed: 1.06, accel: 1.08, grip: 1.04 } },
  { id: "papaya",    name: "Papaya GP",          short: "PAP", primary: 0xff8000, secondary: 0x47c7fc, drivers: ["CHESTER", "BAILEY"],   driverSkills: [0.91, 0.82], variant: "sidepods", perf: { topSpeed: 1.02, accel: 1.06, grip: 1.10 } },
  { id: "verde",     name: "Verde Sport",        short: "VRD", primary: 0x006f3a, secondary: 0xff80c0, drivers: ["COSTA", "SOUSA"],      driverSkills: [0.47, 0.50], variant: "nose",     perf: { topSpeed: 0.92, accel: 0.94, grip: 0.96 } },
  { id: "alpha",     name: "Alpha Bleu",         short: "ALP", primary: 0x0078d4, secondary: 0xfa0537, drivers: ["DUPONT", "GIRAUD"],    driverSkills: [0.60, 0.69], variant: "spine",    perf: { topSpeed: 0.96, accel: 0.94, grip: 0.96 } },
  { id: "crown",     name: "Crown Royal",        short: "CRW", primary: 0x0070d2, secondary: 0xffffff, drivers: ["WHITNEY", "BRADLEY"],  driverSkills: [0.71, 0.59], variant: "wingtips", perf: { topSpeed: 1.04, accel: 0.98, grip: 0.94 } },
  { id: "forge",     name: "Forge Racing",       short: "FRG", primary: 0xe5e5e5, secondary: 0xb70a1c, drivers: ["IRONS", "STEEL"],      driverSkills: [0.80, 0.60], variant: "wingtips", perf: { topSpeed: 1.00, accel: 0.98, grip: 1.00 } },
  { id: "vorsprung", name: "Vorsprung Racing",   short: "VOR", primary: 0xb70a1c, secondary: 0x222222, drivers: ["GRUBER", "KOENIG"],    driverSkills: [0.69, 0.80], variant: "sidepods", perf: { topSpeed: 0.96, accel: 1.00, grip: 1.04 } },
  { id: "liberty",   name: "Liberty Speed",      short: "LBR", primary: 0x0a3161, secondary: 0xb22234, drivers: ["MONROE", "JACKSON"],   driverSkills: [0.51, 0.48], variant: "spine",    perf: { topSpeed: 0.98, accel: 0.92, grip: 0.90 } },
  { id: "junior",    name: "Junior Bulls",       short: "JUN", primary: 0x4a90e2, secondary: 0xff0000, drivers: ["COLT", "DASH"],        driverSkills: [0.81, 0.64], variant: "nose",     perf: { topSpeed: 0.98, accel: 1.04, grip: 1.00 } },
] as const satisfies readonly Team[];

// Range bounds used by the menu bar viz to map perf values to a 0..1 fill.
export const TEAM_PERF_MIN = 0.90;
export const TEAM_PERF_MAX = 1.10;

// Bounds the hardcoded driverSkills were rolled within. RaceScene maps from this range
// into the active difficulty's skillRange so the relative ordering of drivers is preserved
// while difficulty still scales overall AI sharpness.
export const DRIVER_SKILL_MIN = 0.40;
export const DRIVER_SKILL_MAX = 1.00;

export type TeamId = (typeof TEAMS)[number]["id"];

export const DEFAULT_TEAM_ID: TeamId = TEAMS[0].id;

export function teamById(id: string): Team {
  return TEAMS.find((t) => t.id === id) ?? TEAMS[0];
}
