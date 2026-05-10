export interface Team {
  id: string;
  name: string;
  short: string;
  primary: number;
  secondary: number;
  // Two AI driver names, one per car slot. Each ≤8 characters so HUD/results columns fit.
  drivers: readonly [string, string];
}

export const TEAMS = [
  { id: "rosso",     name: "Scuderia Rosso",     short: "ROS", primary: 0xed1c24, secondary: 0xffd700, drivers: ["BARETTI", "MARCHESI"] },
  { id: "silver",    name: "Silver Star",        short: "SVR", primary: 0xb8b8b8, secondary: 0x00d2be, drivers: ["SCHMIDT", "KAISER"] },
  { id: "rampage",   name: "Rampage Racing",     short: "RAM", primary: 0x1e3a8a, secondary: 0xffd200, drivers: ["HUNTER", "KANE"] },
  { id: "papaya",    name: "Papaya GP",          short: "PAP", primary: 0xff8000, secondary: 0x47c7fc, drivers: ["CHESTER", "BAILEY"] },
  { id: "verde",     name: "Verde Sport",        short: "VRD", primary: 0x006f3a, secondary: 0xff80c0, drivers: ["COSTA", "SOUSA"] },
  { id: "alpha",     name: "Alpha Bleu",         short: "ALP", primary: 0x0078d4, secondary: 0xfa0537, drivers: ["DUPONT", "GIRAUD"] },
  { id: "crown",     name: "Crown Royal",        short: "CRW", primary: 0x0070d2, secondary: 0xffffff, drivers: ["WHITNEY", "BRADLEY"] },
  { id: "forge",     name: "Forge Racing",       short: "FRG", primary: 0xe5e5e5, secondary: 0xb70a1c, drivers: ["IRONS", "STEEL"] },
  { id: "vorsprung", name: "Vorsprung Racing",   short: "VOR", primary: 0xb70a1c, secondary: 0x222222, drivers: ["GRUBER", "KOENIG"] },
  { id: "liberty",   name: "Liberty Speed",      short: "LBR", primary: 0x0a3161, secondary: 0xb22234, drivers: ["MONROE", "JACKSON"] },
  { id: "junior",    name: "Junior Bulls",       short: "JUN", primary: 0x4a90e2, secondary: 0xff0000, drivers: ["COLT", "DASH"] },
] as const satisfies readonly Team[];

export type TeamId = (typeof TEAMS)[number]["id"];

export const DEFAULT_TEAM_ID: TeamId = TEAMS[0].id;

export function teamById(id: string): Team {
  return TEAMS.find((t) => t.id === id) ?? TEAMS[0];
}
