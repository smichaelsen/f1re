// All-time fastest-laps board, per track, top 10 entries each. Mixed humans + AI.
// Persisted to localStorage under `f1re.fastestLaps`.

import { TRACK_KEYS, type TrackKey } from "./MenuScene";

export interface FastestLapEntry {
  name: string;
  ms: number;
  isPlayer: boolean;
  recordedAt: number;
}

export const FASTEST_LAPS_PER_TRACK = 10;
const STORAGE_KEY = "f1re.fastestLaps";

export type FastestLapsBoard = Record<string, FastestLapEntry[]>;

export function emptyBoard(): FastestLapsBoard {
  const out: FastestLapsBoard = {};
  for (const k of TRACK_KEYS) out[k] = [];
  return out;
}

export function loadFastestLaps(): FastestLapsBoard {
  if (typeof localStorage === "undefined") return emptyBoard();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyBoard();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = emptyBoard();
    for (const k of TRACK_KEYS) {
      const list = parsed?.[k];
      if (!Array.isArray(list)) continue;
      const cleaned: FastestLapEntry[] = [];
      for (const item of list) {
        const e = validateEntry(item);
        if (e) cleaned.push(e);
      }
      cleaned.sort((a, b) => a.ms - b.ms);
      out[k] = cleaned.slice(0, FASTEST_LAPS_PER_TRACK);
    }
    return out;
  } catch {
    return emptyBoard();
  }
}

export function saveFastestLaps(board: FastestLapsBoard) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch {
    // Quota / privacy errors non-fatal.
  }
}

// Insert a candidate lap, keep the list sorted ascending, cap to FASTEST_LAPS_PER_TRACK.
// Returns the new list. Also writes to localStorage so callers don't need to remember.
export function recordFastestLap(track: TrackKey, entry: FastestLapEntry): FastestLapEntry[] {
  const board = loadFastestLaps();
  const list = board[track] ?? [];
  list.push(entry);
  list.sort((a, b) => a.ms - b.ms);
  const trimmed = list.slice(0, FASTEST_LAPS_PER_TRACK);
  board[track] = trimmed;
  saveFastestLaps(board);
  return trimmed;
}

function validateEntry(raw: unknown): FastestLapEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<FastestLapEntry>;
  if (typeof o.name !== "string" || o.name.length === 0) return null;
  if (typeof o.ms !== "number" || !Number.isFinite(o.ms) || o.ms <= 0) return null;
  if (typeof o.isPlayer !== "boolean") return null;
  if (typeof o.recordedAt !== "number" || !Number.isFinite(o.recordedAt)) return null;
  return {
    name: o.name.slice(0, 16),
    ms: o.ms,
    isPlayer: o.isPlayer,
    recordedAt: o.recordedAt,
  };
}
