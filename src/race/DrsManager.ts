import type { Car, CarInput } from "../entities/Car";
import type { Track } from "../entities/Track";
import type { DrsMode, DrsModes } from "../input/DrsMode";

interface DetectionRecord {
  car: Car;
  t: number;
}

interface DrsCarState {
  // Index of the zone whose start gate the car most recently passed while eligible. null while
  // not currently inside a DRS zone.
  insideZoneIdx: number | null;
  // Auto mode: ms timestamp after which DRS becomes active. Cleared when fired or zone ends.
  scheduledActivateAt: number | null;
  // Edge-detect "currently inside band" flags, one slot per detection / zone-start / zone-end.
  // Detections and zones are independent — `Car.drsAvailable` is the single boolean eligibility
  // flag updated by detection crosses; zones just consult it on entry.
  prevDetTouching: boolean[];
  prevStartTouching: boolean[];
  prevEndTouching: boolean[];
}

// Eligibility window: chaser within this many ms of the prior crosser at a detection point gets DRS.
const DRS_GAP_MS = 1000;
// Auto activation delay after crossing the zone-start gate. Same value for human auto mode and the
// AI base; AI adds skill-driven jitter on top.
const DRS_AUTO_DELAY_MS = 200;
// AI activation timing (ms): base + (1 - skill) * skillSpread + uniform jitter ±jitter.
const DRS_AI_SKILL_SPREAD = 600;
const DRS_AI_JITTER = 200;

export class DrsManager {
  // Per-zone append-only crossing log. detectionLog[zoneIdx] is ordered by time.
  private detectionLog: DetectionRecord[][] = [];
  private states = new Map<Car, DrsCarState>();
  // Becomes true on the frame the leader completes their first lap. Detection points only grant
  // eligibility while this is true; crossings logged before then are kept so the first post-enable
  // chaser can still find a prior crosser to compare against.
  private enabled = false;

  constructor(
    private track: Track,
    private modes: DrsModes,
    private skillFor: (car: Car) => number,
    private flash: (text: string, ms: number) => void,
  ) {}

  init(cars: readonly Car[]): void {
    const detCount = this.track.drsDetections.length;
    const zoneCount = this.track.drsZones.length;
    this.detectionLog = Array.from({ length: detCount }, () => []);
    this.states.clear();
    this.enabled = false;
    for (const car of cars) {
      this.states.set(car, {
        insideZoneIdx: null,
        scheduledActivateAt: null,
        prevDetTouching: new Array(detCount).fill(false),
        prevStartTouching: new Array(zoneCount).fill(false),
        prevEndTouching: new Array(zoneCount).fill(false),
      });
    }
  }

  // Shift DRS-owned timestamps forward by `dt` ms. Called from RaceScene on pause resume
  // so a scheduled auto-activation (mid AI delay window) doesn't fire the instant unpause.
  // Also shifts the per-detection-point crossing log so post-pause gap measurements match
  // the actual physical gap on track rather than including the paused interval.
  shiftTime(dt: number): void {
    for (const state of this.states.values()) {
      if (state.scheduledActivateAt != null) state.scheduledActivateAt += dt;
    }
    for (const log of this.detectionLog) {
      for (const record of log) record.t += dt;
    }
  }

  // First time any car completes lap 1 → DRS becomes active for the rest of the race.
  // Skipped entirely on tracks without DRS data so we don't broadcast a meaningless message.
  // Subsequent calls are no-ops.
  notifyLapComplete(): void {
    if (this.enabled) return;
    if (this.track.drsZones.length === 0) return;
    this.enabled = true;
    this.flash("DRS ENABLED", 1500);
  }

  modeFor(car: Car): DrsMode {
    if (car.playerIndex === 0) return this.modes.p1;
    if (car.playerIndex === 1) return this.modes.p2;
    return "auto";
  }

  // Per-car DRS state machine. Runs once per active car per frame *after* car.update +
  // applyTrackBounds so wall collisions have already settled the position. Detections and zones
  // are independent: detection crosses set/clear `Car.drsAvailable`; zone-start arms activation
  // if available; zone-end clears `drsActive` only (`drsAvailable` persists per spec — "stays
  // available until next detection point").
  update(car: Car, input: CarInput, now: number): void {
    const detections = this.track.drsDetections;
    const zones = this.track.drsZones;
    if (detections.length === 0 && zones.length === 0) return;
    const state = this.states.get(car);
    if (!state) return;

    for (let d = 0; d < detections.length; d++) {
      const touching = this.track.gateHit(detections[d].gate, car.x, car.y);
      const enter = touching && !state.prevDetTouching[d];
      state.prevDetTouching[d] = touching;
      if (enter) this.onDetectionCross(car, d, now);
    }

    for (let z = 0; z < zones.length; z++) {
      const zone = zones[z];
      const startTouching = this.track.gateHit(zone.start, car.x, car.y);
      const endTouching = this.track.gateHit(zone.end, car.x, car.y);
      const startEnter = startTouching && !state.prevStartTouching[z];
      const endEnter = endTouching && !state.prevEndTouching[z];
      state.prevStartTouching[z] = startTouching;
      state.prevEndTouching[z] = endTouching;
      if (startEnter) this.onZoneStart(car, state, z, now);
      if (endEnter) this.onZoneEnd(car, state, z);
    }

    // Auto activation: fire when the scheduled timestamp elapses.
    if (state.scheduledActivateAt != null && now >= state.scheduledActivateAt && !car.drsActive) {
      car.drsActive = true;
      state.scheduledActivateAt = null;
    }

    // Manual activation (humans only — AI never sets useDrs). Pressing the DRS key inside any
    // zone re-arms `drsActive` even after a lift-cancel, as long as eligibility still holds.
    if (
      input.useDrs &&
      car.drsAvailable &&
      !car.drsActive &&
      state.insideZoneIdx != null &&
      this.modeFor(car) === "manual"
    ) {
      car.drsActive = true;
      state.scheduledActivateAt = null;
    }

    // Lift / brake cancels DRS. Doesn't clear drsAvailable — chaser can re-trigger via manual
    // press, and the eligibility flag survives until the next detection cross per spec.
    if (car.drsActive && (input.throttle === 0 || input.brake > 0)) {
      car.drsActive = false;
      state.scheduledActivateAt = null;
    }
  }

  private onDetectionCross(car: Car, detIdx: number, now: number): void {
    const log = this.detectionLog[detIdx];
    // Most recent prior crosser at this detection point, excluding this car. Lap is intentionally
    // not considered — the gap is a physical time-difference at the line. If a leader is lapping
    // a backmarker and crosses the detection 0.5s after them, the leader is genuinely 0.5s
    // behind at the line and gets DRS to chase past, regardless of who's on which lap.
    let priorT: number | null = null;
    for (let i = log.length - 1; i >= 0; i--) {
      const r = log[i];
      if (r.car === car) continue;
      priorT = r.t;
      break;
    }
    log.push({ car, t: now });

    // Each detection cross fully overwrites the eligibility flag — "stays available until next
    // detection point", at which point we re-evaluate. Cleared if gap doesn't qualify or the
    // scene-wide DRS isn't enabled yet.
    if (!this.enabled || priorT == null) {
      car.drsAvailable = false;
      return;
    }
    const gap = now - priorT;
    car.drsAvailable = gap > 0 && gap <= DRS_GAP_MS;
  }

  private onZoneStart(car: Car, state: DrsCarState, zoneIdx: number, now: number): void {
    if (!car.drsAvailable) return;
    state.insideZoneIdx = zoneIdx;
    if (this.modeFor(car) === "auto") {
      state.scheduledActivateAt = now + this.autoActivationDelay(car);
    }
  }

  private onZoneEnd(car: Car, state: DrsCarState, zoneIdx: number): void {
    // Only respond to the end gate of the zone we're currently inside. Stops a rogue end-gate
    // cross (e.g. chicane geometry) from clobbering DRS activated for a different zone.
    if (state.insideZoneIdx !== zoneIdx) return;
    car.drsActive = false;
    state.scheduledActivateAt = null;
    state.insideZoneIdx = null;
    // Note: `car.drsAvailable` is intentionally not cleared here. Eligibility persists across
    // zones until the next detection cross.
  }

  // Auto-activation delay (ms). Humans get a flat 200ms; AI gets a skill-driven base + jitter so
  // weaker AI react slower and there's some variation across opponents.
  private autoActivationDelay(car: Car): number {
    if (car.isPlayer) return DRS_AUTO_DELAY_MS;
    const skill = this.skillFor(car);
    const base = DRS_AUTO_DELAY_MS + (1 - skill) * DRS_AI_SKILL_SPREAD;
    const jitter = (Math.random() * 2 - 1) * DRS_AI_JITTER;
    return Math.max(0, base + jitter);
  }
}
