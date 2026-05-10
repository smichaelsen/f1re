import Phaser from "phaser";
import type { CarInput } from "../entities/Car";

// An input source is what a single human player reads from. We keep two keyboard
// schemes (arrows / wasd) so two humans can share one keyboard, plus a pad
// identified by its Gamepad.id so it survives reconnects across sessions.
export type KeyboardScheme = "arrows" | "wasd";

// `padIndex` is the live `Gamepad.index` slot. Two physically identical controllers (e.g. two
// Switch Pro Controllers) report the *same* `Gamepad.id` string, so an id-only identity treats
// them as the same source. Identity uses `padIndex`; `padId` is kept for display + reconnect-time
// rebinding when an index slot has shifted between sessions.
export type InputSource =
  | { kind: "keyboard"; scheme: KeyboardScheme }
  | { kind: "pad"; padId: string; padIndex: number };

export function sourcesEqual(a: InputSource | null, b: InputSource | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "keyboard" && b.kind === "keyboard") return a.scheme === b.scheme;
  if (a.kind === "pad" && b.kind === "pad") return a.padIndex === b.padIndex;
  return false;
}

export function describeSource(s: InputSource): string {
  if (s.kind === "keyboard") return s.scheme === "arrows" ? "ARROWS + ENTER" : "WASD + SPACE";
  return shortenPadId(s.padId);
}

export function shortenPadId(id: string): string {
  // Pad ids look like "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)".
  // Show the prefix before the parens; fall back to the full id.
  const idx = id.indexOf("(");
  const head = idx > 0 ? id.slice(0, idx).trim() : id;
  return (head || id).toUpperCase().slice(0, 28);
}

const STICK_DEADZONE = 0.15;

function applyDeadzone(v: number): number {
  if (Math.abs(v) < STICK_DEADZONE) return 0;
  const sign = Math.sign(v);
  return sign * Math.min(1, (Math.abs(v) - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}

function getPads(): (Gamepad | null)[] {
  return typeof navigator !== "undefined" && navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
}

export interface PadInfo {
  index: number;
  id: string;
}

export interface PadDebugSnapshot {
  index: number;
  id: string;
  throttle: number;
  brake: number;
  steerX: number;
  pressedButtons: number[];
}

// Standard-gamepad button index for the right shoulder (R / RB). Used as the manual DRS button.
const PAD_DRS_BUTTON = 5;
// Standard-gamepad button index for "Start" / "Options" / "+" — used to toggle pause from any
// connected controller. Switch Pro Controller's "+" reports here.
const PAD_PAUSE_BUTTON = 9;

export class InputReader {
  private keys: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
    enter: Phaser.Input.Keyboard.Key;
    // DRS keys, one per scheme. WASD scheme (P1) uses Q (upper-left of WASD); arrows scheme (P2)
    // uses SHIFT (Phaser KeyCodes don't expose left/right shift separately, but P1 doesn't bind
    // shift so the keys don't collide). 1P `readAuto` accepts both.
    q: Phaser.Input.Keyboard.Key;
    shift: Phaser.Input.Keyboard.Key;
  };
  // Per-pad edge state for the east button (Switch A / Xbox B). Keyed by pad index.
  private prevPadEast = new Map<number, boolean>();
  // Per-pad edge state for the DRS shoulder button.
  private prevPadDrs = new Map<number, boolean>();
  // Per-pad edge state for the pause button (Switch +, Xbox Start, PS Options).
  private prevPadPause = new Map<number, boolean>();

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (!kb) throw new Error("InputReader requires a keyboard plugin");
    const KC = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(KC.UP),
      down: kb.addKey(KC.DOWN),
      left: kb.addKey(KC.LEFT),
      right: kb.addKey(KC.RIGHT),
      w: kb.addKey(KC.W),
      a: kb.addKey(KC.A),
      s: kb.addKey(KC.S),
      d: kb.addKey(KC.D),
      space: kb.addKey(KC.SPACE),
      enter: kb.addKey(KC.ENTER),
      q: kb.addKey(KC.Q),
      shift: kb.addKey(KC.SHIFT),
    };
  }

  read(source: InputSource): CarInput {
    if (source.kind === "keyboard") {
      if (source.scheme === "arrows") {
        return {
          throttle: this.keys.up.isDown ? 1 : 0,
          brake: this.keys.down.isDown ? 1 : 0,
          steer: (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0),
          useItem: Phaser.Input.Keyboard.JustDown(this.keys.enter),
          useDrs: Phaser.Input.Keyboard.JustDown(this.keys.shift),
        };
      }
      return {
        throttle: this.keys.w.isDown ? 1 : 0,
        brake: this.keys.s.isDown ? 1 : 0,
        steer: (this.keys.d.isDown ? 1 : 0) - (this.keys.a.isDown ? 1 : 0),
        useItem: Phaser.Input.Keyboard.JustDown(this.keys.space),
        useDrs: Phaser.Input.Keyboard.JustDown(this.keys.q),
      };
    }
    const pad = this.resolvePad(source);
    if (!pad) {
      return { throttle: 0, brake: 0, steer: 0, useItem: false, useDrs: false };
    }
    const east = !!pad.buttons[1]?.pressed;
    const prev = this.prevPadEast.get(pad.index) ?? false;
    this.prevPadEast.set(pad.index, east);
    const drs = !!pad.buttons[PAD_DRS_BUTTON]?.pressed;
    const prevDrs = this.prevPadDrs.get(pad.index) ?? false;
    this.prevPadDrs.set(pad.index, drs);
    return {
      throttle: pad.buttons[7]?.value ?? 0,
      brake: pad.buttons[6]?.value ?? 0,
      steer: applyDeadzone(pad.axes[0] ?? 0),
      useItem: east && !prev,
      useDrs: drs && !prevDrs,
    };
  }

  // Edge-detect the Start/+ button (Switch +, Xbox Start, PS Options) on any connected
  // pad. Returns true on the frame of a fresh press; must be called once per frame to
  // maintain per-pad edge state. Used by RaceScene for the pad-pause toggle.
  pollPadPauseEdge(): boolean {
    let fired = false;
    for (const p of getPads()) {
      if (!p || !p.connected) continue;
      const pressed = !!p.buttons[PAD_PAUSE_BUTTON]?.pressed;
      const prev = this.prevPadPause.get(p.index) ?? false;
      if (pressed && !prev) fired = true;
      this.prevPadPause.set(p.index, pressed);
    }
    return fired;
  }

  // Side-effect-free throttle read for pre-race revs. Avoids advancing edge-detection state.
  readThrottle(source: InputSource): number {
    if (source.kind === "keyboard") {
      if (source.scheme === "arrows") return this.keys.up.isDown ? 1 : 0;
      return this.keys.w.isDown ? 1 : 0;
    }
    return this.resolvePad(source)?.buttons[7]?.value ?? 0;
  }

  readAutoThrottle(): number {
    let t = this.keys.up.isDown ? 1 : 0;
    for (const p of getPads()) {
      if (p && p.connected) {
        t = Math.max(t, p.buttons[7]?.value ?? 0);
        break;
      }
    }
    return t;
  }

  // 1P fallback: read keyboard arrows + first connected pad and OR/max-merge them,
  // so a single player gets pad input "for free" without picking a source.
  readAuto(): CarInput {
    const kbInput = this.read({ kind: "keyboard", scheme: "arrows" });
    const useItemKb = kbInput.useItem || Phaser.Input.Keyboard.JustDown(this.keys.space);
    // 1P keyboard convenience: also accept Q for DRS so single-player keyboard users get both
    // schemes' bindings (the strict per-scheme binding only kicks in for explicit 2P sources).
    const useDrsKb = kbInput.useDrs || Phaser.Input.Keyboard.JustDown(this.keys.q);
    let firstPad: Gamepad | null = null;
    for (const p of getPads()) {
      if (p && p.connected) {
        firstPad = p;
        break;
      }
    }
    if (!firstPad) {
      return { ...kbInput, useItem: useItemKb, useDrs: useDrsKb };
    }
    const padInput = this.read({ kind: "pad", padId: firstPad.id, padIndex: firstPad.index });
    return {
      throttle: Math.max(kbInput.throttle, padInput.throttle),
      brake: Math.max(kbInput.brake, padInput.brake),
      steer: Math.abs(padInput.steer) > Math.abs(kbInput.steer) ? padInput.steer : kbInput.steer,
      useItem: useItemKb || padInput.useItem,
      useDrs: useDrsKb || padInput.useDrs,
    };
  }

  // Press-to-join: returns the source that just had a fresh activation, skipping any
  // source already in `exclude`. Activation = JustDown on a directional/action key for
  // keyboard, or any face button / trigger > 0.3 for a pad.
  pollNewPress(exclude: (InputSource | null)[]): InputSource | null {
    const isExcluded = (s: InputSource) => exclude.some((e) => sourcesEqual(e, s));

    // Activation deliberately uses direction keys only — ENTER/SPACE are reserved for menu
    // actions (start race) and would otherwise be claimed before the menu listener runs.
    const arrows: InputSource = { kind: "keyboard", scheme: "arrows" };
    if (
      !isExcluded(arrows) &&
      (Phaser.Input.Keyboard.JustDown(this.keys.up) ||
        Phaser.Input.Keyboard.JustDown(this.keys.down) ||
        Phaser.Input.Keyboard.JustDown(this.keys.left) ||
        Phaser.Input.Keyboard.JustDown(this.keys.right))
    ) {
      return arrows;
    }

    const wasd: InputSource = { kind: "keyboard", scheme: "wasd" };
    if (
      !isExcluded(wasd) &&
      (Phaser.Input.Keyboard.JustDown(this.keys.w) ||
        Phaser.Input.Keyboard.JustDown(this.keys.a) ||
        Phaser.Input.Keyboard.JustDown(this.keys.s) ||
        Phaser.Input.Keyboard.JustDown(this.keys.d))
    ) {
      return wasd;
    }

    for (const pad of getPads()) {
      if (!pad || !pad.connected) continue;
      const padSrc: InputSource = { kind: "pad", padId: pad.id, padIndex: pad.index };
      if (isExcluded(padSrc)) continue;
      const triggerHit = (pad.buttons[6]?.value ?? 0) > 0.3 || (pad.buttons[7]?.value ?? 0) > 0.3;
      let buttonHit = false;
      for (let i = 0; i < Math.min(pad.buttons.length, 12); i++) {
        if (pad.buttons[i]?.pressed) {
          buttonHit = true;
          break;
        }
      }
      if (triggerHit || buttonHit) return padSrc;
    }

    return null;
  }

  getConnectedPads(): PadInfo[] {
    const out: PadInfo[] = [];
    for (const p of getPads()) {
      if (p && p.connected) out.push({ index: p.index, id: p.id });
    }
    return out;
  }

  isPadConnected(source: { padIndex: number; padId: string }): boolean {
    return this.resolvePad(source) !== null;
  }

  getPadDebugSnapshot(source: { padIndex: number; padId: string }): PadDebugSnapshot | null {
    const pad = this.resolvePad(source);
    if (!pad) return null;
    const pressed: number[] = [];
    for (let i = 0; i < pad.buttons.length; i++) {
      if (pad.buttons[i]?.pressed) pressed.push(i);
    }
    return {
      index: pad.index,
      id: pad.id,
      throttle: pad.buttons[7]?.value ?? 0,
      brake: pad.buttons[6]?.value ?? 0,
      steerX: applyDeadzone(pad.axes[0] ?? 0),
      pressedButtons: pressed,
    };
  }

  // Resolve a pad source against the live gamepad list. Index-first (so two identical controllers
  // route to distinct slots within a session). If the slot is empty or holds a different model,
  // fall back to id-match — covers the case where the OS renumbered controllers between sessions.
  private resolvePad(source: { padIndex: number; padId: string }): Gamepad | null {
    const pads = getPads();
    const direct = pads[source.padIndex];
    if (direct && direct.connected && direct.id === source.padId) return direct;
    for (const p of pads) {
      if (p && p.connected && p.id === source.padId) return p;
    }
    return null;
  }
}

const STORAGE_KEY = "f1re.inputAssignments";

export interface InputAssignments {
  p1: InputSource | null;
  p2: InputSource | null;
}

export function loadAssignments(): InputAssignments {
  if (typeof localStorage === "undefined") return { p1: null, p2: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { p1: null, p2: null };
    const parsed = JSON.parse(raw) as { p1?: unknown; p2?: unknown };
    return {
      p1: validateSource(parsed?.p1),
      p2: validateSource(parsed?.p2),
    };
  } catch {
    return { p1: null, p2: null };
  }
}

export function saveAssignments(a: InputAssignments) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    // Quota / privacy errors are non-fatal — user just won't get persistence.
  }
}

function validateSource(s: unknown): InputSource | null {
  if (!s || typeof s !== "object") return null;
  const obj = s as { kind?: unknown; scheme?: unknown; padId?: unknown; padIndex?: unknown };
  if (obj.kind === "keyboard" && (obj.scheme === "arrows" || obj.scheme === "wasd")) {
    return { kind: "keyboard", scheme: obj.scheme };
  }
  if (
    obj.kind === "pad" &&
    typeof obj.padId === "string" &&
    typeof obj.padIndex === "number" &&
    Number.isInteger(obj.padIndex) &&
    obj.padIndex >= 0
  ) {
    return { kind: "pad", padId: obj.padId, padIndex: obj.padIndex };
  }
  // Pre-`padIndex` saves stored only `padId`. Drop them so the user re-presses to bind — this
  // also forces a clean rebind when the user has multiple identical controllers.
  return null;
}
