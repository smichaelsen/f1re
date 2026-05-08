export interface Team {
  id: string;
  name: string;
  short: string;
  primary: number;
  secondary: number;
}

export const TEAMS = [
  { id: "rosso",     name: "Scuderia Rosso",     short: "ROS", primary: 0xed1c24, secondary: 0xffd700 },
  { id: "silver",    name: "Silver Star",        short: "SVR", primary: 0xb8b8b8, secondary: 0x00d2be },
  { id: "rampage",   name: "Rampage Racing",     short: "RAM", primary: 0x1e3a8a, secondary: 0xffd200 },
  { id: "papaya",    name: "Papaya GP",          short: "PAP", primary: 0xff8000, secondary: 0x47c7fc },
  { id: "verde",     name: "Verde Sport",        short: "VRD", primary: 0x006f3a, secondary: 0xff80c0 },
  { id: "alpha",     name: "Alpha Bleu",         short: "ALP", primary: 0x0078d4, secondary: 0xfa0537 },
  { id: "crown",     name: "Crown Royal",        short: "CRW", primary: 0x0070d2, secondary: 0xffffff },
  { id: "forge",     name: "Forge Racing",       short: "FRG", primary: 0xe5e5e5, secondary: 0xb70a1c },
  { id: "vorsprung", name: "Vorsprung Racing",   short: "VOR", primary: 0xb70a1c, secondary: 0x222222 },
  { id: "liberty",   name: "Liberty Speed",      short: "LBR", primary: 0x0a3161, secondary: 0xb22234 },
  { id: "junior",    name: "Junior Bulls",       short: "JUN", primary: 0x4a90e2, secondary: 0xff0000 },
] as const satisfies readonly Team[];

export type TeamId = (typeof TEAMS)[number]["id"];

export const DEFAULT_TEAM_ID: TeamId = TEAMS[0].id;

export function teamById(id: string): Team {
  return TEAMS.find((t) => t.id === id) ?? TEAMS[0];
}
