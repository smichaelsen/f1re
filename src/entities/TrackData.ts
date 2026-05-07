export interface TrackPoint {
  x: number;
  y: number;
}

export type Surface = "asphalt" | "grass" | "gravel";

export interface RunoffSide {
  surface: Surface;
  /**
   * Per-side runoff width. A `number` is uniform along the whole loop. A `number[]` overrides
   * the width per centerline point (length should match `centerline.length`; values wrap if shorter).
   * Use the array form for tracks that need walls right at the asphalt edge in places (Monaco-style).
   */
  width: number | number[];
}

export interface SurfacePatch {
  surface: Surface;
  polygon: TrackPoint[];
}

/**
 * Soft constraint applied during racing-line solving.
 * `index` is a centerline point index (wraps modulo length).
 * `offset` is in pixels, perpendicular to the centerline; positive = inside (toward loop centroid).
 * `strength` ∈ [0, 1] blends between the solver's unconstrained step (0) and the hinted offset (1).
 */
export interface RacingLineHint {
  index: number;
  offset: number;
  strength?: number;
}

export interface RacingLineOverrides {
  hints?: RacingLineHint[];
}

/**
 * Reference image displayed under the centerline in the track inspector,
 * for iterating geometry against a real-world track map. Inspector-only;
 * never read by RaceScene.
 *
 * `image` is a path under `public/`. `x`/`y` are world-space coordinates of
 * the image center. `scale` is world units per source pixel.
 */
export interface ReferenceOverlay {
  image: string;
  x: number;
  y: number;
  scale: number;
  alpha?: number;
  rotation?: number;
}

export interface TrackData {
  version: 1 | 2;
  name: string;
  description?: string;
  width: number;
  centerline: TrackPoint[];
  checkpoints: number;
  startIndex: number;
  runoff: { outside: RunoffSide; inside: RunoffSide };
  patches: SurfacePatch[];
  racingLineOverrides?: RacingLineOverrides;
  referenceOverlay?: ReferenceOverlay;
}

export class TrackDataError extends Error {}

const ZERO_RUNOFF: RunoffSide = { surface: "grass", width: 0 };
const VALID_SURFACES = new Set<Surface>(["asphalt", "grass", "gravel"]);

export function parseTrackData(raw: unknown): TrackData {
  if (!raw || typeof raw !== "object") throw new TrackDataError("track data must be an object");
  const d = raw as Record<string, unknown>;

  const version = d.version === 1 || d.version === 2 ? d.version : null;
  if (version == null)
    throw new TrackDataError(`unsupported track version: ${String(d.version)}`);
  if (typeof d.name !== "string" || d.name.length === 0)
    throw new TrackDataError("track.name must be a non-empty string");
  if (typeof d.width !== "number" || d.width <= 0)
    throw new TrackDataError("track.width must be a positive number");
  if (!Array.isArray(d.centerline) || d.centerline.length < 4)
    throw new TrackDataError("track.centerline must have at least 4 points");

  const centerline: TrackPoint[] = d.centerline.map((p, i) => parsePoint(p, `centerline[${i}]`));

  const checkpoints =
    typeof d.checkpoints === "number" && d.checkpoints >= 2 ? Math.floor(d.checkpoints) : 8;
  const startIndex =
    typeof d.startIndex === "number" && d.startIndex >= 0 && d.startIndex < centerline.length
      ? Math.floor(d.startIndex)
      : 0;
  const description = typeof d.description === "string" ? d.description : undefined;

  const runoff = parseRunoff(d.runoff);
  const patches = parsePatches(d.patches);
  const racingLineOverrides = parseRacingLineOverrides(d.racingLineOverrides);
  const referenceOverlay = parseReferenceOverlay(d.referenceOverlay);

  return {
    version,
    name: d.name,
    description,
    width: d.width,
    centerline,
    checkpoints,
    startIndex,
    runoff,
    patches,
    racingLineOverrides,
    referenceOverlay,
  };
}

function parseReferenceOverlay(raw: unknown): ReferenceOverlay | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object")
    throw new TrackDataError("referenceOverlay must be an object");
  const r = raw as Record<string, unknown>;
  if (typeof r.image !== "string" || r.image.length === 0)
    throw new TrackDataError("referenceOverlay.image must be a non-empty string");
  if (typeof r.x !== "number" || typeof r.y !== "number")
    throw new TrackDataError("referenceOverlay.x and .y must be numbers");
  if (typeof r.scale !== "number" || r.scale <= 0)
    throw new TrackDataError("referenceOverlay.scale must be a positive number");
  const alpha =
    typeof r.alpha === "number" ? Math.max(0, Math.min(1, r.alpha)) : undefined;
  const rotation = typeof r.rotation === "number" ? r.rotation : undefined;
  return { image: r.image, x: r.x, y: r.y, scale: r.scale, alpha, rotation };
}

function parseRacingLineOverrides(raw: unknown): RacingLineOverrides | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object")
    throw new TrackDataError("racingLineOverrides must be an object");
  const r = raw as Record<string, unknown>;
  const hints: RacingLineHint[] = [];
  if (r.hints !== undefined) {
    if (!Array.isArray(r.hints))
      throw new TrackDataError("racingLineOverrides.hints must be an array");
    r.hints.forEach((h, i) => {
      if (!h || typeof h !== "object")
        throw new TrackDataError(`racingLineOverrides.hints[${i}] must be an object`);
      const hh = h as Record<string, unknown>;
      if (typeof hh.index !== "number" || hh.index < 0)
        throw new TrackDataError(
          `racingLineOverrides.hints[${i}].index must be a non-negative number`,
        );
      if (typeof hh.offset !== "number")
        throw new TrackDataError(`racingLineOverrides.hints[${i}].offset must be a number`);
      const strength =
        typeof hh.strength === "number" ? Math.max(0, Math.min(1, hh.strength)) : 1;
      hints.push({ index: Math.floor(hh.index), offset: hh.offset, strength });
    });
  }
  return { hints };
}

function parsePoint(raw: unknown, label: string): TrackPoint {
  if (!raw || typeof raw !== "object") throw new TrackDataError(`${label} is not an object`);
  const p = raw as Record<string, unknown>;
  if (typeof p.x !== "number" || typeof p.y !== "number")
    throw new TrackDataError(`${label} must have numeric x and y`);
  return { x: p.x, y: p.y };
}

function parseRunoffSide(raw: unknown, label: string): RunoffSide {
  if (raw == null) return { ...ZERO_RUNOFF };
  if (typeof raw !== "object") throw new TrackDataError(`${label} must be an object`);
  const r = raw as Record<string, unknown>;
  const surface = typeof r.surface === "string" && VALID_SURFACES.has(r.surface as Surface)
    ? (r.surface as Surface)
    : "grass";
  let width: number | number[] = 0;
  if (typeof r.width === "number" && r.width >= 0) {
    width = r.width;
  } else if (Array.isArray(r.width)) {
    if (r.width.length === 0)
      throw new TrackDataError(`${label}.width array must be non-empty`);
    if (!r.width.every((v) => typeof v === "number" && v >= 0))
      throw new TrackDataError(`${label}.width array must contain non-negative numbers`);
    width = (r.width as number[]).slice();
  }
  return { surface, width };
}

function parseRunoff(raw: unknown): { outside: RunoffSide; inside: RunoffSide } {
  if (raw == null) return { outside: { ...ZERO_RUNOFF }, inside: { ...ZERO_RUNOFF } };
  if (typeof raw !== "object") throw new TrackDataError("runoff must be an object");
  const r = raw as Record<string, unknown>;
  return {
    outside: parseRunoffSide(r.outside, "runoff.outside"),
    inside: parseRunoffSide(r.inside, "runoff.inside"),
  };
}

function parsePatches(raw: unknown): SurfacePatch[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new TrackDataError("patches must be an array");
  return raw.map((p, i) => {
    if (!p || typeof p !== "object")
      throw new TrackDataError(`patches[${i}] must be an object`);
    const pp = p as Record<string, unknown>;
    if (typeof pp.surface !== "string" || !VALID_SURFACES.has(pp.surface as Surface))
      throw new TrackDataError(`patches[${i}].surface must be one of: asphalt, grass, gravel`);
    if (!Array.isArray(pp.polygon) || pp.polygon.length < 3)
      throw new TrackDataError(`patches[${i}].polygon must have at least 3 points`);
    const polygon = pp.polygon.map((q, j) => parsePoint(q, `patches[${i}].polygon[${j}]`));
    return { surface: pp.surface as Surface, polygon };
  });
}

export interface SurfaceParams {
  drag: number;
  grip: number;
  color: number;
}

export const SURFACE_PARAMS: Record<Surface, SurfaceParams> = {
  asphalt: { drag: 0.6, grip: 4.0, color: 0x3a3a3a },
  grass:   { drag: 4.0, grip: 1.6, color: 0x3d8a3d },
  gravel:  { drag: 8.5, grip: 1.0, color: 0xb89568 },
};
