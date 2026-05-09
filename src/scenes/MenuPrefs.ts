// Menu selections persisted in localStorage so the user lands on their last choice after reload.
// Input assignments and DRS modes already persist separately; this covers the remaining menu state
// (track, difficulty, teams, laps, opponents, players).

import { TEAMS, DEFAULT_TEAM_ID, type TeamId } from "../entities/Team";
import {
  LAPS_MAX,
  LAPS_MIN,
  OPPONENTS_MAX,
  OPPONENTS_MIN,
  PLAYERS_MAX,
  PLAYERS_MIN,
  TRACK_KEYS,
  type Difficulty,
  type PlayerCount,
  type TrackKey,
} from "./MenuScene";

export interface MenuPrefs {
  track: TrackKey;
  difficulty: Difficulty;
  team: TeamId;
  team2: TeamId;
  laps: number;
  opponents: number;
  players: PlayerCount;
  // 1P-only camera mode. When true, the world rotates so player heading is always up.
  // Forced false in 2P (split-screen would need its own design).
  cockpitCam: boolean;
}

const STORAGE_KEY = "f1re.menu.prefs";
const DIFFICULTIES_VALID: Difficulty[] = ["easy", "normal", "hard"];

export function defaultMenuPrefs(): MenuPrefs {
  return {
    track: "oval",
    difficulty: "normal",
    team: DEFAULT_TEAM_ID,
    // Mirror MenuScene's default: a different team for P2 so 2P starts visually distinct.
    team2: (TEAMS[1]?.id ?? DEFAULT_TEAM_ID) as TeamId,
    laps: 3,
    opponents: 5,
    players: 1,
    cockpitCam: false,
  };
}

export function loadMenuPrefs(): MenuPrefs {
  const defaults = defaultMenuPrefs();
  if (typeof localStorage === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<MenuPrefs>;
    return {
      track: parseTrack(parsed?.track, defaults.track),
      difficulty: parseDifficulty(parsed?.difficulty, defaults.difficulty),
      team: parseTeam(parsed?.team, defaults.team),
      team2: parseTeam(parsed?.team2, defaults.team2),
      laps: clampInt(parsed?.laps, LAPS_MIN, LAPS_MAX, defaults.laps),
      opponents: clampInt(parsed?.opponents, OPPONENTS_MIN, OPPONENTS_MAX, defaults.opponents),
      players: parsePlayers(parsed?.players, defaults.players),
      cockpitCam: typeof parsed?.cockpitCam === "boolean" ? parsed.cockpitCam : defaults.cockpitCam,
    };
  } catch {
    return defaults;
  }
}

export function saveMenuPrefs(prefs: MenuPrefs) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota / privacy errors non-fatal — user just won't get persistence.
  }
}

function parseTrack(raw: unknown, fallback: TrackKey): TrackKey {
  return typeof raw === "string" && (TRACK_KEYS as string[]).includes(raw) ? (raw as TrackKey) : fallback;
}

function parseDifficulty(raw: unknown, fallback: Difficulty): Difficulty {
  return typeof raw === "string" && (DIFFICULTIES_VALID as string[]).includes(raw) ? (raw as Difficulty) : fallback;
}

function parseTeam(raw: unknown, fallback: TeamId): TeamId {
  return typeof raw === "string" && TEAMS.some((t) => t.id === raw) ? (raw as TeamId) : fallback;
}

function parsePlayers(raw: unknown, fallback: PlayerCount): PlayerCount {
  if (raw === 1 || raw === 2) return raw as PlayerCount;
  return fallback;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const n = Math.round(raw);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
