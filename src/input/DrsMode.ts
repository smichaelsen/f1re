// Per-player DRS activation mode. Persisted in localStorage so the choice survives sessions;
// MenuScene's settings view writes it, RaceScene reads it via init data on race start.

export type DrsMode = "auto" | "manual";

export interface DrsModes {
  p1: DrsMode;
  p2: DrsMode;
}

const STORAGE_KEY = "f1re.drs.mode";
const DEFAULT_MODES: DrsModes = { p1: "auto", p2: "auto" };

export function defaultDrsModes(): DrsModes {
  return { ...DEFAULT_MODES };
}

export function loadDrsModes(): DrsModes {
  if (typeof localStorage === "undefined") return defaultDrsModes();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultDrsModes();
    const parsed = JSON.parse(raw) as Partial<DrsModes>;
    return {
      p1: parseMode(parsed?.p1, DEFAULT_MODES.p1),
      p2: parseMode(parsed?.p2, DEFAULT_MODES.p2),
    };
  } catch {
    return defaultDrsModes();
  }
}

export function saveDrsModes(modes: DrsModes) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // Quota / privacy errors are non-fatal — the user just won't get persistence.
  }
}

function parseMode(raw: unknown, fallback: DrsMode): DrsMode {
  return raw === "auto" || raw === "manual" ? raw : fallback;
}
