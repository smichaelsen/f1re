import Phaser from "phaser";
import type { Car, CarInput } from "../entities/Car";
import { ITEM_INVENTORY_SIZE, type Item } from "../entities/Items";
import type { Track } from "../entities/Track";

interface ItemNoiseSample {
  // Three independent rolls in [-1, 1]. Each evaluator wires them to its own
  // judgement values (range estimate, perceived bearing, gate threshold, etc.)
  // so noise on different axes is uncorrelated.
  r1: number;
  r2: number;
  r3: number;
  // time.now snapshot at pickup. Patience is computed live (now - pickupAt ≥ patienceFor)
  // so inventory pressure from a second pickup retroactively shortens the front-item deadline.
  pickupAt: number;
}

interface AISkillState {
  skill: number;
  aimOffset: number;
  chunk: number;
  // One noise sample per held item, parallel to Car.items. Sampled at pickup so the
  // AI's misjudgement of *this specific item instance* is frozen until consumed —
  // reads like a personality trait rather than per-tick jitter.
  itemNoise: ItemNoiseSample[];
}

const AIM_CHUNK_SIZE = 6;
const AIM_OFFSET_FLOOR = 0.05;
const AIM_OFFSET_RANGE = 0.5;

// Pure-pursuit lookahead in arc length (px). Index-based lookahead failed because
// hand-authored centerline spacing varies 10× on a single track — "4 indices ahead"
// can mean 100px in dense apex regions or 1000px on a sparse approach, so AI starts
// turning toward an apex from absurdly far away. Arc-length lookahead is uniform.
const AI_LOOKAHEAD_DIST = 220;

// Curvature-based brake points. For each point ahead, compute corner speed via
// v² · κ ≤ K_LIMIT, then convert to "max speed allowed *now*" using
// v_now = √(v_corner² + 2 · brake · distance). The min over the scan window is the target
// — i.e. AI brakes only when actually within braking distance of a slower corner.
// AI_BRAKE_DECEL is slightly under cfg.brake (520) to leave headroom for grip lost
// to lateral load when braking and turning. K_LIMIT tuned so the tightest chicane
// targets ~180px/s on Champions Wall; raise if AI is too slow, lower if it slides off.
const AI_BRAKE_DECEL = 480;
const AI_BRAKE_SCAN_DIST = 1200;
const AI_LATERAL_GRIP_LIMIT = 500;
const AI_BRAKE_DEADZONE = 1.04;
const AI_THROTTLE_TAPER = 60;

// AI item-use intelligence. Each recheck the front-of-queue item is scored in [0, 1] for
// "fit right now"; that fit, the elapsed fraction of patience, and a small floor combine
// into a per-recheck Bernoulli probability. So a stuck leader holding a seeker still fires
// it stochastically rather than waiting the full patience cap. Patience still acts as a
// hard ceiling (force-fire at expiry). A utility may return null to mean "do not fire under
// any circumstances right now" (e.g. already boosted/shielded) — bypasses the draw, defers
// the recheck. Skill scales input-noise quadratically so only the bottom of the skill range
// visibly fumbles: factor = (1 - skill)².
const AI_ITEM_PATIENCE_MS = 8000;
const AI_ITEM_PATIENCE_FULL_MS = 3000;
const AI_ITEM_RECHECK_MS = 250;
// Shield is special-cased: short scheduling window, score = 1 (unless already shielded → null).
// Reasoning asymmetry — held shields protect from surprises, missed shields don't.
const AI_SHIELD_PATIENCE_MS = 1500;
// Per-recheck firing probability: p = clamp(p_floor + score * w_score + tFrac * w_time, 0, 1).
// Tuned so a perfect-fit item fires ~immediately, a moderate fit (~0.5) fires within ~2 rechecks,
// and a poor-fit (score≈0) ramps via the time term + floor (~5 rechecks ≈ 1.25s baseline).
const AI_FIRE_W_SCORE = 0.8;
const AI_FIRE_W_TIME = 0.5;
const AI_FIRE_P_FLOOR = 0.05;
// Boost: fire on a low-curvature stretch when already moving fast.
const AI_BOOST_CURVATURE_MAX = 0.0035;
const AI_BOOST_SCAN_DIST = 400;
const AI_BOOST_SPEED_FRAC = 0.85;
// Missile: target visible ahead of the firing car.
const AI_MISSILE_RANGE = 220;
const AI_MISSILE_AHEAD_DOT = 0.3;
// Seeker: useful when at least one rival is up-track on race progress.
const AI_SEEKER_CURVATURE_MAX = 0.005;
// Oil: useful when a chaser is close behind on race progress.
const AI_OIL_BEHIND_RANGE = 260;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class AIDriver {
  private skills = new Map<Car, AISkillState>();

  // Cars list is provided as a getter so AIDriver doesn't go stale when RaceScene rebuilds
  // `this.cars` on scene restart. Iterators read it lazily inside utility evals.
  constructor(
    private track: Track,
    private getCars: () => readonly Car[],
  ) {}

  register(car: Car, skill: number): void {
    this.skills.set(car, { skill, aimOffset: 0, chunk: -1, itemNoise: [] });
  }

  skillFor(car: Car): number {
    return this.skills.get(car)?.skill ?? 0.7;
  }

  // Called when an AI picks up an item. Pushes a noise sample (parallel to car.items) and
  // arms the first eval if the AI was previously empty. Mid-queue pickups don't reset the
  // existing timer — the front item keeps its deadline.
  onPickup(car: Car, now: number): void {
    const state = this.skills.get(car);
    if (!state) return;
    state.itemNoise.push({
      r1: Phaser.Math.FloatBetween(-1, 1),
      r2: Phaser.Math.FloatBetween(-1, 1),
      r3: Phaser.Math.FloatBetween(-1, 1),
      pickupAt: now,
    });
    if (car.useItemAt == null && car.items.length > 0) {
      const [lo, hi] = this.initialDelayFor(car.items[0] as Item);
      car.useItemAt = now + Phaser.Math.Between(lo, hi);
    }
  }

  // Called immediately *after* an AI consumes its front item (Car.items has been shifted).
  // Drops the matching noise sample and schedules the next eval if items remain.
  onConsume(car: Car, now: number): void {
    const state = this.skills.get(car);
    if (!state) return;
    state.itemNoise.shift();
    if (car.items.length > 0) {
      const [lo, hi] = this.initialDelayFor(car.items[0] as Item);
      car.useItemAt = now + Phaser.Math.Between(lo, hi);
    }
  }

  // Per-frame hook. Returns true when the AI should fire its front item *now*.
  // On a miss it pushes the recheck deadline so the caller doesn't have to.
  tickItemUse(car: Car, now: number): boolean {
    if (car.items.length === 0) return false;
    if (car.useItemAt == null || now < car.useItemAt) return false;
    if (this.shouldFire(car, now)) return true;
    car.useItemAt = now + AI_ITEM_RECHECK_MS;
    return false;
  }

  input(ai: Car): CarInput {
    const bestIdx = this.closestCenterlineIdx(ai);
    const speed = ai.speed;

    let asphaltCorners = 0;
    for (const c of ai.corners()) {
      if (this.track.surfaceAt(c.x, c.y) === "asphalt") asphaltCorners++;
    }

    // Off-track recovery: with 3+ wheels off the asphalt, abandon the racing line and
    // aim at the bisector of (track-tangent forward, perpendicular-toward-centerline) —
    // a 45° forward-angled rejoin. Switches back to the normal waypoint aim once at
    // least 2 wheels are back on asphalt.
    let desiredAng: number;
    if (asphaltCorners < 2) {
      const probe = this.track.probe(ai.x, ai.y);
      const pts = this.track.centerline;
      const n = pts.length;
      const a = pts[probe.index];
      const b = pts[(probe.index + 1) % n];
      const tdx = b.x - a.x;
      const tdy = b.y - a.y;
      const tlen = Math.hypot(tdx, tdy) || 1;
      const fx = tdx / tlen;
      const fy = tdy / tlen;
      // probe.nx,ny points centerline→car; negate for car→centerline (inward).
      const ax = fx - probe.nx;
      const ay = fy - probe.ny;
      desiredAng = Math.atan2(ay, ax);
    } else {
      const target = this.aimAtRacingLine(ai, bestIdx);
      desiredAng = Math.atan2(target.y - ai.y, target.x - ai.x);
    }
    const diff = Phaser.Math.Angle.Wrap(desiredAng - ai.heading);
    const steer = Phaser.Math.Clamp(diff * 1.8, -1, 1);

    const targetSpeed = this.cornerSpeed(bestIdx, ai.config.maxSpeed);
    let throttle = 1;
    let brake = 0;
    if (speed > targetSpeed * AI_BRAKE_DEADZONE) {
      brake = Phaser.Math.Clamp((speed - targetSpeed) / 80, 0.2, 1);
      throttle = 0;
    } else if (speed > targetSpeed) {
      throttle = Phaser.Math.Clamp((targetSpeed - speed) / AI_THROTTLE_TAPER + 1, 0.4, 1);
    }
    // Steer-induced safety brake: if the aim point is way off heading we're already losing
    // the corner, so dump throttle and add brake on top of the curvature-driven decision.
    if (Math.abs(diff) > 0.6 && speed > 200) {
      throttle = Math.min(throttle, 0.4);
      brake = Math.max(brake, 0.3);
    }

    return { throttle, brake, steer, useItem: false, useDrs: false };
  }

  // Initial scheduling window before the first utility eval. Shield's window is shorter so
  // protection lands quickly; other items get a 1–5s breath before the AI starts considering.
  private initialDelayFor(item: Item): [number, number] {
    if (item === "shield") return [300, 1200];
    return [1000, 5000];
  }

  // Live patience cap. Shorter when inventory is full so the AI doesn't lose pickups while
  // sitting on a low-utility item.
  private patienceFor(car: Car, item: Item): number {
    if (item === "shield") return AI_SHIELD_PATIENCE_MS;
    return car.items.length >= ITEM_INVENTORY_SIZE ? AI_ITEM_PATIENCE_FULL_MS : AI_ITEM_PATIENCE_MS;
  }

  // Quadratic skill→noise: a 0.7-skill AI is still ~quite sharp, only the bottom of
  // the skill range visibly fumbles. skill=0.4 → 0.36, skill=0.7 → 0.09, skill=1.0 → 0.
  private noiseFactor(car: Car): number {
    const skill = this.skills.get(car)?.skill ?? 0.7;
    const inv = 1 - skill;
    return inv * inv;
  }

  private trackLoopLength(): number {
    const cs = this.track.centerlineCumS;
    const cl = this.track.centerline;
    const last = cl.length - 1;
    if (last < 0) return 1;
    return cs[last] + Math.hypot(cl[0].x - cl[last].x, cl[0].y - cl[last].y);
  }

  // Coarse race-progress scalar: lap × loopLen + arc length to nearest centerline node.
  // Used for "ahead/behind" comparisons; modular wrap handled at call sites.
  private raceProgress(car: Car): number {
    const probe = this.track.probe(car.x, car.y);
    const baseS = this.track.centerlineCumS[probe.index] ?? 0;
    return car.lap * this.trackLoopLength() + baseS;
  }

  private closestCenterlineIdx(ai: Car): number {
    const pts = this.track.centerline;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Phaser.Math.Distance.Squared(pts[i].x, pts[i].y, ai.x, ai.y);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  }

  private aimAtRacingLine(ai: Car, bestIdx: number) {
    const pts = this.track.centerline;
    const rl = this.track.racingLine.length === pts.length ? this.track.racingLine : pts;
    const n = pts.length;
    // Arc-length lookahead: walk forward from bestIdx until we've covered
    // AI_LOOKAHEAD_DIST in real distance. Robust to uneven centerline spacing.
    const cumS = this.track.centerlineCumS;
    const totalLen = cumS[n];
    let aimIdx = bestIdx;
    if (cumS.length === n + 1 && totalLen > 0) {
      let acc = 0;
      for (let step = 1; step <= n; step++) {
        const cur = (bestIdx + step) % n;
        const prev = (cur - 1 + n) % n;
        const segEnd = cur === 0 ? totalLen : cumS[cur];
        const segLen = segEnd - cumS[prev];
        acc += segLen;
        if (acc >= AI_LOOKAHEAD_DIST) { aimIdx = cur; break; }
      }
    } else {
      aimIdx = (bestIdx + 4) % n;
    }
    const aim = rl[aimIdx];

    const state = this.skills.get(ai);
    if (!state) return aim;

    const currentChunk = Math.floor(bestIdx / AIM_CHUNK_SIZE);
    if (currentChunk !== state.chunk) {
      state.chunk = currentChunk;
      state.aimOffset = this.sampleAimOffset(state.skill);
    }
    if (state.aimOffset === 0) return aim;

    const prev = pts[(aimIdx - 1 + n) % n];
    const next = pts[(aimIdx + 1) % n];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { x: aim.x + nx * state.aimOffset, y: aim.y + ny * state.aimOffset };
  }

  // Walk the racing line forward. At each point, compute the corner-entry speed allowed by
  // its curvature, then convert to "max speed we can be at right now and still make that
  // corner" via v_now = √(v_corner² + 2 · brake · arc_length_to_point). Return the minimum
  // such threshold across the scan window. So AI cruises at maxSpeed until a corner enters
  // its actual braking horizon — no more crawling 800px before a tight bend.
  private cornerSpeed(bestIdx: number, maxSpeed: number): number {
    const curv = this.track.racingLineCurvature;
    if (curv.length === 0) return maxSpeed;
    const rl = this.track.racingLine.length === curv.length
      ? this.track.racingLine
      : this.track.centerline;
    const n = rl.length;
    let acc = 0;
    let minThreshold = maxSpeed;
    for (let step = 0; step < n; step++) {
      const i = (bestIdx + step) % n;
      const j = (bestIdx + step + 1) % n;
      acc += Math.hypot(rl[j].x - rl[i].x, rl[j].y - rl[i].y);
      const k = curv[i];
      if (k > 0) {
        const vCorner = Math.min(maxSpeed, Math.sqrt(AI_LATERAL_GRIP_LIMIT / k));
        const vNow = Math.sqrt(vCorner * vCorner + 2 * AI_BRAKE_DECEL * acc);
        if (vNow < minThreshold) minThreshold = vNow;
      }
      if (acc > AI_BRAKE_SCAN_DIST) break;
    }
    return minThreshold;
  }

  private sampleAimOffset(skill: number): number {
    const halfWidth = this.track.width / 2;
    const maxOff = halfWidth * (AIM_OFFSET_FLOOR + (1 - skill) * AIM_OFFSET_RANGE);
    const r = Math.random() - Math.random();
    return r * maxOff;
  }

  private shouldFire(ai: Car, now: number): boolean {
    const skillState = this.skills.get(ai);
    if (!skillState || skillState.itemNoise.length === 0) return true;
    const sample = skillState.itemNoise[0];
    const item = ai.items[0] as Item;
    const patience = this.patienceFor(ai, item);
    const elapsed = now - sample.pickupAt;
    if (elapsed >= patience) return true;
    const noise = this.noiseFactor(ai);
    let score: number | null;
    switch (item) {
      case "boost":   score = this.evalBoostUtility(ai, sample, noise); break;
      case "missile": score = this.evalMissileUtility(ai, sample, noise); break;
      case "seeker":  score = this.evalSeekerUtility(ai, sample, noise); break;
      case "oil":     score = this.evalOilUtility(ai, sample, noise); break;
      case "shield":  score = this.evalShieldUtility(ai); break;
    }
    if (score == null) return false;
    const tFrac = elapsed / patience;
    const p = Math.max(0, Math.min(1, AI_FIRE_P_FLOOR + score * AI_FIRE_W_SCORE + tFrac * AI_FIRE_W_TIME));
    return Math.random() < p;
  }

  // Score in [0, 1] = "how good is firing right now". `null` means do-not-fire (already boosting,
  // already shielded). Skill noise still perturbs threshold inputs; bad fit yields a low — but
  // nonzero — score so the time-ramp + floor in shouldFire still lifts probability over patience.
  private evalBoostUtility(ai: Car, s: ItemNoiseSample, n: number): number | null {
    if (ai.boostTimer > 0) return null;
    const cl = this.track.centerline;
    const len = cl.length;
    if (len < 2) return 1;
    const curv = this.track.racingLineCurvature;
    const probe = this.track.probe(ai.x, ai.y);
    let idx = probe.index;
    let acc = 0;
    let maxCurv = curv[idx] ?? 0;
    for (let step = 0; step < len; step++) {
      const next = (idx + 1) % len;
      acc += Math.hypot(cl[next].x - cl[idx].x, cl[next].y - cl[idx].y);
      idx = next;
      const k = curv[idx] ?? 0;
      if (k > maxCurv) maxCurv = k;
      if (acc >= AI_BOOST_SCAN_DIST) break;
    }
    const curvThreshold = AI_BOOST_CURVATURE_MAX * (1 + s.r1 * n * 0.6);
    const curvScore = clamp01(1 - maxCurv / Math.max(1e-6, curvThreshold * 2));
    const speedFloor = ai.config.maxSpeed * (AI_BOOST_SPEED_FRAC + s.r2 * n * 0.15);
    const speedScore = clamp01((ai.speed - speedFloor * 0.7) / Math.max(1e-6, speedFloor * 0.3));
    return curvScore * speedScore;
  }

  private evalMissileUtility(ai: Car, s: ItemNoiseSample, n: number): number | null {
    let nearest: Car | null = null;
    let nearestD = Infinity;
    for (const c of this.getCars()) {
      if (c === ai) continue;
      const d = Phaser.Math.Distance.Between(c.x, c.y, ai.x, ai.y);
      if (d < nearestD) { nearestD = d; nearest = c; }
    }
    if (!nearest) return 0;
    const effD = nearestD * (1 + s.r1 * n * 0.3);
    const rangeScore = clamp01(1 - effD / (AI_MISSILE_RANGE * 1.5));
    const trueAng = Math.atan2(nearest.y - ai.y, nearest.x - ai.x);
    const aimErr = s.r2 * n * 0.4;
    const perceivedRel = Phaser.Math.Angle.Wrap(trueAng - ai.heading + aimErr);
    const dot = Math.cos(perceivedRel);
    const aheadGate = AI_MISSILE_AHEAD_DOT - s.r3 * n * 0.3;
    const bearingScore = clamp01((dot - aheadGate) / Math.max(0.01, 1 - aheadGate));
    return rangeScore * bearingScore;
  }

  private evalSeekerUtility(ai: Car, s: ItemNoiseSample, n: number): number | null {
    const myProg = this.raceProgress(ai);
    const loopLen = this.trackLoopLength();
    let rivalAhead = false;
    for (const c of this.getCars()) {
      if (c === ai) continue;
      const d = (((this.raceProgress(c) - myProg) % loopLen) + loopLen) % loopLen;
      if (d > 20 && d < loopLen / 2) { rivalAhead = true; break; }
    }
    // Without a rival ahead, fall back to a small baseline so leaders don't sit on seekers.
    // Low-skill AIs lift the baseline further (more eager to fire blind).
    const aheadScore = rivalAhead ? 1 : clamp01(0.15 + Math.max(0, s.r1) * n * 0.5);
    const probe = this.track.probe(ai.x, ai.y);
    const localK = this.track.racingLineCurvature[probe.index] ?? 0;
    const threshold = AI_SEEKER_CURVATURE_MAX * (1 + s.r2 * n * 0.6);
    const curvScore = clamp01(1 - localK / Math.max(1e-6, threshold * 2));
    return aheadScore * curvScore;
  }

  private evalOilUtility(ai: Car, s: ItemNoiseSample, n: number): number | null {
    const myProg = this.raceProgress(ai);
    const loopLen = this.trackLoopLength();
    let chaserD = Infinity;
    for (const c of this.getCars()) {
      if (c === ai) continue;
      const dProg = (((myProg - this.raceProgress(c)) % loopLen) + loopLen) % loopLen;
      if (dProg > 0 && dProg < loopLen / 2) {
        const eucD = Phaser.Math.Distance.Between(c.x, c.y, ai.x, ai.y);
        if (eucD < chaserD) chaserD = eucD;
      }
    }
    if (!Number.isFinite(chaserD)) return 0;
    const effD = chaserD * (1 + s.r1 * n * 0.3);
    return clamp01(1 - effD / (AI_OIL_BEHIND_RANGE * 1.5));
  }

  private evalShieldUtility(ai: Car): number | null {
    return ai.shielded ? null : 1;
  }
}
