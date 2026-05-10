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
  // Overtake state. side ∈ {-1, 0, 1} where 0 = not currently attempting an overtake.
  // commitMinUntil locks the side once chosen so AIs don't flicker on noise; commitMaxUntil
  // is a hard timeout so a doomed attempt eventually terminates even if abort gates miss.
  overtakeSide: number;
  overtakeMinUntil: number;
  overtakeMaxUntil: number;
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
// Friendly-fire penalty. Multiplies the utility score for missile/seeker/oil when the
// relevant target (nearest car / closest up-track car / closest chaser) is a teammate.
// Not zero — patience cap and time-ramp can still force-fire if no other use shows up.
const AI_TEAMMATE_PENALTY = 0.15;

// Overtake — pull off the racing line when stuck on the back of a slower car.
// Trigger gates: tight gap to a forward-cone rival, near top speed, and faster than the rival
// (closing-speed delta). Side is committed for at least COMMIT_MIN_MS so steering doesn't
// flicker on noise; aborts kick in once committed (rival pulled away, brake zone, off-track).
// High-skill AIs pick the inside of the next corner and use the full abort logic; low-skill
// AIs pick a random valid side and just ride out the timer. Off-track guard probes the
// candidate side and flips (or cancels) when the chosen offset would put the AI off asphalt.
const AI_OVERTAKE_RANGE = 80;
const AI_OVERTAKE_AHEAD_DOT = 0.8;
const AI_OVERTAKE_SPEED_FRAC = 0.9;
const AI_OVERTAKE_CLOSING_DELTA = 18;
const AI_OVERTAKE_OFFSET_FRAC = 0.55;
const AI_OVERTAKE_COMMIT_MIN_MS = 1200;
const AI_OVERTAKE_COMMIT_MAX_MS = 3500;
const AI_OVERTAKE_BRAKE_ABORT_FRAC = 0.92;
const AI_OVERTAKE_NEXT_CORNER_SCAN = 300;
const AI_OVERTAKE_SKILL_THRESHOLD = 0.6;

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
    this.skills.set(car, {
      skill,
      aimOffset: 0,
      chunk: -1,
      itemNoise: [],
      overtakeSide: 0,
      overtakeMinUntil: 0,
      overtakeMaxUntil: 0,
    });
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

  input(ai: Car, now: number): CarInput {
    const bestIdx = this.closestCenterlineIdx(ai);
    const speed = ai.speed;

    let asphaltCorners = 0;
    for (const c of ai.corners()) {
      if (this.track.surfaceAt(c.x, c.y) === "asphalt") asphaltCorners++;
    }

    const targetSpeed = this.cornerSpeed(bestIdx, ai.config.maxSpeed);

    // Off-track recovery: with 3+ wheels off the asphalt, abandon the racing line and
    // aim at the bisector of (track-tangent forward, perpendicular-toward-centerline) —
    // a 45° forward-angled rejoin. Switches back to the normal waypoint aim once at
    // least 2 wheels are back on asphalt. Also clears any in-progress overtake — no
    // point committing to a pull-out while you're still rejoining.
    let desiredAng: number;
    if (asphaltCorners < 2) {
      this.clearOvertake(ai);
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
      this.updateOvertake(ai, bestIdx, targetSpeed, now);
      const target = this.aimAtRacingLine(ai, bestIdx);
      desiredAng = Math.atan2(target.y - ai.y, target.x - ai.x);
    }
    const diff = Phaser.Math.Angle.Wrap(desiredAng - ai.heading);
    const steer = Phaser.Math.Clamp(diff * 1.8, -1, 1);

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

    // Overtake offset overrides skill drift so the pull-out is visible. Same perpendicular
    // basis at the aim point; sign carries the chosen side. When not in an overtake, fall
    // through to the existing skill drift behaviour.
    let off = state.aimOffset;
    if (state.overtakeSide !== 0) {
      off = state.overtakeSide * (this.track.width / 2) * AI_OVERTAKE_OFFSET_FRAC;
    }
    if (off === 0) return aim;

    const prev = pts[(aimIdx - 1 + n) % n];
    const next = pts[(aimIdx + 1) % n];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { x: aim.x + nx * off, y: aim.y + ny * off };
  }

  // Walk the racing line forward. At each point, compute the corner-entry speed allowed by
  // its curvature, then convert to "max speed we can be at right now and still make that
  // corner" via v_now = √(v_corner² + 2 · brake · arc_length_to_point). Return the minimum
  // such threshold across the scan window. So AI cruises at maxSpeed until a corner enters
  // its actual braking horizon — no more crawling 800px before a tight bend.
  private clearOvertake(ai: Car): void {
    const state = this.skills.get(ai);
    if (!state) return;
    state.overtakeSide = 0;
    state.overtakeMinUntil = 0;
    state.overtakeMaxUntil = 0;
  }

  // Overtake state machine. Run each frame on-track; manages start/abort/timeout.
  // - Trigger: rival in a forward cone within AI_OVERTAKE_RANGE, own speed ≥ 90% maxSpeed,
  //   own speed ≥ rival.speed + closing-delta. Closing-delta scales with skill — stronger
  //   AIs commit at smaller speed advantages.
  // - Side choice: high-skill picks inside of next corner; low-skill random. Off-track guard
  //   probes the proposed offset point and flips (or cancels) if it lands off asphalt.
  // - Commit: side held for at least COMMIT_MIN_MS — no flicker on noise. Hard timeout at
  //   COMMIT_MAX_MS so a doomed pull-out terminates.
  // - Abort (high-skill only): rival no longer ahead within range, brake zone entered, or
  //   chosen side becomes off-track. Low-skill AIs ride out the timer.
  private updateOvertake(ai: Car, bestIdx: number, targetSpeed: number, now: number): void {
    const state = this.skills.get(ai);
    if (!state) return;
    const skill = state.skill;
    const skilled = skill >= AI_OVERTAKE_SKILL_THRESHOLD;

    if (state.overtakeSide !== 0) {
      // Hard timeout always applies; commit-min holds the side regardless of abort signals.
      if (now >= state.overtakeMaxUntil) {
        this.clearOvertake(ai);
      } else if (now >= state.overtakeMinUntil) {
        if (skilled) {
          const rival = this.findOvertakeTarget(ai);
          const brakeZone = targetSpeed < ai.config.maxSpeed * AI_OVERTAKE_BRAKE_ABORT_FRAC;
          const offTrackNow = !this.overtakeSideClear(ai, bestIdx, state.overtakeSide);
          if (!rival || brakeZone || offTrackNow) {
            this.clearOvertake(ai);
          }
        }
      }
      return;
    }

    // Not currently in an overtake — evaluate trigger.
    if (ai.speed < ai.config.maxSpeed * AI_OVERTAKE_SPEED_FRAC) return;
    // Skip when about to brake — pulling out into a corner is a lap-time disaster.
    if (targetSpeed < ai.config.maxSpeed * AI_OVERTAKE_BRAKE_ABORT_FRAC) return;
    const rival = this.findOvertakeTarget(ai);
    if (!rival) return;
    // Skill-modulated closing delta: stronger AIs need less of an advantage to commit.
    const closingDelta = AI_OVERTAKE_CLOSING_DELTA * (1.4 - 0.6 * skill);
    if (ai.speed < rival.speed + closingDelta) return;

    // Pick a candidate side. High-skill: inside of next corner; low-skill: random.
    let primary: number;
    if (skilled) {
      const sgn = this.nextCornerSign(bestIdx, AI_OVERTAKE_NEXT_CORNER_SCAN);
      // Inside-of-corner side relative to (-dy, dx) left-perpendicular basis used in
      // aimAtRacingLine. Net cross > 0 = right turn on screen → inside on right → -1.
      primary = sgn > 0 ? -1 : sgn < 0 ? 1 : (Math.random() < 0.5 ? -1 : 1);
    } else {
      primary = Math.random() < 0.5 ? -1 : 1;
    }
    let chosen = 0;
    if (this.overtakeSideClear(ai, bestIdx, primary)) chosen = primary;
    else if (this.overtakeSideClear(ai, bestIdx, -primary)) chosen = -primary;
    if (chosen === 0) return;

    state.overtakeSide = chosen;
    state.overtakeMinUntil = now + AI_OVERTAKE_COMMIT_MIN_MS;
    state.overtakeMaxUntil = now + AI_OVERTAKE_COMMIT_MAX_MS;
  }

  // Find the rival the AI is most plausibly trying to overtake: tightest gap inside a
  // forward cone within AI_OVERTAKE_RANGE. Returns null if nobody qualifies.
  private findOvertakeTarget(ai: Car): Car | null {
    const fx = Math.cos(ai.heading);
    const fy = Math.sin(ai.heading);
    let best: Car | null = null;
    let bestD = Infinity;
    for (const c of this.getCars()) {
      if (c === ai) continue;
      const dx = c.x - ai.x;
      const dy = c.y - ai.y;
      const d = Math.hypot(dx, dy);
      if (d > AI_OVERTAKE_RANGE || d < 1e-3) continue;
      const dot = (dx * fx + dy * fy) / d;
      if (dot < AI_OVERTAKE_AHEAD_DOT) continue;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // Off-track guard. side ∈ {-1, +1}. Returns true if the perpendicular offset on the
  // chosen side lands on asphalt. Sampled at the AI's current position projected onto
  // the local racing-line normal — that's where the body ends up after the swerve.
  private overtakeSideClear(ai: Car, bestIdx: number, side: number): boolean {
    const pts = this.track.centerline;
    const n = pts.length;
    const prev = pts[(bestIdx - 1 + n) % n];
    const next = pts[(bestIdx + 1) % n];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const off = side * (this.track.width / 2) * AI_OVERTAKE_OFFSET_FRAC;
    const sx = ai.x + nx * off;
    const sy = ai.y + ny * off;
    return this.track.surfaceAt(sx, sy) === "asphalt";
  }

  // Sign of net turning over scanDist of arc length on the racing line, starting at bestIdx.
  // Positive = clockwise on screen (right turn in y-down), negative = counter-clockwise.
  // 0 if the segment is effectively straight or the loop is too short.
  private nextCornerSign(bestIdx: number, scanDist: number): number {
    const rl = this.track.racingLine.length === this.track.centerline.length
      ? this.track.racingLine
      : this.track.centerline;
    const n = rl.length;
    if (n < 3) return 0;
    let acc = 0;
    let netCross = 0;
    for (let step = 0; step < n; step++) {
      const i = (bestIdx + step) % n;
      const j = (bestIdx + step + 1) % n;
      const k = (bestIdx + step + 2) % n;
      const ax = rl[j].x - rl[i].x;
      const ay = rl[j].y - rl[i].y;
      const bx = rl[k].x - rl[j].x;
      const by = rl[k].y - rl[j].y;
      netCross += ax * by - ay * bx;
      acc += Math.hypot(ax, ay);
      if (acc >= scanDist) break;
    }
    if (Math.abs(netCross) < 1) return 0;
    return netCross > 0 ? 1 : -1;
  }

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
    // Friendly-fire: missile homes on the nearest non-owner. If the nearest car is a
    // teammate, almost any missile fired now risks hitting them — drop the score hard.
    const friendly = this.isTeammate(ai, nearest) ? AI_TEAMMATE_PENALTY : 1;
    return rangeScore * bearingScore * friendly;
  }

  private evalSeekerUtility(ai: Car, s: ItemNoiseSample, n: number): number | null {
    const myProg = this.raceProgress(ai);
    const loopLen = this.trackLoopLength();
    let enemyAhead = false;
    let closestUpTrack: Car | null = null;
    let closestProg = Infinity;
    for (const c of this.getCars()) {
      if (c === ai) continue;
      const d = (((this.raceProgress(c) - myProg) % loopLen) + loopLen) % loopLen;
      if (d > 20 && d < loopLen / 2) {
        if (!this.isTeammate(ai, c)) enemyAhead = true;
        if (d < closestProg) { closestProg = d; closestUpTrack = c; }
      }
    }
    // Without an enemy ahead, fall back to a small baseline so leaders don't sit on seekers.
    // Low-skill AIs lift the baseline further (more eager to fire blind). Teammates ahead
    // don't qualify as a rival here — the seeker would just lock the friend.
    const aheadScore = enemyAhead ? 1 : clamp01(0.15 + Math.max(0, s.r1) * n * 0.5);
    const probe = this.track.probe(ai.x, ai.y);
    const localK = this.track.racingLineCurvature[probe.index] ?? 0;
    const threshold = AI_SEEKER_CURVATURE_MAX * (1 + s.r2 * n * 0.6);
    const curvScore = clamp01(1 - localK / Math.max(1e-6, threshold * 2));
    // Friendly-fire: seeker spawns 24px ahead and locks the first non-owner inside its
    // 140u arming radius. If the closest up-track car is a teammate, they're the most
    // likely target — penalise. If only a teammate is ahead but no enemy at all, the
    // baseline score plus this penalty keeps the seeker mostly suppressed until patience.
    const friendly = closestUpTrack && this.isTeammate(ai, closestUpTrack) ? AI_TEAMMATE_PENALTY : 1;
    return aheadScore * curvScore * friendly;
  }

  private evalOilUtility(ai: Car, s: ItemNoiseSample, n: number): number | null {
    const myProg = this.raceProgress(ai);
    const loopLen = this.trackLoopLength();
    let chaser: Car | null = null;
    let chaserD = Infinity;
    for (const c of this.getCars()) {
      if (c === ai) continue;
      const dProg = (((myProg - this.raceProgress(c)) % loopLen) + loopLen) % loopLen;
      if (dProg > 0 && dProg < loopLen / 2) {
        const eucD = Phaser.Math.Distance.Between(c.x, c.y, ai.x, ai.y);
        if (eucD < chaserD) { chaserD = eucD; chaser = c; }
      }
    }
    if (!chaser) return 0;
    const effD = chaserD * (1 + s.r1 * n * 0.3);
    // Friendly-fire: oil drops behind the firing car. If the closest chaser is a teammate,
    // they're who eats it — penalise.
    const friendly = this.isTeammate(ai, chaser) ? AI_TEAMMATE_PENALTY : 1;
    return clamp01(1 - effD / (AI_OIL_BEHIND_RANGE * 1.5)) * friendly;
  }

  private evalShieldUtility(ai: Car): number | null {
    return ai.shielded ? null : 1;
  }

  // Two cars are teammates iff both have the same non-null teamId. Null teamId on either
  // side falls through to "not a teammate" so unset cars (e.g. tests) just behave as before.
  private isTeammate(a: Car, b: Car): boolean {
    return a.teamId != null && a.teamId === b.teamId;
  }
}
