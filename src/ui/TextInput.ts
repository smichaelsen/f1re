import Phaser from "phaser";

export interface TextInputOptions {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  height: number;
  initialValue: string;
  maxLength: number;
  // Allow A-Z, 0-9, space (lowercase typed is auto-uppercased).
  onChange: (value: string) => void;
  // Required because the input replaces the live text — empty strings are coerced to fallback
  // on blur so the field never reads as completely blank.
  fallback: string;
}

const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, monospace";

export class TextInput {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  textObj: Phaser.GameObjects.Text;
  caret: Phaser.GameObjects.Rectangle;
  value: string;
  focused = false;
  private opts: TextInputOptions;
  private blinkEvent: Phaser.Time.TimerEvent | null = null;

  constructor(opts: TextInputOptions) {
    this.opts = opts;
    this.value = opts.initialValue.slice(0, opts.maxLength);
    const { scene, x, y, width, height } = opts;
    this.container = scene.add.container(x, y);
    this.bg = scene.add
      .rectangle(0, 0, width, height, 0x1d1d1d)
      .setStrokeStyle(2, 0x444444)
      .setInteractive({ useHandCursor: true });
    this.textObj = scene.add
      .text(-width / 2 + 12, 0, this.value, {
        fontFamily: FONT_FAMILY,
        fontSize: "20px",
        color: "#ffffff",
      })
      .setOrigin(0, 0.5);
    this.caret = scene.add
      .rectangle(0, 0, 2, height - 16, 0xffd24a)
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.repositionCaret();
    this.container.add([this.bg, this.textObj, this.caret]);

    this.bg.on("pointerdown", (_p: Phaser.Input.Pointer, _lx: number, _ly: number, e: Phaser.Types.Input.EventData) => {
      this.focus();
      e.stopPropagation();
    });
  }

  focus() {
    if (this.focused) return;
    this.focused = true;
    this.bg.setStrokeStyle(2, 0xffd24a);
    this.caret.setVisible(true);
    this.blinkEvent = this.opts.scene.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => this.caret.setVisible(!this.caret.visible),
    });
  }

  blur() {
    if (!this.focused) return;
    this.focused = false;
    this.bg.setStrokeStyle(2, 0x444444);
    this.caret.setVisible(false);
    this.blinkEvent?.remove(false);
    this.blinkEvent = null;
    if (this.value.length === 0) {
      this.value = this.opts.fallback;
      this.textObj.setText(this.value);
      this.repositionCaret();
      this.opts.onChange(this.value);
    }
  }

  setValue(v: string) {
    this.value = v.slice(0, this.opts.maxLength);
    this.textObj.setText(this.value);
    this.repositionCaret();
  }

  // Returns true if the event was consumed (so the host scene can short-circuit menu hotkeys).
  handleKey(e: KeyboardEvent): boolean {
    if (!this.focused) return false;
    if (e.key === "Enter" || e.key === "Escape") {
      this.blur();
      return true;
    }
    if (e.key === "Backspace") {
      if (this.value.length > 0) {
        this.value = this.value.slice(0, -1);
        this.textObj.setText(this.value);
        this.repositionCaret();
        this.opts.onChange(this.value);
      }
      return true;
    }
    if (e.key.length === 1) {
      const ch = e.key.toUpperCase();
      if (!/^[A-Z0-9 ]$/.test(ch)) return false;
      if (this.value.length >= this.opts.maxLength) return true;
      this.value += ch;
      this.textObj.setText(this.value);
      this.repositionCaret();
      this.opts.onChange(this.value);
      return true;
    }
    return false;
  }

  private repositionCaret() {
    const x = this.textObj.x + this.textObj.width + 2;
    this.caret.setPosition(x, 0);
  }

  setVisible(v: boolean) {
    this.container.setVisible(v);
    if (!v) this.blur();
  }

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y);
  }
}
